import { WETH9_ADDRESS } from "@/app/_lib/contracts/config";

/**
 * Uniswap V3 pool reads and price math, with no React and no "use client".
 *
 * Split out of poolPrice.ts so the server can use it. That file is a client
 * module (it exports hooks), and importing a "use client" module from a
 * route handler pulls React into the server bundle. The alternative was a
 * second copy of `spotPriceFromSqrtX96` living in the API route, which is
 * exactly the drift poolPrice.ts was written to stop — its header makes the
 * point that the price of a migrated token had already been reimplemented
 * per view once, and the two answers diverged.
 *
 * So the math lives here and poolPrice.ts re-exports it. There is still one
 * definition; it is just reachable from both sides now.
 */

const ONE_TOKEN = 10n ** 18n;
const Q96 = 2n ** 96n;

export const GET_POOL_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

export const SLOT0_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

/** Converts a Uniswap `sqrtPriceX96` into wei of ETH per one whole token. */
export function spotPriceFromSqrtX96(sqrtPriceX96: bigint, tokenIsToken0: boolean): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const denominator = Q96 * Q96;
  return tokenIsToken0
    ? (numerator * ONE_TOKEN) / denominator
    : (denominator * ONE_TOKEN) / numerator;
}

/** Uniswap sorts a pair by address; this decides which side the token is on. */
export function isTokenToken0(tokenAddress: string): boolean {
  return tokenAddress.toLowerCase() < WETH9_ADDRESS.toLowerCase();
}
