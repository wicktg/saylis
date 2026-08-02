import { index, onchainTable } from "ponder";

/**
 * Every executed trade, across both venues, for every token this app has
 * launched. Lands directly in Supabase's `public` schema — current Ponder
 * writes real tables there, not views in a separate schema — so the
 * frontend's existing supabase-js client reads this with a plain
 * `.from("chain_trades")` query, no new API integration required.
 *
 * Named distinctly from every hand-written table in supabase/*.sql so
 * there is no collision risk. Ponder owns this table's schema and
 * migrations entirely — nothing outside this indexer should ever write to
 * it, only read.
 *
 * Field names deliberately mirror app/_lib/useCurveTrades.ts's `Trade`
 * type, so wiring the frontend to read from here instead of raw RPC logs
 * is a data-source swap, not a shape change.
 */
export const chainTrade = onchainTable(
  "chain_trades",
  (t) => ({
    /** `${txHash}-${logIndex}` — stable and unique per log, matches the
     *  frontend's existing `Trade.id` exactly. */
    id: t.text().primaryKey(),
    tokenAddress: t.hex().notNull(),
    curveAddress: t.hex(),
    poolAddress: t.hex(),
    type: t.text().notNull(), // "buy" | "sell"
    venue: t.text().notNull(), // "curve" | "pool"
    wallet: t.hex().notNull(),
    /** ETH paid in (buy) or received out (sell), wei. */
    ethWei: t.bigint().notNull(),
    /** Tokens received (buy) or sold (sell), base units. */
    tokensWei: t.bigint().notNull(),
    /** Realized execution price: wei of ETH per one whole token. */
    priceWei: t.bigint().notNull(),
    /** Pool trades only — marginal spot price right after the swap,
     *  decoded from sqrtPriceX96. See the frontend Trade type's identical
     *  field for why this differs from priceWei. */
    spotPriceWei: t.bigint(),
    blockNumber: t.bigint().notNull(),
    /** Unix seconds. */
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    curveIdx: index().on(table.curveAddress),
    tokenIdx: index().on(table.tokenAddress),
    blockIdx: index().on(table.blockNumber),
  })
);

/**
 * One row per curve, tracking state the frontend needs but that isn't
 * itself an individual trade — specifically which pool (if any) a curve
 * graduated into, so the frontend can tell `chain_trades.venue = "pool"`
 * apart per-token without re-deriving it from raw events each time.
 */
export const curveStatus = onchainTable("curve_status", (t) => ({
  curveAddress: t.hex().primaryKey(),
  tokenAddress: t.hex().notNull(),
  poolAddress: t.hex(),
  migrated: t.boolean().notNull().default(false),
}));
