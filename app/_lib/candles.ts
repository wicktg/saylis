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

  // Every price below is denominated in USD, so without a rate there is no
  // series to draw — only a flat line at zero, which is indistinguishable
  // from a token that really is worthless. Returning nothing lets the chart
  // show its empty state instead of asserting something false.
  if (!Number.isFinite(ethUsdPrice) || ethUsdPrice <= 0) return [];
  if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 0) return [];

  const candles: Candle[] = [];
  let current: Candle | null = null;

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    if (trade.timestamp === 0) continue;

    const bucket = Math.floor(trade.timestamp / bucketSeconds) * bucketSeconds;
    const value = (Number(spotPricesWei[i]) / WEI_PER_ETH) * ethUsdPrice;
    const ethVolume = Number(trade.ethWei) / WEI_PER_ETH;

    // These start as bigints of unbounded width; `Number()` on one large
    // enough returns Infinity, and a malformed reserve can produce NaN. Both
    // reach klinecharts as a bar it cannot lay out, and one of them blanks
    // the entire chart rather than just its own candle. Dropping the point
    // costs a single tick; letting it through costs the whole series.
    if (!Number.isFinite(value) || !Number.isFinite(ethVolume)) continue;

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
  return fillQuietBuckets(candles, bucketSeconds);
}

/**
 * Upper bound on bars produced by gap filling.
 *
 * A token that traded twice, days apart, on the 1-second timeframe spans
 * hundreds of thousands of buckets — enough to lock the browser for a chart
 * nobody can read. Past this the series is left sparse, which is worse to
 * look at but survivable, and the coarser timeframes still fill.
 */
const MAX_FILLED_CANDLES = 5_000;

/**
 * Emits a flat bar for every bucket between trades that had none.
 *
 * WHY THE TIME AXIS NEEDS THIS
 *
 * A candlestick chart is drawn bar-by-bar, not against a real time scale, so
 * omitting quiet buckets does not leave a gap — it CLOSES one. Two trades
 * five days apart rendered as two adjacent candles, with the axis silently
 * jumping five days between them. Every reading of that chart is wrong:
 * spacing implies tempo, and the tempo shown was invented by the omission.
 *
 * This reverses an earlier decision here to emit "no synthetic flat bars, so
 * every candle corresponds to real on-chain activity". The intent was right
 * and the conclusion was backwards. A flat bar is not synthetic activity: it
 * states that the price did not move because nobody traded, which is exactly
 * what happened. Volume is zero on these, so nothing implies a trade that
 * did not occur — and the alternative was a chart whose x-axis lied.
 *
 * Only the interior is filled. Nothing is invented before the first trade or
 * after the last; extending to the present is `anchorToLivePrice`'s job, and
 * it needs the live price to do it honestly.
 */
function fillQuietBuckets(candles: Candle[], bucketSeconds: number): Candle[] {
  if (candles.length < 2) return candles;

  const span = (candles[candles.length - 1].time - candles[0].time) / bucketSeconds + 1;
  if (span > MAX_FILLED_CANDLES) return candles;

  const filled: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    filled.push(candles[i]);

    const next = candles[i + 1];
    if (!next) break;

    // Flat at the previous close: no trade happened, so the price is
    // whatever the last one left it at.
    const close = candles[i].close;
    for (let t = candles[i].time + bucketSeconds; t < next.time; t += bucketSeconds) {
      filled.push({ time: t, open: close, high: close, low: close, close, volume: 0 });
    }
  }
  return filled;
}

/**
 * Forces the series to close at the price the rest of the page is showing.
 *
 * A curve-only chart needs no help here: `reconstructSpotPrices` anchors its
 * last entry to the LIVE token reserve, so the final close already equals
 * `getPrice()` by construction. Nothing plays that role after migration —
 * candles there are built purely from historical swap logs, so the series
 * ends at whatever the last indexed trade was, while the header reads the
 * pool's current `slot0`. Between a log-fetch window that misses recent
 * swaps and the re-pricing that migration itself performs, those two can sit
 * visibly apart, and a chart that disagrees with the price printed above it
 * reads as broken no matter which number is "right".
 *
 * @param livePriceUsd The same price the header shows, in USD.
 * @param nowSeconds Injected rather than read from the clock so callers can
 *        bucket deterministically (and so this stays testable).
 */
export function anchorToLivePrice(
  candles: Candle[],
  livePriceUsd: number | undefined,
  bucketSeconds: number,
  nowSeconds: number
): Candle[] {
  if (livePriceUsd === undefined || !Number.isFinite(livePriceUsd) || livePriceUsd <= 0) {
    return candles;
  }
  if (candles.length === 0) return candles;

  const bucket = Math.floor(nowSeconds / bucketSeconds) * bucketSeconds;
  const last = candles[candles.length - 1];

  // Still inside the newest bucket: extend it rather than opening a second
  // bar for the same slot, which klinecharts would reject as out of order.
  if (last.time === bucket) {
    if (last.close === livePriceUsd) return candles;
    const updated: Candle = {
      ...last,
      high: Math.max(last.high, livePriceUsd),
      low: Math.min(last.low, livePriceUsd),
      close: livePriceUsd,
    };
    return [...candles.slice(0, -1), updated];
  }

  // A newer bucket: open where the last one closed, so the line stays
  // continuous. Zero volume, because no trade produced this bar — it only
  // carries the current price forward.
  return [
    ...candles,
    {
      time: bucket,
      open: last.close,
      high: Math.max(last.close, livePriceUsd),
      low: Math.min(last.close, livePriceUsd),
      close: livePriceUsd,
      volume: 0,
    },
  ];
}
