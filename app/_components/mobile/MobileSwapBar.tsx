"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import SwapPanel from "@/app/_components/token/SwapPanel";

/**
 * Mobile trading entry point: a fixed bar pinned above the tab bar, with
 * two large targets that open the full swap sheet.
 *
 * Trading is the whole point of the token page, so on a phone it cannot be
 * a panel the user has to scroll past the chart to reach. The desktop
 * layout docks the panel beside the chart for the same reason -- always
 * visible, never a scroll away -- and this is that idea in the one place a
 * phone has room for it.
 *
 * The sheet reuses SwapPanel unchanged, so quoting, approvals, slippage
 * and both the curve and pool trade paths are the exact same code as
 * desktop. Nothing about how a trade is built or sent differs by viewport.
 */
export default function MobileSwapBar({
  tokenAddress,
  curveAddress,
  migrated,
  poolPriceWei,
  ethUsdPrice,
}: {
  tokenAddress: Address;
  curveAddress: Address | undefined;
  migrated: boolean | undefined;
  poolPriceWei: bigint | undefined;
  ethUsdPrice: number;
}) {
  const [sheetMode, setSheetMode] = useState<"buy" | "sell" | null>(null);

  useEffect(() => {
    if (!sheetMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSheetMode(null);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sheetMode]);

  return (
    <>
      <div
        className="ascii fixed inset-x-0 z-30 flex gap-2 px-3 py-2 border-t border-white/15 bg-black"
        // Sits directly on top of the bottom tab bar (h-14) plus whatever
        // the device reserves for its home indicator.
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 3.5rem)" }}
      >
        <button
          onClick={() => setSheetMode("buy")}
          className="flex-1 min-h-12 pixel-frame text-[13px] lowercase text-white bg-[#2ebd85]"
        >
          [ buy ]
        </button>
        <button
          onClick={() => setSheetMode("sell")}
          className="flex-1 min-h-12 pixel-frame text-[13px] lowercase text-white bg-[#e2444b]"
        >
          [ sell ]
        </button>
      </div>

      {sheetMode && (
        <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-label="Trade">
          <button
            aria-label="Close"
            onClick={() => setSheetMode(null)}
            className="flex-1 bg-black/60"
          />
          <div className="ascii max-h-[88%] flex flex-col border-t border-white/20 bg-black">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
              <span className="text-[11px] text-white/35 lowercase">./trade</span>
              <button
                onClick={() => setSheetMode(null)}
                aria-label="Close"
                className="text-[11px] text-white/40 active:text-white px-3 py-1.5"
              >
                [x]
              </button>
            </div>
            <SwapPanel
              tokenAddress={tokenAddress}
              curveAddress={curveAddress}
              migrated={migrated}
              poolPriceWei={poolPriceWei}
              ethUsdPrice={ethUsdPrice}
              fill
              initialMode={sheetMode}
            />
          </div>
        </div>
      )}
    </>
  );
}
