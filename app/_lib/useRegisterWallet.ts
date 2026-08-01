"use client";

import { useEffect, useRef } from "react";
import type { Address } from "viem";

/**
 * Fires once per connected wallet (per page load), registering it as a
 * "known" wallet — see /api/wallets/register. This is the entire audience
 * source for admin broadcast notifications, so it needs to fire from
 * somewhere every real page mounts; AppShell is that place.
 */
export function useRegisterWallet(wallet: Address | undefined) {
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!wallet || registered.current === wallet) return;
    registered.current = wallet;
    fetch("/api/wallets/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: wallet }),
    }).catch(() => {
      // Best-effort; a missed registration just means this wallet won't
      // receive broadcasts until its next connect on some other page.
    });
  }, [wallet]);
}
