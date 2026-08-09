import Link from "next/link";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatCompactTokenAmount, truncateAddress } from "@/app/_lib/format";
import { formatTimeAgo } from "@/app/_lib/time";

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
 * A publicly browsable campaign — no wallet needed to see this.
 *
 * Ended campaigns keep their place in the list rather than disappearing, so
 * a token's campaign history stays reachable; the status chip is what
 * distinguishes them, not their absence.
 */
export default function PublicCampaignCard({ campaign }: { campaign: PublicCampaign }) {
  const imageUrl = campaign.imageUrl ? resolveIpfsUrl(campaign.imageUrl) : null;
  const isEnded = campaign.state !== "open";

  return (
    <li className="camp-card">
      <Link href={`/campaigns/${campaign.tokenAddress}`} className="contents">
        <div className="camp-top">
          <span className="camp-token">
            <span className="camp-thumb" aria-hidden="true">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <span className="text-base font-extrabold text-white">
                  {(campaign.ticker ?? "?").charAt(0).toUpperCase()}
                </span>
              )}
            </span>
            <span className="camp-id">
              <span className="camp-name">
                {campaign.name ?? campaign.ticker ?? truncateAddress(campaign.tokenAddress)}
              </span>
              {campaign.ticker && <span className="camp-ticker">${campaign.ticker}</span>}
            </span>
          </span>

          <span className="camp-status" data-state={isEnded ? "ended" : "live"}>
            {isEnded ? "Ended" : "Live"}
          </span>
        </div>

        <p className="camp-desc">
          {campaign.description ?? campaign.title ?? "Post about this token to earn a share."}
        </p>

        <dl className="camp-figures">
          <div>
            <dt>Pool</dt>
            <dd>{formatCompactTokenAmount(campaign.allocationRaw)}</dd>
          </div>
          <div>
            <dt>Winners</dt>
            <dd>{campaign.winnerCount ?? "—"}</dd>
          </div>
          <div>
            <dt>{isEnded ? "Ended" : "Opened"}</dt>
            <dd>
              {campaign.openedAt ? formatTimeAgo(campaign.openedAt) : "—"}
            </dd>
          </div>
        </dl>
      </Link>
    </li>
  );
}
