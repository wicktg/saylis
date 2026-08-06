import { NextResponse } from "next/server";
import { upstreamRpcUrl } from "@/app/_lib/serverRpcUrl";

export const runtime = "nodejs";
// Chain state changes every block (~100ms on Robinhood Chain); nothing here
// is ever cacheable.
export const dynamic = "force-dynamic";

/**
 * Server-side JSON-RPC proxy. The browser posts here instead of calling the
 * Alchemy endpoint directly, which fixes two problems at once:
 *
 *   1. CORS. Alchemy does not send Access-Control-Allow-Origin for arbitrary
 *      origins, so every direct browser call from saylis.wtf failed
 *      preflight. This route is same-origin, so there is no preflight.
 *   2. Key exposure. The endpoint URL contains an Alchemy API key. Reaching
 *      it through NEXT_PUBLIC_ROBINHOOD_RPC_URL meant that key was inlined
 *      into the client bundle and readable by anyone. It now lives in
 *      ROBINHOOD_RPC_URL (server-only) and never leaves the server.
 *
 * Because this route is public, it is effectively a free RPC endpoint for
 * anyone who finds it — so it forwards only the methods this app actually
 * uses, all read-only except eth_sendRawTransaction (which carries its own
 * signature and cannot be forged by the proxy).
 */
const ALLOWED_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
  "web3_clientVersion",
]);

type RpcRequest = { id?: unknown; method?: unknown };

/**
 * Upstream rate limits are the reason this exists. Alchemy's free tier
 * allows roughly 330 compute units per second, and eth_getLogs costs ~75,
 * so a burst of log queries earns a 429 almost immediately. The client
 * already paces itself (see chunkedLogs.ts), but pacing cannot account for
 * other tabs, other users, or a poll tick landing on top of a backfill.
 *
 * A 429 here is transient by definition, so it is retried with exponential
 * backoff rather than handed to the browser -- where it surfaced as a wall
 * of console errors and missing data. Only 429 and 5xx are retried; a 4xx
 * like the 10-block range error is a permanent answer and returns at once.
 */
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ---------------------------------------------------------------------
 * Coalescing, caching and pacing -- all of it here, on purpose.
 * ---------------------------------------------------------------------
 *
 * An earlier attempt paced requests in the BROWSER, inside the chunked log
 * reader. That fixed only the log backfill, because every other source of
 * RPC traffic bypasses it: the 8-second multicall poll on every token
 * card, `eth_blockNumber` from several hooks at once, the ETH/USD price
 * feed, pool spot-price reads. Those were the calls 429ing this time.
 *
 * Every one of them arrives here, so this is the only place that can
 * govern all of them at once -- and unlike a client-side limiter it also
 * covers a user with three tabs open, and every other visitor sharing the
 * same upstream quota.
 *
 * Three mechanisms, cheapest first:
 *
 *  1. CACHE. Chain state changes every ~100ms, but the UI polls far faster
 *     than it can meaningfully change and many components ask the same
 *     question at the same moment. A sub-second TTL collapses that without
 *     the UI ever showing stale data a user could notice. Keyed on
 *     (method, params) -- NOT the raw body, which carries a per-request id.
 *  2. SINGLE FLIGHT. Identical requests arriving while one is already in
 *     flight share its promise instead of adding load.
 *  3. PACING. What survives 1 and 2 is spaced out, so bursts queue rather
 *     than earning a 429.
 *
 * All state is module-level, so it is per warm serverless instance. That
 * is a real limit -- several instances multiply the effective rate -- but
 * it removes the dominant source of duplicate load and needs no external
 * store.
 */

/** Per-method cache lifetime. Anything absent is never cached. */
const CACHE_TTL_MS: Record<string, number> = {
  // Height moves ~10x/second; a page cannot render faster than this and
  // several hooks ask for it simultaneously.
  eth_blockNumber: 1_000,
  // The dominant cost. Multicalls repeat identically across cards and
  // across the 8s poll; 2.5s is under the poll interval so every tick
  // still fetches fresh data.
  eth_call: 2_500,
  eth_getBalance: 2_500,
  eth_getCode: 60_000,
  // Historical ranges are immutable once mined.
  eth_getLogs: 15_000,
  eth_getBlockByNumber: 10_000,
  eth_getBlockByHash: 60_000,
  eth_getTransactionReceipt: 10_000,
  eth_getTransactionByHash: 10_000,
  eth_chainId: 300_000,
  net_version: 300_000,
  web3_clientVersion: 300_000,
  eth_gasPrice: 3_000,
  eth_maxPriorityFeePerGas: 3_000,
  eth_feeHistory: 3_000,
  // Params carry from/to/data/value, so this is already caller- and
  // call-specific; the key separates them. Without an entry here it was
  // `bypass` -- every swap preview reaching upstream unprotected, which is
  // what surfaced as "couldn't get the gas limit" during a rate limit.
  eth_estimateGas: 2_500,
};

/**
 * How long past its TTL an entry stays usable as a FALLBACK.
 *
 * A rate limit is not a reason to fail a read we answered correctly four
 * seconds ago. Rather than synthesize an error -- which viem reports as
 * `the contract function "allowance" reverted`, blaming a contract that
 * never ran -- the last good answer is served with a `stale` marker.
 *
 * Deliberately much longer than any TTL: an entry is only reached here when
 * the alternative is a hard failure, so the only question is whether stale
 * data beats no data. For balances, reserves and allowances it does.
 */
const STALE_GRACE_MS = 60_000;

/**
 * Longest TTL any call in this body allows, or 0 if any of them must not
 * be cached. A batch is cached as a unit, which is exactly how viem sends
 * repeated polls, and taking the MINIMUM keeps the freshest member honest.
 */
function cacheTtlFor(calls: RpcRequest[]): number {
  let ttl = Infinity;
  for (const call of calls) {
    const method = typeof call?.method === "string" ? call.method : "";
    const allowed = CACHE_TTL_MS[method];
    if (!allowed) return 0;
    ttl = Math.min(ttl, allowed);
  }
  return Number.isFinite(ttl) ? ttl : 0;
}

/**
 * A response object with its `id` stripped, so it can be re-stamped with
 * whichever id the next caller happens to use.
 */
type RpcResponseEntry = Record<string, unknown>;
type UpstreamResult = {
  text: string;
  ok: boolean;
  /** Positionally aligned to the request's calls, or null if unshareable. */
  entries: RpcResponseEntry[] | null;
};

type CacheEntry = { expires: number; entries: RpcResponseEntry[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<UpstreamResult>>();

/** Bounded so a long-lived instance cannot grow the map without limit. */
const MAX_CACHE_ENTRIES = 500;

/**
 * The cache key must NOT include the JSON-RPC `id`.
 *
 * viem stamps every outgoing request with a fresh id from a global counter
 * (`id: body.id ?? idCache.take()` in viem/utils/rpc/http.ts), so two
 * byte-identical eth_calls arrive here with different ids. Keying on the raw
 * body -- which is what this route did originally -- therefore produced a
 * unique key every single time: the cache never hit, single flight never
 * coalesced, and every call went upstream. Only the pacing gate below was
 * doing any real work.
 *
 * Keying on (method, params) instead is what makes the cache function at all.
 * `batch` is part of the key because a lone request and a one-element batch
 * must not share an entry -- their response shapes differ (object vs array).
 */
function cacheKeyFor(body: unknown, calls: RpcRequest[]): string {
  return JSON.stringify({
    batch: Array.isArray(body),
    calls: calls.map((call) => [call?.method, (call as { params?: unknown })?.params ?? null]),
  });
}

/**
 * Whether a JSON-RPC error is worth storing.
 *
 * A revert, an unknown method, bad params -- these are deterministic answers
 * for the given input and cache exactly as well as a success does. Rate
 * limits and internal upstream failures are momentary, and pinning one in
 * front of every caller for the TTL is how a brief 429 turns into seconds of
 * broken UI.
 *
 * This distinction matters more than it looks: a batch is cached as a unit,
 * so treating every error as uncacheable would mean one reverting read
 * anywhere in the grid's 80-odd-call multicall defeats caching for the whole
 * batch. Reverts are ordinary here -- reading `migrationExecuted()` on a
 * curve that predates it, for one -- so that would quietly undo the fix.
 */
function isTransientError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };

  // -32005 "limit exceeded" is transient by definition. -32603 "internal
  // error" is a server hiccup rather than an answer about the input.
  if (code === -32005 || code === -32603) return true;

  // -32000 is deliberately NOT on that list. It is the catch-all execution
  // error code, and geth-family nodes -- Nitro included -- return it for
  // `execution reverted` and `out of gas`, which are deterministic answers
  // for the given calldata. Treating the code as transient made every batch
  // containing one revert uncacheable, which for an 84-call grid multicall
  // is every batch. So -32000 is judged on its message like anything else.
  return typeof message === "string" && TRANSIENT_MESSAGE.test(message);
}

/**
 * Deliberately narrower than /limit/: "exceeds block gas limit" and "gas
 * required exceeds allowance" are permanent properties of the call, and
 * matching them would reintroduce the problem above from the other side.
 */
const TRANSIENT_MESSAGE =
  /rate[ -]?limit|limit exceeded|too many|timed? ?out|capacity|try again|overloaded|temporarily|unavailable/i;

/**
 * Strips ids off an upstream response and puts the entries in REQUEST order.
 *
 * Matching is by id rather than by position: JSON-RPC explicitly allows a
 * server to return batch responses in any order, so zipping positionally
 * would hand callers the wrong result for the wrong call.
 *
 * Returns null when the response cannot be safely re-stamped or stored -- a
 * length mismatch, an id that was not asked for, or a transient error. A null
 * result means "use once, do not store or share".
 */
function alignEntries(calls: RpcRequest[], parsed: unknown): RpcResponseEntry[] | null {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.length !== calls.length) return null;

  const byId = new Map<string, RpcResponseEntry>();
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const entry = item as RpcResponseEntry;
    if ("error" in entry && isTransientError(entry.error)) return null;
    byId.set(JSON.stringify(entry.id ?? null), entry);
  }

  const aligned: RpcResponseEntry[] = [];
  for (const call of calls) {
    const match = byId.get(JSON.stringify(call?.id ?? null));
    if (!match) return null;
    const { id: _id, ...rest } = match;
    aligned.push(rest);
  }
  return aligned;
}

/**
 * Serializes cached entries back out under the CURRENT caller's ids. viem
 * matches batch responses to requests by id, so replaying a stored body with
 * the original requester's ids would leave every call unresolved.
 */
function restamp(entries: RpcResponseEntry[], body: unknown, calls: RpcRequest[]): string {
  const stamped = entries.map((entry, i) => ({ ...entry, id: calls[i]?.id ?? null }));
  return JSON.stringify(Array.isArray(body) ? stamped : stamped[0]);
}

function readCache(key: string): RpcResponseEntry[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    // NOT deleted here. The entry stays reachable by readStale() until the
    // grace window closes, which is the whole point of keeping it around.
    return null;
  }
  return hit.entries;
}

/**
 * The last good answer for this key, TTL expired but still inside the grace
 * window. Only reached when the alternative is handing the browser an error.
 */
function readStale(key: string): RpcResponseEntry[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires + STALE_GRACE_MS <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.entries;
}

function writeCache(key: string, entries: RpcResponseEntry[], ttl: number): void {
  if (ttl <= 0) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Oldest insertion first -- Map preserves insertion order, and an
    // approximate eviction is fine for a short-TTL cache.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expires: Date.now() + ttl, entries });
}

/**
 * Upstream pacing. Alchemy's free tier allows ~330 compute units per
 * second; eth_call and eth_getLogs are the expensive ones (~26 and ~75),
 * so this stays deliberately conservative rather than trying to ride the
 * exact ceiling.
 */
const MIN_UPSTREAM_INTERVAL_MS = 60;
let nextUpstreamAt = 0;

async function paceUpstream(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextUpstreamAt);
  nextUpstreamAt = slot + MIN_UPSTREAM_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

async function forwardWithRetry(body: unknown): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Honour Retry-After when the upstream sends one, since it knows the
      // real reset window better than a fixed curve does.
      const retryAfter = Number(lastResponse?.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 4000)
        : BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(backoff);
    }

    const response = await fetch(upstreamRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (response.status !== 429 && response.status < 500) return response;
    lastResponse = response;
  }

  return lastResponse as Response;
}

function rejected(id: unknown, message: string) {
  // A JSON-RPC-shaped error, not an HTTP error: viem parses the body and
  // surfaces `message` instead of throwing an opaque network failure.
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 }
    );
  }

  // viem batches calls (multicall, useTokenMarketData) as a JSON array.
  const calls: RpcRequest[] = Array.isArray(body) ? body : [body as RpcRequest];
  const blocked = calls.filter(
    (call) => typeof call?.method !== "string" || !ALLOWED_METHODS.has(call.method)
  );
  if (blocked.length > 0) {
    const errors = blocked.map((call) =>
      rejected(call?.id, `Method not supported by this proxy: ${String(call?.method)}`)
    );
    return NextResponse.json(Array.isArray(body) ? errors : errors[0], { status: 400 });
  }

  const key = cacheKeyFor(body, calls);
  const ttl = cacheTtlFor(calls);

  const cached = ttl > 0 ? readCache(key) : null;
  if (cached !== null) return jsonResponse(restamp(cached, body, calls), 200, "hit");

  // Single flight: a duplicate arriving mid-request shares the answer.
  const pending = ttl > 0 ? inFlight.get(key) : undefined;
  if (pending) {
    try {
      const shared = await pending;
      // Only shareable when ids could be stripped and realigned. If not, fall
      // through and fetch our own copy rather than handing back a body whose
      // ids belong to somebody else's request.
      if (shared.entries) {
        return jsonResponse(restamp(shared.entries, body, calls), 200, "coalesced");
      }
    } catch {
      // Fall through and try for ourselves rather than inheriting a failure.
    }
  }

  const work = (async (): Promise<UpstreamResult> => {
    await paceUpstream();
    const upstream = await forwardWithRetry(body);
    const text = await upstream.text();

    // An upstream 429 (or any error) can carry an EMPTY or non-JSON body.
    // Passing that through verbatim is what produced "Unexpected end of
    // JSON input" in the browser: viem calls JSON.parse on it and got
    // nothing, so a rate limit surfaced as a parse error with no hint of
    // the real cause.
    //
    // The fix is narrow on purpose. A non-2xx that still carries valid
    // JSON is passed through UNCHANGED, because that body is the useful
    // part: it holds eth_call revert reasons, and Alchemy's own "up to a
    // 10 block range" explanation. Only a body that cannot be parsed at
    // all gets replaced with a synthesized error.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new UpstreamError(upstream.status, text);
    }
    if (text.trim() === "") throw new UpstreamError(upstream.status, text);

    return { text, ok: upstream.ok, entries: upstream.ok ? alignEntries(calls, parsed) : null };
  })();

  if (ttl > 0) inFlight.set(key, work);

  try {
    const { text, ok, entries } = await work;
    // Only successful responses are cached. An upstream error is passed
    // through for its detail, but caching it would pin a transient 429 or
    // a one-off failure in front of every caller for the whole TTL.
    if (ok && entries) writeCache(key, entries, ttl);
    return jsonResponse(text, 200, ttl > 0 ? "miss" : "bypass");
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 0;
    const rateLimited = status === 429;

    // Last resort before failing the read: an answer we gave correctly a few
    // seconds ago. A balance, a reserve or an allowance that is 30s stale is
    // enormously better than viem surfacing this as a phantom contract
    // revert, which is how upstream 429s used to reach the user.
    const stale = ttl > 0 ? readStale(key) : null;
    if (stale) return jsonResponse(restamp(stale, body, calls), 200, "stale");

    return jsonResponse(
      JSON.stringify(
        errorPayload(
          body,
          rateLimited
            ? "Upstream RPC rate limit reached. Retrying shortly."
            : `Upstream RPC error${status ? ` (HTTP ${status})` : ""}.`
        )
      ),
      // Deliberately 200. viem treats a non-2xx as a transport failure and
      // reports it as "HTTP request failed", burying the reason; a 200
      // carrying a JSON-RPC error object gets surfaced properly and lets
      // its own retry logic handle it.
      200,
      "error"
    );
  } finally {
    if (ttl > 0) inFlight.delete(key);
  }
}

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`upstream ${status}`);
  }
}

/** Mirrors the request's shape (array in, array out) so viem can match ids. */
function errorPayload(body: unknown, message: string) {
  const error = { code: -32603, message };
  if (Array.isArray(body)) {
    return body.map((call: RpcRequest) => ({
      jsonrpc: "2.0",
      id: call?.id ?? null,
      error,
    }));
  }
  return { jsonrpc: "2.0", id: (body as RpcRequest)?.id ?? null, error };
}

/**
 * `x-rpc-cache` reports how the response was produced:
 *   hit       served from the in-process cache, no upstream call
 *   coalesced joined a request already in flight, no upstream call
 *   miss      forwarded upstream
 *   bypass    method is not cacheable (sends, and anything absent from
 *             CACHE_TTL_MS), always forwarded
 *   stale     upstream failed, so the last good answer was served past its
 *             TTL rather than surfacing the failure
 *   error     upstream failed and a synthesized error was returned
 *
 * Only `miss` and `error` consume upstream quota, so the header is the
 * cheapest way to confirm the cache is actually working -- in dev, and in
 * production where a broken key would otherwise be invisible.
 */
type CacheStatus = "hit" | "coalesced" | "miss" | "bypass" | "stale" | "error";

function jsonResponse(text: string, status = 200, cacheStatus: CacheStatus = "miss") {
  return new NextResponse(text, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "x-rpc-cache": cacheStatus,
    },
  });
}
