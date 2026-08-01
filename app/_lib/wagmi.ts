import { createConfig, http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
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
export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains: [arbitrumSepolia],
    transports: {
      [arbitrumSepolia.id]: http(
        process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ??
          "https://sepolia-rollup.arbitrum.io/rpc"
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
