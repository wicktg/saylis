"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import {
  UNISWAP_V3_FACTORY_ADDRESS,
  UNISWAP_V3_POOL_FEE,
  WETH9_ADDRESS,
} from "@/app/_lib/contracts/config";

/**
 * ONE definition of "what is a migrated token worth".
 *
 * This exists because the answer was previously reimplemented per view — the
 * grid read the pool's `slot0`, while the token page inferred it from the
 * last trade in its feed — and the two drifted. Anything that needs the
 * price of a migrated token should come through here.
 *
 * THE RULE THIS FILE ENFORCES
 *
 * `BondingCurve.getPrice()` is only meaningful BEFORE migration. Migration
 * moves the whole real ETH reserve into the Uniswap pool and leaves
 * `realEthReserve = 0`, after which `getPrice()` returns a frozen figure
 * derived from virtual reserves alone — a number that looks plausible and
 * is simply wrong.
 *
 * So for a migrated token the curve price is never a valid fallback, not
 * even a temporary one while the pool price loads. Every helper here returns
 * `undefined` instead, so callers render a loading state rather than briefly
 * showing a wrong price and then correcting itself. That flash — a real
 * price replaced a second later by a different one — is exactly what a user
 * reads as the site being broken.
 */

const ONE_TOKEN = 10n ** 18n;
const Q96 = 2n ** 96n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const GET_POOL_ABI = [
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

export const SLOT0_ABI = [
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

/** Converts a Uniswap `sqrtPriceX96` into wei of ETH per one whole token. */
export function spotPriceFromSqrtX96(sqrtPriceX96: bigint, tokenIsToken0: boolean): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const denominator = Q96 * Q96;
  return tokenIsToken0
    ? (numerator * ONE_TOKEN) / denominator
    : (denominator * ONE_TOKEN) / numerator;
}

/** Uniswap sorts a pair by address; this decides which side the token is on. */
export function isTokenToken0(tokenAddress: string): boolean {
  return tokenAddress.toLowerCase() < WETH9_ADDRESS.toLowerCase();
}

/**
 * Live spot price of a single migrated token, read straight from its pool.
 *
 * @param tokenAddress The launch token.
 * @param enabled Pass the token's `migrationExecuted` flag. While it is
 *        `undefined` (still loading) this stays disabled, so a page cannot
 *        accidentally price a migrated token off the curve just because it
 *        has not learned yet that it migrated.
 * @param refetchIntervalMs Keeps the figure live between trades.
 * @returns `priceWei` is `undefined` until a real pool price is known —
 *          never a curve-derived stand-in. See this file's header.
 */
export function usePoolSpotPrice(
  tokenAddress: Address | undefined,
  enabled: boolean | undefined,
  refetchIntervalMs = 15_000
): { priceWei: bigint | undefined; isPending: boolean } {
  const active = Boolean(tokenAddress && enabled === true);

  const { data: poolAddress } = useReadContract({
    address: UNISWAP_V3_FACTORY_ADDRESS,
    abi: GET_POOL_ABI,
    functionName: "getPool",
    args: tokenAddress ? [tokenAddress, WETH9_ADDRESS, UNISWAP_V3_POOL_FEE] : undefined,
    query: { enabled: active },
  });

  const pool =
    poolAddress && poolAddress !== ZERO_ADDRESS ? (poolAddress as Address) : undefined;

  const { data: slot0 } = useReadContracts({
    contracts: pool ? [{ address: pool, abi: SLOT0_ABI, functionName: "slot0" } as const] : [],
    query: { enabled: Boolean(pool), refetchInterval: refetchIntervalMs },
  });

  const priceWei = useMemo(() => {
    if (!active || !tokenAddress) return undefined;
    const result = slot0?.[0];
    if (result?.status !== "success") return undefined;
    const sqrtPriceX96 = (result.result as readonly [bigint, ...unknown[]])[0];
    const price = spotPriceFromSqrtX96(sqrtPriceX96, isTokenToken0(tokenAddress));
    return price > 0n ? price : undefined;
  }, [active, slot0, tokenAddress]);

  return { priceWei, isPending: active && priceWei === undefined };
}
