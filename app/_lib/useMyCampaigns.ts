"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

/**
 * Mirrors `InfoFiCampaign.State`, PLUS two off-chain-only states that exist
 * before anything is on-chain at all — Path B is now admin-gated, so a
 * campaign's life starts in Supabase, not in the contract:
 *
 *   invited          the team granted this wallet a Path B slot for a
 *                     token. Nothing has moved yet.
 *   awaiting_review  the creator says they sent the agreed supply and
 *                     submitted title/description/cohort; the admin still
 *                     has to verify the real on-chain balance and register
 *                     the pool.
 */
export type CampaignState =
  | "invited"
  | "awaiting_review"
  | "none"
  | "registered"
  | "eligible"
  | "open"
  | "settled"
  | "burned";

/** 'launched' = Path A (pre-mint allocation). 'post_launch' = Path B
 *  (admin-invited send + confirm). 'external' = legacy true-external, no
 *  longer reachable from the UI. */
export type MyCampaign = {
  origin: "launched" | "post_launch" | "external";
  tokenAddress: string;
  curveAddress: string | null;
  name: string | null;
  ticker: string | null;
  imageUrl: string | null;
  state: CampaignState;
  allocationRaw: string;
  title: string | null;
  description: string | null;
  winnerCount: number | null;
  approvalStatus: "pending" | "approved" | "rejected" | null;
  approvalRequestedAt: string | null;
  approvalNote: string | null;
  openedAt: string | null;
  windowEndsAt: string | null;
  claimDeadlineAt: string | null;
  merkleRoot: string | null;
  lastMcapUsd18: string | null;
  invitedAt: string | null;
  reportedAmountRaw: string | null;
};

export type MyRequest = {
  id: string;
  projectName: string;
  contractAddress: string;
  status: "submitted" | "approved" | "rejected";
  reviewNote: string | null;
  createdAt: string;
};

/**
 * The connected wallet's campaigns and pending applications.
 *
 * Campaigns are scoped to one wallet by design: a campaign that has not been
 * opened yet is only meaningful to the developer who owns it, so the page
 * shows nothing to anyone else rather than advertising unlaunched pools.
 */
export function useMyCampaigns(wallet: Address | undefined) {
  const [campaigns, setCampaigns] = useState<MyCampaign[]>([]);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setCampaigns([]);
      setRequests([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/mine?wallet=${wallet}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load campaigns.");
      setCampaigns(payload.campaigns ?? []);
      setRequests(payload.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load campaigns.");
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { campaigns, requests, isLoading, error, refresh };
}
