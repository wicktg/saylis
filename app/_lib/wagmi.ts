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
//
// The browser talks to our own /api/rpc route, never to Alchemy directly.
// Calling Alchemy from the page failed CORS preflight (it sends no
// Access-Control-Allow-Origin for saylis.wtf), and doing it via a
// NEXT_PUBLIC_ URL also inlined the Alchemy API key into the client
// bundle. The proxy is same-origin and keeps the key server-side — see
// app/api/rpc/route.ts.
export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [robinhood],
    transports: {
      // `batch` coalesces calls made in the same tick into ONE HTTP POST
      // carrying a JSON-RPC array. The chunked log reader issues many small
      // getLogs in quick succession, and without this each was its own
      // request -- which is what filled the console with 429s on /api/rpc.
      // The proxy already handles array bodies.
      [robinhood.id]: http("/api/rpc", { batch: { wait: 16 } }),
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
