"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/_lib/supabase";
import type { TokenRecord } from "@/app/_lib/types";

/**
 * Live-queries public.tokens (newest first) and subscribes to Realtime
 * INSERTs so new launches appear immediately, with no manual refresh and
 * no client-side polling. Optionally scoped to a single creator wallet
 * (used by the My Tokens modal) — otherwise returns every token, in
 * insertion order, with no ranking/sort/filter logic applied on top.
 */
export function useLiveTokens(creatorWalletAddress?: string) {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadInitial() {
      let query = supabase
        .from("tokens")
        .select("*")
        .order("created_at", { ascending: false });

      if (creatorWalletAddress) {
        query = query.eq("creator_wallet_address", creatorWalletAddress.toLowerCase());
      }

      const { data, error: fetchError } = await query;
      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setTokens((data ?? []) as TokenRecord[]);
      }
      setLoading(false);
    }

    loadInitial();

    // Unique per effect run (not just per creatorWalletAddress): React
    // Strict Mode double-invokes effects in dev, and cleanup's
    // `removeChannel` is async — a fixed name can collide with a
    // same-named channel that's still mid-teardown, which throws "cannot
    // add postgres_changes callbacks... after subscribe()" on the reused
    // instance. A fresh name every run sidesteps that race entirely.
    const channelName = `tokens-changes-${creatorWalletAddress ?? "all"}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tokens",
          ...(creatorWalletAddress
            ? { filter: `creator_wallet_address=eq.${creatorWalletAddress.toLowerCase()}` }
            : {}),
        },
        (payload) => {
          const newToken = payload.new as TokenRecord;
          setTokens((prev) => {
            if (prev.some((t) => t.id === newToken.id)) return prev;
            return [newToken, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [creatorWalletAddress]);

  return { tokens, loading, error };
}
