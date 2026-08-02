"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import AppShell from "@/app/_components/AppShell";
import CampaignCard from "@/app/_components/campaigns/CampaignCard";
import PublicCampaignCard, {
  type PublicCampaign,
} from "@/app/_components/campaigns/PublicCampaignCard";
import TalkToTeamModal from "@/app/_components/campaigns/TalkToTeamModal";
import { useMyCampaigns, type CampaignState } from "@/app/_lib/useMyCampaigns";
import Icon from "@/app/_components/Icon";

/** Once a campaign reaches one of these, it's public — everyone sees it in
 *  the grid below, not just its owner. */
const LIVE_STATES = new Set<CampaignState>(["open", "settled", "burned"]);

/**
 * Campaigns — one grid, visibility decided per-campaign rather than by a
 * separate "my campaigns" section:
 *
 *   - Not yet live (invited/awaiting_review/registered/eligible): visible
 *     ONLY to the connected owner wallet, rendered as a management card
 *     (CampaignCard) with the send-supply / approval-request actions.
 *   - Live or ended (open/settled/burned): visible to EVERYONE, wallet or
 *     not, rendered as a plain public card (PublicCampaignCard) linking to
 *     the leaderboard/claim page. This is true for the owner too — once
 *     live, a campaign is just a campaign; the only thing that changes for
 *     its creator is that the Join button on the detail page hides itself
 *     for them (see /campaigns/[token]).
 *
 * Ended campaigns stay visible, sorted after live ones, dimmed — see
 * /api/campaigns/public and PublicCampaignCard.
 *
 * Two paths feed the not-yet-live half, both for tokens that exist inside
 * Saylis:
 *   Path A  reserve 0-5% of supply at mint. Appears here automatically the
 *           moment the curve registers the pool.
 *   Path B  admin-gated. There is no self-service entry point anymore —
 *           the creator talks to the team (Telegram), the team invites
 *           their wallet for a specific token, then the creator sends the
 *           agreed supply and the team confirms it before the pool goes
 *           live. See TalkToTeamModal / SendSupplyModal.
 */
export default function CampaignsPage() {
  const { address: account } = useAccount();
  const { campaigns, isLoading, error, refresh } = useMyCampaigns(account);
  const [talkToTeamOpen, setTalkToTeamOpen] = useState(false);

  const [publicCampaigns, setPublicCampaigns] = useState<PublicCampaign[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPublic() {
      setPublicLoading(true);
      setPublicError(null);
      try {
        const response = await fetch("/api/campaigns/public", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "Could not load campaigns.");
        if (!cancelled) setPublicCampaigns(payload.campaigns ?? []);
      } catch (err) {
        if (!cancelled) {
          setPublicError(err instanceof Error ? err.message : "Could not load campaigns.");
        }
      } finally {
        if (!cancelled) setPublicLoading(false);
      }
    }
    loadPublic();
    return () => {
      cancelled = true;
    };
  }, []);

  // Owner's own not-yet-live campaigns, only ever fetched/shown for the
  // connected wallet — everyone else's equivalent rows simply don't exist
  // in `campaigns` (useMyCampaigns is wallet-scoped server-side).
  const myPendingCampaigns = campaigns.filter((c) => !LIVE_STATES.has(c.state));

  const loading = publicLoading || (Boolean(account) && isLoading);
  const loadError = publicError ?? (account ? error : null);
  const isEmpty = publicCampaigns.length === 0 && myPendingCampaigns.length === 0;

  return (
    <AppShell>
      <div className="flex-1 flex overflow-hidden">
        {/* ---- Main column ---- */}
        <div className="flex-1 overflow-y-auto pixel-scrollbar">
          <div className="px-6 py-5 border-b border-white/10">
            <h1 className="text-lg font-bold">Campaigns</h1>
            <p className="text-[11px] text-white/40 mt-0.5">
              Reward the people who bring attention to a token.
            </p>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-[rgba(207,56,221,0.3)] border-t-[#cf38dd] spinner-circle animate-spin" />
              </div>
            ) : loadError ? (
              <EmptyState
                icon="pixelarticons:close-box"
                title="Could not load campaigns"
                body={loadError}
              />
            ) : isEmpty ? (
              <EmptyState icon="pixelarticons:zap" title="No campaigns yet" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {myPendingCampaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.tokenAddress}
                    campaign={campaign}
                    onChanged={refresh}
                  />
                ))}
                {publicCampaigns.map((campaign) => (
                  <PublicCampaignCard key={campaign.tokenAddress} campaign={campaign} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- Side rail ---- */}
        <aside className="w-64 shrink-0 border-l border-white/10 p-5 hidden lg:flex flex-col gap-4 overflow-y-auto pixel-scrollbar">
          <button
            onClick={() => setTalkToTeamOpen(true)}
            className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm flex items-center justify-center gap-2"
          >
            <Icon icon="mdi:telegram" className="text-sm" />
            Talk to Team
          </button>

          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-wide text-white/30">
              How it works
            </h3>
            <ol className="space-y-2.5 text-[11px] text-white/45 leading-snug">
              <Step n={1}>
                Reserve supply at mint, or talk to the team about a campaign
                for a token you&apos;ve already launched.
              </Step>
              <Step n={2}>
                If invited, send the agreed supply and submit your
                campaign details for the team to confirm.
              </Step>
              <Step n={3}>
                Once the token graduates and the team approves, the
                campaign runs for 7 days while people post about it.
              </Step>
              <Step n={4}>
                Mindshare is scored daily. The top wallets share the pool.
              </Step>
            </ol>
          </div>

          <p className="text-[10px] text-white/25 leading-snug border-t border-white/10 pt-3">
            Pools are locked on-chain from the moment they are funded. Nothing
            unclaimed is ever recoverable by us; it burns.
          </p>
        </aside>
      </div>

      <TalkToTeamModal open={talkToTeamOpen} onClose={() => setTalkToTeamOpen(false)} />
    </AppShell>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-white/25 font-bold shrink-0">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 gap-2">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-1">
        <Icon icon={icon} className="text-xl text-white/25" />
      </div>
      <h2 className="text-sm font-bold text-white/70">{title}</h2>
      {body && <p className="text-[11px] text-white/35 max-w-xs leading-relaxed">{body}</p>}
    </div>
  );
}
