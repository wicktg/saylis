/**
 * Event-only slice of GraduationMigrator's ABI — signature copied verbatim
 * from contracts/src/GraduationMigrator.sol.
 *
 * `Migrated`'s `pool` parameter is exactly what makes this a real
 * Ponder `factory()` source: this contract's address is fixed and known
 * (GRADUATION_MIGRATOR_ADDRESS), and every graduated token's pool address
 * is discoverable from this single event with no manual tracking, unlike
 * BondingCurve instances (see scripts/generate-curve-addresses.mjs).
 */
export const GraduationMigratorAbi = [
  {
    type: "event",
    name: "Migrated",
    inputs: [
      { name: "pool", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "liquidity", type: "uint128", indexed: false },
    ],
  },
] as const;
