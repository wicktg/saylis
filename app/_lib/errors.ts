/**
 * Turns a raw error (often a viem/wagmi error whose `.message` dumps the
 * full calldata, args, gas fees, etc.) into a short, human-readable string
 * safe to show directly in the UI.
 */
export function getFriendlyErrorMessage(err: unknown): string {
  // viem's BaseError exposes `shortMessage` specifically for this —
  // e.g. "User rejected the request." instead of the full verbose dump.
  const shortMessage =
    err && typeof err === "object" && "shortMessage" in err
      ? (err as { shortMessage?: string }).shortMessage
      : undefined;

  const raw = shortMessage ?? (err instanceof Error ? err.message : String(err));

  if (/rejected|denied|user cancel/i.test(raw)) {
    return "You rejected the transaction.";
  }

  return shortMessage ?? "Something went wrong. Please try again.";
}
