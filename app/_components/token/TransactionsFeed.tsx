"use client";

import { useEffect, useRef, useState } from "react";
import { formatWeiAsUsdPrice, truncateAddress } from "@/app/_lib/format";
import WalletAvatar from "@/app/_components/WalletAvatar";
import type { Trade } from "@/app/_lib/useCurveTrades";

const ONE_TOKEN = 10n ** 18n;

/** Relative age of a unix-seconds timestamp, e.g. "12s ago". */
function timeAgo(timestampSeconds: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - timestampSeconds);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatTokenAmount(baseUnits: bigint): string {
  const whole = Number(baseUnits / ONE_TOKEN);
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(2)}M`;
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(2)}K`;
  return whole.toLocaleString();
}

export default function TransactionsFeed({
  trades,
  isLoading,
  error,
  ethUsdPrice,
}: {
  trades: Trade[];
  isLoading: boolean;
  error: string | null;
  ethUsdPrice: number;
}) {
  // Re-render on a tick so the relative timestamps stay honest without
  // needing new trades to arrive.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  // Track which rows are new since the last render so they can animate in.
  const seenRef = useRef<Set<string>>(new Set());
  const [entering, setEntering] = useState<Set<string>>(new Set());
  const isFirstBatchRef = useRef(true);

  useEffect(() => {
    const fresh = trades.filter((trade) => !seenRef.current.has(trade.id));
    for (const trade of trades) seenRef.current.add(trade.id);

    // The initial backfill shouldn't animate every historical row.
    if (isFirstBatchRef.current) {
      if (trades.length > 0) isFirstBatchRef.current = false;
      return;
    }
    if (fresh.length === 0) return;

    setEntering(new Set(fresh.map((trade) => trade.id)));
    const timeout = setTimeout(() => setEntering(new Set()), 900);
    return () => clearTimeout(timeout);
  }, [trades]);

  // Newest first.
  const rows = [...trades].reverse();

  return (
    // `h-full` is load-bearing: the parent gives this a fixed height, but
    // without claiming it the column collapses to its content, leaving the
    // `flex-1` empty/loading states below nothing to centre themselves in.
    <div className="flex flex-col h-full min-h-0 border-t border-white/10">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-wide">Transactions</span>
        <span className="text-[10px] text-white/40">{trades.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 flex flex-col">
        {trades.length > 0 ? (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[var(--bg-main)] z-10">
              <tr className="text-white/40 text-[10px] uppercase tracking-wide">
                <th className="text-left font-medium px-4 py-2">Time</th>
                <th className="text-left font-medium px-2 py-2">Type</th>
                <th className="text-right font-medium px-2 py-2">Amount</th>
                <th className="text-right font-medium px-2 py-2">Value</th>
                <th className="text-right font-medium px-2 py-2">Price</th>
                <th className="text-right font-medium px-4 py-2">Wallet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => {
                const isBuy = trade.type === "buy";
                return (
                  <tr
                    key={trade.id}
                    className={`border-t border-white/5 hover:bg-white/5 transition-colors ${
                      entering.has(trade.id) ? "tx-row-enter" : ""
                    }`}
                  >
                    <td className="px-4 py-1.5 text-white/50 whitespace-nowrap">
                      {timeAgo(trade.timestamp, now)}
                    </td>
                    <td
                      className={`px-2 py-1.5 font-bold uppercase ${
                        isBuy ? "text-[#2ebd85]" : "text-[#e2444b]"
                      }`}
                    >
                      {trade.type}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {formatTokenAmount(trade.tokensWei)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-white/70">
                      {formatWeiAsUsdPrice(trade.ethWei, ethUsdPrice)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-white/70">
                      {formatWeiAsUsdPrice(trade.priceWei, ethUsdPrice)}
                    </td>
                    <td className="px-4 py-1.5 font-mono text-white/40">
                      <div className="flex items-center justify-end gap-1.5">
                        <WalletAvatar address={trade.wallet} size={16} />
                        {truncateAddress(trade.wallet)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-lime-400/30 border-t-lime-400 spinner-circle animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-[11px] text-white/50 text-center px-4">
            {error}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[11px] text-white/30 text-center px-4">
            No trades yet. This curve hasn&apos;t been traded.
          </div>
        )}
      </div>
    </div>
  );
}
