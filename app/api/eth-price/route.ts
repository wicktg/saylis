import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { robinhood } from "viem/chains";
import { upstreamRpcUrl } from "@/app/_lib/serverRpcUrl";
import {
  ETH_USD_PRICE_FEED_ADDRESS,
  DEFAULT_ETH_USD_PRICE_WHOLE,
} from "@/app/_lib/contracts/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ETH/USD rate, read once on the server and shared by every visitor.
 *
 * WHY THIS IS NOT A HOOK ANY MORE
 *
 * Every USD figure in the app — market caps, the price header, and every
 * OHLC value on the chart — is an ETH amount multiplied by this number. So
 * it is not just a display detail: it sets the SCALE of the chart. Two
 * people holding different values are looking at different charts of the
 * same token.
 *
 * That is exactly what happened. The old hook read Chainlink from each
 * browser and returned a hardcoded constant whenever the read had not
 * landed yet — which is every first render, and any render where the read
 * failed. So a page would draw its whole history at the fallback scale and
 * then rescale when the real answer arrived, which is the "chart jumps on
 * refresh" you can see on any reload. Between two users, whoever's read
 * failed saw a permanently different chart.
 *
 * One server-side read, cached, fixes both: everyone within the cache
 * window multiplies by the same number, and the client can tell "loading"
 * apart from "known" instead of being handed a plausible wrong value.
 *
 * It also removes two eth_calls per visitor per minute.
 */

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

/**
 * Deliberately long. Chainlink updates on its own schedule (deviation
 * threshold or heartbeat), not continuously, so re-reading faster than this
 * mostly returns the same round — and every second this value is stable is
 * a second in which two visitors cannot disagree about the chart's scale.
 */
const CACHE_TTL_MS = 60_000;

const client = createPublicClient({
  chain: robinhood,
  transport: http(upstreamRpcUrl(), { batch: { wait: 16 } }),
});

type Cached = { price: number; at: number };
let cache: Cached | null = null;
let inFlight: Promise<number> | null = null;

async function readPrice(): Promise<number> {
  const [round, decimals] = await client.multicall({
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
    allowFailure: true,
  });

  if (round.status !== "success" || decimals.status !== "success") {
    throw new Error("price feed unavailable");
  }

  const answer = (round.result as readonly [bigint, bigint, bigint, bigint, bigint])[1];
  const price = Number(answer) / 10 ** (decimals.result as number);
  if (!Number.isFinite(price) || price <= 0) throw new Error("price feed returned nothing usable");
  return price;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return json({ usd: cache.price, stale: false }, "hit");
  }

  inFlight ??= readPrice();
  try {
    const price = await inFlight;
    cache = { price, at: Date.now() };
    return json({ usd: price, stale: false }, "miss");
  } catch {
    // The last good rate beats the compile-time constant by a wide margin:
    // DEFAULT_ETH_USD_PRICE_WHOLE is fixed at each curve's deploy time and
    // only drifts further from reality. `stale` is reported honestly so the
    // client can decide whether to trust it.
    if (cache) return json({ usd: cache.price, stale: true }, "stale");
    return json({ usd: Number(DEFAULT_ETH_USD_PRICE_WHOLE), stale: true }, "fallback");
  } finally {
    inFlight = null;
  }
}

function json(body: { usd: number; stale: boolean }, status: string) {
  return new NextResponse(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "x-price-cache": status,
    },
  });
}
