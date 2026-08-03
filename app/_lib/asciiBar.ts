/**
 * Renders a percentage as a fixed-width bar of block characters, e.g.
 * `████████░░░░░░`. Used instead of a CSS-width div so the bonding-curve
 * progress reads as terminal output rather than UI chrome.
 *
 * The bar is a fixed cell count, so it quantises: at width 14 each cell is
 * ~7.1%, and anything under half a cell shows as empty. That is deliberate
 * — the exact figure is always printed alongside it — but it means the bar
 * is an at-a-glance indicator, never the precise value.
 */
const FILLED = "█";
const EMPTY = "░";

export function asciiBar(pct: number, width = 14): string {
  const { filled, empty } = asciiBarParts(pct, width);
  return filled + empty;
}

/**
 * Same bar, split into its two runs so a caller can colour them
 * independently (the slider draws the filled run in the accent colour and
 * the remainder dimmed, which a single string cannot express).
 */
export function asciiBarParts(pct: number, width = 14): { filled: string; empty: string } {
  // Guard NaN/Infinity as well as out-of-range: market data arrives async
  // and a malformed percentage would otherwise produce a negative repeat
  // count, which throws.
  const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const filledCells = Math.round((safePct / 100) * width);
  return {
    filled: FILLED.repeat(filledCells),
    empty: EMPTY.repeat(width - filledCells),
  };
}
