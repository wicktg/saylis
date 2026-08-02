"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContracts, usePublicClient } from "wagmi";
import { parseAbiItem, type Address } from "viem";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { getLogsChunked } from "@/app/_lib/chunkedLogs";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_POOL_FEE,
  WETH9_ADDRESS,
} from "@/app/_lib/contracts/config";
import {
  GET_POOL_ABI,
  SLOT0_ABI,
  isTokenToken0,
  spotPriceFromSqrtX96,
} from "@/app/_lib/poolPrice";

const CALLS_PER_TOKEN = 7;
const LIVE_REFETCH_INTERVAL_MS = 8_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Uniswap V3's pool swap event — amounts are signed, pool-relative. */
const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);

export type MarketData = {
  /** Wei per one whole token — curve price pre-migration, live pool spot
   *  price post-migration (see `migrated` below). */
  priceWei: bigint;
  /** priceWei * totalSupply (whole tokens) — market cap in wei. */
  marketCapWei: bigint;
  /** realEthReserve / graduationThreshold, clamped to [0, 100]. */
  progressPct: number;
  graduated: boolean;
  /** True once `GraduationMigrator.migrate()` has run for this curve — the
   *  curve's own `getPrice()` is frozen/wrong past this point (its real ETH
   *  reserve was drained to seed the pool), so `priceWei`/`marketCapWei`
   *  switch to reading the live Uniswap pool instead. */
  migrated: boolean;
  /** BondingCurve.cumulativeVolume() — gross ETH value of every trade so far, wei. */
  volumeWei: bigint;
};

/**
 * Batches curve reads across every given pair into a single multicall, so
 * rendering N cards costs one RPC round trip instead of N. Nothing here is
 * cached/stored — every value is read live from the chain, and the whole
 * batch polls on an interval so cards stay current as trades happen
 * elsewhere, not just on first mount.
 *
 * For any pair whose curve has migrated, two further small multicalls
 * (pool address, then pool spot price) resolve the live post-migration
 * price — same source the token detail page's chart reads from via
 * `useCurveTrades`, so cards stay accurate instead of freezing at whatever
 * `curve.getPrice()` returns after its real reserve was drained.
 */
export function useTokenMarketData(
  pairs: { curveAddress: Address; tokenAddress: Address }[]
): { data: Record<Address, MarketData | undefined>; isLoading: boolean; refetch: () => void } {
  const contracts = useMemo(
    () =>
      pairs.flatMap(({ curveAddress, tokenAddress }) => [
        { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "getPrice" } as const,
        {
          address: tokenAddress,
          abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
          functionName: "totalSupply",
        } as const,
        { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "realEthReserve" } as const,
        {
          address: curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: "graduationThreshold",
        } as const,
        { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "graduated" } as const,
        {
          address: curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: "cumulativeVolume",
        } as const,
        {
          address: curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: "migrationExecuted",
        } as const,
      ]),
    [pairs]
  );

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, refetchInterval: LIVE_REFETCH_INTERVAL_MS },
  });

  const stage1 = useMemo(() => {
    const map: Record<
      Address,
      {
        priceWei: bigint;
        totalSupplyWhole: bigint;
        progressPct: number;
        graduated: boolean;
        migrated: boolean;
        volumeWei: bigint;
        tokenAddress: Address;
      }
    > = {};
    if (!data) return map;

    pairs.forEach(({ curveAddress, tokenAddress }, index) => {
      const base = index * CALLS_PER_TOKEN;
      const priceResult = data[base];
      const totalSupplyResult = data[base + 1];
      const realEthReserveResult = data[base + 2];
      const graduationThresholdResult = data[base + 3];
      const graduatedResult = data[base + 4];
      const cumulativeVolumeResult = data[base + 5];
      const migrationExecutedResult = data[base + 6];

      if (
        priceResult?.status === "success" &&
        totalSupplyResult?.status === "success" &&
        realEthReserveResult?.status === "success" &&
        graduationThresholdResult?.status === "success" &&
        graduatedResult?.status === "success" &&
        cumulativeVolumeResult?.status === "success" &&
        migrationExecutedResult?.status === "success"
      ) {
        const priceWei = priceResult.result as bigint;
        const totalSupplyBaseUnits = totalSupplyResult.result as bigint;
        const totalSupplyWhole = totalSupplyBaseUnits / 10n ** 18n;
        const realEthReserve = realEthReserveResult.result as bigint;
        const graduationThreshold = graduationThresholdResult.result as bigint;
        const graduated = graduatedResult.result as boolean;
        const volumeWei = cumulativeVolumeResult.result as bigint;
        const migrated = migrationExecutedResult.result as boolean;

        const progressPct = graduated
          ? 100
          : graduationThreshold > 0n
            ? Math.min(100, Number((realEthReserve * 10_000n) / graduationThreshold) / 100)
            : 0;

        map[curveAddress] = {
          priceWei,
          totalSupplyWhole,
          progressPct,
          graduated,
          migrated,
          volumeWei,
          tokenAddress,
        };
      }
    });

    return map;
  }, [data, pairs]);

  const migratedPairs = useMemo(
    () => pairs.filter(({ curveAddress }) => stage1[curveAddress]?.migrated),
    [pairs, stage1]
  );

  const poolLookupContracts = useMemo(
    () =>
      migratedPairs.map(
        ({ tokenAddress }) =>
          ({
            address: UNISWAP_V3_FACTORY_ADDRESS,
            abi: GET_POOL_ABI,
            functionName: "getPool",
            args: [tokenAddress, WETH9_ADDRESS, UNISWAP_V3_POOL_FEE],
          }) as const
      ),
    [migratedPairs]
  );

  const { data: poolData } = useReadContracts({
    contracts: poolLookupContracts,
    query: { enabled: poolLookupContracts.length > 0, refetchInterval: LIVE_REFETCH_INTERVAL_MS },
  });

  const poolAddresses = useMemo(() => {
    const map: Record<Address, Address> = {};
    if (!poolData) return map;
    migratedPairs.forEach(({ curveAddress }, index) => {
      const result = poolData[index];
      if (result?.status === "success" && result.result && result.result !== ZERO_ADDRESS) {
        map[curveAddress] = result.result as Address;
      }
    });
    return map;
  }, [poolData, migratedPairs]);

  const slot0Contracts = useMemo(
    () =>
      migratedPairs
        .map(({ curveAddress }) => poolAddresses[curveAddress])
        .filter((address): address is Address => Boolean(address))
        .map(
          (address) =>
            ({ address, abi: SLOT0_ABI, functionName: "slot0" }) as const
        ),
    [migratedPairs, poolAddresses]
  );

  const { data: slot0Data } = useReadContracts({
    contracts: slot0Contracts,
    query: { enabled: slot0Contracts.length > 0, refetchInterval: LIVE_REFETCH_INTERVAL_MS },
  });

  const poolPrices = useMemo(() => {
    const map: Record<Address, bigint> = {};
    if (!slot0Data) return map;

    const curvesWithPool = migratedPairs.filter(({ curveAddress }) => poolAddresses[curveAddress]);
    curvesWithPool.forEach(({ curveAddress, tokenAddress }, index) => {
      const result = slot0Data[index];
      if (result?.status !== "success") return;
      const sqrtPriceX96 = (result.result as readonly [bigint, ...unknown[]])[0];
      const tokenIsToken0 = isTokenToken0(tokenAddress);
      map[curveAddress] = spotPriceFromSqrtX96(sqrtPriceX96, tokenIsToken0);
    });
    return map;
  }, [slot0Data, migratedPairs, poolAddresses]);

  /**
   * Post-migration pool volume, summed from Swap logs.
   *
   * A curve's `cumulativeVolume` counts buys and sells alike but stops the
   * moment the token migrates, since a Uniswap swap never touches it — so a
   * busy migrated pool otherwise showed its graduation-day total forever,
   * and disagreed with the token detail page, which does span both venues.
   *
   * Scoped tightly to keep this affordable in a grid: only MIGRATED tokens
   * are scanned (most are not), and only once per pool rather than on the
   * 8-second price poll, since historical volume cannot change retroactively
   * — new swaps simply add to it on the next mount.
   */
  const publicClient = usePublicClient();
  const [poolVolumes, setPoolVolumes] = useState<Record<Address, bigint>>({});

  const poolVolumeKey = useMemo(
    () =>
      migratedPairs
        .map(({ curveAddress }) => `${curveAddress}:${poolAddresses[curveAddress] ?? ""}`)
        .sort()
        .join(","),
    [migratedPairs, poolAddresses]
  );

  useEffect(() => {
    if (!publicClient) return;
    const entries = migratedPairs
      .map((pair) => ({ ...pair, pool: poolAddresses[pair.curveAddress] }))
      .filter((entry): entry is typeof entry & { pool: Address } => Boolean(entry.pool));
    if (entries.length === 0) return;

    let cancelled = false;
    (async () => {
      const found: Record<Address, bigint> = {};
      for (const { curveAddress, tokenAddress, pool } of entries) {
        try {
          // `fromBlock: 0n, toBlock: "latest"` used to sit here directly.
          // The RPC this app is configured with (Alchemy free tier) hard-caps
          // a single eth_getLogs call at 10 blocks — see chunkedLogs.ts — so
          // that request 400'd every time, was swallowed by this same catch,
          // and pool volume silently stayed at 0 for every migrated token.
          // Anchoring on the curve's own launchBlock (rather than genesis)
          // keeps the chunked scan's block count small.
          let startBlock = 0n;
          try {
            startBlock = (await publicClient.readContract({
              address: curveAddress,
              abi: BONDING_CURVE_ABI,
              functionName: "launchBlock",
            })) as bigint;
          } catch {
            // Fall back to a full scan from genesis rather than failing.
          }
          const head = await publicClient.getBlockNumber();
          const logs = await getLogsChunked(
            (from, to) =>
              publicClient.getLogs({ address: pool, event: SWAP_EVENT, fromBlock: from, toBlock: to }),
            startBlock,
            head
          );
          const tokenIsToken0 = isTokenToken0(tokenAddress);
          let total = 0n;
          for (const log of logs) {
            const args = log.args as { amount0?: bigint; amount1?: bigint };
            const ethDelta = tokenIsToken0 ? args.amount1 : args.amount0;
            if (ethDelta === undefined) continue;
            // Absolute value: the ETH leg is negative when it leaves the
            // pool (a buy) and positive when it enters (a sell). Both are
            // volume.
            total += ethDelta < 0n ? -ethDelta : ethDelta;
          }
          found[curveAddress] = total;
        } catch {
          // Best-effort: a failed scan just leaves curve-only volume, which
          // is what this showed before.
        }
      }
      if (!cancelled) setPoolVolumes((prev) => ({ ...prev, ...found }));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolVolumeKey, publicClient]);

  const result = useMemo(() => {
    const map: Record<Address, MarketData | undefined> = {};
    for (const [curveAddress, entry] of Object.entries(stage1) as [Address, (typeof stage1)[Address]][]) {
      // A migrated token is priced by its pool or not at all. The curve's
      // `getPrice()` is frozen once migration drains `realEthReserve` to
      // zero, so falling back to it here — as this did — rendered a
      // plausible but WRONG price on every load, for the second or two
      // before the pool lookup resolved, then silently corrected itself.
      //
      // Leaving the entry out instead makes the card show its normal
      // loading state, which is honest. Pool resolution is two chained
      // reads (getPool, then slot0), so this window is real on every mount.
      const poolPrice = poolPrices[curveAddress];
      if (entry.migrated && poolPrice === undefined) continue;

      const priceWei = entry.migrated ? poolPrice! : entry.priceWei;
      map[curveAddress] = {
        priceWei,
        marketCapWei: priceWei * entry.totalSupplyWhole,
        progressPct: entry.progressPct,
        graduated: entry.graduated,
        migrated: entry.migrated,
        volumeWei: entry.volumeWei + (poolVolumes[curveAddress] ?? 0n),
      };
    }
    return map;
  }, [stage1, poolPrices, poolVolumes]);

  return { data: result, isLoading, refetch: () => refetch() };
}
