"use client";

import { useMemo } from "react";
import Link from "next/link";
import TokenCard from "@/app/_components/TokenCard";
import { useLiveTokens } from "@/app/_lib/useLiveTokens";
import { useTokenMarketData, type MarketData } from "@/app/_lib/useTokenMarketData";
import type { SortOption } from "@/app/_lib/sort";
import type { TokenRecord } from "@/app/_lib/types";
import type { Address } from "viem";

export default function TokenGrid({ sortBy, search = "" }: { sortBy: SortOption; search?: string }) {
  const { tokens, loading } = useLiveTokens();

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
    return <div className="text-xs text-white/30 py-10 text-center">Loading tokens...</div>;
  }

  if (tokens.length === 0) {
    return (
      <div className="text-xs text-white/30 py-16 text-center">
        No tokens launched yet.
      </div>
    );
  }

  if (search.trim() && searchedTokens.length === 0) {
    return (
      <div className="text-xs text-white/30 py-16 text-center">
        No tokens match &quot;{search.trim()}&quot;.
      </div>
    );
  }

  if (sortedTokens.length === 0) {
    return (
      <div className="text-xs text-white/30 py-16 text-center">
        No graduated tokens yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
      {sortedTokens.map((token) => (
        <Link key={token.id} href={`/token/${token.contract_address}`}>
          <TokenCard token={token} marketData={marketData[token.curve_address as Address]} />
        </Link>
      ))}
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
