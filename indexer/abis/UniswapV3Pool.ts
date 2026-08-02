/**
 * Event-only slice of Uniswap V3's pool ABI — same signature already used
 * on the frontend (app/_lib/useCurveTrades.ts), kept identical so both
 * sides decode `amount0`/`amount1`/`sqrtPriceX96` the same way.
 */
export const UniswapV3PoolAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount0", type: "int256", indexed: false },
      { name: "amount1", type: "int256", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
    ],
  },
] as const;
