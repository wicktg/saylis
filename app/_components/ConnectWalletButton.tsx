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
export default function ConnectWalletButton() {
  return (
    <ConnectKitButton.Custom>
      {({ show, isConnecting }) => (
        <button
          onClick={show}
          disabled={isConnecting}
          className="pixel-frame pixel-btn h-9 flex items-center text-white font-bold px-4 text-xs"
        >
          {isConnecting ? "Connecting..." : "Connect Wallet"}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
