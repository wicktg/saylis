"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem, type Address, type Log, type PublicClient } from "viem";
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_POOL_FEE,
  WETH9_ADDRESS,
} from "@/app/_lib/contracts/config";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { getLogsChunked, clampScanRange } from "@/app/_lib/chunkedLogs";
import { supabase } from "@/app/_lib/supabase";

/**
 * A single executed trade, reconstructed from on-chain logs. Every field is
 * derived from real events — nothing here is synthesized or estimated.
 */
export type Trade = {
  /** `${txHash}-${logIndex}` — stable and unique per log. */
  id: string;
  type: "buy" | "sell";
  wallet: Address;
  /** ETH paid in (buy) or received out (sell), wei. */
  ethWei: bigint;
  /** Tokens received (buy) or sold (sell), base units. */
  tokensWei: bigint;
  /** Realized execution price: wei of ETH per ONE WHOLE token. */
  priceWei: bigint;
  /**
   * Pool trades only: the pool's MARGINAL spot price immediately after the
   * swap, read from the Swap event's `sqrtPriceX96`.
   *
   * `priceWei` above is a slippage-AVERAGED figure, which is systematically
   * above true spot on sells and below it on buys — charting it makes sells
   * look flat or even like pumps. This is the correct value to plot, and is
   * the direct analogue of the curve's reconstructed marginal price.
   */
  spotPriceWei?: bigint;
  blockNumber: bigint;
  /** Block timestamp, unix seconds. */
  timestamp: number;
  /**
   * Where the trade happened. A token trades on `curve` until it
   * graduates, then on `pool` forever after — the feed spans both so it
   * doesn't go silent at migration.
   */
  venue: "curve" | "pool";
};

const BUY_EVENT = parseAbiItem(
  "event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut)"
);
const SELL_EVENT = parseAbiItem(
  "event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut)"
);

/** Uniswap V3's pool swap event — amounts are signed, pool-relative. */
const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);

const GET_POOL_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const ONE_TOKEN = 10n ** 18n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Block-timestamp fetches issued at once; keeps the public RPC happy. */
const TIMESTAMP_BATCH_SIZE = 10;

function priceOf(ethWei: bigint, tokensWei: bigint): bigint {
  if (tokensWei === 0n) return 0n;
  return (ethWei * ONE_TOKEN) / tokensWei;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

const Q96 = 2n ** 96n;

/**
 * Converts a Uniswap `sqrtPriceX96` into wei of ETH per one whole token.
 *
 * Pool price is `(sqrtPriceX96 / 2^96)^2`, expressed as token1 per token0,
 * so it needs inverting when the token sorts as token1. Both sides carry 18
 * decimals, making the base-unit ratio equal to the whole-unit ratio.
 *
 * Squaring `sqrtPriceX96` overflows 256 bits on-chain, but JS `BigInt` is
 * arbitrary precision, so it can be done directly here.
 */
function spotPriceFromSqrtX96(sqrtPriceX96: bigint, tokenIsToken0: boolean): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const denominator = Q96 * Q96;
  return tokenIsToken0
    ? (numerator * ONE_TOKEN) / denominator
    : (denominator * ONE_TOKEN) / numerator;
}

/**
 * Resolves unix timestamps for a set of block numbers. Logs don't carry
 * timestamps, so each distinct block has to be fetched — deduped and
 * batched so a busy token doesn't fan out into hundreds of parallel calls.
 */
async function fetchBlockTimestamps(
  client: PublicClient,
  blockNumbers: bigint[],
  known: Map<string, number>
): Promise<Map<string, number>> {
  const missing = Array.from(new Set(blockNumbers.map((b) => b.toString()))).filter(
    (key) => !known.has(key)
  );

  for (let i = 0; i < missing.length; i += TIMESTAMP_BATCH_SIZE) {
    const slice = missing.slice(i, i + TIMESTAMP_BATCH_SIZE);
    const blocks = await Promise.all(
      slice.map((key) =>
        client
          .getBlock({ blockNumber: BigInt(key) })
          .then((block) => ({ key, timestamp: Number(block.timestamp) }))
          .catch(() => null)
      )
    );
    for (const entry of blocks) {
      if (entry) known.set(entry.key, entry.timestamp);
    }
  }

  return known;
}

/**
 * One row of `public.chain_trades` — the read-only view over the Ponder
 * indexer's table (see indexer/ and supabase/indexer_views.sql).
 *
 * Every wei-scale column arrives as a STRING, not a number. Postgres stores
 * them as numeric(78,0) and PostgREST would serialize that as a bare JSON
 * number, which `JSON.parse` rounds away above 2^53 — a real trade here has
 * tokens_wei = 184781706545052039848055. The view casts them to text so
 * `BigInt()` round-trips the exact value, matching what the log-decoding
 * path below produces.
 */
type ChainTradeRow = {
  id: string;
  type: string;
  venue: string;
  wallet: string;
  eth_wei: string;
  tokens_wei: string;
  price_wei: string;
  spot_price_wei: string | null;
  block_number: string;
  timestamp: number;
};

function rowToTrade(row: ChainTradeRow): Trade {
  return {
    id: row.id,
    type: row.type === "sell" ? "sell" : "buy",
    wallet: row.wallet as Address,
    ethWei: BigInt(row.eth_wei),
    tokensWei: BigInt(row.tokens_wei),
    priceWei: BigInt(row.price_wei),
    spotPriceWei: row.spot_price_wei !== null ? BigInt(row.spot_price_wei) : undefined,
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    venue: row.venue === "pool" ? "pool" : "curve",
  };
}

/** Every column `rowToTrade` needs, shared by the two queries below. */
const TRADE_COLUMNS =
  "id,type,venue,wallet,eth_wei,tokens_wei,price_wei,spot_price_wei,block_number,timestamp";

/**
 * Chain order: block, then position within it.
 *
 * Applied locally rather than trusted from the query, because `block_number`
 * arrives from the view as TEXT (see `ChainTradeRow`) and ordering on it in
 * Postgres is therefore lexicographic — "9999999" would sort after
 * "10000001". That happens to be harmless today only because every block
 * number on this chain currently has the same digit count, and stops being
 * harmless the moment it doesn't. `id` breaks ties so the sort is stable.
 */
function sortTrades(list: Trade[]): Trade[] {
  return list.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Full trade history for one curve, straight out of the indexer.
 *
 * This is the whole point of indexer/: one HTTP request returns every trade
 * a token has ever had, where the RPC path below needs thousands of
 * 10-block windows to cover the same span and gives up partway (see
 * `clampScanRange`). Returns null — not an empty array — when the indexer
 * has nothing for this curve, so the caller can tell "indexed, no trades
 * yet" apart from "not indexed" and fall back accordingly.
 *
 * Covers BOTH venues in the one query: the indexer stamps pool swaps with
 * the curve they graduated from, so post-migration trades come back here too.
 */
async function fetchIndexedTrades(curveAddress: Address): Promise<Trade[] | null> {
  // `ilike` rather than `eq`: Ponder writes addresses lowercased while
  // viem/wagmi hand us EIP-55 checksummed ones, and an `eq` would silently
  // match nothing.
  const { data, error } = await supabase
    .from("chain_trades")
    .select(TRADE_COLUMNS)
    .ilike("curve_address", curveAddress)
    .order("timestamp", { ascending: true });

  if (error || !data || data.length === 0) return null;
  return sortTrades((data as ChainTradeRow[]).map(rowToTrade));
}

/**
 * How many recent rows a doorbell refetch pulls back.
 *
 * The Realtime event says only THAT something was inserted, so this re-reads
 * the tail and lets id-dedup sort out what's actually new. Generous on
 * purpose: it costs one indexed Supabase query and it is what makes a
 * dropped or coalesced notification self-healing rather than a permanently
 * missing trade.
 */
const RECENT_TRADE_LIMIT = 300;

/**
 * Coalescing window for doorbell refetches. One block can mint several
 * trades and each arrives as its own notification, so this is short enough
 * to stay imperceptible and long enough that a burst costs one query.
 */
const REFETCH_DEBOUNCE_MS = 120;

/**
 * Backstop sweep while subscribed. Realtime can drop a message — a
 * reconnect, a server restart — and without this the feed would stay silent
 * until the next trade happened to arrive. Reads Supabase only.
 */
const REALTIME_SWEEP_MS = 20_000;

/**
 * Fallback poll interval, for curves the indexer doesn't have. Unchanged
 * from when this was the only path; it is now reached rarely rather than
 * by every open tab.
 */
const POLL_INTERVAL_MS = 4_000;

/**
 * How far the indexer may trail the chain head before it is treated as
 * stalled and the log reader is brought back to cover the gap.
 *
 * ~60 seconds at this chain's ~100ms blocks, against an indexer that polls
 * every 250ms — so ordinary lag is orders of magnitude inside it and this
 * only fires when something is actually wrong (the process is down, or
 * re-syncing). Generous on purpose: the cost of tripping it needlessly is
 * some polling, and the cost of NOT tripping it is a feed that has quietly
 * stopped showing trades.
 */
const STALE_INDEXER_BLOCKS = 600n;

/** The tail of a curve's history — see `RECENT_TRADE_LIMIT`. */
async function fetchRecentIndexedTrades(curveAddress: Address): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("chain_trades")
    .select(TRADE_COLUMNS)
    .ilike("curve_address", curveAddress)
    .order("timestamp", { ascending: false })
    .limit(RECENT_TRADE_LIMIT);

  if (error || !data) return [];
  return (data as ChainTradeRow[]).map(rowToTrade);
}

type RawTradeLog = {
  id: string;
  type: "buy" | "sell";
  wallet: Address;
  ethWei: bigint;
  tokensWei: bigint;
  blockNumber: bigint;
  logIndex: number;
  venue: "curve" | "pool";
  spotPriceWei?: bigint;
};

function toCurveTrade(log: Log, type: "buy" | "sell"): RawTradeLog | null {
  const args = (log as unknown as { args?: Record<string, unknown> }).args;
  if (!args || log.blockNumber === null || log.logIndex === null) return null;

  if (type === "buy") {
    const buyer = args.buyer as Address | undefined;
    const ethIn = args.ethIn as bigint | undefined;
    const tokensOut = args.tokensOut as bigint | undefined;
    if (!buyer || ethIn === undefined || tokensOut === undefined) return null;
    return {
      id: `${log.transactionHash}-${log.logIndex}`,
      type: "buy",
      wallet: buyer,
      ethWei: ethIn,
      tokensWei: tokensOut,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      venue: "curve",
    };
  }

  const seller = args.seller as Address | undefined;
  const tokensIn = args.tokensIn as bigint | undefined;
  const ethOut = args.ethOut as bigint | undefined;
  if (!seller || tokensIn === undefined || ethOut === undefined) return null;
  return {
    id: `${log.transactionHash}-${log.logIndex}`,
    type: "sell",
    wallet: seller,
    ethWei: ethOut,
    tokensWei: tokensIn,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    venue: "curve",
  };
}

/**
 * Maps a Uniswap V3 `Swap` into the same shape as a curve trade.
 *
 * Pool amounts are signed from the POOL's perspective: positive means the
 * asset flowed in, negative means it flowed out. So tokens leaving the
 * pool (negative token delta) is a buy, and tokens entering it is a sell.
 */
function toPoolTrade(log: Log, tokenIsToken0: boolean): RawTradeLog | null {
  const args = (log as unknown as { args?: Record<string, unknown> }).args;
  if (!args || log.blockNumber === null || log.logIndex === null) return null;

  const amount0 = args.amount0 as bigint | undefined;
  const amount1 = args.amount1 as bigint | undefined;
  const recipient = args.recipient as Address | undefined;
  const sqrtPriceX96 = args.sqrtPriceX96 as bigint | undefined;
  if (amount0 === undefined || amount1 === undefined || !recipient) return null;

  const tokenDelta = tokenIsToken0 ? amount0 : amount1;
  const ethDelta = tokenIsToken0 ? amount1 : amount0;
  if (tokenDelta === 0n || ethDelta === 0n) return null;

  return {
    id: `${log.transactionHash}-${log.logIndex}`,
    type: tokenDelta < 0n ? "buy" : "sell",
    // `sender` is the router; `recipient` is who actually receives the
    // output, which is the closest thing to the trader available here.
    wallet: recipient,
    ethWei: abs(ethDelta),
    tokensWei: abs(tokenDelta),
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    venue: "pool",
    spotPriceWei:
      sqrtPriceX96 !== undefined
        ? spotPriceFromSqrtX96(sqrtPriceX96, tokenIsToken0)
        : undefined,
  };
}

/**
 * Full trade history for one token, live, across BOTH venues.
 *
 * History comes from the Ponder indexer via `public.chain_trades` in a
 * single Supabase request — the whole span, unclamped. New trades then
 * arrive by PUSH: the indexer's INSERT is replicated to the browser over
 * Supabase Realtime (see supabase/indexer_realtime.sql), which both removes
 * the four-second wait and removes what was the app's heaviest consumer of
 * upstream RPC quota — a chunked `eth_getLogs` sweep, every four seconds,
 * per open tab.
 *
 * The chain-reading path has not been deleted, only demoted to a fallback,
 * so behaviour is never worse than it was before the indexer existed. It
 * runs when the indexer has no rows for this curve at all (a token launched
 * after the indexer's address snapshot; an environment where it isn't
 * running) and when the Realtime subscription cannot be established.
 *
 * Trades are returned oldest-first.
 *
 * Reading both venues matters because the curve stops emitting entirely at
 * migration; without the pool side the chart and feed would freeze at the
 * graduation block and show nothing ever again.
 */
export function useCurveTrades(
  curveAddress: Address | undefined,
  tokenAddress: Address | undefined
) {
  const publicClient = usePublicClient();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poolAddress, setPoolAddress] = useState<Address | null>(null);
  /** True when the backfill could not reach the curve's launch block. */
  const [historyTruncated, setHistoryTruncated] = useState(false);

  // Block number we've already scanned through, so polling only ever asks
  // for the delta rather than re-reading the whole history each tick.
  const cursorRef = useRef<bigint | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const timestampCacheRef = useRef<Map<string, number>>(new Map());

  /**
   * Adds trades that aren't already on screen, in chain order.
   *
   * Both live paths converge here — Realtime refetches and the fallback log
   * reader — and both are allowed to hand over rows already held. Dedup is
   * by `id` (`${txHash}-${logIndex}`), which is what makes an overlapping
   * refetch cheap enough to use as the recovery mechanism for a missed
   * notification.
   */
  const merge = useCallback((incoming: Trade[]) => {
    const fresh = incoming.filter((trade) => !seenIdsRef.current.has(trade.id));
    if (fresh.length === 0) return;
    for (const trade of fresh) seenIdsRef.current.add(trade.id);
    setTrades((prev) => sortTrades([...prev, ...fresh]));
  }, []);

  const ingest = useCallback(
    async (client: PublicClient, raws: RawTradeLog[]) => {
      const fresh = raws.filter((raw) => !seenIdsRef.current.has(raw.id));
      if (fresh.length === 0) return;

      const timestamps = await fetchBlockTimestamps(
        client,
        fresh.map((raw) => raw.blockNumber),
        timestampCacheRef.current
      );

      merge(
        fresh.map((raw) => ({
          id: raw.id,
          type: raw.type,
          wallet: raw.wallet,
          ethWei: raw.ethWei,
          tokensWei: raw.tokensWei,
          priceWei: priceOf(raw.ethWei, raw.tokensWei),
          blockNumber: raw.blockNumber,
          timestamp: timestamps.get(raw.blockNumber.toString()) ?? 0,
          venue: raw.venue,
          spotPriceWei: raw.spotPriceWei,
        }))
      );
    },
    [merge]
  );

  useEffect(() => {
    if (!publicClient || !curveAddress || !tokenAddress) return;
    const client = publicClient as PublicClient;
    // Narrowed local const: closures below capture this rather than the
    // outer `Address | undefined` param, which TS can't narrow across an
    // async closure boundary.
    const curveAddr: Address = curveAddress;

    let cancelled = false;
    // Uniswap sorts pool currencies by address; the token's side decides
    // which signed amount in a Swap is tokens and which is ETH.
    const tokenIsToken0 = tokenAddress.toLowerCase() < WETH9_ADDRESS.toLowerCase();
    let pool: Address | null = null;

    // Live-tail handles, torn down together. Exactly one of the two paths
    // below is normally active: `channel` when the indexer has this curve,
    // `pollTimer` when it doesn't or when the subscription fails.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let sweepTimer: ReturnType<typeof setInterval> | null = null;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;

    async function resolvePool(): Promise<Address | null> {
      try {
        const found = (await client.readContract({
          address: UNISWAP_V3_FACTORY_ADDRESS,
          abi: GET_POOL_ABI,
          functionName: "getPool",
          args: [tokenAddress!, WETH9_ADDRESS, UNISWAP_V3_POOL_FEE],
        })) as Address;
        return found && found !== ZERO_ADDRESS ? found : null;
      } catch {
        // Not graduated yet, or the factory is unreachable — the curve
        // side still works on its own.
        return null;
      }
    }

    /** A single request, for exactly one window ≤ `LOG_RANGE_LIMIT` blocks
     *  wide. Never call this with a wider range — see `LOG_RANGE_LIMIT`. */
    async function readRange(fromBlock: bigint, toBlock: bigint) {
      const requests: Promise<Log[]>[] = [
        client.getLogs({ address: curveAddr, event: BUY_EVENT, fromBlock, toBlock }),
        client.getLogs({ address: curveAddr, event: SELL_EVENT, fromBlock, toBlock }),
      ];
      if (pool) {
        requests.push(client.getLogs({ address: pool, event: SWAP_EVENT, fromBlock, toBlock }));
      }

      const [buyLogs, sellLogs, swapLogs = []] = await Promise.all(requests);

      return [
        ...buyLogs.map((log) => toCurveTrade(log, "buy")),
        ...sellLogs.map((log) => toCurveTrade(log, "sell")),
        ...swapLogs.map((log) => toPoolTrade(log, tokenIsToken0)),
      ].filter((raw): raw is RawTradeLog => raw !== null);
    }

    /**
     * `readRange` above only ever handles ONE window ≤10 blocks wide — see
     * `chunkedLogs.ts` for why. This is the entry point everything else in
     * this effect actually calls.
     */
    async function readRangeChunked(fromBlock: bigint, toBlock: bigint): Promise<RawTradeLog[]> {
      const collected = await getLogsChunked(readRange, fromBlock, toBlock);
      return collected.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
        return a.logIndex - b.logIndex;
      });
    }

    /**
     * Live tail, fallback mode: read new logs off the chain on a timer.
     *
     * This is the pre-indexer behaviour, kept for curves the indexer has
     * never seen and for when Realtime can't connect. Every few seconds is
     * enough of a gap on its own to exceed LOG_RANGE_LIMIT on Robinhood
     * Chain's ~100ms block time, so this MUST go through the chunked reader,
     * not a single wide call.
     */
    function startPolling() {
      if (pollTimer || cancelled) return;
      pollTimer = setInterval(async () => {
        if (cancelled || cursorRef.current === null) return;
        try {
          // A token can graduate WHILE this page is open, so keep looking
          // for the pool until it exists — otherwise the feed would stop at
          // the migration block until the user reloaded.
          if (!pool) {
            pool = await resolvePool();
            if (pool && !cancelled) setPoolAddress(pool);
          }

          const head = await client.getBlockNumber();
          if (head <= cursorRef.current) return;
          const raws = await readRangeChunked(cursorRef.current + 1n, head);
          cursorRef.current = head;
          if (!cancelled) await ingest(client, raws);
        } catch {
          // Transient RPC hiccup — the next tick retries from the same cursor.
        }
      }, POLL_INTERVAL_MS);
    }

    /**
     * Re-read the tail of the indexer's rows. Debounced, because a single
     * block can mint several trades and each arrives as its own notification
     * — one query should serve the whole burst.
     */
    function scheduleRefetch() {
      if (refetchTimer || cancelled) return;
      refetchTimer = setTimeout(async () => {
        refetchTimer = null;
        if (cancelled) return;
        const recent = await fetchRecentIndexedTrades(curveAddr);
        if (cancelled || recent.length === 0) return;
        merge(recent);

        // Graduation while the page is open. The curve stops emitting and
        // the pool takes over, so the address is resolved lazily — the first
        // pool trade to arrive is the signal that there is one to find.
        if (!pool && recent.some((trade) => trade.venue === "pool")) {
          pool = await resolvePool();
          if (pool && !cancelled) setPoolAddress(pool);
        }
      }, REFETCH_DEBOUNCE_MS);
    }

    /**
     * Live tail, preferred mode: the indexer's INSERT is pushed here.
     *
     * The payload is used as a DOORBELL only, never for its values —
     * `scheduleRefetch` re-reads through `public.chain_trades` instead. The
     * wei columns are numeric(78,0) and only that view's ::text casts
     * survive a JSON round-trip intact; a Realtime payload would silently
     * round `tokens_wei` above 2^53.
     */
    function startRealtime() {
      // Unique per effect run. React Strict Mode double-invokes effects in
      // dev and `removeChannel` is async, so a fixed name can collide with a
      // same-named channel still mid-teardown — which throws "cannot add
      // postgres_changes callbacks after subscribe()" on the reused instance.
      const name = `chain-trades-${curveAddr.toLowerCase()}-${Math.random().toString(36).slice(2)}`;

      channel = supabase
        .channel(name)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            // The indexer's own table, not the public view: views produce no
            // replication events. See supabase/indexer_realtime.sql, which
            // has to be applied for this subscription to deliver anything.
            schema: "indexer",
            table: "chain_trades",
            // Ponder writes addresses lowercased.
            filter: `curve_address=eq.${curveAddr.toLowerCase()}`,
          },
          () => {
            // An event arriving is proof the indexer is alive and current,
            // which is the only reliable signal that a gap-filling poll is
            // no longer earning its keep. Stopping here rather than on a
            // timer means the fallback lasts exactly as long as it is needed.
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            scheduleRefetch();
          }
        )
        .subscribe((status) => {
          if (cancelled) return;
          // CLOSED is excluded deliberately: it is also how a normal
          // teardown reports itself, and reacting to it would start a
          // pointless poll on every unmount.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") startPolling();
        });

      // Safety net for a dropped or missed notification. Costs one indexed
      // Supabase query and no upstream RPC at all, which is why it can be
      // this frequent without undoing the point of the exercise.
      sweepTimer = setInterval(scheduleRefetch, REALTIME_SWEEP_MS);
    }

    async function backfill() {
      setIsLoading(true);
      setError(null);
      try {
        pool = await resolvePool();
        if (!cancelled) setPoolAddress(pool);

        const head = await client.getBlockNumber();

        // PREFERRED PATH: the indexer already has the whole history.
        //
        // One request, no window clamp, no per-block timestamp fetches —
        // rows arrive with their block timestamp and realized price already
        // computed by indexer/src/index.ts using the identical formulas
        // this file uses, so nothing downstream can tell the two apart.
        const indexed = await fetchIndexedTrades(curveAddr);
        if (cancelled) return;
        if (indexed) {
          for (const trade of indexed) seenIdsRef.current.add(trade.id);
          setTrades(indexed);
          setHistoryTruncated(false);

          // How far the indexer has actually got, which is NOT the same as
          // how far the chain has got. Treating those as equal is what makes
          // a stalled indexer invisible: the subscription connects fine and
          // then waits forever for INSERTs from a process that has stopped
          // producing them, and the feed silently freezes while trades keep
          // happening on chain. That is strictly worse than the polling this
          // replaced, so it has to be checked rather than assumed.
          const indexedHead = indexed[indexed.length - 1]?.blockNumber ?? 0n;

          if (head > indexedHead + STALE_INDEXER_BLOCKS) {
            // Cover the gap from the chain, then keep reading it. Clamped,
            // so an indexer that is days behind degrades to "recent history"
            // rather than attempting millions of 10-block windows.
            const { fromBlock, truncated } = clampScanRange(indexedHead + 1n, head);
            if (!cancelled) setHistoryTruncated(truncated);
            const raws = await readRangeChunked(fromBlock, head);
            if (cancelled) return;
            cursorRef.current = head;
            await ingest(client, raws);
            startPolling();
          } else {
            // Where the log reader would resume from, if it ever has to.
            cursorRef.current = head;
          }

          // Subscribed either way. When the indexer is healthy this is the
          // only live path; when it is behind, the first event to arrive is
          // proof it has caught up, and `stopPollingOnRealtimeEvent` drops
          // the polling at that point.
          startRealtime();
          return;
        }

        // FALLBACK: no indexed rows for this curve. Expected for a token
        // launched after the indexer's address snapshot was taken (see
        // indexer/README.md's known limitations) and for any environment
        // where the indexer isn't running at all — so this keeps the exact
        // pre-indexer behaviour rather than showing an empty feed.
        //
        // Anchor on the curve's OWN launch block rather than 0 — the
        // difference between scanning a few thousand blocks and scanning
        // the chain's entire history in 10-block slices.
        let startBlock = 0n;
        try {
          startBlock = (await client.readContract({
            address: curveAddr,
            abi: BONDING_CURVE_ABI,
            functionName: "launchBlock",
          })) as bigint;
        } catch {
          // Older/non-standard curve without this getter — fall back to a
          // full scan from genesis rather than failing outright.
        }

        // Bound the scan. Unbounded, "since launch" on a ~10-blocks-per-second
        // chain meant tens of thousands of 10-block windows and a 429 storm
        // that returned no history at all. A bounded scan returns recent
        // history reliably; see MAX_SCAN_WINDOWS for the full reasoning.
        const { fromBlock: scanFrom, truncated } = clampScanRange(startBlock, head);
        if (!cancelled) setHistoryTruncated(truncated);
        const raws = await readRangeChunked(scanFrom, head);
        if (cancelled) return;
        cursorRef.current = head;
        await ingest(client, raws);
        // Nothing indexed for this curve, so there is nothing to subscribe
        // to — tail the chain directly, as before the indexer existed.
        startPolling();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trade history.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    // `backfill` chooses the live-tail mode itself, once it knows whether
    // the indexer has this curve — which is why neither is started here.
    backfill();

    return () => {
      // Set before removing the channel: `removeChannel` reports CLOSED
      // through the same status callback that starts the poll fallback.
      cancelled = true;
      if (refetchTimer) clearTimeout(refetchTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, curveAddress, tokenAddress]);

  // Reset everything when switching to a different token.
  useEffect(() => {
    setTrades([]);
    setIsLoading(true);
    setError(null);
    setPoolAddress(null);
    cursorRef.current = null;
    seenIdsRef.current = new Set();
    timestampCacheRef.current = new Map();
  }, [curveAddress]);

  return { trades, isLoading, error, poolAddress, historyTruncated };
}
