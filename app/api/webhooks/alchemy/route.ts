import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import type { Address, Hex } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { decodeTradeLog, type DecodedTrade } from "@/app/_lib/tradeLogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Alchemy webhook receiver — the only thing that writes trades.
 *
 * This replaced a Ponder indexer running as a separate always-on service.
 * The indexing was never the hard part; keeping a process alive was, and it
 * is what produced every outage this project has had. A webhook route has
 * no uptime of its own to manage: it is available because the site is.
 *
 * SIGNATURE VERIFICATION IS NOT OPTIONAL
 *
 * This endpoint is public and it writes the trade history that the chart,
 * the feed and every volume figure are drawn from. Without verification,
 * anyone who finds the URL can post fabricated trades into every user's
 * chart. The signature is checked against the RAW body before anything is
 * parsed, which is also why the body is read with .text() and not .json():
 * re-serializing changes the bytes and invalidates the HMAC.
 *
 * DUPLICATES ARE EXPECTED
 *
 * Alchemy retries on any non-2xx and can deliver the same event twice. The
 * primary key is `${txHash}-${logIndex}`, so an upsert that ignores
 * conflicts makes a redelivery free. That is also why this returns 200 for
 * anything it has understood, even when it stored nothing — a 500 would
 * earn a retry loop for an event that will never parse.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not guarantee completeness. A delivery lost to a deploy or to
 * exhausted retries leaves a hole, and a hole in the middle of a chart is
 * invisible. app/api/cron/reconcile exists for exactly that and is not
 * optional either.
 */

/** One log, flattened out of whichever payload shape delivered it. */
type NormalizedLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
  timestamp: number;
};

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value !== "") {
    try {
      return Number(BigInt(value)); // handles "0x..." and decimal alike
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Flattens an Alchemy delivery into logs.
 *
 * The GraphQL (Custom Webhook) shape is NOT the flat log shape the JSON-RPC
 * world uses, and the differences are silent — every one of them yields
 * `undefined` rather than an error, so a mismatch shows up as a webhook that
 * returns 200 and stores nothing:
 *
 *   - the log's position is `index`, not `logIndex`
 *   - the block number lives on the BLOCK, not on the log
 *   - the emitting contract is `account.address`, not `address`
 *   - the transaction hash is `transaction.hash`, not `transactionHash`
 *
 * Normalizing here keeps that entirely out of the decoder, which then only
 * ever sees one shape.
 */
function extractLogs(payload: unknown): NormalizedLog[] {
  const event = (payload as { event?: Record<string, unknown> })?.event;
  if (!event) return [];

  const block = (event as { data?: { block?: Record<string, unknown> } }).data?.block;
  if (block && Array.isArray(block.logs)) {
    const blockNumber = num(block.number);
    const timestamp = num(block.timestamp);
    if (blockNumber === null) return [];

    return (block.logs as Record<string, unknown>[]).flatMap((log) => {
      const address = (log.account as { address?: string } | undefined)?.address;
      const hash = (log.transaction as { hash?: string } | undefined)?.hash;
      const logIndex = num(log.index);
      if (!address || !hash || logIndex === null || !Array.isArray(log.topics)) return [];

      return [
        {
          address,
          topics: log.topics as string[],
          data: typeof log.data === "string" ? log.data : "0x",
          blockNumber,
          logIndex,
          transactionHash: hash,
          timestamp: timestamp ?? 0,
        },
      ];
    });
  }

  // Address-activity webhooks deliver flat, JSON-RPC-shaped logs instead.
  const flat = (event as { logs?: Record<string, unknown>[] }).logs;
  if (!Array.isArray(flat)) return [];

  return flat.flatMap((log) => {
    const blockNumber = num(log.blockNumber);
    const logIndex = num(log.logIndex);
    if (
      typeof log.address !== "string" ||
      typeof log.transactionHash !== "string" ||
      blockNumber === null ||
      logIndex === null ||
      !Array.isArray(log.topics)
    ) {
      return [];
    }
    return [
      {
        address: log.address,
        topics: log.topics as string[],
        data: typeof log.data === "string" ? log.data : "0x",
        blockNumber,
        logIndex,
        transactionHash: log.transactionHash,
        timestamp: num(log.blockTimestamp) ?? 0,
      },
    ];
  });
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and the length is not a secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  // Raw bytes, before any parsing — see the note above.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-alchemy-signature"))) {
    // Deliberately terse. A detailed reason helps an attacker calibrate.
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const logs = extractLogs(payload);
  if (logs.length === 0) return NextResponse.json({ received: 0, stored: 0 });

  const admin = getSupabaseAdmin();

  // Pool swaps are attributed via the curve that graduated into them, so the
  // registry is read once per delivery rather than per log.
  const { data: poolRows } = await admin
    .from("curve_pools")
    .select("curve_address,token_address,pool_address");
  const poolRegistry = new Map(
    (poolRows ?? []).map((row) => [
      row.pool_address.toLowerCase(),
      { curveAddress: row.curve_address as Address, tokenAddress: row.token_address as Address },
    ])
  );

  // Curves we know about, so a Buy/Sell from an unrelated contract that
  // happens to share an event signature is ignored rather than indexed.
  const { data: tokenRows } = await admin
    .from("tokens")
    .select("curve_address,contract_address");
  const curveRegistry = new Map(
    (tokenRows ?? [])
      .filter((row) => row.curve_address && row.contract_address)
      .map((row) => [
        (row.curve_address as string).toLowerCase(),
        (row.contract_address as string).toLowerCase() as Address,
      ])
  );

  const trades: DecodedTrade[] = [];

  for (const log of logs) {
    if (log.topics.length === 0) continue;

    // Graduation is deliberately NOT handled here. `Migrated` carries the
    // pool but not the curve — that connection exists only in the calldata
    // of the transaction that emitted it, which a log-only webhook does not
    // deliver. Resolving it needs a transaction fetch, so it belongs to the
    // reconciler, which is already reading the chain and already runs on a
    // schedule. Attempting it here would mean a second, subtly different
    // path to the same table.
    const decoded = decodeTradeLog({
      address: log.address as Address,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data as Hex,
      blockNumber: BigInt(log.blockNumber),
      logIndex: log.logIndex,
      transactionHash: log.transactionHash as Hex,
      timestamp: log.timestamp,
      curveRegistry,
      poolRegistry,
    });
    if (decoded) trades.push(decoded);
  }

  let stored = 0;
  if (trades.length > 0) {
    const { error, count } = await admin
      .from("trades")
      .upsert(
        trades.map((trade) => ({
          id: trade.id,
          token_address: trade.tokenAddress,
          curve_address: trade.curveAddress,
          pool_address: trade.poolAddress,
          type: trade.type,
          venue: trade.venue,
          wallet: trade.wallet,
          eth_wei: trade.ethWei.toString(),
          tokens_wei: trade.tokensWei.toString(),
          price_wei: trade.priceWei.toString(),
          spot_price_wei: trade.spotPriceWei?.toString() ?? null,
          block_number: Number(trade.blockNumber),
          timestamp: trade.timestamp,
        })),
        { onConflict: "id", ignoreDuplicates: true, count: "exact" }
      );

    if (error) {
      // A database failure IS worth a retry — the event is valid and we
      // simply failed to keep it. This is the one path that returns 5xx.
      return NextResponse.json({ error: "Could not store trades." }, { status: 500 });
    }
    stored = count ?? trades.length;
  }

  return NextResponse.json({ received: logs.length, stored });
}
