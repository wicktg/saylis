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
import { getLogsChunked } from "@/app/_lib/chunkedLogs";

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
 * Backfills every historical curve `Buy`/`Sell` and — once the token has
 * graduated — every Uniswap `Swap` on its pool, then polls for new logs
 * from the last-seen block onward. Trades are returned oldest-first.
 *
 * Reading both matters because the curve stops emitting entirely at
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

  // Block number we've already scanned through, so polling only ever asks
  // for the delta rather than re-reading the whole history each tick.
  const cursorRef = useRef<bigint | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const timestampCacheRef = useRef<Map<string, number>>(new Map());

  const ingest = useCallback(async (client: PublicClient, raws: RawTradeLog[]) => {
    const fresh = raws.filter((raw) => !seenIdsRef.current.has(raw.id));
    if (fresh.length === 0) return;

    const timestamps = await fetchBlockTimestamps(
      client,
      fresh.map((raw) => raw.blockNumber),
      timestampCacheRef.current
    );

    const mapped: Trade[] = fresh.map((raw) => ({
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
    }));

    for (const raw of fresh) seenIdsRef.current.add(raw.id);

    setTrades((prev) =>
      [...prev, ...mapped].sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
        return a.timestamp - b.timestamp;
      })
    );
  }, []);

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

    async function backfill() {
      setIsLoading(true);
      setError(null);
      try {
        pool = await resolvePool();
        if (!cancelled) setPoolAddress(pool);

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

        const head = await client.getBlockNumber();
        const raws = await readRangeChunked(startBlock, head);
        if (cancelled) return;
        cursorRef.current = head;
        await ingest(client, raws);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load trade history.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    backfill();

    // Poll the delta. Every few seconds is enough of a gap on its own to
    // exceed LOG_RANGE_LIMIT on Robinhood Chain's ~100ms block time, so
    // this MUST go through the chunked reader too, not a single wide call.
    const interval = setInterval(async () => {
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
    }, 4_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
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

  return { trades, isLoading, error, poolAddress };
}
