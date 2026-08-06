"use client";

import { useEffect, useRef } from "react";
import { dispose, init, type Chart } from "klinecharts";
import type { Candle } from "@/app/_lib/candles";
import { formatUsdPrice } from "@/app/_lib/format";
import type { ToolId } from "@/app/_lib/drawings";

const ACCENT = "#cf38dd";
const UP = "#2ebd85";
const DOWN = "#e2444b";
const GRID = "rgba(255,255,255,0.06)";
const AXIS_TEXT = "rgba(255,255,255,0.5)";

/** Last-resort stack if the webfont variable cannot be read. */
const FALLBACK_FONT = 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';

/**
 * The font klinecharts paints axis ticks, tooltips and crosshair labels in.
 *
 * This is resolved at runtime rather than hard-coded because the chart draws
 * to a CANVAS, and a canvas `font` string cannot resolve `var(...)` — it
 * needs a real family name. next/font generates a hashed family (see
 * app/layout.tsx), so the only way to name it is to read the custom property
 * back off the document.
 *
 * It used to read `"Satoshi, Inter, sans-serif"`, which was correct when the
 * app used Satoshi — but the ASCII conversion deleted that webfont, so every
 * axis label had been silently falling back to a PROPORTIONAL sans while the
 * entire rest of the UI was monospace. That is also why chart digits drifted
 * out of alignment with the header's tabular figures. Same result on both
 * viewports; nothing here is viewport-dependent.
 */
function resolveChartFont(): string {
  if (typeof window === "undefined") return FALLBACK_FONT;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-jetbrains-mono")
    .trim();
  return value ? `${value}, ${FALLBACK_FONT}` : FALLBACK_FONT;
}

/**
 * Candlestick chart backed by klinecharts. Every drawing tool is one of
 * the library's own built-in overlay templates, so drawing, dragging,
 * selection and deletion are all handled by klinecharts rather than
 * re-implemented here — `activeTool` is simply the overlay's name.
 */
export default function TokenChart({
  candles,
  seriesKey,
  activeTool,
  onToolConsumed,
  clearSignal,
}: {
  candles: Candle[];
  /**
   * Identity of the series being plotted — token, timeframe, price-vs-mcap.
   *
   * The chart resets its viewport whenever the whole dataset is replaced, so
   * it needs to know the difference between "this is a different series" and
   * "the same series has not finished loading". Without that it could only
   * infer it from the data, and the data lies during load: candles start
   * empty, so the chart blanked itself and then replaced the dataset a
   * second time when the real bars arrived — two viewport resets on every
   * page load. This makes the distinction explicit instead of guessed.
   */
  seriesKey: string;
  activeTool: ToolId;
  /** Fired once a drawing is committed, so the toolbar can fall back to the cursor. */
  onToolConsumed: () => void;
  /** Incrementing counter — each bump clears every overlay. */
  clearSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const onToolConsumedRef = useRef(onToolConsumed);
  onToolConsumedRef.current = onToolConsumed;

  // Create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Resolved here rather than at module scope: this runs in an effect, so
    // the document exists and next/font's stylesheet has already been applied.
    const UI_FONT = resolveChartFont();

    const chart = init(container, {
      styles: {
        grid: {
          horizontal: { color: GRID },
          vertical: { color: GRID },
        },
        candle: {
          bar: {
            upColor: UP,
            downColor: DOWN,
            upBorderColor: UP,
            downBorderColor: DOWN,
            upWickColor: UP,
            downWickColor: DOWN,
          },
          priceMark: {
            high: { color: AXIS_TEXT },
            low: { color: AXIS_TEXT },
            last: {
              upColor: UP,
              downColor: DOWN,
              text: { color: "#ffffff" },
            },
          },
          tooltip: {
            // The "time / open / high / low / close" legend klinecharts
            // paints across the top of the chart is switched off entirely:
            // an empty `custom` list leaves nothing to render. The same
            // numbers are already on the axes and in the crosshair, so the
            // legend was duplicated text sitting over the candles.
            custom: [],
            text: {
              color: "rgba(255,255,255,0.85)",
              size: 11,
              family: UI_FONT,
            },
          },
        },
        xAxis: {
          axisLine: { color: "rgba(255,255,255,0.1)" },
          tickLine: { color: "rgba(255,255,255,0.1)" },
          tickText: { color: AXIS_TEXT, size: 10, family: UI_FONT },
        },
        yAxis: {
          axisLine: { color: "rgba(255,255,255,0.1)" },
          tickLine: { color: "rgba(255,255,255,0.1)" },
          tickText: { color: AXIS_TEXT, size: 10, family: UI_FONT },
        },
        crosshair: {
          horizontal: {
            line: { color: "rgba(255,255,255,0.3)" },
            text: { backgroundColor: ACCENT, family: UI_FONT },
          },
          vertical: {
            line: { color: "rgba(255,255,255,0.3)" },
            text: { backgroundColor: ACCENT, family: UI_FONT },
          },
        },
        overlay: {
          line: { color: ACCENT },
          point: { color: ACCENT, borderColor: "rgba(207,56,221,0.35)" },
        },
      },
    });

    if (!chart) return;
    chartRef.current = chart;

    // Every axis/tooltip/crosshair price runs through the same USD
    // formatter the rest of the page uses.
    chart.setCustomApi({
      formatBigNumber: (value: string | number) => formatUsdPrice(Number(value)),
    });

    return () => {
      dispose(container);
      chartRef.current = null;
    };
  }, []);

  /**
   * Push candle data. klinecharts expects millisecond timestamps.
   *
   * `applyNewData` REPLACES the whole dataset and resets the visible range
   * with it, so calling it on every update made the chart jump back to the
   * latest bar and discard any zoom or pan the moment a trade landed —
   * which, on an actively traded token, is constantly. `updateData` instead
   * mutates the last bar in place (or appends, when the timestamp is newer)
   * and leaves the viewport alone, which is what makes new trades animate
   * into a chart the user is still looking at.
   *
   * A full reset is still correct when the series identity changes — a new
   * timeframe rebuckets everything, and a backfill can prepend history — so
   * this only takes the incremental path when the new array is recognisably
   * the same series that has merely grown at the tail.
   */
  const appliedRef = useRef<{ seriesKey: string; count: number; firstTime: number } | null>(null);
  const precisionRef = useRef<number | null>(null);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const toBar = (candle: Candle) => ({
      timestamp: candle.time * 1000,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    });

    // A freshly launched token prices in millionths of a dollar, so the
    // default 2-decimal precision would collapse every axis tick and
    // tooltip to "0.00". Scale the precision to the data instead — but only
    // when it actually changes, since re-applying it forces a redraw.
    const reference = candles.length > 0 ? candles[candles.length - 1].close : 0;
    const precision = pricePrecisionFor(reference);
    if (precision !== precisionRef.current) {
      precisionRef.current = precision;
      chart.setPriceVolumePrecision(precision, 4);
    }

    const prev = appliedRef.current;
    const seriesChanged = prev === null || prev.seriesKey !== seriesKey;

    // An empty array within the SAME series means "not loaded yet", not
    // "this token has no trades" — history arrives a moment after the first
    // render, and the USD rate a moment after that. Blanking on it was the
    // first of the two resets: the chart cleared itself, then rebuilt from
    // scratch when the bars showed up, losing the viewport both times.
    // Leaving the previous bars up until real ones replace them is both
    // steadier and more honest about what is happening.
    if (candles.length === 0 && !seriesChanged) return;

    const canAppend =
      !seriesChanged &&
      prev !== null &&
      candles.length >= prev.count &&
      candles[0].time === prev.firstTime;

    if (canAppend) {
      // Re-send the previously-last bar (its close/high/low/volume keep
      // moving while its bucket is open) plus anything appended since.
      for (let i = Math.max(0, prev.count - 1); i < candles.length; i++) {
        chart.updateData(toBar(candles[i]));
      }
    } else {
      // The only path that resets the viewport, and now it only runs when
      // the series really did change or its history grew backwards.
      chart.applyNewData(candles.map(toBar));
    }

    appliedRef.current = {
      seriesKey,
      count: candles.length,
      firstTime: candles.length > 0 ? candles[0].time : 0,
    };
  }, [candles, seriesKey]);

  // Arming a tool creates the matching overlay; klinecharts then drives the
  // click-to-place interaction itself.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (activeTool === "cursor") return;

    chart.createOverlay({
      name: activeTool,
      // Drop back to the cursor once the shape is finished, matching how
      // DexScreener/GMGN toolbars behave.
      onDrawEnd: () => {
        onToolConsumedRef.current();
        return false;
      },
    });
  }, [activeTool]);

  useEffect(() => {
    if (clearSignal === 0) return;
    chartRef.current?.removeOverlay();
  }, [clearSignal]);

  return <div ref={containerRef} className="flex-1 min-h-0" />;
}

/** Decimal places needed to render a USD price of this magnitude legibly. */
function pricePrecisionFor(value: number): number {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) return 8;
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  // Four significant digits below a cent, capped to what the axis can show.
  return Math.min(12, Math.max(6, 4 - Math.floor(Math.log10(abs))));
}
