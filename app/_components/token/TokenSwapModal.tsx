"use client";

import { useEffect } from "react";
import Image from "next/image";
import type { Address } from "viem";
import SwapPanel from "@/app/_components/token/SwapPanel";
import Icon from "@/app/_components/Icon";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact, formatWeiAsUsdPrice, truncateAddress } from "@/app/_lib/format";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import { useIsMobile } from "@/app/_lib/useIsMobile";
import type { MarketData } from "@/app/_lib/useTokenMarketData";
import type { TokenRecord } from "@/app/_lib/types";

/**
 * Trading a token, and nothing else.
 *
 * This replaced a full page carrying a candlestick chart, a drawing
 * toolset, a live trade feed and a docked swap panel. All of that existed to
 * help someone decide; only the last part let them act, and everything else
 * had to be continuously fed from the chain to stay honest.
 *
 * WHY IT COSTS NOTHING TO OPEN
 *
 * Every figure here — price, market cap, volume — is already in hand. The
 * grid reads them once for all tokens through /api/market and passes the
 * matching entry down, so opening this makes no request of any kind. The
 * numbers update when the grid's do, and the grid's update when a trade
 * happens.
 *
 * The quote inside SwapPanel is the one live read, and it belongs there: a
 * quote is a statement about current chain state and cannot come from
 * anywhere else without being wrong.
 */
export default function TokenSwapModal({
  token,
  marketData,
  onClose,
}: {
  token: TokenRecord;
  marketData: MarketData | undefined;
  onClose: () => void;
}) {
  const ethUsdPrice = useEthUsdPrice();
  const isMobile = useIsMobile();
  const imageUrl = resolveIpfsUrl(token.image_url);

  // Escape closes, and the page behind does not scroll while this is open —
  // on a phone that scroll-through is the difference between a sheet and a
  // page that has visibly broken.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const stats = [
    {
      label: "price",
      value: marketData ? formatWeiAsUsdPrice(marketData.priceWei, ethUsdPrice) : "-",
    },
    {
      label: "mcap",
      value: marketData ? formatUsdCompact(marketData.marketCapWei, ethUsdPrice) : "-",
    },
    {
      label: "volume",
      value: marketData ? formatUsdCompact(marketData.volumeWei, ethUsdPrice) : "-",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/80 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      {/* Bottom sheet on a phone, centred dialog on a desktop. Same content,
          same component — the only thing that differs is where it sits and
          how tall it is, which is a genuine structural difference rather
          than something a breakpoint can scale into place. */}
      <div
        className="ascii ascii-box relative w-full sm:max-w-sm bg-black max-h-[92dvh] sm:max-h-[86vh] flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Trade ${token.ticker}`}
      >
        <div className="flex items-start gap-3 p-3 border-b border-white/10 shrink-0">
          <div className="w-11 h-11 shrink-0 bg-black border border-white/15 relative overflow-hidden">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={token.ticker}
                fill
                sizes="44px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/20 text-[10px]">
                ?
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold truncate">{token.ticker}</p>
            <p className="text-[11px] text-white/40 truncate">{token.name}</p>
            <p className="text-[10px] text-white/25 mt-0.5">
              {truncateAddress(token.contract_address)}
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[11px] text-white/40 hover:text-white active:text-white px-2 py-1 -mr-1 -mt-1"
          >
            [x]
          </button>
        </div>

        {/* The three numbers, and only these three. Each is a contract read
            the grid already made. */}
        <div className="grid grid-cols-3 border-b border-white/10 shrink-0">
          {stats.map((stat) => (
            <div key={stat.label} className="px-3 py-2 border-r border-white/10 last:border-r-0">
              <p className="text-[9px] uppercase tracking-wider text-white/30">{stat.label}</p>
              <p className="text-[12px] font-medium tabular-nums truncate">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <SwapPanel
            tokenAddress={token.contract_address as Address}
            curveAddress={token.curve_address as Address}
            migrated={marketData?.migrated}
            poolPriceWei={marketData?.migrated ? marketData.priceWei : undefined}
            ethUsdPrice={ethUsdPrice}
            fill
          />
        </div>

        {marketData?.graduated && (
          <p className="text-[10px] text-white/30 px-3 py-1.5 border-t border-white/10 shrink-0">
            {marketData.migrated
              ? "[migrated] trading on the open market"
              : "[migrating] pool is being created"}
          </p>
        )}

        {!isMobile && (
          <p className="text-[10px] text-white/20 px-3 py-1.5 border-t border-white/10 shrink-0">
            <Icon icon="pixelarticons:info-box" className="inline mr-1 -mt-0.5" />
            esc to close
          </p>
        )}
      </div>
    </div>
  );
}
