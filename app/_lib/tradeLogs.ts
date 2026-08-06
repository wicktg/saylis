import { decodeEventLog, parseAbiItem, type Address, type Hex } from "viem";
import { isTokenToken0, spotPriceFromSqrtX96 } from "@/app/_lib/poolMath";

/**
 * Turning a raw log into a trade — the single definition, used by both
 * writers.
 *
 * There are exactly two ways a trade reaches the database: a webhook
 * delivery (app/api/webhooks/alchemy) and the reconciler that repairs gaps
 * (app/api/cron/reconcile). They see the same events and must agree to the
 * wei about what those events mean, because a row written by one is
 * indistinguishable from a row written by the other once it is stored.
 *
 * Two copies of this logic would be two chances to disagree, and the
 * disagreement would surface as a chart that changes shape depending on
 * which path happened to capture a given trade. So the decoding lives here
 * and both import it.
 */

export const BUY_EVENT = parseAbiItem(
  "event Buy(address indexed buyer, uint256 ethIn, uint256 tokensOut)"
);
export const SELL_EVENT = parseAbiItem(
  "event Sell(address indexed seller, uint256 tokensIn, uint256 ethOut)"
);
/** Uniswap V3's pool swap — amounts are signed, from the POOL's side. */
export const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)"
);

export const TRADE_EVENTS = [BUY_EVENT, SELL_EVENT, SWAP_EVENT] as const;

const ONE_TOKEN = 10n ** 18n;

export type DecodedTrade = {
  /** `${txHash}-${logIndex}` — unique per log, and the primary key. */
  id: string;
  tokenAddress: string;
  curveAddress: string;
  poolAddress: string | null;
  type: "buy" | "sell";
  venue: "curve" | "pool";
  wallet: string;
  ethWei: bigint;
  tokensWei: bigint;
  /** Realized: what the trader actually got, fee and slippage included. */
  priceWei: bigint;
  /** Marginal price after the trade. Null for curve trades until enriched. */
  spotPriceWei: bigint | null;
  blockNumber: bigint;
  timestamp: number;
};

/** Realized price: wei of ETH per ONE WHOLE token. */
export function priceOf(ethWei: bigint, tokensWei: bigint): bigint {
  if (tokensWei === 0n) return 0n;
  return (ethWei * ONE_TOKEN) / tokensWei;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export type DecodeInput = {
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  timestamp: number;
  /** lowercased curve address -> lowercased token address. */
  curveRegistry: Map<string, string>;
  /** lowercased pool address -> the curve that graduated into it. */
  poolRegistry: Map<string, { curveAddress: Address; tokenAddress: Address }>;
};

/**
 * Decodes one log, or returns null if it is not a trade we track.
 *
 * Both registries are consulted rather than trusting the event signature
 * alone: a webhook filtered on topic0 sees `Buy`/`Sell`/`Swap` from every
 * contract on the chain that happens to share those signatures, and an
 * unrelated pool's Swap must not become a candle on someone's token.
 */
export function decodeTradeLog(input: DecodeInput): DecodedTrade | null {
  const {
    address,
    topics,
    data,
    blockNumber,
    logIndex,
    transactionHash,
    timestamp,
    curveRegistry,
    poolRegistry,
  } = input;

  const id = `${transactionHash}-${logIndex}`;
  const source = address.toLowerCase();

  // ---- Curve side ----
  const tokenAddress = curveRegistry.get(source);
  if (tokenAddress) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: [BUY_EVENT, SELL_EVENT], topics, data });
    } catch {
      return null; // Some other event on a curve we watch.
    }

    if (decoded.eventName === "Buy") {
      const { buyer, ethIn, tokensOut } = decoded.args as {
        buyer: Address;
        ethIn: bigint;
        tokensOut: bigint;
      };
      return {
        id,
        tokenAddress,
        curveAddress: source,
        poolAddress: null,
        type: "buy",
        venue: "curve",
        wallet: buyer.toLowerCase(),
        ethWei: ethIn,
        tokensWei: tokensOut,
        priceWei: priceOf(ethIn, tokensOut),
        spotPriceWei: null,
        blockNumber,
        timestamp,
      };
    }

    const { seller, tokensIn, ethOut } = decoded.args as {
      seller: Address;
      tokensIn: bigint;
      ethOut: bigint;
    };
    return {
      id,
      tokenAddress,
      curveAddress: source,
      poolAddress: null,
      type: "sell",
      venue: "curve",
      wallet: seller.toLowerCase(),
      ethWei: ethOut,
      tokensWei: tokensIn,
      priceWei: priceOf(ethOut, tokensIn),
      spotPriceWei: null,
      blockNumber,
      timestamp,
    };
  }

  // ---- Pool side ----
  const pool = poolRegistry.get(source);
  if (!pool) return null;

  let decoded;
  try {
    decoded = decodeEventLog({ abi: [SWAP_EVENT], topics, data });
  } catch {
    return null;
  }
  if (decoded.eventName !== "Swap") return null;

  const { recipient, amount0, amount1, sqrtPriceX96 } = decoded.args as {
    recipient: Address;
    amount0: bigint;
    amount1: bigint;
    sqrtPriceX96: bigint;
  };

  // Uniswap sorts a pair by address; which side the token is on decides
  // which signed amount is tokens and which is ETH.
  const tokenIsToken0 = isTokenToken0(pool.tokenAddress);
  const tokenDelta = tokenIsToken0 ? amount0 : amount1;
  const ethDelta = tokenIsToken0 ? amount1 : amount0;
  if (tokenDelta === 0n || ethDelta === 0n) return null;

  return {
    id,
    tokenAddress: pool.tokenAddress.toLowerCase(),
    curveAddress: pool.curveAddress.toLowerCase(),
    poolAddress: source,
    // Amounts are from the pool's perspective: a negative token delta means
    // the pool paid tokens out, which is a buy.
    type: tokenDelta < 0n ? "buy" : "sell",
    venue: "pool",
    // `recipient`, not `sender` — the sender is the router.
    wallet: recipient.toLowerCase(),
    ethWei: abs(ethDelta),
    tokensWei: abs(tokenDelta),
    priceWei: priceOf(abs(ethDelta), abs(tokenDelta)),
    // The pool's marginal price straight after the swap, which is the
    // quantity the chart plots. Curve trades have no equivalent in their
    // event and are enriched with a getPrice() read instead.
    spotPriceWei: spotPriceFromSqrtX96(sqrtPriceX96, tokenIsToken0),
    blockNumber,
    timestamp,
  };
}
