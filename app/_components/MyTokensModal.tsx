"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useLiveTokens } from "@/app/_lib/useLiveTokens";
import { useTokenMarketData } from "@/app/_lib/useTokenMarketData";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact } from "@/app/_lib/format";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";

const PAGE_SIZE = 5;

export default function MyTokensModal({
  open,
  onClose,
  walletAddress,
}: {
  open: boolean;
  onClose: () => void;
  walletAddress: Address;
}) {
  const { tokens, loading } = useLiveTokens(walletAddress);
  const [page, setPage] = useState(0);
  const ethUsdPrice = useEthUsdPrice();

  const totalPages = Math.max(1, Math.ceil(tokens.length / PAGE_SIZE));
  const pageTokens = useMemo(
    () => tokens.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [tokens, page]
  );

  // Reset to page 1 whenever the modal is reopened or the underlying list
  // changes size (e.g. a new token lands via realtime while it's closed).
  useEffect(() => {
    if (open) setPage(0);
  }, [open]);
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [totalPages, page]);

  const pairs = useMemo(
    () =>
      pageTokens.map((t) => ({
        curveAddress: t.curve_address as Address,
        tokenAddress: t.contract_address as Address,
      })),
    [pageTokens]
  );
  const { data: marketData } = useTokenMarketData(pairs);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="pixel-frame pixel-panel relative w-full max-w-sm mx-4 p-6 max-h-[80vh] flex flex-col">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors"
        >
          <iconify-icon icon="pixelarticons:close" className="text-base" />
        </button>

        <h2 className="text-lg font-bold tracking-tight mb-5">My Tokens</h2>

        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 space-y-1.5">
          {loading && (
            <div className="text-xs text-white/30 py-10 text-center">Loading...</div>
          )}

          {!loading && tokens.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <iconify-icon icon="pixelarticons:coin" className="text-3xl text-white/15" />
              <p className="text-xs font-bold text-white/50">No bags yet.</p>
              <p className="text-[11px] text-white/25">
                Launch your first token to see it here.
              </p>
            </div>
          )}

          {pageTokens.map((token) => {
            const imageUrl = resolveIpfsUrl(token.image_url);
            const marketCapWei = marketData[token.curve_address as Address]?.marketCapWei;

            return (
              <Link
                key={token.id}
                href={`/token/${token.contract_address}`}
                onClick={onClose}
                className="group flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors"
              >
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    className="w-9 h-9 rounded-lg object-cover bg-white/5 shrink-0 ring-1 ring-transparent group-hover:ring-lime-400/30 transition-all"
                    alt={`${token.ticker} icon`}
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-lime-400/20 flex items-center justify-center shrink-0 ring-1 ring-transparent group-hover:ring-lime-400/30 transition-all">
                    <span className="text-xs font-black text-lime-400">
                      {token.ticker.charAt(0)}
                    </span>
                  </div>
                )}
                <span className="font-bold text-xs uppercase tracking-wide flex-1 truncate">
                  {token.ticker}
                </span>
                <span className="text-[11px] font-bold text-white/70 bg-white/5 rounded-full px-2.5 py-1 shrink-0">
                  {marketCapWei !== undefined
                    ? formatUsdCompact(marketCapWei, ethUsdPrice)
                    : "..."}
                </span>
              </Link>
            );
          })}
        </div>

        {!loading && tokens.length > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-4 mt-3 border-t border-white/5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Previous page"
              className="pixel-frame pixel-btn-ghost w-8 h-8 flex items-center justify-center text-white/70 disabled:cursor-not-allowed"
            >
              <iconify-icon icon="pixelarticons:chevron-left" className="text-xs" />
            </button>
            <span className="text-[11px] font-medium text-white/40">
              <span className="text-[var(--accent)] font-bold">{page + 1}</span> / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              aria-label="Next page"
              className="pixel-frame pixel-btn-ghost w-8 h-8 flex items-center justify-center text-white/70 disabled:cursor-not-allowed"
            >
              <iconify-icon icon="pixelarticons:chevron-right" className="text-xs" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
