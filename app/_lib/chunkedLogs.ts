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

/**
 * Chunks in flight at once.
 *
 * Was 10, chosen to make long scans fast. That is what produced the 429
 * storm on /api/rpc: Alchemy's free tier allows roughly 330 compute units
 * per second and eth_getLogs costs ~75, so about FOUR requests per second
 * are sustainable. Ten unthrottled in flight blows past that instantly and
 * every subsequent call comes back 429.
 */
const DEFAULT_CONCURRENCY = 4;

/**
 * Hard ceiling on how many 10-block windows one scan may issue.
 *
 * Robinhood Chain produces ~10 blocks per second, so "all history since
 * this curve launched" grows by 864,000 blocks a day. At a 10-block cap
 * that is 86,400 windows -- and `readRange` issues 2-3 getLogs per window,
 * so viewing a ONE-DAY-OLD token meant roughly 200,000 requests from a
 * single page load. That is the flood, and no amount of caching or
 * backoff makes it acceptable; the scan itself has to be bounded.
 *
 * 600 blocks is about a minute of chain. Small enough to complete in
 * a few seconds inside the rate limit, which means the feed and chart show
 * recent activity immediately instead of hanging and then failing.
 *
 * This is a stopgap, and deliberately a single constant so it is trivial
 * to raise. Full history needs either an RPC without the 10-block cap
 * (Alchemy PAYG serves the same query in ONE request) or the Ponder
 * indexer in indexer/, which exists precisely so the browser never issues
 * these queries at all.
 */
export const MAX_SCAN_WINDOWS = 60;

/**
 * Narrows a scan to the newest `MAX_SCAN_WINDOWS` worth of blocks.
 *
 * Returns the clamped start plus whether anything was dropped, so callers
 * can tell the user their history is partial rather than letting a
 * truncated chart read as "this token barely traded".
 */
export function clampScanRange(
  fromBlock: bigint,
  toBlock: bigint
): { fromBlock: bigint; truncated: boolean } {
  const maxBlocks = BigInt(MAX_SCAN_WINDOWS) * LOG_RANGE_LIMIT;
  if (toBlock <= fromBlock) return { fromBlock, truncated: false };
  const span = toBlock - fromBlock;
  if (span <= maxBlocks) return { fromBlock, truncated: false };
  return { fromBlock: toBlock - maxBlocks, truncated: true };
}

/**
 * Shared token bucket, module-level so EVERY caller draws from one budget.
 *
 * Per-call-site throttling would not work: the token page runs a trade
 * backfill, a market-data scan and a poll tick concurrently, and the RPC's
 * limit applies to their sum, not to each individually.
 */
const RATE_LIMIT_PER_SECOND = 8;
const REFILL_INTERVAL_MS = 1000 / RATE_LIMIT_PER_SECOND;
let nextSlotAt = 0;

/** Resolves when this caller's turn in the shared budget comes up. */
function acquireSlot(): Promise<void> {
  const now = Date.now();
  // A burst that has fallen idle should not bank credit and then fire all
  // at once, so the cursor never rewinds further than "now".
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + REFILL_INTERVAL_MS;
  const wait = slot - now;
  return wait <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, wait));
}

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
      batch.map(async ([from, to]) => {
        // Wait for a slot BEFORE issuing, so the shared budget paces the
        // whole app rather than each batch racing ahead of the RPC.
        await acquireSlot();
        return fetchOneRange(from, to).catch(() => [] as T[]);
      })
    );
    collected.push(...results.flat());
  }

  return collected;
}
