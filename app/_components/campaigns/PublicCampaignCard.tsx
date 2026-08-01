import Link from "next/link";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatCompactTokenAmount, truncateAddress } from "@/app/_lib/format";

export type PublicCampaign = {
  tokenAddress: string;
  name: string | null;
  ticker: string | null;
  imageUrl: string | null;
  state: "open" | "settled" | "burned";
  allocationRaw: string;
  title: string | null;
  description: string | null;
  winnerCount: number | null;
  openedAt: string | null;
  windowEndsAt: string | null;
};

/**
 * A publicly browsable campaign — no wallet needed to see this. Ended
 * campaigns (settled/burned) render dimmed and stay at the bottom of the
 * grid rather than disappearing, so the campaign's history is still
 * reachable.
 *
 * No "Live" label — a live campaign is the default, unmarked state; the
 * badge only appears once a campaign has actually ended, since that's the
 * one status worth calling out at a glance.
 */
export default function PublicCampaignCard({ campaign }: { campaign: PublicCampaign }) {
  const imageUrl = campaign.imageUrl ? resolveIpfsUrl(campaign.imageUrl) : null;
  const isEnded = campaign.state !== "open";

  return (
    <Link
      href={`/campaigns/${campaign.tokenAddress}`}
      className={`pixel-frame pixel-card p-4 flex flex-col gap-2 transition-opacity ${
        isEnded ? "opacity-50 hover:opacity-75" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={campaign.ticker ?? "Token"}
            className="w-10 h-10 object-cover bg-white/5 shrink-0"
          />
        ) : (
          <div className="w-10 h-10 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
            <span className="text-sm font-black text-[var(--accent)]">
              {(campaign.ticker ?? "?").charAt(0)}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-tight truncate">
              {campaign.name ?? campaign.ticker ?? truncateAddress(campaign.tokenAddress)}
            </h3>
            {isEnded && (
              <span className="text-[9px] font-bold uppercase bg-white/10 text-white/40 px-1.5 py-0.5 shrink-0">
                Ended
              </span>
            )}
          </div>
        </div>
      </div>

      {campaign.title && (
        <p className="text-xs font-bold text-white/90 truncate">{campaign.title}</p>
      )}
      {campaign.description && (
        <p className="text-[11px] text-white/40 leading-snug line-clamp-2">
          {campaign.description}
        </p>
      )}

      <div className="flex items-center gap-3 text-[10px] text-white/40 pt-2 border-t border-white/10">
        <span>
          <span className="text-white font-bold">
            {campaign.winnerCount ?? "?"}
          </span>{" "}
          winners
        </span>
        <span>
          <span className="text-[var(--accent)] font-bold">
            {formatCompactTokenAmount(campaign.allocationRaw)}
          </span>{" "}
          tokens in pool
        </span>
      </div>
    </Link>
  );
}
