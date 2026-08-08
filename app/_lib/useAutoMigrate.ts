"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import type { MarketData } from "@/app/_lib/useTokenMarketData";

/**
 * Triggers `GraduationMigrator.migrate()` for any curve observed to have
 * graduated but not yet migrated.
 *
 * WHY A BROWSER DOES THIS AT ALL
 *
 * `BondingCurve` deliberately never migrates itself — DEX migration is kept
 * out of the trading path on purpose, so a graduating trade cannot be made
 * to pay for a pool deployment. That leaves a window where the curve has
 * halted and no pool exists yet: the token is visibly graduated with
 * nowhere to trade. `.github/workflows/infofi-poke.yml` closes it
 * eventually, but only on a 10-minute tick that GitHub openly delays and
 * skips under load. This closes it in seconds.
 *
 * It is a nudge, never a dependency. If nobody has the site open, the cron
 * still gets there.
 *
 * WHY IT IS SAFE TO FIRE FROM AN UNAUTHENTICATED CLIENT
 *
 * `migrate` is permissionless on-chain: anyone may call it once
 * `curve.graduated()`, and the assets can only ever reach the new pool and
 * then that token's `TokenFeeCollector`, regardless of caller. The route
 * simulates before spending, so a curve that has not graduated or has
 * already migrated costs nothing. The worst an attacker achieves is a
 * migration that was going to happen anyway, sooner.
 *
 * @param marketData The grid's market map. Every graduated-but-unmigrated
 *        curve in it is nudged — not just one the user opened, so a token
 *        nobody clicks on still migrates promptly.
 */
export function useAutoMigrate(marketData: Record<Address, MarketData | undefined>) {
  useEffect(() => {
    const pending = Object.entries(marketData).filter(
      ([curve, data]) => data?.graduated && !data.migrated && !attempted.has(curve.toLowerCase())
    );
    if (pending.length === 0) return;

    for (const [curve] of pending) {
      // Claim it before awaiting: two curves resolving in the same tick, a
      // re-render mid-flight, or a second tab would otherwise each fire
      // their own transaction for the same migration.
      attempted.add(curve.toLowerCase());

      fetch("/api/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curveAddress: curve }),
      }).catch(() => {
        // Deliberately silent, and deliberately NOT retried. The cron is
        // the guarantee; this is the fast path. Surfacing a failure here
        // would be telling a trader about a background job they did not
        // ask for and cannot act on.
      });
    }
  }, [marketData]);
}

/**
 * Curves already nudged in this page session, so a re-render does not fire
 * a second transaction for the same migration. Module-level rather than a
 * ref because the grid remounts across navigations while the tab lives on.
 *
 * Never pruned: a curve can only migrate once, so an entry is never stale
 * in a way that matters, and the set is bounded by how many graduated
 * tokens one session can see.
 */
const attempted = new Set<string>();
