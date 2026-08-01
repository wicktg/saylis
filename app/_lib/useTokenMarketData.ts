"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_POOL_FEE,
  WETH9_ADDRESS,
} from "@/app/_lib/contracts/config";

const CALLS_PER_TOKEN = 7;
const LIVE_REFETCH_INTERVAL_MS = 8_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE_TOKEN = 10n ** 18n;
const Q96 = 2n ** 96n;

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

const SLOT0_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

/**
 * Converts a Uniswap `sqrtPriceX96` into wei of ETH per one whole token.
 * Mirrors `useCurveTrades.ts`'s identical helper — kept separate rather
 * than shared since each hook batches it into a different multicall shape.
 */
function spotPriceFromSqrtX96(sqrtPriceX96: bigint, tokenIsToken0: boolean): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const denominator = Q96 * Q96;
  return tokenIsToken0
    ? (numerator * ONE_TOKEN) / denominator
    : (denominator * ONE_TOKEN) / numerator;
}

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
      const tokenIsToken0 = tokenAddress.toLowerCase() < WETH9_ADDRESS.toLowerCase();
      map[curveAddress] = spotPriceFromSqrtX96(sqrtPriceX96, tokenIsToken0);
    });
    return map;
  }, [slot0Data, migratedPairs, poolAddresses]);

  const result = useMemo(() => {
    const map: Record<Address, MarketData | undefined> = {};
    for (const [curveAddress, entry] of Object.entries(stage1) as [Address, (typeof stage1)[Address]][]) {
      const priceWei = entry.migrated ? (poolPrices[curveAddress] ?? entry.priceWei) : entry.priceWei;
      map[curveAddress] = {
        priceWei,
        marketCapWei: priceWei * entry.totalSupplyWhole,
        progressPct: entry.progressPct,
        graduated: entry.graduated,
        migrated: entry.migrated,
        volumeWei: entry.volumeWei,
      };
    }
    return map;
  }, [stage1, poolPrices]);

  return { data: result, isLoading, refetch: () => refetch() };
}
