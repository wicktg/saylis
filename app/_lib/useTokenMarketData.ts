"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";

/**
 * Refresh cadence.
 *
 * This is now ONE request for the entire grid rather than one per token, so
 * the cost no longer scales with what is on screen and the interval can be
 * tightened rather than stretched to compensate. The route caches for 4s, so
 * a tab polling at 5s mostly reads cache; several tabs cost the same as one.
 */
const REFRESH_INTERVAL_MS = 5_000;

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
   *  come from the live Uniswap pool instead. */
  migrated: boolean;
  /** Gross ETH value of every trade so far, wei, across BOTH venues. */
  volumeWei: bigint;
};

type MarketRow = {
  curveAddress: Address;
  priceWei: string;
  marketCapWei: string;
  progressPct: number;
  graduated: boolean;
  migrated: boolean;
  volumeWei: string;
};

/**
 * Live market data for a set of tokens, from /api/market.
 *
 * All of the reading happens there — see that route for what it does and
 * why. What matters here is what it replaced: this hook used to issue a
 * seven-call multicall per token every 15 seconds, then a pool lookup, then
 * a slot0 read, then a chunked eth_getLogs sweep of each migrated token's
 * entire pool history. Every visitor paid that separately, and it was the
 * last eth_getLogs poll left in the app.
 *
 * One request now answers for the whole grid, and the answer is shared
 * across visitors by the route's cache.
 *
 * Values that arrive as decimal strings are converted back to `bigint` here
 * rather than being parsed as JSON numbers: a market cap in wei is far past
 * `Number.MAX_SAFE_INTEGER`, and `JSON.parse` would silently round it.
 */
export function useTokenMarketData(
  pairs: { curveAddress: Address; tokenAddress: Address }[]
): { data: Record<Address, MarketData | undefined>; isLoading: boolean; refetch: () => void } {
  const [data, setData] = useState<Record<Address, MarketData | undefined>>({});
  const [isLoading, setIsLoading] = useState(true);

  // A stable identity for "which tokens", so re-rendering the grid with an
  // equal-but-new array doesn't restart the polling.
  const query = useMemo(
    () =>
      pairs
        .map(({ curveAddress, tokenAddress }) => `${curveAddress}:${tokenAddress}`)
        .sort()
        .join(","),
    [pairs]
  );

  // Bumped by `refetch` to force an immediate read — used after a trade,
  // where waiting out the interval would show the user a stale price they
  // just changed themselves.
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((n) => n + 1), []);

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (query === "") {
      setData({});
      setIsLoading(false);
      return;
    }

    async function load() {
      try {
        const response = await fetch(`/api/market?pairs=${encodeURIComponent(query)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { tokens?: MarketRow[] };
        if (cancelledRef.current) return;

        const next: Record<Address, MarketData | undefined> = {};
        for (const row of body.tokens ?? []) {
          next[row.curveAddress] = {
            priceWei: BigInt(row.priceWei),
            marketCapWei: BigInt(row.marketCapWei),
            progressPct: row.progressPct,
            graduated: row.graduated,
            migrated: row.migrated,
            volumeWei: BigInt(row.volumeWei),
          };
        }
        setData(next);
      } catch {
        // Keep whatever is on screen. A dropped poll is not a reason to
        // empty the grid; the next tick will refill it.
      } finally {
        if (!cancelledRef.current) setIsLoading(false);
      }
    }

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [query, tick]);

  return { data, isLoading, refetch };
}
