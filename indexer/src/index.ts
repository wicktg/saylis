import { ponder } from "ponder:registry";
import { chainTrade, curveStatus } from "ponder:schema";
import { decodeFunctionData, parseAbiItem } from "viem";
import addresses from "../addresses.generated.json";

const ONE_TOKEN = 10n ** 18n;
const Q96 = 2n ** 96n;

/** address(0) < address(WETH) or not decides which side of a Uniswap pair
 *  is the launch token — same rule the frontend uses (see poolPrice.ts). */
function isTokenToken0(tokenAddress: string, wethAddress: string): boolean {
  return tokenAddress.toLowerCase() < wethAddress.toLowerCase();
}

function spotPriceFromSqrtX96(sqrtPriceX96: bigint, tokenIsToken0: boolean): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const numerator = sqrtPriceX96 * sqrtPriceX96;
  const denominator = Q96 * Q96;
  return tokenIsToken0
    ? (numerator * ONE_TOKEN) / denominator
    : (denominator * ONE_TOKEN) / numerator;
}

function priceOf(ethWei: bigint, tokensWei: bigint): bigint {
  if (tokensWei === 0n) return 0n;
  return (ethWei * ONE_TOKEN) / tokensWei;
}

const tokenByCurve = addresses.tokenByCurve as Record<string, string>;

const GET_PRICE_ABI = [parseAbiItem("function getPrice() view returns (uint256)")];

/**
 * The curve's MARGINAL price right after this trade, in wei per whole token.
 *
 * Why this is read here rather than derived in the browser: the frontend
 * used to reconstruct it, walking backwards from the curve's CURRENT token
 * reserve and undoing each trade in turn. That works, but it makes every
 * historical price on the chart depend on two live values being right — the
 * reserve and the curve's `k` — so a single bad read rescales the entire
 * series, and it cannot work at all for a graduated token, whose reserve was
 * drained to seed the pool.
 *
 * Read once, at the block the trade happened in, it is simply a fact about
 * the trade, stored next to it. Pool trades have always had this (decoded
 * from the Swap event's own sqrtPriceX96) — this gives curve trades the
 * same, so both venues store the same quantity and the chart plots one
 * series without reconstructing half of it.
 *
 * Marginal price, not realized price. A realized price is slippage-averaged,
 * so it sits above spot on a sell and below it on a buy — charting it prints
 * green candles on trades that pushed the price down. `priceWei` keeps the
 * realized figure, which is the honest number for the trade feed.
 *
 * Granularity note: this is the price at the END of the block, so several
 * trades in one block share a value. On a ~100ms chain that is rare, and
 * those trades land in the same candle regardless.
 *
 * Returns null rather than throwing — a curve without the getter still gets
 * its trade indexed, and the frontend falls back to reconstruction for any
 * row where this is null.
 */
async function curveSpotPrice(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  curveAddress: `0x${string}`,
  blockNumber: bigint
): Promise<bigint | null> {
  try {
    return (await context.client.readContract({
      address: curveAddress,
      abi: GET_PRICE_ABI,
      functionName: "getPrice",
      blockNumber,
    })) as bigint;
  } catch {
    return null;
  }
}

/**
 * pool address -> the token/curve it belongs to, kept in memory rather
 * than queried back out of `curveStatus` for every Swap.
 *
 * This relies on event ORDER, not a database round trip: Ponder processes
 * one chain's events in strict block order, and a pool cannot exist before
 * the `Migrated` event that creates it — so by the time any `Swap` for a
 * given pool is processed, that pool's entry is already here. Simpler and
 * more reliable than a secondary-index lookup on a non-primary-key column,
 * which Ponder's indexing-function `db.find` does not support directly.
 */
const poolRegistry = new Map<string, { tokenAddress: `0x${string}`; curveAddress: `0x${string}` }>();

/** Falls back to an on-chain read for any curve launched after the last
 *  `generate-curve-addresses` snapshot but somehow still reached (should
 *  not normally happen, since such a curve isn't in the watch list either
 *  — this is defense in depth, not the primary path). */
async function resolveTokenAddress(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  curveAddress: string
): Promise<`0x${string}`> {
  const known = tokenByCurve[curveAddress.toLowerCase()];
  if (known) return known as `0x${string}`;

  const token = await context.client.readContract({
    address: curveAddress as `0x${string}`,
    abi: [parseAbiItem("function token() view returns (address)")],
    functionName: "token",
  });
  return token as `0x${string}`;
}

ponder.on("BondingCurve:Buy", async ({ event, context }) => {
  const tokenAddress = await resolveTokenAddress(context, event.log.address);
  const ethIn = event.args.ethIn;
  const tokensOut = event.args.tokensOut;
  const spotPriceWei = await curveSpotPrice(context, event.log.address, event.block.number);

  await context.db.insert(chainTrade).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tokenAddress,
    curveAddress: event.log.address,
    poolAddress: null,
    type: "buy",
    venue: "curve",
    wallet: event.args.buyer,
    ethWei: ethIn,
    tokensWei: tokensOut,
    priceWei: priceOf(ethIn, tokensOut),
    spotPriceWei,
    blockNumber: event.block.number,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("BondingCurve:Sell", async ({ event, context }) => {
  const tokenAddress = await resolveTokenAddress(context, event.log.address);
  const ethOut = event.args.ethOut;
  const tokensIn = event.args.tokensIn;
  const spotPriceWei = await curveSpotPrice(context, event.log.address, event.block.number);

  await context.db.insert(chainTrade).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tokenAddress,
    curveAddress: event.log.address,
    poolAddress: null,
    type: "sell",
    venue: "curve",
    wallet: event.args.seller,
    ethWei: ethOut,
    tokensWei: tokensIn,
    priceWei: priceOf(ethOut, tokensIn),
    spotPriceWei,
    blockNumber: event.block.number,
    timestamp: Number(event.block.timestamp),
  });
});

/**
 * `Migrated` itself only carries `pool`/`tokenId`/`liquidity` — not which
 * curve graduated. `migrate(BondingCurve curve)` is the only place that
 * connection exists, so it's recovered by decoding the very transaction
 * that emitted this event, rather than threading it through some other
 * side channel.
 */
const MIGRATE_FUNCTION = parseAbiItem("function migrate(address curve)");

ponder.on("GraduationMigrator:Migrated", async ({ event, context }) => {
  const { args } = decodeFunctionData({
    abi: [MIGRATE_FUNCTION],
    data: event.transaction.input,
  });
  const curveAddress = args[0] as `0x${string}`;
  const tokenAddress = await resolveTokenAddress(context, curveAddress);
  const poolAddress = event.args.pool;

  poolRegistry.set(poolAddress.toLowerCase(), { tokenAddress, curveAddress });

  await context.db
    .insert(curveStatus)
    .values({ curveAddress, tokenAddress, poolAddress, migrated: true })
    .onConflictDoUpdate({ poolAddress, migrated: true });
});

const WETH9_ADDRESS = process.env.WETH9_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

ponder.on("UniswapV3Pool:Swap", async ({ event, context }) => {
  const entry = poolRegistry.get(event.log.address.toLowerCase());
  if (!entry) {
    // A Swap on a pool this indexer never saw get created — e.g. this
    // process started mid-history with a startBlock after that pool's own
    // Migrated event. Skip rather than insert a row with no token to
    // attribute it to; a full backfill from START_BLOCK doesn't hit this.
    return;
  }

  const tokenIsToken0 = isTokenToken0(entry.tokenAddress, WETH9_ADDRESS);
  const amount0 = event.args.amount0;
  const amount1 = event.args.amount1;
  const tokenDelta = tokenIsToken0 ? amount0 : amount1;
  const ethDelta = tokenIsToken0 ? amount1 : amount0;
  if (tokenDelta === 0n || ethDelta === 0n) return;

  const tokensWei = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  const ethWei = ethDelta < 0n ? -ethDelta : ethDelta;

  await context.db.insert(chainTrade).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tokenAddress: entry.tokenAddress,
    curveAddress: entry.curveAddress,
    poolAddress: event.log.address,
    // A negative token delta means the pool paid tokens OUT — a buy.
    type: tokenDelta < 0n ? "buy" : "sell",
    venue: "pool",
    // `recipient`, not `sender` (the router) — the closest thing to "who
    // actually traded" a pool event carries. Matches the frontend's
    // existing toPoolTrade() exactly.
    wallet: event.args.recipient,
    ethWei,
    tokensWei,
    priceWei: priceOf(ethWei, tokensWei),
    spotPriceWei: spotPriceFromSqrtX96(event.args.sqrtPriceX96, tokenIsToken0),
    blockNumber: event.block.number,
    timestamp: Number(event.block.timestamp),
  });
});
