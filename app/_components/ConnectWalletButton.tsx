"use client";

import { ConnectKitButton } from "connectkit";

/**
 * A rectangular "Connect Wallet" pill in the top nav, styled to match the
 * "Create Token" button it swaps places with once connected. One click
 * opens ConnectKit's own modal (see app/_lib/wagmi.ts / Web3Provider.tsx)
 * — it auto-detects installed browser wallets (MetaMask, Rabby, Coinbase,
 * etc.) as one-click options AND falls back to a WalletConnect QR code for
 * every other mobile/hardware wallet. `ConnectKitButton.Custom` renders no
 * default UI of its own — just a hook into `show()` — so this stays
 * visually consistent with the rest of the top nav instead of ConnectKit's
 * default button styling.
 */
export default function ConnectWalletButton({
  size = "default",
}: {
  /** "compact" trims height/padding/text for the mobile header, where the
   *  logo now takes up more of the same 48px-tall bar. */
  size?: "default" | "compact";
}) {
  return (
    <ConnectKitButton.Custom>
      {({ show, isConnecting }) => (
        <button
          onClick={show}
          disabled={isConnecting}
          className={
            size === "compact"
              ? "btn btn-primary !h-[28px] !px-2.5 !text-[0.625rem] !tracking-[0.03em]"
              : "btn btn-primary !h-[34px] !px-4 !text-[0.6875rem] !tracking-[0.04em]"
          }
        >
          {isConnecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
