"use client";

import { useMemo, useState } from "react";
import TokenCard from "@/app/_components/TokenCard";
import TokenSwapModal from "@/app/_components/token/TokenSwapModal";
import { useLiveTokens } from "@/app/_lib/useLiveTokens";
import { useTokenMarketData, type MarketData } from "@/app/_lib/useTokenMarketData";
import { useAutoMigrate } from "@/app/_lib/useAutoMigrate";
import type { SortOption } from "@/app/_lib/sort";
import type { TokenRecord } from "@/app/_lib/types";
import type { Address } from "viem";

export default function TokenGrid({ sortBy, search = "" }: { sortBy: SortOption; search?: string }) {
  const { tokens, loading } = useLiveTokens();

  /** Which token's trade panel is open, if any. */
  const [openToken, setOpenToken] = useState<TokenRecord | null>(null);

  const pairs = useMemo(
    () =>
      tokens.map((t) => ({
        curveAddress: t.curve_address as Address,
        tokenAddress: t.contract_address as Address,
      })),
    [tokens]
  );
  const { data: marketData } = useTokenMarketData(pairs);

  // A graduated curve has halted with no pool yet. Nudge it along the
  // moment we see one, rather than waiting on the 10-minute cron.
  useAutoMigrate(marketData);

  // Ticker, name, or a full/partial contract address — whatever the user
  // actually has on hand when hunting for a specific token.
  const searchedTokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return tokens;
    return tokens.filter(
      (t) =>
        t.ticker.toLowerCase().includes(query) ||
        t.name.toLowerCase().includes(query) ||
        t.contract_address.toLowerCase().includes(query)
    );
  }, [tokens, search]);

  const sortedTokens = useMemo(
    () => sortTokens(searchedTokens, marketData, sortBy),
    [searchedTokens, marketData, sortBy]
  );

  if (loading) {
    return <EmptyState>Loading tokens…</EmptyState>;
  }

  if (tokens.length === 0) {
    return <EmptyState>No tokens launched yet.</EmptyState>;
  }

  if (search.trim() && searchedTokens.length === 0) {
    return <EmptyState>No tokens match &quot;{search.trim()}&quot;.</EmptyState>;
  }

  if (sortedTokens.length === 0) {
    return <EmptyState>No graduated tokens yet</EmptyState>;
  }

  return (
    // Single column below `sm`, which is the mobile list view: a landscape
    // card (thumbnail beside a stat block) already reads as a list row, so
    // the mobile layout is the same component at full width rather than a
    // separate one. Above that, fewer columns than the old square cards
    // used, since these need roughly double the width to keep the numeric
    // column from wrapping.
    <>
      {/* Row gap clears the 17px overhang of the graduation medallion. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-3.5 gap-y-7">
        {sortedTokens.map((token) => (
          // A button, not a link. Trading is the only thing there is to do
          // with a token now, so tapping a card opens the trade surface
          // directly instead of navigating to a page whose remaining job was
          // to hold the same panel.
          <button
            key={token.id}
            type="button"
            onClick={() => setOpenToken(token)}
            className="group text-left rounded-[var(--r-lg)] focus-visible:outline-2 focus-visible:outline-[var(--brand)] focus-visible:outline-offset-2"
            aria-label={`Trade ${token.ticker}`}
          >
            <TokenCard token={token} marketData={marketData[token.curve_address as Address]} />
          </button>
        ))}
      </div>

      {openToken && (
        <TokenSwapModal
          token={openToken}
          // Already fetched for the card behind it, so opening costs nothing.
          marketData={marketData[openToken.curve_address as Address]}
          onClose={() => setOpenToken(null)}
        />
      )}
    </>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 gap-2">
      <h2 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">{children}</h2>
    </div>
  );
}

function sortTokens(
  tokens: TokenRecord[],
  marketData: Record<Address, MarketData | undefined>,
  sortBy: SortOption
): TokenRecord[] {
  const withData = (token: TokenRecord) => marketData[token.curve_address as Address];
  const createdAtMs = (token: TokenRecord) => new Date(token.created_at).getTime();

  // A token with no market data yet sorts last rather than as a zero, so a
  // still-loading row never displaces a real one from the top.
  const metric = (token: TokenRecord, key: "volumeWei" | "marketCapWei") => {
    const data = withData(token);
    return data ? data[key] : -1n;
  };
  const byMetric = (key: "volumeWei" | "marketCapWei") => (a: TokenRecord, b: TokenRecord) => {
    const av = metric(a, key);
    const bv = metric(b, key);
    if (av === bv) return createdAtMs(b) - createdAtMs(a);
    return bv > av ? 1 : -1;
  };

  switch (sortBy) {
    // Trending is volume, not price action: it answers "what is being traded
    // right now", which is the question the board is actually for.
    case "trending":
      return [...tokens].sort(byMetric("volumeWei"));

    case "mcap":
      return [...tokens].sort(byMetric("marketCapWei"));

    case "newest":
      return [...tokens].sort((a, b) => createdAtMs(b) - createdAtMs(a));

    case "graduated":
      // Filter down to graduated tokens only, newest-launched first (since
      // graduation order isn't tracked off-chain).
      return tokens
        .filter((token) => withData(token)?.graduated ?? false)
        .sort((a, b) => createdAtMs(b) - createdAtMs(a));

    default:
      return tokens;
  }
}
