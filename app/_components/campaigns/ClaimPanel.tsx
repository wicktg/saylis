"use client";

import { useEffect, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { formatUnits, type Address } from "viem";
import { INFO_FI_CAMPAIGN_ABI } from "@/app/_lib/contracts/InfoFiCampaign";
import { INFOFI_CAMPAIGN_ADDRESS, TOKEN_DECIMALS } from "@/app/_lib/contracts/config";
import Icon from "@/app/_components/Icon";
import { waitForReceipt } from "@/app/_lib/txReceipt";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";

type ClaimStatus = "checking" | "unclaimed" | "claimed";

/**
 * The claim flow, gated entirely by on-chain state:
 *
 *   - `hasClaimed(token, account)` is read the moment a settled campaign's
 *     panel mounts, so a returning claimant sees "Claimed" immediately
 *     rather than being invited to try again.
 *   - "Check Allocation" fetches the wallet's merkle proof from Supabase
 *     (computed once at settlement — see /api/infofi/settle) purely for
 *     display; the actual claim call re-verifies that proof against the
 *     on-chain root itself, so a stale or wrong row here can only produce a
 *     failed transaction, never a bad payout.
 *   - The contract's own `hasClaimed` one-way latch is what actually
 *     prevents a second claim — this panel's local "claimed" state after a
 *     successful tx is just what makes the UI reflect that instantly
 *     without waiting on a fresh read.
 */
export default function ClaimPanel({
  tokenAddress,
  account,
  campaignState,
  claimDeadlineAt,
}: {
  tokenAddress: string;
  account: Address | undefined;
  campaignState: string;
  claimDeadlineAt: string | null;
}) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [claimStatus, setClaimStatus] = useState<ClaimStatus>("checking");
  const [checking, setChecking] = useState(false);
  const [allocation, setAllocation] = useState<{ amountRaw: string; proof: string[] } | null>(
    null
  );
  const [notEligible, setNotEligible] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!account || !publicClient || campaignState !== "settled") return;
      setClaimStatus("checking");
      try {
        const result = await publicClient.readContract({
          address: INFOFI_CAMPAIGN_ADDRESS as Address,
          abi: INFO_FI_CAMPAIGN_ABI,
          functionName: "hasClaimed",
          args: [tokenAddress as Address, account],
        });
        if (!cancelled) setClaimStatus(result ? "claimed" : "unclaimed");
      } catch {
        // Read failed (RPC hiccup) — fail open into "unclaimed" so the user
        // can still try; the contract enforces the one-claim rule for real.
        if (!cancelled) setClaimStatus("unclaimed");
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [account, publicClient, campaignState, tokenAddress]);

  if (!account) {
    return (
      <p className="text-[11px] text-white/40">Connect your wallet to check your allocation.</p>
    );
  }

  if (campaignState === "burned") {
    return (
      <p className="text-[11px] text-white/40">
        This campaign&apos;s claim window closed and unclaimed tokens were burned.
      </p>
    );
  }

  if (campaignState !== "settled") {
    return (
      <p className="text-[11px] text-white/40">Claiming opens once results are published.</p>
    );
  }

  if (claimStatus === "checking") {
    return <p className="text-[11px] text-white/40">Checking claim status...</p>;
  }

  if (claimStatus === "claimed") {
    return (
      <p className="text-[11px] text-[#cf38dd] font-bold flex items-center gap-1.5">
        <Icon icon="pixelarticons:check" className="text-sm" />
        Claimed
      </p>
    );
  }

  const claimDeadlinePassed = claimDeadlineAt ? Date.now() > new Date(claimDeadlineAt).getTime() : false;

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setNotEligible(false);
    try {
      const response = await fetch(`/api/infofi/campaign/${tokenAddress}?wallet=${account}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not check your allocation.");
      if (payload.viewer?.allocation) {
        setAllocation(payload.viewer.allocation);
      } else {
        setNotEligible(true);
      }
    } catch (err) {
      setError(getFriendlyErrorMessage(err, "Could not check your allocation."));
    } finally {
      setChecking(false);
    }
  }

  async function handleClaim() {
    if (!walletClient || !publicClient || !allocation) return;
    setClaiming(true);
    setError(null);
    try {
      const txHash = await walletClient.writeContract({
        address: INFOFI_CAMPAIGN_ADDRESS as Address,
        abi: INFO_FI_CAMPAIGN_ABI,
        functionName: "claim",
        args: [
          tokenAddress as Address,
          BigInt(allocation.amountRaw),
          allocation.proof as `0x${string}`[],
        ],
      });
      const receipt = await waitForReceipt(publicClient, txHash);
      if (receipt.status !== "success") throw new Error("The claim transaction failed.");
      setClaimStatus("claimed");
    } catch (err) {
      setError(getFriendlyErrorMessage(err, "Could not claim."));
    } finally {
      setClaiming(false);
    }
  }

  if (allocation) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] text-white/60">
          You can claim{" "}
          <span className="font-bold text-[var(--accent)]">
            {formatUnits(BigInt(allocation.amountRaw), TOKEN_DECIMALS)}
          </span>{" "}
          tokens.
        </p>
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="pixel-frame pixel-btn text-white font-bold px-4 py-2 text-[11px] self-start disabled:cursor-not-allowed"
        >
          {claiming ? "Claiming..." : "Claim"}
        </button>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    );
  }

  if (notEligible) {
    return <p className="text-[11px] text-white/40">You&apos;re not eligible for this campaign.</p>;
  }

  if (claimDeadlinePassed) {
    return <p className="text-[11px] text-white/40">The claim window has closed.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={handleCheck}
        disabled={checking}
        className="pixel-frame pixel-btn text-white font-bold px-4 py-2 text-[11px] self-start disabled:cursor-not-allowed"
      >
        {checking ? "hold on, checking your bag..." : "Check Allocation"}
      </button>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
