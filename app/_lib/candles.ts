import type { Trade } from "@/app/_lib/useCurveTrades";

/** Chart timeframes, matching the top bar's selector. */
export const TIMEFRAMES = [
  { label: "1s", seconds: 1 },
  { label: "1m", seconds: 60 },
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3_600 },
  { label: "4h", seconds: 14_400 },
  { label: "D", seconds: 86_400 },
] as const;

export type TimeframeLabel = (typeof TIMEFRAMES)[number]["label"];

export type Candle = {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Total ETH traded in the bucket. */
  volume: number;
};

const ONE_TOKEN = 10n ** 18n;
const WEI_PER_ETH = 1e18;

/**
 * Reconstructs the curve's MARGINAL SPOT PRICE immediately after each
 * trade — the exact quantity `BondingCurve.getPrice()` returns.
 *
 * Why this is needed: a trade's realized price (`ethIn / tokensOut`) is an
 * *average* across the whole fill, and also carries the 1% fee, so it is
 * always some distance from the spot price the curve sits at afterwards.
 * Charting realized prices therefore never lines up with the live price
 * shown elsewhere in the UI.
 *
 * The reconstruction is exact rather than approximated. The curve conserves
 * `k = ethReserve * tokenReserve` across every trade (the fee is a
 * surcharge applied outside the curve, so it doesn't shift it), and
 * `tokenReserve` moves by precisely the token amount in each Buy/Sell
 * event. So anchoring on the live reserves and walking the events backwards
 * recovers `tokenReserve` after every trade, and:
 *
 *     price = ethReserve * 1e18 / tokenReserve
 *           = (k / tokenReserve) * 1e18 / tokenReserve
 *           = k * 1e18 / tokenReserve^2
 *
 * Because the last element is anchored to the live token reserve, the final
 * candle's close equals `getPrice()` exactly — while the curve is live.
 *
 * `k` must be supplied rather than derived from current reserves.
 * `withdrawForMigration` sets `realEthReserve = 0` at graduation, so
 * `ethReserve() * tokenReserve()` collapses to a much smaller number
 * afterwards and would rescale every historical price on the chart. The
 * caller computes `k` from the curve's immutables instead, which hold for
 * the token's whole life.
 *
 * @returns Spot price in wei per whole token, one entry per trade, aligned
 *          to `trades` (oldest first).
 */
export function reconstructSpotPrices(
  trades: Trade[],
  k: bigint,
  currentTokenReserve: bigint
): bigint[] {
  if (trades.length === 0 || currentTokenReserve === 0n || k === 0n) return [];

  // tokenReserve immediately after each trade. The last one is the live
  // value, since nothing has traded since.
  const reserves = new Array<bigint>(trades.length);
  reserves[trades.length - 1] = currentTokenReserve;

  for (let i = trades.length - 2; i >= 0; i--) {
    const later = trades[i + 1];
    // Undo the later trade: a buy drew tokens out of the reserve, a sell
    // put them back in.
    reserves[i] =
      later.type === "buy"
        ? reserves[i + 1] + later.tokensWei
        : reserves[i + 1] - later.tokensWei;
  }

  return reserves.map((reserve) =>
    reserve > 0n ? (k * ONE_TOKEN) / (reserve * reserve) : 0n
  );
}

/**
 * Buckets trades into OHLC candles of `bucketSeconds`, priced in USD.
 *
 * Only buckets that actually contain trades produce candles — no synthetic
 * flat bars are emitted for quiet periods, so every candle on screen
 * corresponds to real on-chain activity. Consecutive candles are chained so
 * each one opens where the previous closed, which is what makes a
 * bonding-curve series read continuously rather than as isolated ticks.
 *
 * `spotPricesWei` must be aligned to `trades` (see reconstructSpotPrices).
 */
export function buildCandles(
  trades: Trade[],
  spotPricesWei: bigint[],
  bucketSeconds: number,
  ethUsdPrice: number
): Candle[] {
  if (trades.length === 0 || spotPricesWei.length !== trades.length) return [];

  const candles: Candle[] = [];
  let current: Candle | null = null;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    if (trade.timestamp === 0) continue;

    const bucket = Math.floor(trade.timestamp / bucketSeconds) * bucketSeconds;
    const value = (Number(spotPricesWei[i]) / WEI_PER_ETH) * ethUsdPrice;
    const ethVolume = Number(trade.ethWei) / WEI_PER_ETH;

    if (current && current.time === bucket) {
      current.high = Math.max(current.high, value);
      current.low = Math.min(current.low, value);
      current.close = value;
      current.volume += ethVolume;
      continue;
    }

    if (current) candles.push(current);
    // Chain from the previous close so the series is continuous.
    const open: number = current ? current.close : value;
    current = {
      time: bucket,
      open,
      high: Math.max(open, value),
      low: Math.min(open, value),
      close: value,
      volume: ethVolume,
    };
  }

  if (current) candles.push(current);
  return candles;
}
