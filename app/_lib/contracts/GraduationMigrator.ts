/**
 * Minimal ABI — only what the app needs from the already-deployed
 * GraduationMigrator (see contracts/src/GraduationMigrator.sol): the
 * permissionless `migrate` entrypoint and its one-way `migrated` latch.
 */
export const GRADUATION_MIGRATOR_ABI = [
  {
    type: "function",
    name: "migrate",
    stateMutability: "nonpayable",
    inputs: [{ name: "curve", type: "address", internalType: "contract BondingCurve" }],
    outputs: [
      { name: "pool", type: "address", internalType: "address" },
      { name: "tokenId", type: "uint256", internalType: "uint256" },
      { name: "liquidity", type: "uint128", internalType: "uint128" },
    ],
  },
  {
    type: "function",
    name: "migrated",
    stateMutability: "view",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
  },
] as const;
