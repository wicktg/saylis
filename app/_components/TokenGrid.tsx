"use client";

import { useMemo, useState } from "react";
import TokenCard from "@/app/_components/TokenCard";
import TokenSwapModal from "@/app/_components/token/TokenSwapModal";
import { useLiveTokens } from "@/app/_lib/useLiveTokens";
import { useTokenMarketData, type MarketData } from "@/app/_lib/useTokenMarketData";
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
    return <EmptyState>loading tokens...</EmptyState>;
  }

  if (tokens.length === 0) {
    return <EmptyState>no tokens launched yet</EmptyState>;
  }

  if (search.trim() && searchedTokens.length === 0) {
    return <EmptyState>no tokens match &quot;{search.trim()}&quot;</EmptyState>;
  }

  if (sortedTokens.length === 0) {
    return <EmptyState>no graduated tokens yet</EmptyState>;
  }

  return (
    // Single column below `sm`, which is the mobile list view: a landscape
    // card (thumbnail beside a stat block) already reads as a list row, so
    // the mobile layout is the same component at full width rather than a
    // separate one. Above that, fewer columns than the old square cards
    // used, since these need roughly double the width to keep the numeric
    // column from wrapping.
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        {sortedTokens.map((token) => (
          // A button, not a link. Trading is the only thing there is to do
          // with a token now, so tapping a card opens the trade surface
          // directly instead of navigating to a page whose remaining job was
          // to hold the same panel.
          <button
            key={token.id}
            type="button"
            onClick={() => setOpenToken(token)}
            className="text-left"
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
    <div className="ascii text-[11px] text-white/30 py-16 text-center">
      <span className="text-white/20">{"// "}</span>
      {children}
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

  switch (sortBy) {
    case "newest":
      return [...tokens].sort((a, b) => createdAtMs(b) - createdAtMs(a));

    case "oldest":
      return [...tokens].sort((a, b) => createdAtMs(a) - createdAtMs(b));

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
