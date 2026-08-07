"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import type { Address } from "viem";
import { REFERRAL_VAULT_ADDRESS } from "@/app/_lib/contracts/config";
import { REFERRAL_VAULT_ABI } from "@/app/_lib/contracts/ReferralVault";
import { waitForReceipt } from "@/app/_lib/txReceipt";
import { writeWithGas } from "@/app/_lib/txGas";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";

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
 * sessionStorage — the pending referrer to confirm.
 *
 * WHY THIS CANNOT BE GASLESS
 *
 * Worth writing down, because it looks like a frontend problem and is not.
 * The vault's only entry point is:
 *
 *     registerReferral(address referrer)
 *
 * The REFERRED party is `msg.sender`. There is no `registerReferralFor`,
 * no EIP-712 meta-transaction variant, and no owner- or relayer-permissioned
 * path — so no backend can register on a user's behalf, whoever pays. The
 * vault is deployed and immutable, so this is a property of the contract
 * rather than of this file. Making it gasless means deploying a new vault
 * with a signature-based entry point and migrating to it.
 *
 * The cost is 45,949 gas, about 0.0000014 ETH at current prices. The
 * signature, not the fee, is what the user actually notices.
 *
 * `confirm()` stays an explicit user action for the same reason: it is a
 * permanent, one-time binding of their wallet to someone else's.
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
        // A wallet's referrer is set once and never changes — the vault
        // reverts with AlreadyRegistered on a second attempt. So a code
        // held from an earlier visit can never apply to this wallet, and
        // keeping it around only leaves something that looks pending.
        // Dropped here so no later render can offer it.
        sessionStorage.removeItem(REF_STORAGE_KEY);
        setExistingReferrer(referrer);
        setPendingReferrer(null);
        setPendingCode(null);
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
      // Simulated before the wallet opens.
      //
      // A referrer is a one-time, permanent binding, and the page may have
      // loaded before the wallet was registered somewhere else — another
      // tab, another device, or a second click on this same banner. Sending
      // blind meant the vault reverting with AlreadyRegistered and the user
      // paying gas to be told no. This catches that, along with
      // SelfReferral and ZeroReferrer, while it is still free.
      const { request } = await publicClient.simulateContract({
        address: REFERRAL_VAULT_ADDRESS as Address,
        abi: REFERRAL_VAULT_ABI,
        functionName: "registerReferral",
        args: [pendingReferrer],
        account: walletClient.account,
      });

      const receipt = await waitForReceipt(
        publicClient,
        await writeWithGas(publicClient, walletClient, request, walletClient.account?.address)
      );
      if (receipt.status !== "success") throw new Error("Registration transaction failed.");

      sessionStorage.removeItem(REF_STORAGE_KEY);
      setExistingReferrer(pendingReferrer);
      setPendingReferrer(null);
      setPendingCode(null);
    } catch (err) {
      // An already-registered wallet is a normal outcome, not a fault:
      // resolve the banner into the settled state instead of leaving a red
      // error over a link the user can do nothing about.
      const raw = err instanceof Error ? err.message : "";
      if (/AlreadyRegistered/i.test(raw)) {
        sessionStorage.removeItem(REF_STORAGE_KEY);
        setPendingReferrer(null);
        setPendingCode(null);
        await refresh();
      } else {
        setError(getFriendlyErrorMessage(err));
      }
    } finally {
      setConfirming(false);
    }
  }, [walletClient, publicClient, pendingReferrer, refresh]);

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
