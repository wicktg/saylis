/**
 * Proof that a request really came from the wallet it claims to be.
 *
 * Every API route in this app used to identify its caller by reading a
 * `walletAddress` field straight out of the request body or query string and
 * comparing it to something. `isAddress()` was applied, which checks that a
 * string is SHAPED like an address — it says nothing about whether the sender
 * controls it. Anyone with curl could name any wallet they liked and be
 * treated as that wallet.
 *
 * For the team-only routes that was a complete authentication bypass: the
 * admin gate was a string comparison against a value the attacker supplies.
 *
 * The fix is the standard one: the client signs a short, structured, expiring
 * message with the wallet it claims, and the server recovers the signer and
 * compares THAT. A signature over `personal_sign` cannot be produced without
 * the private key, so the recovered address is the one thing in the request an
 * attacker cannot choose.
 *
 * What the message commits to, and why each part is there:
 *
 *   - `domain`   — binds the signature to this app, so a signature harvested
 *                  by another site cannot be replayed here.
 *   - `action`   — binds it to one specific operation. An "approve a campaign"
 *                  signature is not also a "broadcast to every user"
 *                  signature.
 *   - `address`  — stated explicitly so what the user sees in their wallet
 *                  matches what the server checks.
 *   - `issuedAt` — bounds the replay window. A leaked signature is useless
 *                  once it ages out.
 *
 * This is deliberately NOT a session/cookie scheme. Sessions need server-side
 * storage and revocation to be safe; a per-action signature needs neither, and
 * the actions here are infrequent enough that signing each one is not a
 * usability problem.
 */
import { isAddress, verifyMessage, type Address } from "viem";

/** How long a signed request stays valid. Long enough to cover a slow wallet
 *  prompt and clock skew, short enough that a leaked signature expires. */
export const AUTH_MAX_AGE_MS = 5 * 60 * 1000;

const DOMAIN = "saylis.wtf";

/**
 * The exact string the wallet signs. MUST be produced identically on the
 * client and the server — any divergence recovers a different address and the
 * request is rejected, so this function is the single source of truth for the
 * format and is imported by both sides.
 */
export function buildAuthMessage(params: {
  action: string;
  address: string;
  issuedAt: number;
}): string {
  return [
    `${DOMAIN} wants you to sign in with your wallet.`,
    "",
    `Action: ${params.action}`,
    `Wallet: ${params.address.toLowerCase()}`,
    `Issued At: ${new Date(params.issuedAt).toISOString()}`,
  ].join("\n");
}

export type AuthenticatedRequest = {
  walletAddress?: string;
  signature?: string;
  issuedAt?: number;
};

export type AuthResult =
  | { ok: true; address: Address }
  | { ok: false; error: string; status: 400 | 401 };

/**
 * Verifies that `body` carries a valid, unexpired signature over
 * `buildAuthMessage(action, walletAddress, issuedAt)`, produced by
 * `walletAddress` itself.
 *
 * Returns the RECOVERED address on success — callers must authorize against
 * that value, never against `body.walletAddress`, which stays attacker
 * controlled right up until it has been matched against a signature.
 */
export async function verifyWalletAuth(
  body: AuthenticatedRequest,
  action: string
): Promise<AuthResult> {
  const claimed = body.walletAddress?.toLowerCase() ?? "";
  const signature = body.signature ?? "";
  const issuedAt = body.issuedAt;

  if (!isAddress(claimed)) {
    return { ok: false, error: "A valid walletAddress is required.", status: 400 };
  }
  if (!signature.startsWith("0x")) {
    return { ok: false, error: "A wallet signature is required.", status: 401 };
  }
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    return { ok: false, error: "A valid issuedAt timestamp is required.", status: 400 };
  }

  // Reject both stale signatures and ones dated in the future — a future
  // timestamp would otherwise extend the replay window arbitrarily.
  const age = Date.now() - issuedAt;
  if (age > AUTH_MAX_AGE_MS || age < -AUTH_MAX_AGE_MS) {
    return { ok: false, error: "Signature expired. Try again.", status: 401 };
  }

  const message = buildAuthMessage({ action, address: claimed, issuedAt });

  let valid = false;
  try {
    valid = await verifyMessage({
      address: claimed as Address,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return { ok: false, error: "Signature could not be verified.", status: 401 };
  }

  if (!valid) {
    return { ok: false, error: "Signature does not match the stated wallet.", status: 401 };
  }

  return { ok: true, address: claimed as Address };
}
