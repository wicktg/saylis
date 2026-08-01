"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { Address } from "viem";
import { REFERRAL_VAULT_ADDRESS } from "@/app/_lib/contracts/config";
import { REFERRAL_VAULT_ABI } from "@/app/_lib/contracts/ReferralVault";

const REF_STORAGE_KEY = "saylis:pendingReferralCode";

/** Captures `?ref=CODE` from the URL once, on first load, and remembers it
 *  across the wallet-connect flow (which may navigate away and back) —
 *  call this once, near the app root. */
export function useCaptureReferralCode() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code) {
      sessionStorage.setItem(REF_STORAGE_KEY, code.trim().toUpperCase());
    }
  }, []);
}

/**
 * Per-wallet referral state: whether this wallet already has a permanent
 * referrer on-chain, and — if not, and a `?ref=` code is waiting from
 * sessionStorage — the pending referrer to confirm. Registration is a real
 * signed transaction (`ReferralVault.registerReferral`), so nothing here
 * happens silently; `confirm()` is an explicit user action.
 */
export function useReferral(wallet: Address | undefined) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [existingReferrer, setExistingReferrer] = useState<Address | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingReferrer, setPendingReferrer] = useState<Address | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet || !publicClient) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const referrer = (await publicClient.readContract({
        address: REFERRAL_VAULT_ADDRESS as Address,
        abi: REFERRAL_VAULT_ABI,
        functionName: "getReferrer",
        args: [wallet],
      })) as Address;

      if (referrer !== "0x0000000000000000000000000000000000000000") {
        setExistingReferrer(referrer);
        setPendingReferrer(null);
        return;
      }
      setExistingReferrer(null);

      const code = sessionStorage.getItem(REF_STORAGE_KEY);
      if (!code) return;
      setPendingCode(code);

      const response = await fetch(`/api/referral/resolve?code=${code}`);
      if (!response.ok) return;
      const payload = await response.json();
      const referrerWallet = (payload.walletAddress as string)?.toLowerCase();
      if (referrerWallet && referrerWallet !== wallet.toLowerCase()) {
        setPendingReferrer(referrerWallet as Address);
      }
    } catch {
      // Best-effort — a failed check just means no banner shows this load.
    } finally {
      setChecking(false);
    }
  }, [wallet, publicClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Ensure this wallet has its own shareable code the moment it connects,
  // so the /referral page never has to show a loading gap for it.
  useEffect(() => {
    if (!wallet) return;
    fetch("/api/referral/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: wallet }),
    }).catch(() => {});
  }, [wallet]);

  const confirm = useCallback(async () => {
    if (!walletClient || !publicClient || !pendingReferrer) return;
    setConfirming(true);
    setError(null);
    try {
      const txHash = await walletClient.writeContract({
        address: REFERRAL_VAULT_ADDRESS as Address,
        abi: REFERRAL_VAULT_ABI,
        functionName: "registerReferral",
        args: [pendingReferrer],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Registration transaction failed.");

      sessionStorage.removeItem(REF_STORAGE_KEY);
      setExistingReferrer(pendingReferrer);
      setPendingReferrer(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm referral.");
    } finally {
      setConfirming(false);
    }
  }, [walletClient, publicClient, pendingReferrer]);

  const dismiss = useCallback(() => {
    sessionStorage.removeItem(REF_STORAGE_KEY);
    setPendingReferrer(null);
    setPendingCode(null);
  }, []);

  return {
    existingReferrer,
    pendingCode,
    pendingReferrer,
    checking,
    confirming,
    error,
    confirm,
    dismiss,
  };
}
