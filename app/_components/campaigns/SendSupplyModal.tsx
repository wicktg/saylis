"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { formatUnits, type Address } from "viem";
import { INFOFI_CAMPAIGN_ADDRESS, TOKEN_DECIMALS } from "@/app/_lib/contracts/config";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import type { MyCampaign } from "@/app/_lib/useMyCampaigns";
import { useWalletAuth } from "@/app/_lib/useWalletAuth";
import WinnerCountStepper from "./WinnerCountStepper";
import Icon from "@/app/_components/Icon";

const BALANCE_POLL_MS = 4_000;

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;

/**
 * Path B, step 3 of the admin-gated flow: the creator has already been
 * invited (see TalkToTeamModal / the admin dashboard's invite action) and
 * now needs to actually fund the pool.
 *
 * Deliberately NOT a buy-and-lock transaction anymore — the creator sends
 * whatever supply was agreed with the team as a PLAIN ERC-20 transfer to
 * InfoFiCampaign's own address, using their own wallet or any tool they
 * like. This modal only collects "I've sent it" plus the campaign's
 * metadata; it does not sign anything itself. The admin verifies the real
 * on-chain balance and registers the pool afterward — see
 * app/admin/page.tsx's confirm-lock action.
 */
export default function SendSupplyModal({
  open,
  onClose,
  campaign,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  campaign: MyCampaign | null;
  onSubmitted: () => void;
}) {
  const { address: account } = useAccount();
  const { authorize } = useWalletAuth();

  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [winnerCount, setWinnerCount] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-detect the supply landing, rather than trusting a typed number:
  // poll InfoFiCampaign's own balance of this token live, same source of
  // truth the admin's review step re-checks before registering anything.
  const { data: detectedBalance } = useReadContract({
    address: campaign?.tokenAddress as Address | undefined,
    abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
    functionName: "balanceOf",
    args: [INFOFI_CAMPAIGN_ADDRESS as Address],
    query: {
      enabled: Boolean(open && campaign?.tokenAddress),
      refetchInterval: BALANCE_POLL_MS,
    },
  });

  const balance = (detectedBalance as bigint | undefined) ?? 0n;
  const hasDetectedSupply = balance > 0n;

  if (!open || !campaign) return null;

  function reset() {
    setTitle("");
    setDescription("");
    setWinnerCount(50);
    setError(null);
    setCopied(false);
  }

  function handleClose() {
    if (submitting) return;
    onClose();
    reset();
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(INFOFI_CAMPAIGN_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!account || !campaign || !hasDetectedSupply) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.tokenAddress}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("campaigns:lock")),
          title: title.trim(),
          description: description.trim(),
          winnerCount,
          reportedAmount: balance.toString(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not submit for review.");
      onSubmitted();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit for review.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="pixel-frame pixel-panel relative w-full max-w-sm mx-4 p-5">
        <button
          onClick={handleClose}
          disabled={submitting}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Icon icon="pixelarticons:close" className="text-base" />
        </button>

        <h2 className="text-base font-bold mb-1">
          Send Supply {campaign.ticker ? `for ${campaign.ticker}` : ""}
        </h2>
        <p className="text-[10px] text-white/40 leading-snug mb-3">
          Send the agreed token supply to the address below from your own
          wallet. This page watches that address live. Once your tokens
          land, submit below and the team creates the pool.
        </p>

        <div className="mb-3">
          <p className="text-[10px] text-white/40 mb-1">Send tokens to</p>
          <button
            type="button"
            onClick={handleCopy}
            className="pixel-frame pixel-input w-full px-3 py-2 flex items-center justify-between gap-2 text-left"
          >
            <span className="text-[11px] font-mono truncate">
              {INFOFI_CAMPAIGN_ADDRESS}
            </span>
            <Icon
              icon={copied ? "pixelarticons:check" : "pixelarticons:copy"}
              className="text-white/40 text-sm shrink-0"
            />
          </button>
        </div>

        <div className="mb-3 pixel-frame pixel-input px-3 py-2 flex items-center gap-2">
          {hasDetectedSupply ? (
            <>
              <Icon icon="pixelarticons:check" className="text-[var(--accent)] text-sm shrink-0" />
              <span className="text-[11px]">
                Detected{" "}
                <span className="font-bold text-[var(--accent)]">
                  {formatUnits(balance, TOKEN_DECIMALS)}
                </span>{" "}
                tokens
              </span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-white/20 animate-pulse shrink-0" />
              <span className="text-[11px] text-white/40">Waiting for tokens to arrive...</span>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div className="pixel-frame pixel-input px-3 py-1.5">
            <input
              type="text"
              placeholder="Campaign title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              required
              className="w-full bg-transparent text-sm focus:outline-none placeholder:text-white/30"
            />
          </div>

          <div className="pixel-frame pixel-input px-3 py-1.5">
            <textarea
              placeholder="What is this campaign about?"
              rows={3}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
              required
              className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder:text-white/30"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] text-white/40">Airdrop winners</span>
              {/* Submitting is what fixes this, so say so before they do. */}
              <p className="text-[10px] text-white/25 leading-snug">
                Set once -- cannot be changed after submitting.
              </p>
            </div>
            <WinnerCountStepper
              value={winnerCount}
              onChange={setWinnerCount}
              disabled={submitting}
            />
          </div>

          {error && <p className="text-[11px] text-red-400 leading-snug">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !hasDetectedSupply}
            className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm mt-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting
              ? "Submitting..."
              : hasDetectedSupply
                ? "Submit for Review"
                : "Waiting for Tokens..."}
          </button>
        </form>
      </div>
    </div>
  );
}
