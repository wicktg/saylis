"use client";

import { truncateAddress } from "@/app/_lib/format";
import WalletAvatar from "@/app/_components/WalletAvatar";

/**
 * Shown once, when a wallet connects with a pending `?ref=` code AND has no
 * referrer registered on-chain yet. Confirming is a real signed transaction
 * (`ReferralVault.registerReferral`) — permanent, one-way, so this is
 * always an explicit click, never automatic.
 */
export default function ReferralPrompt({
  referrer,
  confirming,
  error,
  onConfirm,
  onDismiss,
}: {
  referrer: string;
  confirming: boolean;
  error: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[90] w-full max-w-xs pixel-frame pixel-panel p-4">
      <div className="flex items-start gap-2.5">
        <WalletAvatar address={referrer} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold">You were referred</p>
          <p className="text-[11px] text-[var(--ink-soft)] leading-snug mt-0.5">
            Link{" "}
            <span className="font-mono text-[var(--ink)]">{truncateAddress(referrer)}</span> as your
            referrer permanently? This can only be set once.
          </p>
          {error && <p className="text-[10px] text-red-400 mt-1.5">{error}</p>}
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={onConfirm}
              disabled={confirming}
              className="pixel-frame pixel-btn text-white font-bold px-3 py-1.5 text-[11px] disabled:cursor-not-allowed"
            >
              {confirming ? "Confirming..." : "Confirm"}
            </button>
            <button
              onClick={onDismiss}
              disabled={confirming}
              className="text-[11px] text-[var(--ink-soft)] hover:text-[var(--ink)] transition-colors disabled:cursor-not-allowed"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
