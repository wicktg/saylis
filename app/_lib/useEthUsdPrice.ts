"use client";

import { useEffect, useState } from "react";

/**
 * The ETH/USD rate, from /api/eth-price — one server-side read shared by
 * every visitor.
 *
 * WHY IT NO LONGER READS THE FEED FROM THE BROWSER
 *
 * Every USD figure in the app is an ETH amount times this number, including
 * every OHLC value on the chart. So it does not merely format a display, it
 * sets the chart's SCALE — and two people holding different values are
 * looking at different charts of the same token.
 *
 * The previous version read Chainlink from each browser and returned a
 * hardcoded constant until that landed. Every page therefore drew its whole
 * history at the fallback scale and rescaled a moment later, which is the
 * jump you see on any refresh; and a visitor whose read failed kept a
 * permanently different chart from everyone else. Reading it once on the
 * server removes both, and drops two eth_calls per visitor per minute.
 *
 * RETURNS 0 WHILE UNKNOWN, ON PURPOSE
 *
 * Not a plausible-looking stand-in. A stand-in has to be replaced, and the
 * replacement is the rescale this exists to remove. `buildCandles` already
 * declines to draw on a non-positive rate, so the chart simply waits and
 * then renders once, correctly, rather than twice. Callers that show a
 * figure should treat 0 as "still loading", the same way the token grid
 * already treats a missing market price.
 */

const REFRESH_MS = 60_000;

/**
 * Shared across every component using this hook. Six of them mount on a
 * token page; without this, that is six identical requests on load and six
 * more every minute, and — worse — six independently-timed values that can
 * briefly disagree with each other on the same screen.
 */
let cached: { usd: number; at: number } | null = null;
let inFlight: Promise<number> | null = null;
const subscribers = new Set<(usd: number) => void>();

async function fetchPrice(): Promise<number> {
  const response = await fetch("/api/eth-price", { cache: "no-store" });
  if (!response.ok) throw new Error("price unavailable");
  const body = (await response.json()) as { usd?: number };
  const usd = Number(body.usd);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("price unusable");
  return usd;
}

async function refresh(): Promise<void> {
  if (cached && Date.now() - cached.at < REFRESH_MS) return;
  inFlight ??= fetchPrice();
  try {
    const usd = await inFlight;
    cached = { usd, at: Date.now() };
    for (const notify of subscribers) notify(usd);
  } catch {
    // Keep the last good value. A failed refresh is not a reason to rescale
    // everyone's chart to zero.
  } finally {
    inFlight = null;
  }
}

export function useEthUsdPrice(): number {
  const [usd, setUsd] = useState<number>(() => cached?.usd ?? 0);

  useEffect(() => {
    subscribers.add(setUsd);
    void refresh();
    // Everyone shares one timer's worth of staleness rather than each
    // component drifting onto its own schedule.
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      subscribers.delete(setUsd);
      clearInterval(interval);
    };
  }, []);

  return usd;
}
