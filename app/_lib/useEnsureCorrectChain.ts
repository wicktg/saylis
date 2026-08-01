"use client";

import { useEffect } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { TARGET_CHAIN } from "@/app/_lib/contracts/config";

/**
 * Once a wallet is connected, auto-switch (or, if the wallet doesn't know
 * about it yet, add + switch) to Arbitrum Sepolia. This app only ever
 * targets one chain — there's no multi-chain picker anywhere in the UI.
 */
export function useEnsureCorrectChain() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, status } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== undefined && chainId !== TARGET_CHAIN.id;

  useEffect(() => {
    if (isWrongNetwork) {
      switchChain({ chainId: TARGET_CHAIN.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWrongNetwork]);

  return { isWrongNetwork, isSwitching: status === "pending" };
}
