/**
 * SERVER-ONLY: the real upstream RPC endpoint, including its API key.
 *
 * `ROBINHOOD_RPC_URL` has no NEXT_PUBLIC_ prefix on purpose — the Alchemy
 * key embedded in it must never reach the browser bundle. Browser code
 * talks to `/api/rpc` instead (see app/api/rpc/route.ts), which forwards
 * here server-side.
 *
 * The NEXT_PUBLIC_ fallback exists only so an environment that still has
 * the old variable set keeps working; prefer setting ROBINHOOD_RPC_URL and
 * removing the public one, since anything NEXT_PUBLIC_ is world-readable.
 */
export function upstreamRpcUrl(): string {
  return (
    process.env.ROBINHOOD_RPC_URL ||
    process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ||
    "https://rpc.mainnet.chain.robinhood.com"
  );
}
