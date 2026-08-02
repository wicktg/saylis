/**
 * Every `eth_getLogs` call against this app's RPC MUST go through this —
 * see `LOG_RANGE_LIMIT` below for why.
 *
 * Alchemy's free tier — what `NEXT_PUBLIC_ROBINHOOD_RPC_URL` is actually
 * configured with — caps a single `eth_getLogs` request to a 10-block
 * range. Confirmed against the literal error the RPC returns, not assumed.
 * A wider request doesn't degrade or truncate; it 400s outright, and every
 * call site's own try/catch quietly treated that as "transient hiccup,
 * retry later" — so a real trade just never appeared in the chart or feed,
 * with nothing anywhere logging why.
 *
 * Robinhood Chain is what makes this bite immediately rather than
 * eventually: its block time is ~100ms (see viem's own `robinhood` chain
 * definition), so a single 4-second UI poll tick alone spans roughly 40
 * blocks — 4x this cap, every tick, forever. This isn't a rare-edge-case
 * fallback path; it is the hard ceiling on every log query this app makes.
 */
const LOG_RANGE_LIMIT = 10n;

/** Chunks in flight at once. High enough to make scanning thousands of
 *  blocks in 10-block slices actually fast; not so high it reads as a
 *  burst attack to the RPC's own rate limiter. */
const DEFAULT_CONCURRENCY = 10;

/**
 * Fetches logs (or anything else scoped to a block range) across
 * `[fromBlock, toBlock]` by splitting it into `LOG_RANGE_LIMIT`-wide
 * windows and running `fetchOneRange` over each, `concurrency` at a time.
 *
 * `fetchOneRange` is the caller's own query for a SINGLE window no wider
 * than the limit — this function only owns the splitting and batching, not
 * what's being fetched, so one call site can combine several event types
 * per window (see `useCurveTrades`) while another does a single plain
 * `getLogs` (see `useTokenMarketData`) without either duplicating the
 * chunking logic.
 *
 * A window that fails (a transient RPC hiccup, not the range-limit error
 * this function exists to avoid) is skipped rather than aborting the whole
 * scan — losing one 10-block slice's worth of history is far better than
 * losing everything because of it.
 */
export async function getLogsChunked<T>(
  fetchOneRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  concurrency: number = DEFAULT_CONCURRENCY
): Promise<T[]> {
  if (fromBlock > toBlock) return [];

  const windows: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_RANGE_LIMIT) {
    const end = start + LOG_RANGE_LIMIT - 1n > toBlock ? toBlock : start + LOG_RANGE_LIMIT - 1n;
    windows.push([start, end]);
  }

  const collected: T[] = [];
  for (let i = 0; i < windows.length; i += concurrency) {
    const batch = windows.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(([from, to]) => fetchOneRange(from, to).catch(() => [] as T[]))
    );
    collected.push(...results.flat());
  }

  return collected;
}
