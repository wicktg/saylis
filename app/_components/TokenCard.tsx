import Image from "next/image";
import type { TokenRecord } from "@/app/_lib/types";
import type { MarketData } from "@/app/_lib/useTokenMarketData";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact, truncateAddress } from "@/app/_lib/format";
import { formatTimeAgo } from "@/app/_lib/time";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";

/**
 * One token on the board.
 *
 * A landscape card: square art on the left, everything else stacked beside
 * it. That shape is why the same component serves the phone list — a
 * thumbnail beside a stat block already reads as a list row, so mobile is
 * this card at full width rather than a second component.
 *
 * Deliberately no hover lift or shadow. The board can hold a hundred of
 * these; a card that reacts to the pointer turns scanning into a light
 * show. Keyboard focus still marks itself, via the wrapping button.
 */
export default function TokenCard({
  token,
  marketData,
}: {
  token: TokenRecord;
  marketData: MarketData | undefined;
}) {
  const imageUrl = resolveIpfsUrl(token.image_url);
  const ethUsdPrice = useEthUsdPrice();

  // A graduated curve is at 100% by definition; progressPct only tracks the
  // pre-graduation climb.
  const graduated = marketData?.graduated ?? false;
  const progressPct = graduated ? 100 : marketData?.progressPct ?? 0;

  return (
    <div className="pixel-frame pixel-card relative h-full p-3.5 transition-colors group-hover:border-[var(--brand-line)]">
      {graduated && (
        <span className="grad-cap">
          <span aria-hidden="true">🎓</span>
          <span className="sr-only">Graduated</span>
        </span>
      )}

      <div className="flex gap-3.5">
        <div className="token-thumb w-[76px] h-[76px] sm:w-[84px] sm:h-[84px] shrink-0 rounded-[var(--r-md)] relative overflow-hidden">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={token.ticker}
              fill
              sizes="(max-width: 640px) 76px, 84px"
              className="object-cover"
              // Every card ships through here (a live-updating grid, not a
              // fixed handful) — never worth marking any one of them
              // `priority`; letting them all lazy-load off-screen is what
              // actually keeps the initial page load fast.
              loading="lazy"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-2xl font-extrabold text-white/90">
              {token.ticker.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
            {/* The full name carries the card's identity; the ticker is
                what people actually scan by, so it gets the brand colour. */}
            <span className="text-[0.875rem] font-bold leading-tight text-[var(--ink)] truncate max-w-full">
              {token.name}
            </span>
            <span className="text-[0.75rem] font-bold tracking-[0.02em] text-[var(--brand)]">
              ${token.ticker}
            </span>
          </div>

          <p className="mt-1.5 text-[0.6875rem] font-medium text-[var(--ink-faint)] truncate">
            by{" "}
            <b className="font-bold text-[var(--ink-soft)] font-mono">
              {truncateAddress(token.creator_wallet_address)}
            </b>
            <span className="px-1.5" aria-hidden="true">
              ·
            </span>
            {formatTimeAgo(token.created_at)}
          </p>

          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <span className="text-[0.8125rem] font-bold text-[var(--up)] tabular-nums">
              {marketData ? formatUsdCompact(marketData.marketCapWei, ethUsdPrice) : "—"}
              <em className="ml-1.5 not-italic text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--ink-faint)]">
                mcap
              </em>
            </span>
            <span className="text-[0.75rem] font-bold text-[var(--ink-soft)] tabular-nums">
              {marketData ? formatUsdCompact(marketData.volumeWei, ethUsdPrice) : "—"}
              <em className="ml-1.5 not-italic text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--ink-faint)]">
                vol
              </em>
            </span>
          </div>

          <div
            className="curve mt-2.5"
            role="img"
            aria-label={`Bonding curve ${Math.round(progressPct)} percent`}
          >
            <span
              className="curve-fill"
              data-complete={graduated || undefined}
              style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
            />
          </div>
        </div>
      </div>

      {graduated && (
        <p className="mt-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--ink-faint)]">
          {marketData?.migrated ? "Migrated · trading on the open market" : "Migrating…"}
        </p>
      )}
    </div>
  );
}
