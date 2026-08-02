import { createConfig, http } from "wagmi";
import { robinhood } from "wagmi/chains";
import { getDefaultConfig } from "connectkit";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
if (!walletConnectProjectId) {
  throw new Error(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required. Get one at https://cloud.walletconnect.com"
  );
}

// ConnectKit's own connect UI/modal drives wallet selection (injected
// wallets, Coinbase, WalletConnect QR — auto-detected, not hand-picked
// here); `getDefaultConfig` just builds the matching wagmi connector set
// for whatever it renders.
// MAINNET as of 2026-08-02 — Robinhood Chain (chain id 4663), real ETH.
// NEXT_PUBLIC_ROBINHOOD_RPC_URL should be set to the funded Alchemy
// endpoint in Vercel; the public default is a fallback only and may be
// rate-limited under real traffic.
export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [robinhood],
    transports: {
      [robinhood.id]: http(
        process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ??
          "https://rpc.mainnet.chain.robinhood.com"
      ),
    },
    walletConnectProjectId,
    appName: "saylis.wtf",
    appDescription: "saylis.wtf token launchpad",
    appUrl: "https://saylis.wtf",
  })
);

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
