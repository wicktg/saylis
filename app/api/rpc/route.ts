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
 *     the UI ever showing stale data a user could notice.
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
};

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

type CacheEntry = { expires: number; text: string };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ text: string; ok: boolean }>>();

/** Bounded so a long-lived instance cannot grow the map without limit. */
const MAX_CACHE_ENTRIES = 500;

function readCache(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.text;
}

function writeCache(key: string, text: string, ttl: number): void {
  if (ttl <= 0) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Oldest insertion first -- Map preserves insertion order, and an
    // approximate eviction is fine for a short-TTL cache.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expires: Date.now() + ttl, text });
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

  const key = JSON.stringify(body);
  const ttl = cacheTtlFor(calls);

  const cached = ttl > 0 ? readCache(key) : null;
  if (cached !== null) return jsonResponse(cached);

  // Single flight: a duplicate arriving mid-request shares the answer.
  const pending = ttl > 0 ? inFlight.get(key) : undefined;
  if (pending) {
    try {
      return jsonResponse((await pending).text);
    } catch {
      // Fall through and try for ourselves rather than inheriting a failure.
    }
  }

  const work = (async (): Promise<{ text: string; ok: boolean }> => {
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
    if (!isParseableJson(text)) {
      throw new UpstreamError(upstream.status, text);
    }
    return { text, ok: upstream.ok };
  })();

  if (ttl > 0) inFlight.set(key, work);

  try {
    const { text, ok } = await work;
    // Only successful responses are cached. An upstream error is passed
    // through for its detail, but caching it would pin a transient 429 or
    // a one-off failure in front of every caller for the whole TTL.
    if (ok) writeCache(key, text, ttl);
    return jsonResponse(text);
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 0;
    const rateLimited = status === 429;
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
      200
    );
  } finally {
    if (ttl > 0) inFlight.delete(key);
  }
}

function isParseableJson(text: string): boolean {
  if (text.trim() === "") return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
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

function jsonResponse(text: string, status = 200) {
  return new NextResponse(text, {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
