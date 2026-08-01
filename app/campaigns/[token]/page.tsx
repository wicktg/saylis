"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import AppShell from "@/app/_components/AppShell";
import JoinPanel from "@/app/_components/campaigns/JoinPanel";
import ClaimPanel from "@/app/_components/campaigns/ClaimPanel";
import WalletAvatar from "@/app/_components/WalletAvatar";
import { supabase } from "@/app/_lib/supabase";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { truncateAddress } from "@/app/_lib/format";
import type { TokenRecord } from "@/app/_lib/types";

type LeaderboardRow = {
  walletAddress: string;
  mindshare: number;
  rank: number;
};

type CampaignInfo = {
  tokenAddress: string;
  ownerWallet: string | null;
  state: "none" | "registered" | "eligible" | "open" | "settled" | "burned";
  openedAt: string | null;
  windowEndsAt: string | null;
  claimDeadlineAt: string | null;
} | null;

type ViewerInfo = {
  joined: boolean;
  xUsername: string | null;
} | null;

/**
 * Public campaign detail: leaderboard + join + claim. No wallet required to
 * view — only to join or claim. Reachable from any public campaign card on
 * /campaigns; a campaign not yet live (invited/awaiting_review/registered/
 * eligible) has nothing meaningful to show here yet.
 */
export default function CampaignDetailPage() {
  const params = useParams<{ token: string }>();
  const tokenAddress = (params?.token ?? "").toLowerCase();
  const { address: account } = useAccount();

  const [token, setToken] = useState<TokenRecord | null>(null);
  const [tokenLookup, setTokenLookup] = useState<"loading" | "found" | "missing">("loading");

  const [campaign, setCampaign] = useState<CampaignInfo>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [viewer, setViewer] = useState<ViewerInfo>(null);
  const [loadingCampaign, setLoadingCampaign] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadToken() {
      if (!isAddress(tokenAddress)) {
        setTokenLookup("missing");
        return;
      }
      const { data } = await supabase
        .from("tokens")
        .select("*")
        .eq("contract_address", tokenAddress)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setToken(data as TokenRecord);
        setTokenLookup("found");
      } else {
        setTokenLookup("missing");
      }
    }
    loadToken();
    return () => {
      cancelled = true;
    };
  }, [tokenAddress]);

  const loadCampaign = useCallback(async () => {
    if (!isAddress(tokenAddress)) return;
    setLoadingCampaign(true);
    setLoadError(null);
    try {
      const url = account
        ? `/api/infofi/campaign/${tokenAddress}?wallet=${account}`
        : `/api/infofi/campaign/${tokenAddress}`;
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load this campaign.");
      setCampaign(payload.campaign);
      setLeaderboard(payload.leaderboard ?? []);
      setViewer(payload.viewer ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this campaign.");
    } finally {
      setLoadingCampaign(false);
    }
  }, [tokenAddress, account]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  if (tokenLookup === "missing") {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm font-bold">Campaign not found.</p>
          <Link href="/campaigns" className="text-[11px] text-[var(--accent)] hover:underline">
            Back to Campaigns
          </Link>
        </div>
      </AppShell>
    );
  }

  if (tokenLookup === "loading" || !token || loadingCampaign) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-lime-400/30 border-t-lime-400 spinner-circle animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (loadError || !campaign) {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm font-bold">Could not load this campaign.</p>
          <p className="text-[11px] text-white/40">{loadError}</p>
        </div>
      </AppShell>
    );
  }

  const imageUrl = resolveIpfsUrl(token.image_url);
  const isEnded = campaign.state === "settled" || campaign.state === "burned";
  const isOwner = Boolean(
    account && campaign.ownerWallet && account.toLowerCase() === campaign.ownerWallet.toLowerCase()
  );

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto pixel-scrollbar">
        {/* ---- Header ---- */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          <Link
            href="/campaigns"
            aria-label="Back to Campaigns"
            className="w-8 h-8 flex items-center justify-center shrink-0 border border-white/15 text-white/60 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
          >
            <iconify-icon icon="pixelarticons:arrow-left" className="text-base" />
          </Link>

          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={token.ticker}
              className="w-10 h-10 object-cover bg-white/5 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
              <span className="text-sm font-black text-[var(--accent)]">
                {token.ticker.charAt(0)}
              </span>
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold uppercase tracking-tight truncate">
                {token.ticker}
              </h1>
              <span className="text-[11px] text-white/40 truncate">{token.name}</span>
              {isEnded && (
                <span className="text-[9px] font-bold uppercase bg-white/10 text-white/40 px-1.5 py-0.5 shrink-0">
                  Ended
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* ---- Leaderboard ---- */}
          <div className="pixel-frame pixel-card overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <h2 className="text-xs font-bold uppercase tracking-wide text-white/60">
                Leaderboard
              </h2>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-[11px] text-white/30 text-center py-10">
                No mindshare scored yet.
              </p>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-white/30 uppercase text-[9px] tracking-wide">
                    <th className="text-left font-medium px-4 py-2">Rank</th>
                    <th className="text-left font-medium px-4 py-2">Wallet</th>
                    <th className="text-right font-medium px-4 py-2">Mindshare</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row) => (
                    <tr
                      key={row.walletAddress}
                      className={`border-t border-white/5 ${
                        account && row.walletAddress.toLowerCase() === account.toLowerCase()
                          ? "bg-lime-400/5"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-2 text-white/50 font-mono">#{row.rank}</td>
                      <td className="px-4 py-2 font-mono">
                        <div className="flex items-center gap-2">
                          <WalletAvatar address={row.walletAddress} size={18} />
                          {truncateAddress(row.walletAddress)}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right font-bold text-[var(--accent)]">
                        {row.mindshare.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- Actions ---- */}
          <div className="flex flex-col gap-4">
            {!isOwner && (
              <div className="pixel-frame pixel-card p-4 flex flex-col gap-2">
                <h3 className="text-[10px] uppercase tracking-wide text-white/30">Participate</h3>
                <JoinPanel
                  tokenAddress={tokenAddress}
                  campaignState={campaign.state}
                  account={account}
                  isOwner={isOwner}
                  joined={viewer?.joined ?? false}
                  joinedXUsername={viewer?.xUsername ?? null}
                  onJoined={loadCampaign}
                />
              </div>
            )}

            <div className="pixel-frame pixel-card p-4 flex flex-col gap-2">
              <h3 className="text-[10px] uppercase tracking-wide text-white/30">
                Your Allocation
              </h3>
              <ClaimPanel
                tokenAddress={tokenAddress}
                account={account}
                campaignState={campaign.state}
                claimDeadlineAt={campaign.claimDeadlineAt}
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
