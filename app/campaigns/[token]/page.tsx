"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import AppShell from "@/app/_components/AppShell";
import JoinPanel from "@/app/_components/campaigns/JoinPanel";
import ClaimPanel from "@/app/_components/campaigns/ClaimPanel";
import { supabase } from "@/app/_lib/supabase";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatCompactTokenAmount, truncateAddress } from "@/app/_lib/format";
import { formatTimeLeft } from "@/app/_lib/time";
import type { TokenRecord } from "@/app/_lib/types";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";
import Icon from "@/app/_components/Icon";
import Spinner from "@/app/_components/Spinner";

type LeaderboardRow = {
  walletAddress: string;
  /** Participants join by proving an X account and are scored entirely on
   *  X engagement, so the handle is the identity that means something
   *  here. The wallet is only where a payout lands. */
  xUsername: string | null;
  xAvatarUrl: string | null;
  mindshare: number;
  rank: number;
};

type CampaignInfo = {
  tokenAddress: string;
  ownerWallet: string | null;
  state: "none" | "registered" | "eligible" | "open" | "settled" | "burned";
  allocationRaw: string | null;
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
      setLoadError(getFriendlyErrorMessage(err, "Could not load this campaign."));
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
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-20">
          <h2 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">Campaign not found</h2>
          <Link
            href="/campaigns"
            className="text-[0.6875rem] font-semibold text-[var(--brand)] hover:underline"
          >
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
          <Spinner className="text-xl text-[var(--brand)]" />
        </div>
      </AppShell>
    );
  }

  if (loadError || !campaign) {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-20 text-center px-6">
          <h2 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">
            Could not load this campaign
          </h2>
          <p className="max-w-xs text-[0.6875rem] font-medium leading-relaxed text-[var(--ink-faint)]">
            {loadError}
          </p>
        </div>
      </AppShell>
    );
  }

  const imageUrl = resolveIpfsUrl(token.image_url);
  const isEnded = campaign.state === "settled" || campaign.state === "burned";
  // Leader's score, so bars are scaled against the top of THIS board.
  const topMindshare = leaderboard.length > 0 ? leaderboard[0].mindshare : 0;
  const isOwner = Boolean(
    account && campaign.ownerWallet && account.toLowerCase() === campaign.ownerWallet.toLowerCase()
  );

  return (
    <AppShell>
      <div className="w-full max-w-[var(--shell)] mx-auto px-[var(--gutter)] pt-[clamp(24px,4vh,40px)] pb-[clamp(40px,7vh,72px)]">
        {/* ---- Header ---- */}
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold text-[var(--ink-soft)] transition-colors hover:text-[var(--brand)]"
        >
          <Icon icon="pixelarticons:arrow-left" className="text-xs" />
          Campaigns
        </Link>

        <header className="mt-3 flex items-center gap-3">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="w-11 h-11 shrink-0 rounded-[var(--r-md)] object-cover bg-[var(--surface-sunken)]"
            />
          ) : (
            <span className="grid place-items-center w-11 h-11 shrink-0 rounded-[var(--r-md)] bg-[var(--brand-tint)] text-[0.9375rem] font-extrabold text-[var(--brand)]">
              {token.ticker.charAt(0)}
            </span>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-[clamp(1.125rem,2.2vw,1.5rem)] leading-tight text-[#2e2e2e] m-0 truncate">
                {token.name}
              </h1>
              <span className="camp-status shrink-0" data-state={isEnded ? "ended" : "live"}>
                {isEnded ? "Ended" : "Live"}
              </span>
            </div>
            <p className="mt-0.5 text-[0.75rem] font-bold text-[var(--brand)]">${token.ticker}</p>
          </div>
        </header>

        {/* Pool, timing and turnout: the three things that decide whether
            joining is still worth it, which the board itself cannot say. */}
        <dl className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <div className="camp-meta">
            <dt>Prize pool</dt>
            <dd>
              {campaign.allocationRaw
                ? `${formatCompactTokenAmount(campaign.allocationRaw)} ${token.ticker}`
                : "-"}
            </dd>
          </div>
          <div className="camp-meta">
            <dt>{isEnded ? "Closed" : "Window"}</dt>
            <dd>{campaign.windowEndsAt ? formatTimeLeft(campaign.windowEndsAt) : "-"}</dd>
          </div>
          <div className="camp-meta">
            <dt>Participants</dt>
            <dd>{leaderboard.length}</dd>
          </div>
        </dl>

        <div className="mt-[clamp(20px,3vh,28px)] grid gap-5 lg:grid-cols-[1fr_290px] items-start">
          {/* ---- Leaderboard ----
              A list rather than a table: there are only three facts per row
              and one of them is a bar, so table semantics bought column
              alignment that the flex row already gives and cost a layout
              that has to be rebuilt to work on a phone.

              The bar is scaled against the LEADER, not against 100. Top
              mindshare here is ~25%, so scaling to 100 would render every
              bar as a stub and waste the one thing a bar is for: showing
              the gap between places at a glance. */}
          <section className="lb" aria-label="Leaderboard">
            <div className="lb-head">
              <h2 className="lb-title">Leaderboard</h2>
              {leaderboard.length > 0 && (
                <span className="lb-count">{leaderboard.length} participants</span>
              )}
            </div>

            {leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
                <h3 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">
                  No mindshare scored yet
                </h3>
                <p className="max-w-xs text-[0.6875rem] font-medium leading-relaxed text-[var(--ink-faint)]">
                  Scores appear once the first snapshot lands.
                </p>
              </div>
            ) : (
              <ol className="lb-list">
                {leaderboard.map((row) => {
                  const isYou =
                    Boolean(account) &&
                    row.walletAddress.toLowerCase() === account?.toLowerCase();
                  const share = topMindshare > 0 ? (row.mindshare / topMindshare) * 100 : 0;
                  return (
                    <li
                      key={row.walletAddress}
                      className={`lb-row ${isYou ? "is-you" : ""} ${row.rank <= 3 ? "is-podium" : ""}`}
                    >
                      <span className="lb-rank">{row.rank}</span>

                      <span className="lb-who">
                        {row.xAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.xAvatarUrl} alt="" className="lb-pfp" />
                        ) : (
                          // `avatar_url` is nullable and the binding is
                          // optional, so this is a normal state, not an error.
                          <span className="lb-pfp lb-pfp-fallback" aria-hidden="true">
                            {(row.xUsername ?? "?").charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="lb-addr">
                          {row.xUsername ? `@${row.xUsername}` : truncateAddress(row.walletAddress)}
                          {isYou && <span className="lb-you">You</span>}
                        </span>
                      </span>

                      <span className="lb-bar" aria-hidden="true">
                        <span className="lb-bar-fill" style={{ width: `${share}%` }} />
                      </span>

                      <span className="lb-score">{row.mindshare.toFixed(2)}%</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* ---- Actions ---- */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--header-h)+var(--header-gap)+16px)]">
            {!isOwner && (
              <div className="side-panel">
                <h3 className="side-title">Participate</h3>
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

            <div className="side-panel">
              <h3 className="side-title">Your allocation</h3>
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
