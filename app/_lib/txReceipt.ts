import type { Hash, PublicClient, TransactionReceipt } from "viem";

/**
 * How often a pending transaction is checked for.
 *
 * viem's default is its client `pollingInterval`, 4 seconds — a figure that
 * makes sense on a 12-second chain and none at all here, where blocks land
 * in about 100ms. It meant a swap that confirmed almost instantly still sat
 * behind a spinner for up to four seconds, and the user's next action was
 * gated on a wait that had nothing to do with the chain.
 *
 * The config-wide `pollingInterval` is deliberately NOT lowered to achieve
 * this. It is shared with `useWatchContractEvent` (see useCreatorFees.ts and
 * CreateTokenModal.tsx), which polls eth_getLogs — the single most expensive
 * method on the upstream quota. Speeding up confirmations must not multiply
 * those, so the interval is narrowed per call, here, where it applies only
 * to a receipt lookup that lasts a second or two.
 *
 * eth_getTransactionReceipt is cheap, /api/rpc coalesces concurrent lookups
 * of the same hash, and it caches the receipt once it exists — but never
 * while it is still null, which would otherwise pin "pending" in front of a
 * mined transaction for the whole TTL. See app/api/rpc/route.ts.
 */
const RECEIPT_POLL_MS = 250;

/**
 * Waits for a transaction to be mined, tuned for this chain's block time.
 *
 * A drop-in for `publicClient.waitForTransactionReceipt({ hash })` — same
 * result, same throw on failure — and the reason to prefer it is that the
 * tuning lives in one place rather than being repeated, or forgotten, at
 * each of the dozen-odd call sites that await a write.
 *
 * Broadcasting is not touched: the user's wallet signs and submits the
 * transaction itself, and this only watches for the result.
 */
export function waitForReceipt(
  client: PublicClient,
  hash: Hash,
  confirmations?: number
): Promise<TransactionReceipt> {
  return client.waitForTransactionReceipt({
    hash,
    pollingInterval: RECEIPT_POLL_MS,
    ...(confirmations !== undefined ? { confirmations } : {}),
  });
}
