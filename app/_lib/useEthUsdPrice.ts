"use client";

import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import {
  ETH_USD_PRICE_FEED_ADDRESS,
  DEFAULT_ETH_USD_PRICE_WHOLE,
} from "@/app/_lib/contracts/config";

const AGGREGATOR_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const REFRESH_MS = 60_000;
const FALLBACK = Number(DEFAULT_ETH_USD_PRICE_WHOLE);

/**
 * The REAL, live ETH/USD price, read straight from the same Chainlink feed
 * every curve already reads on-chain to gate the whale sell tax
 * (`ETH_USD_PRICE_FEED_ADDRESS`) — refetched every 60s.
 *
 * Every USD figure shown anywhere in the app should use this, not
 * `DEFAULT_ETH_USD_PRICE_WHOLE`: that constant is fixed forever at each
 * curve's OWN deploy time (baked into its `volumeCapWei` math on-chain) —
 * it was never meant to represent "today's price" and drifts further from
 * reality the older a token gets.
 *
 * Falls back to `DEFAULT_ETH_USD_PRICE_WHOLE` while the first read is still
 * loading, or if the feed read fails, so a page never shows "$0" or blanks
 * out while waiting on a live price.
 */
export function useEthUsdPrice(): number {
  const { data } = useReadContracts({
    contracts: [
      {
        address: ETH_USD_PRICE_FEED_ADDRESS as Address,
        abi: AGGREGATOR_ABI,
        functionName: "latestRoundData",
      },
      {
        address: ETH_USD_PRICE_FEED_ADDRESS as Address,
        abi: AGGREGATOR_ABI,
        functionName: "decimals",
      },
    ],
    query: { refetchInterval: REFRESH_MS },
  });

  const roundData = data?.[0];
  const decimalsResult = data?.[1];
  if (roundData?.status !== "success" || decimalsResult?.status !== "success") {
    return FALLBACK;
  }

  const answer = (roundData.result as readonly [bigint, bigint, bigint, bigint, bigint])[1];
  const decimals = decimalsResult.result as number;
  const price = Number(answer) / 10 ** decimals;
  return price > 0 ? price : FALLBACK;
}
