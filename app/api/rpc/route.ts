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

  let upstream: Response;
  try {
    upstream = await fetch(upstreamRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: `Upstream RPC unreachable: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        },
      },
      { status: 502 }
    );
  }

  // Pass the upstream body through verbatim — including JSON-RPC errors,
  // which viem needs to see intact to decode revert reasons.
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.ok ? 200 : upstream.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
