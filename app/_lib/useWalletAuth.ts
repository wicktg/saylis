"use client";

import { useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { buildAuthMessage, type AuthenticatedRequest } from "@/app/_lib/walletAuth";

/**
 * Client half of the wallet-signature auth in `app/_lib/walletAuth.ts`.
 *
 * Produces the three fields every protected route now expects
 * (`walletAddress`, `signature`, `issuedAt`) by asking the connected wallet
 * to sign the exact string the server will rebuild and verify against.
 *
 * The message is built by the SAME shared function the server uses, which is
 * the point of exporting it from a non-"use client" module: if the two sides
 * ever drift, every request fails closed rather than silently authenticating
 * the wrong thing.
 *
 * Each call prompts the wallet. That is intentional for admin actions — the
 * signature is scoped to one `action`, so approving a campaign cannot be
 * replayed as a broadcast to every user, and the prompt is the moment the
 * team member actually sees which action they are authorizing.
 */
export function useWalletAuth() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  /** Signs `action` and returns the fields to spread into a request body. */
  const authorize = useCallback(
    async (action: string): Promise<Required<AuthenticatedRequest>> => {
      if (!address) throw new Error("Connect a wallet first.");

      const issuedAt = Date.now();
      const message = buildAuthMessage({ action, address, issuedAt });
      const signature = await signMessageAsync({ message });

      return { walletAddress: address, signature, issuedAt };
    },
    [address, signMessageAsync]
  );

  return { authorize };
}
