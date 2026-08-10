import Link from "next/link";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatCompactTokenAmount, truncateAddress } from "@/app/_lib/format";
import { formatTimeLeft } from "@/app/_lib/time";

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

  // The pool is the hook, so it keeps full-strength ink; the rest is
  // supporting detail and stays quiet.
  const pool = `${formatCompactTokenAmount(campaign.allocationRaw)}${
    campaign.ticker ? ` ${campaign.ticker}` : ""
  }`;
  const timing = isEnded
    ? "Ended"
    : campaign.windowEndsAt
      ? formatTimeLeft(campaign.windowEndsAt)
      : null;

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

        {/* One quiet line instead of three bordered tiles. Boxing each
            figure inside an already-bordered card drew three more
            rectangles to say what the words alone say, and the labels
            ("Pool", "Winners") were redundant once the unit is written
            out beside the number. */}
        <p className="camp-facts">
          <strong>{pool}</strong> pool
          {campaign.winnerCount ? <> &middot; {campaign.winnerCount} winners</> : null}
          {timing ? <> &middot; {timing}</> : null}
        </p>
      </Link>
    </li>
  );
}
