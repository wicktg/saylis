"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { isAddress, type Address } from "viem";
import AppShell from "@/app/_components/AppShell";
import TokenSwapModal from "@/app/_components/token/TokenSwapModal";
import { supabase } from "@/app/_lib/supabase";
import { useTokenMarketData } from "@/app/_lib/useTokenMarketData";
import type { TokenRecord } from "@/app/_lib/types";

/**
 * A shareable link to one token's trade panel.
 *
 * This was a full page: a candlestick chart, a drawing toolset, a live trade
 * feed, a stats header and a docked swap panel, each polling the chain on
 * its own schedule. It is now the one thing a visitor can actually do —
 * trade — plus the three numbers worth knowing first.
 *
 * It renders the SAME component the grid opens rather than a page-shaped
 * copy. Two surfaces showing the same thing is how they drift apart, and a
 * second layout would add nothing: closing returns to the grid, which is
 * where the token was reached from anyway.
 */
export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const router = useRouter();
  const routeAddress = (params?.address ?? "").toLowerCase();

  const [token, setToken] = useState<TokenRecord | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "found" | "missing">("loading");

  // Resolve by either the token address or the curve address, so links from
  // anywhere in the app land correctly.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isAddress(routeAddress)) {
        setLookupState("missing");
        return;
      }
      const { data } = await supabase
        .from("tokens")
        .select("*")
        .or(`contract_address.eq.${routeAddress},curve_address.eq.${routeAddress}`)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (data) {
        setToken(data as TokenRecord);
        setLookupState("found");
      } else {
        setLookupState("missing");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [routeAddress]);

  // One entry, through the same cached endpoint the grid uses — so price,
  // market cap and volume come from a read shared with every other visitor
  // rather than one made again for this page.
  const pairs = useMemo(
    () =>
      token
        ? [
            {
              curveAddress: token.curve_address as Address,
              tokenAddress: token.contract_address as Address,
            },
          ]
        : [],
    [token]
  );
  const { data: marketData } = useTokenMarketData(pairs);

  return (
    <AppShell>
      <div className="flex-1 flex items-center justify-center p-6">
        {lookupState === "loading" && (
          <p className="ascii text-[11px] text-[var(--ink-faint)]">loading token...</p>
        )}
        {lookupState === "missing" && (
          <p className="ascii text-[11px] text-[var(--ink-faint)]">
            <span className="text-[var(--ink-faint)]">{"// "}</span>
            no token at that address
          </p>
        )}
      </div>

      {token && (
        <TokenSwapModal
          token={token}
          marketData={marketData[token.curve_address as Address]}
          onClose={() => router.push("/")}
        />
      )}
    </AppShell>
  );
}
