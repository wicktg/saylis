#!/usr/bin/env node
/**
 * Fills in `spot_price_wei` for curve trades indexed before the indexer
 * started recording it.
 *
 * WHAT THIS IS FOR
 *
 * Pool trades have always carried a marginal price, decoded from the Swap
 * event's own `sqrtPriceX96`. Curve trades did not — the frontend
 * reconstructed theirs, walking backwards from the curve's CURRENT token
 * reserve and undoing each trade in turn. That makes every historical price
 * on the chart depend on two live reads still being correct, and it cannot
 * work at all once a token graduates and its reserve is drained to seed the
 * pool.
 *
 * `src/index.ts` now reads `getPrice()` at the trade's own block and stores
 * it, so new trades arrive with the value already on them. This is the same
 * read, applied to the rows that predate that change.
 *
 * WHY A SCRIPT AND NOT A RE-INDEX
 *
 * Wiping the schema and letting Ponder rebuild would also populate these,
 * but it drops and recreates `indexer.chain_trades` — taking the Realtime
 * publication, the RLS policy and the grants with it, so both
 * supabase/indexer_views.sql and supabase/indexer_realtime.sql would have to
 * be re-applied, and the trade feed would fall back to polling until they
 * were. This touches one column and leaves everything else alone.
 *
 * SAFE TO RE-RUN
 *
 * Only rows where `spot_price_wei IS NULL` are considered, and a row whose
 * price cannot be read is left null rather than filled with a guess — so
 * running it twice does nothing the first run already did, and a partial
 * run simply resumes.
 *
 * USAGE
 *
 *   cd indexer && node scripts/backfill-spot-prices.mjs
 *
 * THIS ONE NEEDS AN ARCHIVE RPC — NOT `PONDER_RPC_URL`
 *
 * It asks what a contract returned at a block from weeks ago, which a full
 * node cannot answer: the public endpoint keeps state for roughly the last
 * few thousand blocks and rejects anything older with "Missing or invalid
 * parameters". Alchemy serves it. So this defaults to `BACKFILL_RPC_URL`,
 * then the frontend's `ROBINHOOD_RPC_URL` (which is the Alchemy one), and
 * only falls back to `PONDER_RPC_URL` if neither is set.
 *
 * That is the opposite of the indexer's own preference, and both are right:
 * `src/index.ts` reads at the block a trade just landed in, which is the
 * head and well inside any node's state window, so it stays on the public
 * endpoint and its uncapped eth_getLogs.
 *
 * USAGE
 *
 *   cd indexer && node scripts/backfill-spot-prices.mjs
 *
 * Needs SUPABASE_DB_URL (the direct Postgres connection string) and an
 * archive RPC as above. Pass --dry-run to see what it would change without
 * writing.
 */
import { createPublicClient, http, parseAbiItem } from "viem";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Loads `.env.local` the way the rest of this directory expects.
 *
 * `ponder start` reads it automatically, so every other entry point here
 * behaves as though those variables simply exist. A plain Node script gets
 * no such treatment, and the resulting failure ("SUPABASE_DB_URL is not
 * set") points at a variable that is sitting right there in the file.
 *
 * Both files are read because the two halves of this repo split their
 * config: the indexer's own settings live in indexer/.env.local, while the
 * archive RPC this script needs is ROBINHOOD_RPC_URL from the app's root
 * .env.local. Real environment variables always win, so a value passed on
 * the command line or set in a deployment is never overwritten by a file.
 */
function loadEnvFile(path) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return; // Absent is fine — the variables may come from the environment.
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(join(__dirname, "..", ".env.local"));
loadEnvFile(join(__dirname, "..", "..", ".env.local"));

const DRY_RUN = process.argv.includes("--dry-run");

const DATABASE_URL = process.env.SUPABASE_DB_URL;
const RPC_URL =
  process.env.BACKFILL_RPC_URL ?? process.env.ROBINHOOD_RPC_URL ?? process.env.PONDER_RPC_URL;
const SCHEMA = process.env.DATABASE_SCHEMA ?? "indexer";

if (!DATABASE_URL) {
  console.error(
    "SUPABASE_DB_URL is not set. It is the direct Postgres connection string\n" +
      "(Supabase dashboard > Settings > Database > Connection string > URI),\n" +
      "the same one ponder.config.ts uses — not the NEXT_PUBLIC_SUPABASE_URL pair."
  );
  process.exit(1);
}

if (!RPC_URL) {
  console.error("No RPC configured. Set BACKFILL_RPC_URL to an archive endpoint.");
  process.exit(1);
}

const GET_PRICE_ABI = [parseAbiItem("function getPrice() view returns (uint256)")];

const client = createPublicClient({ transport: http(RPC_URL) });

/**
 * Reads are issued a few at a time rather than all at once. The public node
 * has no documented concurrency limit, but a backfill is not in a hurry and
 * a burst is the one way this could earn a rate limit it doesn't need.
 */
const BATCH_SIZE = 5;

async function main() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  try {
    // Curve trades only. A pool trade with no spot price means the Swap
    // event carried a zero sqrtPriceX96, which getPrice() cannot answer for
    // — the curve is not what priced it.
    const { rows } = await db.query(
      `select id, curve_address, block_number
         from ${SCHEMA}.chain_trades
        where venue = 'curve'
          and spot_price_wei is null
        order by block_number asc`
    );

    if (rows.length === 0) {
      // "No rows need filling" has two very different causes, and reporting
      // them identically is actively misleading: an empty table looks like a
      // completed backfill. Distinguish them, because "the indexer has not
      // written anything yet" means wait, and "all filled" means done.
      const { rows: totals } = await db.query(
        `select count(*)::int as total,
                count(*) filter (where venue = 'curve')::int as curve
           from ${SCHEMA}.chain_trades`
      );
      const { total, curve } = totals[0];

      if (total === 0) {
        console.log(
          "No trades indexed yet — nothing to backfill.\n" +
            "The table exists but is empty, which usually means the indexer is\n" +
            "still working through its historical sync. Check `railway logs`\n" +
            "for 'Synced block N' and run this again once trades appear."
        );
      } else if (curve === 0) {
        console.log(`${total} trade(s) indexed, none on a curve — nothing this script can fill.`);
      } else {
        console.log(`All ${curve} curve trade(s) already have a spot price. Nothing to do.`);
      }
      return;
    }

    console.log(`${rows.length} curve trade(s) missing a spot price.`);
    if (DRY_RUN) console.log("(dry run — nothing will be written)\n");

    let filled = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);

      const priced = await Promise.all(
        slice.map(async (row) => {
          try {
            const price = await client.readContract({
              address: row.curve_address,
              abi: GET_PRICE_ABI,
              functionName: "getPrice",
              // The price as of the block this trade landed in — not now.
              blockNumber: BigInt(row.block_number),
            });
            return { row, price };
          } catch (error) {
            // Left null rather than guessed. The frontend still falls back
            // to reconstruction for a null, so a failure here costs nothing
            // beyond the improvement, and a wrong value would be worse than
            // no value.
            console.warn(`  skip ${row.id}: ${error.shortMessage ?? error.message}`);
            return { row, price: null };
          }
        })
      );

      for (const { row, price } of priced) {
        if (price === null) {
          skipped++;
          continue;
        }
        if (!DRY_RUN) {
          await db.query(
            `update ${SCHEMA}.chain_trades set spot_price_wei = $1 where id = $2`,
            [price.toString(), row.id]
          );
        }
        filled++;
        console.log(`  ${row.id} @ block ${row.block_number} -> ${price} wei`);
      }
    }

    console.log(
      `\n${DRY_RUN ? "Would fill" : "Filled"} ${filled} row(s)` +
        (skipped > 0 ? `, ${skipped} left null (unreadable).` : ".")
    );

    // Every single read failing is not eight independent problems — it is
    // one, and almost always the same one: a full node being asked for
    // state it no longer holds. Worth saying outright, because the run
    // otherwise looks like it merely found nothing worth doing.
    if (filled === 0 && skipped === rows.length) {
      console.error(
        `\nNothing could be read. This usually means ${RPC_URL.split("/")[2]} is not an\n` +
          "archive node — historical eth_call is exactly what this needs. Set\n" +
          "BACKFILL_RPC_URL to an archive endpoint and run it again."
      );
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
