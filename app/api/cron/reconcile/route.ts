import { NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { robinhood } from "viem/chains";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { decodeTradeLog, TRADE_EVENTS, type DecodedTrade } from "@/app/_lib/tradeLogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fills in trades the webhook did not capture.
 *
 * WHY THIS IS NOT OPTIONAL
 *
 * A webhook delivery lost to a deploy, a cold start, exhausted retries or a
 * misconfiguration leaves a hole in the trade history — and a hole is
 * invisible. The feed simply shows fewer trades, with nothing anywhere
 * saying so. This reads the chain and repairs the difference, which makes
 * the webhook an optimisation (lower latency) rather than a single point of
 * failure.
 *
 * WHY IT USES THE PUBLIC NODE, NOT ALCHEMY
 *
 * Alchemy's free tier caps eth_getLogs at a 10-BLOCK range. This chain
 * mines ~10 blocks per second, so covering even a five-minute gap through
 * Alchemy would be ~300 requests at ~75 compute units each — every run,
 * forever. The public endpoint has no such cap and serves an arbitrary
 * range in one request, for nothing. So the expensive path is the one we
 * never take: a gap of any size costs one log query plus a block read per
 * block that actually contained a trade.
 *
 * That is also why this can safely be the fallback for a webhook that is
 * not working yet. It is not a second-best version of the same cost.
 */

/**
 * Blocks covered in one run. ~28 minutes at this chain's rate — comfortably
 * more than any cron interval, so a healthy system always closes the gap
 * completely, while a long outage catches up over several runs instead of
 * trying to scan a month of history inside one 60-second function.
 */
const MAX_BLOCKS_PER_RUN = 20_000n;

/**
 * Where to start when the table is empty. Reading from genesis would be
 * pointless — no curve existed — and slow. Matches the indexer's old floor.
 */
const FLOOR_BLOCK = BigInt(process.env.RECONCILE_START_BLOCK ?? "25667000");

const client = createPublicClient({
  chain: robinhood,
  // Deliberately NOT upstreamRpcUrl(). See the header: the range cap on the
  // paid endpoint is exactly what makes it the wrong tool here.
  transport: http("https://rpc.mainnet.chain.robinhood.com"),
});

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  // Which contracts to watch. Curves come from the app's own registry, so a
  // token launched a minute ago is included without any registration step —
  // the limitation that forced the old indexer to restart per launch.
  const [{ data: tokenRows }, { data: poolRows }] = await Promise.all([
    admin.from("tokens").select("curve_address,contract_address"),
    admin.from("curve_pools").select("curve_address,token_address,pool_address"),
  ]);

  const curveRegistry = new Map<string, string>(
    (tokenRows ?? [])
      .filter((row) => row.curve_address && row.contract_address)
      .map((row) => [
        (row.curve_address as string).toLowerCase(),
        (row.contract_address as string).toLowerCase(),
      ])
  );
  const poolRegistry = new Map(
    (poolRows ?? []).map((row) => [
      (row.pool_address as string).toLowerCase(),
      {
        curveAddress: (row.curve_address as string).toLowerCase() as Address,
        tokenAddress: (row.token_address as string).toLowerCase() as Address,
      },
    ])
  );

  const addresses = [...curveRegistry.keys(), ...poolRegistry.keys()] as Address[];
  if (addresses.length === 0) return NextResponse.json({ scanned: 0, stored: 0 });

  // Resume from the newest block already stored, not from a wall clock.
  const { data: newest } = await admin
    .from("trades")
    .select("block_number")
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const head = await client.getBlockNumber();
  const from = newest?.block_number ? BigInt(newest.block_number) + 1n : FLOOR_BLOCK;
  if (from > head) return NextResponse.json({ upToDate: true, head: head.toString() });

  const to = from + MAX_BLOCKS_PER_RUN - 1n > head ? head : from + MAX_BLOCKS_PER_RUN - 1n;

  // One request for the whole window, every venue, every event. The public
  // node imposes no range limit, which is the entire reason this is cheap.
  const logs = await client.getLogs({
    address: addresses,
    events: TRADE_EVENTS,
    fromBlock: from,
    toBlock: to,
  });

  if (logs.length === 0) {
    return NextResponse.json({
      scanned: (to - from + 1n).toString(),
      from: from.toString(),
      to: to.toString(),
      stored: 0,
      caughtUp: to >= head,
    });
  }

  // Logs carry no timestamp, so each distinct block containing a trade needs
  // one read. Deduped, because several trades commonly share a block.
  const blockNumbers = [...new Set(logs.map((log) => log.blockNumber))];
  const timestamps = new Map<bigint, number>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      timestamps.set(blockNumber, Number(block.timestamp));
    })
  );

  const trades: DecodedTrade[] = [];
  for (const log of logs) {
    if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
    const decoded = decodeTradeLog({
      address: log.address as Address,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data as Hex,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
      timestamp: timestamps.get(log.blockNumber) ?? 0,
      curveRegistry,
      poolRegistry,
    });
    if (decoded) trades.push(decoded);
  }

  let stored = 0;
  if (trades.length > 0) {
    // Same primary key the webhook writes, so whichever path saw a trade
    // first wins and the other is a no-op. That is what lets both run.
    const { error, count } = await admin.from("trades").upsert(
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
    if (error) return NextResponse.json({ error: "Could not store trades." }, { status: 500 });
    stored = count ?? trades.length;
  }

  return NextResponse.json({
    from: from.toString(),
    to: to.toString(),
    head: head.toString(),
    found: trades.length,
    stored,
    // False means there is more history to cover; the next run continues.
    caughtUp: to >= head,
  });
}
