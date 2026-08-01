import type { TokenRecord } from "@/app/_lib/types";
import type { MarketData } from "@/app/_lib/useTokenMarketData";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact } from "@/app/_lib/format";
import { formatTimeAgo } from "@/app/_lib/time";
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

  return (
    <div className="pixel-frame pixel-card token-card p-4 cursor-pointer group">
      <div className="aspect-square rounded-xl bg-black flex items-center justify-center mb-4 relative overflow-hidden">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={token.ticker} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl font-black text-lime-400 tracking-tighter">
            {token.ticker.charAt(0)}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="font-bold text-sm tracking-tight uppercase truncate">
            {token.ticker}
          </h3>
          <span className="font-mono text-[9px] font-medium text-lime-400/80 shrink-0">
            {marketData ? formatUsdCompact(marketData.marketCapWei, ethUsdPrice) : "..."}
          </span>
          {marketData?.graduated && (
            <span
              className={
                marketData.migrated
                  ? "text-[8px] font-bold uppercase bg-white/10 text-white/60 px-1 py-0.5 shrink-0"
                  : "text-[8px] font-bold uppercase bg-[var(--accent-tint)] text-[var(--accent)] px-1 py-0.5 shrink-0 animate-pulse"
              }
            >
              {marketData.migrated ? "Migrated" : "Migrating"}
            </span>
          )}
        </div>
        <span className="text-[10px] text-white/30 shrink-0 ml-2">
          {formatTimeAgo(token.created_at)}
        </span>
      </div>

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/10">
        <span className="text-[10px] text-white/40 font-medium">
          Vol{" "}
          <span className="text-white">
            {marketData ? formatUsdCompact(marketData.volumeWei, ethUsdPrice) : "..."}
          </span>
        </span>

        {/* Bonding curve progress toward graduation — plain white border,
            fill is the only signal: brand magenta while trading, dimmed
            grey once graduated. */}
        <div className="h-1.5 w-14 bg-white/10 rounded-full overflow-hidden shrink-0 relative border border-white/20">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${
              marketData?.graduated ? "bg-white/30" : "bg-[var(--accent)]"
            }`}
            style={{ width: `${marketData?.graduated ? 100 : (marketData?.progressPct ?? 0)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
