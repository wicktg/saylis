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
/** Matches the `body` font stack in globals.css. */
const UI_FONT = "Satoshi, Inter, sans-serif";

/**
 * Candlestick chart backed by klinecharts. Every drawing tool is one of
 * the library's own built-in overlay templates, so drawing, dragging,
 * selection and deletion are all handled by klinecharts rather than
 * re-implemented here — `activeTool` is simply the overlay's name.
 */
export default function TokenChart({
  candles,
  activeTool,
  onToolConsumed,
  clearSignal,
}: {
  candles: Candle[];
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
            // The "time / open / high / low / close" legend across the top
            // of the chart. klinecharts defaults it to its own font stack,
            // which reads as a different typeface to the rest of the app —
            // pin it to the page font and bold it.
            text: {
              color: "rgba(255,255,255,0.85)",
              size: 11,
              family: UI_FONT,
              weight: "bold",
            },
            // Drop the trailing "volume" entry klinecharts includes by
            // default — this app doesn't show volume on the chart itself.
            custom: [
              { title: "time", value: "{time}" },
              { title: "open", value: "{open}" },
              { title: "high", value: "{high}" },
              { title: "low", value: "{low}" },
              { title: "close", value: "{close}" },
            ],
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
  const appliedRef = useRef<{ count: number; firstTime: number } | null>(null);
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
    const sameSeries =
      prev !== null &&
      candles.length >= prev.count &&
      candles.length > 0 &&
      candles[0].time === prev.firstTime;

    if (sameSeries) {
      // Re-send the previously-last bar (its close/high/low/volume keep
      // moving while its bucket is open) plus anything appended since.
      for (let i = Math.max(0, prev.count - 1); i < candles.length; i++) {
        chart.updateData(toBar(candles[i]));
      }
    } else {
      chart.applyNewData(candles.map(toBar));
    }

    appliedRef.current =
      candles.length > 0 ? { count: candles.length, firstTime: candles[0].time } : null;
  }, [candles]);

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
