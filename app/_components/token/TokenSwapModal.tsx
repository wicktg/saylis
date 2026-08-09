"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [copied, setCopied] = useState(false);
  /** True while the swap panel is showing its confirmation. The token
   *  header and its figures are about the trade you were ABOUT to make, so
   *  they are stale the moment one lands. */
  const [settled, setSettled] = useState(false);
  // Stable identity, or the panel's effect would re-fire every render.
  const handleSettledChange = useCallback((next: boolean) => setSettled(next), []);

  async function copyAddress() {
    await navigator.clipboard.writeText(token.contract_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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
      label: "Price",
      value: marketData ? formatWeiAsUsdPrice(marketData.priceWei, ethUsdPrice) : "-",
    },
    {
      label: "Market cap",
      value: marketData ? formatUsdCompact(marketData.marketCapWei, ethUsdPrice) : "-",
    },
    {
      label: "Volume",
      value: marketData ? formatUsdCompact(marketData.volumeWei, ethUsdPrice) : "-",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-[rgba(20,18,34,0.28)] sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      {/* Bottom sheet on a phone, centred dialog on a desktop. Same content,
          same component — the only thing that differs is where it sits and
          how tall it is, which is a genuine structural difference rather
          than something a breakpoint can scale into place. */}
      <div
        className="relative w-full sm:w-[392px] sm:max-w-[calc(100vw-32px)] max-h-[92dvh] sm:max-h-[86vh] flex flex-col overflow-hidden rounded-t-[var(--r-lg)] sm:rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Trade ${token.ticker}`}
      >
        {/* ---- Head ----
            Just the contract address: the one identifier that's actually
            checkable against the chain. Name/ticker/art are already
            established by the card this modal opened from, and repeating
            them here added nothing a trader needed while trading. */}
        <div className="flex items-center gap-2 p-[18px] pb-3.5 shrink-0">
          {/* The close button stays in every state: it is the only way out
              of the sheet on a phone, so it must not vanish with the rest
              of the header. */}
          {!settled && (
            <button
              onClick={copyAddress}
              className="flex items-center gap-1.5 min-w-0 text-[0.75rem] font-semibold text-[var(--ink-soft)] font-mono transition-colors hover:text-[var(--brand)]"
              aria-label="Copy contract address"
              title={token.contract_address}
            >
              <span className="truncate">{truncateAddress(token.contract_address)}</span>
              <Icon
                icon={copied ? "pixelarticons:check" : "pixelarticons:copy"}
                className="text-xs shrink-0"
              />
            </button>
          )}

          <button
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-[30px] h-[30px] shrink-0 ml-auto rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] transition-colors hover:border-[var(--brand-soft)] hover:text-[var(--brand)]"
          >
            <Icon icon="pixelarticons:close" className="text-xs" />
          </button>
        </div>

        {/* The three numbers, and only these three. Each is a contract read
            the grid already made, so opening this costs no request. */}
        {!settled && (
        <dl className="flex gap-2 px-[18px] pb-3.5 shrink-0">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex-1 min-w-0 px-2.5 py-2 rounded-[var(--r-md)] border border-[var(--line)]"
            >
              <dt className="text-[0.625rem] font-semibold tracking-[0.02em] text-[var(--ink-faint)]">
                {stat.label}
              </dt>
              <dd className="mt-0.5 text-[0.8125rem] font-bold tabular-nums text-[var(--ink)] truncate">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          <SwapPanel
            tokenAddress={token.contract_address as Address}
            tokenSymbol={token.ticker}
            tokenImageUrl={imageUrl}
            curveAddress={token.curve_address as Address}
            migrated={marketData?.migrated}
            poolPriceWei={marketData?.migrated ? marketData.priceWei : undefined}
            ethUsdPrice={ethUsdPrice}
            onSettledChange={handleSettledChange}
            fill
          />
        </div>

        {marketData?.graduated && (
          <p className="px-[18px] py-2.5 border-t border-[var(--line)] shrink-0 text-[0.625rem] font-semibold text-[var(--ink-faint)]">
            {marketData.migrated
              ? "Migrated. Trading on the open market."
              : "Migrating. The pool is being created."}
          </p>
        )}

        {!isMobile && (
          <p className="px-[18px] py-2 border-t border-[var(--line)] shrink-0 text-[0.625rem] font-medium text-[var(--ink-faint)]">
            Press Esc to close
          </p>
        )}
      </div>
    </div>
  );
}
