/**
 * Turns a raw error (often a viem/wagmi error whose `.message` dumps the
 * full calldata, args, gas fees, etc.) into a short, human-readable string
 * safe to show directly in the UI.
 *
 * Order matters below. viem's `shortMessage` is the right thing to show for
 * most failures, but for the handful that users actually hit it is either
 * jargon ("execution reverted: STF") or actively misleading — a rate-limited
 * proxy read surfaces as a revert of whatever function was being read, which
 * blames a contract that never ran. Those are matched first, on the FULL
 * message, since the detail that identifies them is often outside
 * `shortMessage`.
 */

/**
 * Matched against the whole error text, most specific first. Each entry
 * covers a failure a user can actually reach through the UI.
 */
const KNOWN_FAILURES: Array<[RegExp, string]> = [
  // Not an error at all — the user closed the wallet. Must come first: a
  // rejection can carry other matching noise from the request it declined.
  [/rejected|denied|user cancel/i, "You rejected the transaction."],

  // Our own proxy, not the chain. Worth its own message because viem reports
  // it as a contract revert, which sends people looking in the wrong place.
  [
    /rate limit|limit exceeded|too many requests|upstream rpc/i,
    "The network is busy right now. Wait a moment and try again.",
  ],

  // The user cannot pay. Distinguished from a revert because the fix is
  // different: send less, rather than try again.
  [
    /insufficient funds|exceeds the balance|gas required exceeds/i,
    "Not enough ETH to cover this trade and its gas fee. Try a smaller amount.",
  ],

  // Slippage. Uniswap's "Too little received", the router's STF, and the
  // curve's own floor all mean the same thing to a user.
  [
    /too little received|too much requested|slippage|STF|minOut|min out/i,
    "The price moved while you were confirming. Try again.",
  ],

  // The curve is closed. Reachable if a token graduates between the page
  // loading and the trade being submitted.
  [
    /TokenGraduated|graduated/i,
    "This token just graduated to the open market. Reload to trade on the pool.",
  ],

  [
    /max wallet|MaxWallet|exceeds max/i,
    "That would put this wallet over the token's maximum holding limit.",
  ],

  [
    /transfer amount exceeds balance|ERC20: transfer amount/i,
    "You don't have enough tokens for that.",
  ],

  // Gas estimation failed rather than the call itself. Almost always a
  // transient node problem here, since a genuine revert is caught by the
  // simulation that runs before any write.
  [
    /cannot estimate gas|gas limit|unable to estimate/i,
    "Couldn't work out the gas for this trade. Try again in a moment.",
  ],

  [
    /nonce|replacement transaction underpriced/i,
    "A previous transaction is still pending. Wait for it to finish, then try again.",
  ],

  [
    /timed out|timeout|network error|failed to fetch/i,
    "Lost connection to the network. Check your connection and try again.",
  ],
];

export function getFriendlyErrorMessage(err: unknown, fallback?: string): string {
  const shortMessage =
    err && typeof err === "object" && "shortMessage" in err
      ? (err as { shortMessage?: string }).shortMessage
      : undefined;

  // The full text, not just `shortMessage` — viem puts the revert reason and
  // the upstream error body in `details`/`metaMessages`, and that is where
  // the identifying detail usually is.
  const full = [
    shortMessage,
    err instanceof Error ? err.message : typeof err === "string" ? err : "",
    err && typeof err === "object" && "details" in err
      ? String((err as { details?: unknown }).details ?? "")
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  for (const [pattern, message] of KNOWN_FAILURES) {
    if (pattern.test(full)) return message;
  }

  // A revert we have no specific wording for. `shortMessage` here is
  // typically "execution reverted", which tells the user nothing they can
  // act on, so it is replaced rather than shown.
  if (/reverted/i.test(full)) {
    return "The trade couldn't go through at this price. Try again, or use a smaller amount.";
  }

  return safeFallback(shortMessage, fallback);
}

/**
 * Whatever is left, with anything internal removed.
 *
 * The last resort used to be `shortMessage` verbatim, and viem's
 * `shortMessage` routinely names contract addresses, function signatures,
 * RPC URLs and raw calldata. None of that helps someone decide what to do
 * next, and all of it is a detail of our deployment rather than of their
 * problem — so a message carrying any of it is replaced wholesale rather
 * than trimmed, since a half-redacted sentence is worse than a plain one.
 */
const LEAKS_INTERNALS =
  /0x[a-fA-F0-9]{8,}|https?:\/\/|\b\w+\.(?:com|dev|io|xyz|app|co|net)\b|\bat\s+\w+\s*\(|contract function|abi|rpc|json|fetch|\bnode_modules\b/i;

/** A message the user cannot act on is not worth showing them. */
const TOO_TECHNICAL = /revert|opcode|gas|nonce|calldata|selector|decode|encode|viem|wagmi/i;

function safeFallback(shortMessage: string | undefined, fallback?: string): string {
  const generic = fallback ?? "Something went wrong. Please try again.";
  if (!shortMessage) return generic;

  const trimmed = shortMessage.trim();
  if (!trimmed || trimmed.length > 160) return generic;
  if (LEAKS_INTERNALS.test(trimmed) || TOO_TECHNICAL.test(trimmed)) return generic;

  return trimmed;
}
