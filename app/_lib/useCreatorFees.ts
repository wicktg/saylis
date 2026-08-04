"use client";

import { useEffect, useState } from "react";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import {
  getLatestLaunchedToken,
  LAUNCHED_TOKEN_EVENT,
  type LaunchedToken,
} from "@/app/_lib/launchedTokens";

export type CreatorFees = {
  /** The launch whose fees this is reading, or null if the wallet has none. */
  launchedToken: LaunchedToken | null;
  /** Wei owed to the creator right now. `undefined` until the read lands. */
  creatorFeesOwed: bigint | undefined;
  /** True while the claim tx is being signed or is awaiting confirmation. */
  isClaimBusy: boolean;
  /** True only when there is a curve AND a non-zero balance to withdraw. */
  hasClaimable: boolean;
  /** Briefly true after a successful claim, to drive a "Claimed" label. */
  justClaimed: boolean;
  claim: () => Promise<void>;
};

/**
 * Creator fee balance + the claim transaction, for a connected wallet.
 *
 * Extracted out of ProfileMenu so the desktop dropdown and the mobile
 * profile page share one implementation. That matters more here than for
 * most shared UI: `withdrawCreatorFees` moves real money, and the guards
 * around it (only enable when a curve exists and the owed balance is
 * non-zero, swallow a user rejection rather than surfacing it as an error,
 * refetch on the events that can change the balance) are the kind of thing
 * that silently diverges when two components each keep their own copy.
 *
 * Reads the wallet's most recent launch only — same scope the dropdown has
 * always had. A creator with several launches sees fees for the latest one;
 * widening that is a product decision, not a refactor, so it is left alone.
 */
export function useCreatorFees(address: Address | undefined): CreatorFees {
  const [launchedToken, setLaunchedToken] = useState<LaunchedToken | null>(null);
  useEffect(() => {
    setLaunchedToken(getLatestLaunchedToken(address));
  }, [address]);

  // A launch recorded elsewhere in the app (the Create Token modal) during
  // this same session won't otherwise be picked up until `address`
  // changes — listen for it directly so the fee row appears immediately.
  useEffect(() => {
    function handleLaunched() {
      setLaunchedToken(getLatestLaunchedToken(address));
    }
    window.addEventListener(LAUNCHED_TOKEN_EVENT, handleLaunched);
    return () => window.removeEventListener(LAUNCHED_TOKEN_EVENT, handleLaunched);
  }, [address]);

  const curveAddress = launchedToken?.curveAddress;

  const { data: creatorFeesOwed, refetch: refetchCreatorFeesOwed } = useReadContract({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: "creatorFeesOwed",
    query: { enabled: Boolean(curveAddress) },
  });

  // Real-time: any trade (Buy/Sell) or the one-time graduation bonus can
  // move creatorFeesOwed, so refetch on whichever event lands. wagmi polls
  // via eth_getLogs under the hood against the public HTTP RPC.
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "FeeCollected",
    enabled: Boolean(curveAddress),
    onLogs: () => refetchCreatorFeesOwed(),
  });
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "Graduated",
    enabled: Boolean(curveAddress),
    onLogs: () => refetchCreatorFeesOwed(),
  });

  const { writeContractAsync, data: claimTxHash, isPending: isClaimPending } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({ hash: claimTxHash });

  const [justClaimed, setJustClaimed] = useState(false);
  useEffect(() => {
    if (isClaimSuccess) {
      setJustClaimed(true);
      refetchCreatorFeesOwed();
      const timeout = setTimeout(() => setJustClaimed(false), 2500);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClaimSuccess]);

  async function claim() {
    if (!curveAddress) return;
    try {
      await writeContractAsync({
        address: curveAddress,
        abi: BONDING_CURVE_ABI,
        functionName: "withdrawCreatorFees",
      });
    } catch {
      // User rejected or the tx reverted (e.g. nothing owed yet) — the
      // button just returns to its normal state, no owed-amount change.
    }
  }

  return {
    launchedToken,
    creatorFeesOwed,
    isClaimBusy: isClaimPending || isClaimConfirming,
    hasClaimable: Boolean(curveAddress && creatorFeesOwed && creatorFeesOwed > 0n),
    justClaimed,
    claim,
  };
}
