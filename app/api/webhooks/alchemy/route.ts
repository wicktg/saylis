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

type AlchemyLog = {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string | number;
  transactionHash?: string;
  logIndex?: string | number;
  blockTimestamp?: string | number;
};

/** Alchemy nests its payload differently per webhook type; accept both. */
function extractLogs(payload: unknown): { logs: AlchemyLog[] } {
  const event = (payload as { event?: Record<string, unknown> })?.event;
  if (!event) return { logs: [] };

  // Custom webhooks (GraphQL) deliver under data.block.logs.
  const graphql = (event as { data?: { block?: { logs?: unknown[]; timestamp?: number } } }).data;
  if (graphql?.block?.logs) {
    const timestamp = graphql.block.timestamp;
    return {
      logs: (graphql.block.logs as Record<string, unknown>[]).map((log) => ({
        ...(log as AlchemyLog),
        // GraphQL nests the log's own fields under `transaction`/`topics`.
        address: (log.account as { address?: string } | undefined)?.address ?? (log as AlchemyLog).address,
        transactionHash:
          (log.transaction as { hash?: string } | undefined)?.hash ??
          (log as AlchemyLog).transactionHash,
        blockTimestamp: timestamp,
      })),
    };
  }

  // Address-activity / mined-transaction webhooks deliver a flat `logs`.
  const flat = (event as { logs?: AlchemyLog[] }).logs;
  return { logs: Array.isArray(flat) ? flat : [] };
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

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "string" ? Number(BigInt(value)) : value;
  return Number.isFinite(n) ? n : null;
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

  const { logs } = extractLogs(payload);
  if (logs.length === 0) return NextResponse.json({ stored: 0 });

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
    const address = log.address?.toLowerCase();
    const topics = log.topics;
    const blockNumber = toNumber(log.blockNumber);
    const logIndex = toNumber(log.logIndex);
    const timestamp = toNumber(log.blockTimestamp);
    if (!address || !topics?.length || blockNumber === null || logIndex === null) continue;
    if (!log.transactionHash) continue;

    // Graduation is deliberately NOT handled here. `Migrated` carries the
    // pool but not the curve — that connection exists only in the calldata
    // of the transaction that emitted it, which a log-only webhook does not
    // deliver. Resolving it needs a transaction fetch, so it belongs to the
    // reconciler, which is already reading the chain and already runs on a
    // schedule. Attempting it here would mean a second, subtly different
    // path to the same table.
    const decoded = decodeTradeLog({
      address: address as Address,
      topics: topics as [Hex, ...Hex[]],
      data: (log.data ?? "0x") as Hex,
      blockNumber: BigInt(blockNumber),
      logIndex,
      transactionHash: log.transactionHash as Hex,
      timestamp: timestamp ?? 0,
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
