"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { supabase } from "@/app/_lib/supabase";

export type XAccount = {
  username: string;
  avatarUrl: string | null;
};

/**
 * The X account permanently bound to `wallet`, if any. The actual linking
 * flow (bio-code entry + verification) lives in <ConnectXModal>; this hook
 * just tracks the current binding and exposes `refresh` for the modal to
 * call once it succeeds.
 */
export function useXAccount(wallet: Address | undefined) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setAccount(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data } = await supabase
      .from("x_accounts")
      .select("username, avatar_url")
      .eq("wallet_address", wallet.toLowerCase())
      .maybeSingle();

    setAccount(
      data
        ? { username: data.username as string, avatarUrl: data.avatar_url as string | null }
        : null
    );
    setIsLoading(false);
  }, [wallet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { account, isLoading, refresh };
}
