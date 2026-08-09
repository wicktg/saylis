"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { wagmiConfig } from "@/app/_lib/wagmi";

/**
 * ConnectKit renders its own modal, entirely outside our component tree, so
 * it cannot inherit the design system the way everything else does. These
 * variables are the whole surface it exposes — set them and the wallet
 * picker matches the app rather than arriving as a dark panel with a lime
 * accent, which is what it did before the rebrand.
 *
 * Values are literals, not `var(--brand)`, because ConnectKit reads them
 * into its own scope where our `:root` tokens are not resolvable. They are
 * the only place in the app that repeats a palette hex, and they are
 * commented as such so a palette change knows to come here too.
 */
const CONNECTKIT_THEME = {
  "--ck-font-family": "var(--font-inter), system-ui, sans-serif",
  "--ck-border-radius": "16px",

  // --brand / --brand-bright / --brand-soft
  "--ck-accent-color": "#cb2ab8",
  "--ck-accent-text-color": "#ffffff",
  "--ck-primary-button-background": "#ffffff",
  "--ck-primary-button-hover-background": "#f6f7f7",
  "--ck-secondary-button-background": "#f6f7f7",
  "--ck-secondary-button-hover-background": "#ececf0",

  // --surface / --surface-sunken / --ink / --ink-soft
  "--ck-body-background": "#ffffff",
  "--ck-body-background-secondary": "#f6f7f7",
  "--ck-body-color": "#1f1f24",
  "--ck-body-color-muted": "#6f6f78",
  "--ck-body-color-muted-hover": "#1f1f24",
  "--ck-body-divider": "#ececf0",
  "--ck-body-action-color": "#6f6f78",

  "--ck-overlay-background": "rgba(20, 18, 34, 0.28)",
  "--ck-modal-box-shadow": "0 22px 48px -20px rgba(114, 29, 104, 0.45)",
} as const;

export default function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider mode="light" customTheme={CONNECTKIT_THEME}>
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
