/**
 * Minimal ABI for TokenFeeCollector — the contract a token earns through
 * AFTER it graduates.
 *
 * Hand-written rather than generated, like GraduationMigrator and
 * ReferralVault: the frontend never deploys this (GraduationMigrator does,
 * one per graduated token), so it needs the call signatures and none of the
 * bytecode. Keep in sync with contracts/src/TokenFeeCollector.sol.
 *
 * The address is not a constant here for the same reason — there is one
 * collector per token, and a token's own `feeCollector()` getter is the
 * lookup. See `useCreatorFees`.
 */
export const TOKEN_FEE_COLLECTOR_ABI = [
  {
    type: "function",
    name: "creatorFeesOwed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "creatorTokensOwed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // Permissionless. Sweeps the LP position's accrued fees and any whale
    // sell tax into the owed balances above — nothing is claimable until
    // this has run, which is why the claim flow calls it first.
    type: "function",
    name: "collect",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [
      { name: "ethCredited", type: "uint256" },
      { name: "tokensCredited", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "withdrawCreatorFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawCreatorTokens",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "FeesCollected",
    inputs: [
      { name: "lpTokens", type: "uint256", indexed: false },
      { name: "lpWeth", type: "uint256", indexed: false },
      { name: "sellTax", type: "uint256", indexed: false },
      { name: "protocolEthFromSwap", type: "uint256", indexed: false },
    ],
  },
] as const;
