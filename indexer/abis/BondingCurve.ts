/**
 * Event-only slice of BondingCurve's ABI — signatures copied verbatim from
 * contracts/src/BondingCurve.sol, not retyped from memory. Indexing needs
 * events only; Ponder never calls a read function on this ABI.
 */
export const BondingCurveAbi = [
  {
    type: "event",
    name: "Buy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "ethIn", type: "uint256", indexed: false },
      { name: "tokensOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "tokensIn", type: "uint256", indexed: false },
      { name: "ethOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { name: "ethRaised", type: "uint256", indexed: false },
      { name: "bonusAmount", type: "uint256", indexed: false },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
] as const;
