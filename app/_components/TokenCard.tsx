import Image from "next/image";
import type { TokenRecord } from "@/app/_lib/types";
import type { MarketData } from "@/app/_lib/useTokenMarketData";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact } from "@/app/_lib/format";
import { formatTimeAgo } from "@/app/_lib/time";
import { asciiBar } from "@/app/_lib/asciiBar";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";

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
  const progressPct = marketData?.graduated ? 100 : marketData?.progressPct ?? 0;

  return (
    <div className="ascii ascii-box relative p-3 cursor-pointer group h-full flex flex-col">
      <div className="flex gap-3">
        <div className="w-14 h-14 shrink-0 bg-black border border-white/15 relative overflow-hidden">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={token.ticker}
              fill
              sizes="56px"
              className="object-cover"
              // Every card ships through here (a live-updating grid, not a
              // fixed handful) — never worth marking any one of them
              // `priority`; letting them all lazy-load off-screen is what
              // actually keeps the initial page load fast.
              loading="lazy"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-lg text-white/40">
              {token.ticker.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            {/* Full name is not shown as its own row — it would double the
                card height for a value that is rarely what you scan by. It
                stays reachable as a tooltip. */}
            <h3 className="text-[13px] text-white uppercase truncate" title={token.name}>
              {token.ticker}
            </h3>
            <span className="text-[10px] text-white/30 shrink-0">
              {formatTimeAgo(token.created_at)}
            </span>
          </div>

          <div className="mt-1.5 space-y-0.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="ascii-label">mcap</span>
              <span className="ascii-value truncate">
                {marketData ? formatUsdCompact(marketData.marketCapWei, ethUsdPrice) : "-"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="ascii-label">vol</span>
              <span className="ascii-value truncate">
                {marketData ? formatUsdCompact(marketData.volumeWei, ethUsdPrice) : "-"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2 flex items-center gap-2 text-[11px] border-t border-white/10">
        <span
          className={`tracking-[-0.05em] ${
            marketData?.graduated ? "text-white/30" : "text-[var(--accent)]"
          }`}
        >
          {asciiBar(progressPct)}
        </span>
        <span className="ascii-value ml-auto shrink-0">{Math.round(progressPct)}%</span>
      </div>

      {marketData?.graduated && (
        <div className="mt-1 text-[10px] text-white/40">
          {marketData.migrated ? "[migrated]" : "[migrating]"}
        </div>
      )}
    </div>
  );
}
