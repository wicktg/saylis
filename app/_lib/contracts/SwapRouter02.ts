/**
 * Hand-written minimal slice of Uniswap's SwapRouter02 — not a Saylis
 * contract, so nothing here is auto-generated from a Foundry build.
 * Mirrors the same narrow-interface approach as
 * contracts/src/interfaces/ISwapRouter02.sol: only what SwapPanel actually
 * calls, nothing else.
 *
 * `multicall` + `unwrapWETH9` exist purely for selling: a swap with
 * `tokenOut = WETH9` pays out WRAPPED ether, not native ETH, unless the
 * caller explicitly unwraps it in the same transaction. Chaining both
 * through `multicall` — with the swap's own `recipient` set to the ROUTER
 * ITSELF rather than the seller — is Uniswap's own documented pattern for
 * this: the router holds the WETH for the instant between the two calls,
 * then `unwrapWETH9` drains its own balance out as real ETH to the actual
 * seller. Skipping this would leave sellers holding WETH they'd have to
 * unwrap themselves in a second transaction — the opposite of "fastest way
 * possible."
 */
export const SWAP_ROUTER_02_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "unwrapWETH9",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;
