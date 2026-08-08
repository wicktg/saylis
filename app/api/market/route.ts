import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { robinhood } from "viem/chains";
import { upstreamRpcUrl } from "@/app/_lib/serverRpcUrl";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_POOL_FEE,
  WETH9_ADDRESS,
} from "@/app/_lib/contracts/config";
import { GET_POOL_ABI, SLOT0_ABI, isTokenToken0, spotPriceFromSqrtX96 } from "@/app/_lib/poolMath";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Market data for a set of tokens — price, market cap, graduation progress,
 * volume — as ONE request, shared by every visitor.
 *
 * WHY THIS IS A ROUTE AND NOT A HOOK
 *
 * This work used to happen in each browser, once per token on screen: a
 * seven-call multicall per token every 15 seconds, then a pool lookup, then
 * a slot0 read, then — for every migrated token — a chunked eth_getLogs
 * sweep of its whole pool history to total up volume. Twenty cards was
 * ~140 contract reads plus a log scan per graduated token, per visitor, and
 * it was the last thing in the app still polling eth_getLogs.
 *
 * Here it is one multicall for every token at once, and the answer is
 * cached, so a hundred people looking at the same grid cost what one person
 * costs. The client is left with a `fetch`.
 *
 * The log sweep is gone entirely. Pool volume is summed from the indexer's
 * own trade rows, which already record every pool swap — the same data the
 * scan was reconstructing from logs, already stored, already indexed.
 */

/** Curve reads issued per token, in the order they are unpacked below. */
const CURVE_CALLS = [
  "getPrice",
  "totalSupply",
  "realEthReserve",
  "graduationThreshold",
  "graduated",
  "cumulativeVolume",
  "migrationExecuted",
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE_TOKEN = 10n ** 18n;

/**
 * How long an answer is reused.
 *
 * Prices move with trades, not with wall time, and the grid shows market
 * caps rounded to a few significant figures — a few seconds of age is not
 * observable there. What it buys is that a burst of visitors, or one
 * visitor with several tabs, collapses into a single upstream read.
 */
const CACHE_TTL_MS = 4_000;

/** Bounded so one instance cannot accumulate entries for every combination. */
const MAX_CACHE_ENTRIES = 64;

/**
 * Cap on tokens per request, so a hand-written URL cannot turn one request
 * into an unbounded multicall. The grid pages well below this.
 */
const MAX_TOKENS = 120;

type MarketEntry = {
  curveAddress: Address;
  priceWei: string;
  marketCapWei: string;
  progressPct: number;
  graduated: boolean;
  migrated: boolean;
  volumeWei: string;
};

type CacheEntry = { expires: number; body: string };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

const client = createPublicClient({
  chain: robinhood,
  // Straight to the upstream rather than back through /api/rpc: this route
  // has its own cache, and a server calling its own HTTP endpoint just to
  // reach the same place is a hop that can only add latency and failure
  // modes. Multicall3 is declared on the chain (see viem's robinhood
  // definition), so `client.multicall` uses it without further config.
  transport: http(upstreamRpcUrl(), { batch: { wait: 16 } }),
});

/**
 * Post-migration volume, summed from stored trades rather than from logs.
 *
 * A curve's `cumulativeVolume` stops at migration — a Uniswap swap never
 * touches the curve — so a busy migrated pool showed its graduation-day
 * total forever. The old fix was to scan the pool's Swap logs in every
 * browser. `trades` already holds those same swaps, written by the Alchemy
 * webhook, so this is one query and it costs no upstream quota at all.
 *
 * This used to read `chain_trades`, a view over a Ponder indexer's tables.
 * That view did not exist in the database, so every call landed in the
 * catch below and returned nothing — migrated tokens have been showing
 * their curve-era total this whole time. The webhook had been recording
 * pool swaps into `trades` all along; only this query never moved across
 * when the webhook replaced the indexer.
 */
async function poolVolumeByCurve(curves: Address[]): Promise<Map<string, bigint>> {
  const totals = new Map<string, bigint>();
  if (curves.length === 0) return totals;

  // PostgREST directly, rather than the shared supabase-js client.
  //
  // That client is constructed at module scope and THROWS when its env vars
  // are absent. `next build` imports every route to collect page data, so
  // importing it here turned a missing-env warning into a hard build
  // failure — on a host where those vars were not set at build time, the
  // whole deploy died on a route that only needed one read.
  //
  // A read this small does not justify that coupling. Missing config now
  // means no pool volume, which is what the error path below already
  // returns, and which shows a migrated token its curve-era total instead
  // of nothing at all.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return totals;

  // Addresses are stored lowercased, and `in` is an exact match.
  const list = curves.map((address) => address.toLowerCase()).join(",");
  const query =
    `${url}/rest/v1/trades` +
    `?select=curve_address,eth_wei&venue=eq.pool&curve_address=in.(${list})`;

  try {
    const response = await fetch(query, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!response.ok) return totals;

    const rows = (await response.json()) as { curve_address: string; eth_wei: string }[];
    for (const row of rows) {
      const curve = row.curve_address.toLowerCase();
      // eth_wei is stored as TEXT precisely so BigInt round-trips it
      // without losing precision to a float.
      totals.set(curve, (totals.get(curve) ?? 0n) + BigInt(row.eth_wei));
    }
  } catch {
    // Never let a volume figure take down the whole market response.
    // Curve-era volume is still correct and still worth showing.
  }
  return totals;
}

async function readMarket(pairs: { curveAddress: Address; tokenAddress: Address }[]): Promise<string> {
  const curveContracts = pairs.flatMap(({ curveAddress, tokenAddress }) =>
    CURVE_CALLS.map((functionName) =>
      functionName === "totalSupply"
        ? ({ address: tokenAddress, abi: IMMUTABLE_LAUNCH_TOKEN_ABI, functionName } as const)
        : ({ address: curveAddress, abi: BONDING_CURVE_ABI, functionName } as const)
    )
  );

  const [curveResults, poolVolumes] = await Promise.all([
    client.multicall({ contracts: curveContracts, allowFailure: true }),
    poolVolumeByCurve(pairs.map((pair) => pair.curveAddress)),
  ]);

  type Stage1 = {
    tokenAddress: Address;
    priceWei: bigint;
    totalSupplyWhole: bigint;
    progressPct: number;
    graduated: boolean;
    migrated: boolean;
    volumeWei: bigint;
  };
  const stage1 = new Map<Address, Stage1>();

  pairs.forEach(({ curveAddress, tokenAddress }, index) => {
    const slice = curveResults.slice(index * CURVE_CALLS.length, (index + 1) * CURVE_CALLS.length);
    // All-or-nothing per token. A partial read would render a card with a
    // plausible but wrong number on it, which is worse than a card that is
    // still loading.
    if (slice.some((entry) => entry.status !== "success")) return;

    const [price, supply, reserve, threshold, graduated, volume, migrated] = slice.map(
      (entry) => entry.result
    );

    const graduationThreshold = threshold as bigint;
    const realEthReserve = reserve as bigint;

    stage1.set(curveAddress, {
      tokenAddress,
      priceWei: price as bigint,
      totalSupplyWhole: (supply as bigint) / ONE_TOKEN,
      progressPct: (graduated as boolean)
        ? 100
        : graduationThreshold > 0n
          ? Math.min(100, Number((realEthReserve * 10_000n) / graduationThreshold) / 100)
          : 0,
      graduated: graduated as boolean,
      migrated: migrated as boolean,
      volumeWei: volume as bigint,
    });
  });

  // A migrated curve's getPrice() is frozen — migration drained the real ETH
  // reserve it prices from — so those tokens are priced by their pool or not
  // at all. Two chained batches: find the pools, then read them.
  const migrated = [...stage1.entries()].filter(([, entry]) => entry.migrated);
  const poolPrices = new Map<Address, bigint>();

  if (migrated.length > 0) {
    const pools = await client.multicall({
      contracts: migrated.map(
        ([, entry]) =>
          ({
            address: UNISWAP_V3_FACTORY_ADDRESS,
            abi: GET_POOL_ABI,
            functionName: "getPool",
            args: [entry.tokenAddress, WETH9_ADDRESS, UNISWAP_V3_POOL_FEE],
          }) as const
      ),
      allowFailure: true,
    });

    const withPool = migrated
      .map(([curveAddress, entry], index) => {
        const result = pools[index];
        const pool =
          result.status === "success" && result.result && result.result !== ZERO_ADDRESS
            ? (result.result as Address)
            : null;
        return pool ? { curveAddress, tokenAddress: entry.tokenAddress, pool } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (withPool.length > 0) {
      const slots = await client.multicall({
        contracts: withPool.map(
          ({ pool }) => ({ address: pool, abi: SLOT0_ABI, functionName: "slot0" }) as const
        ),
        allowFailure: true,
      });

      withPool.forEach(({ curveAddress, tokenAddress }, index) => {
        const result = slots[index];
        if (result.status !== "success") return;
        const sqrtPriceX96 = (result.result as readonly [bigint, ...unknown[]])[0];
        poolPrices.set(curveAddress, spotPriceFromSqrtX96(sqrtPriceX96, isTokenToken0(tokenAddress)));
      });
    }
  }

  const tokens: MarketEntry[] = [];
  for (const [curveAddress, entry] of stage1) {
    const poolPrice = poolPrices.get(curveAddress);
    // Omitted rather than guessed — the card shows its loading state, which
    // is honest, instead of a curve-derived price that is known to be wrong.
    if (entry.migrated && poolPrice === undefined) continue;

    const priceWei = entry.migrated ? poolPrice! : entry.priceWei;
    tokens.push({
      curveAddress,
      priceWei: priceWei.toString(),
      marketCapWei: (priceWei * entry.totalSupplyWhole).toString(),
      progressPct: entry.progressPct,
      graduated: entry.graduated,
      migrated: entry.migrated,
      volumeWei: (
        entry.volumeWei + (poolVolumes.get(curveAddress.toLowerCase()) ?? 0n)
      ).toString(),
    });
  }

  return JSON.stringify({ tokens });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("pairs") ?? "";

  // `curve:token` pairs, comma separated. Both are needed: totalSupply is on
  // the token and everything else is on the curve.
  const pairs: { curveAddress: Address; tokenAddress: Address }[] = [];
  for (const part of raw.split(",")) {
    const [curve, token] = part.split(":");
    if (!/^0x[a-fA-F0-9]{40}$/.test(curve ?? "") || !/^0x[a-fA-F0-9]{40}$/.test(token ?? "")) {
      continue;
    }
    pairs.push({ curveAddress: curve as Address, tokenAddress: token as Address });
  }

  if (pairs.length === 0) return jsonResponse(JSON.stringify({ tokens: [] }), "bypass");
  if (pairs.length > MAX_TOKENS) {
    return NextResponse.json(
      { error: `Too many tokens; the limit is ${MAX_TOKENS}.` },
      { status: 400 }
    );
  }

  // Sorted, so two clients asking for the same tokens in a different order
  // share one entry rather than each paying for their own.
  const key = pairs
    .map(({ curveAddress, tokenAddress }) => `${curveAddress.toLowerCase()}:${tokenAddress.toLowerCase()}`)
    .sort()
    .join(",");

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return jsonResponse(hit.body, "hit");

  // Single flight, for the case this is built to handle: a grid mounting in
  // several tabs at once, all asking the same question before any answer
  // exists to cache.
  const pending = inFlight.get(key);
  if (pending) {
    try {
      return jsonResponse(await pending, "coalesced");
    } catch {
      // Fall through and try for ourselves.
    }
  }

  const work = readMarket(pairs);
  inFlight.set(key, work);

  try {
    const body = await work;
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, body });
    return jsonResponse(body, "miss");
  } catch {
    // Serve the previous answer rather than blanking every card on screen
    // because one upstream read failed. Market caps do not change enough in
    // a few seconds for stale to mislead, and the alternative is a grid that
    // empties itself whenever the RPC hiccups.
    if (hit) return jsonResponse(hit.body, "stale");
    return NextResponse.json({ error: "Could not read market data." }, { status: 502 });
  } finally {
    inFlight.delete(key);
  }
}

function jsonResponse(body: string, status: "hit" | "coalesced" | "miss" | "stale" | "bypass") {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "x-market-cache": status,
    },
  });
}
