#!/usr/bin/env node
/**
 * Writes `addresses.generated.json` — the list of every BondingCurve
 * address this indexer should watch — by reading Supabase's `tokens`
 * table, the same authoritative registry the frontend already uses.
 *
 * WHY THIS IS A SEPARATE STARTUP STEP, NOT PART OF ponder.config.ts DIRECTLY
 *
 * BondingCurve instances have no on-chain factory — every launch deploys
 * one with two raw `deployContract` calls from the frontend, not a
 * `factory.createCurve()` call — so there is no event Ponder's real
 * `factory()` pattern (used for pool discovery below) can key off. Without
 * SOME registry, Ponder has no way to know which addresses to watch at all.
 *
 * Supabase's `tokens.curve_address` column IS that registry. Querying it
 * here, at process start, rather than trying to import the Supabase client
 * inside `ponder.config.ts` itself, keeps the config file a plain
 * synchronous module — simpler to reason about than depending on whether
 * Ponder's own config loader supports an async default export.
 *
 * THE REAL LIMITATION THIS CREATES
 *
 * This list is a snapshot taken at indexer startup. A token launched AFTER
 * that snapshot is invisible to this indexer until it restarts — there is
 * no live "watch Supabase for new rows" path. Re-run `npm run dev`/`start`
 * (or schedule a periodic restart on whatever host runs this) to pick up
 * new launches. This is a known, deliberate tradeoff of not having an
 * on-chain factory to discover instances from — see the project README.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load `indexer/.env.local` by hand.
 *
 * Ponder loads this file itself, but this script runs as a plain `node`
 * process BEFORE ponder (see the `dev`/`start` npm scripts), so it gets no
 * env at all. Because the two are joined with `&&`, that made the script
 * exit 1 and silently prevented `ponder dev` from ever starting — the
 * indexer looked like it was failing to connect when in fact it was never
 * being launched.
 *
 * Deliberately minimal rather than pulling in dotenv: values are taken
 * verbatim after the first `=` (so a Postgres URL containing `=` or `@`
 * survives intact) and existing env wins, so a real environment — CI, a
 * container, a host's dashboard — always overrides the local file.
 */
function loadEnvLocal() {
  let contents;
  try {
    contents = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  } catch {
    return; // No local file: rely on the ambient environment.
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, if present.
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them in indexer/.env.local " +
      "(same values as the main app's .env.local)."
  );
  process.exit(1);
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("tokens")
  .select("curve_address, contract_address")
  .order("created_at", { ascending: true });

if (error) {
  console.error("Could not read tokens table:", error.message);
  process.exit(1);
}

const curveAddresses = (data ?? []).map((row) => row.curve_address);
const tokenByCurve = Object.fromEntries(
  (data ?? []).map((row) => [row.curve_address, row.contract_address])
);

writeFileSync(
  join(__dirname, "..", "addresses.generated.json"),
  JSON.stringify({ curveAddresses, tokenByCurve }, null, 2)
);

console.log(`wrote ${curveAddresses.length} curve address(es) to addresses.generated.json`);
