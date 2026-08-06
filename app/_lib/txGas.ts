import type { PublicClient, WalletClient, Hash } from "viem";

/**
 * Headroom over the estimate.
 *
 * Unused gas is refunded, so the only thing a limit has to be is affordable
 * — and on this chain a swap costs about 0.0000033 ETH, so erring high is
 * free. Erring low is a failed transaction. 25% covers the gap between
 * estimating and mining, which on an Arbitrum Orbit chain moves with L1
 * data pricing rather than staying fixed.
 *
 * For reference, real figures from this chain: a curve buy used 162,644 gas
 * against a 168,465 limit, a sell 99,203 against 114,678 — so wallets
 * themselves ship roughly 4-15% headroom.
 */
const GAS_BUFFER_PERCENT = 125n;

/**
 * Sends a write with an explicit gas limit that WE calculated.
 *
 * WHY NOT LET THE WALLET DO IT
 *
 * viem does not estimate gas for a wallet ("json-rpc") account. It passes
 * `gas: undefined` to `eth_sendTransaction`, and the wallet estimates
 * against whatever RPC the wallet has configured for the chain — not ours.
 *
 * That is fine on desktop, where the user added Robinhood Chain manually
 * with a working endpoint. It is not fine on mobile: this chain is not a
 * default network in any wallet, WalletConnect apps frequently have it
 * configured badly or not at all, and generic estimators mis-handle an
 * Arbitrum Orbit chain because Orbit folds the L1 data cost into the L2 gas
 * figure. The result was "gas estimation failed" on a transaction that was
 * otherwise perfectly valid.
 *
 * Every write here is already simulated first, so we know the call succeeds
 * against a node we control. Estimating on that same node and handing the
 * wallet a finished number removes the dependency on wallet-RPC quality
 * entirely — the wallet is left with nothing to do but sign.
 *
 * If OUR estimate fails, the request goes out without `gas` and the wallet
 * tries as before. That is strictly no worse than the old behaviour, and
 * beats refusing to trade because an estimate did not come back.
 */
export async function writeWithGas(
  publicClient: PublicClient,
  walletClient: WalletClient,
  /**
   * The `request` from `simulateContract`.
   *
   * Typed as `unknown` deliberately. viem models this as a wide discriminated
   * union whose members disagree about whether `value` may be present, so
   * every concrete annotation fails on one branch or another. The object is
   * opaque to us regardless — it is produced by viem and handed straight
   * back to viem, and nothing here reads a field from it.
   */
  request: unknown,
  account?: `0x${string}`
): Promise<Hash> {
  const base = request as Record<string, unknown>;

  let gas: bigint | undefined;
  try {
    const estimate = await publicClient.estimateContractGas({
      ...base,
      ...(account ? { account } : {}),
    } as never);
    gas = (estimate * GAS_BUFFER_PERCENT) / 100n;
  } catch {
    // Fall through with no explicit limit; the wallet estimates, as before.
  }

  return walletClient.writeContract({
    ...base,
    ...(gas !== undefined ? { gas } : {}),
  } as never);
}
