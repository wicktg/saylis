// Measures how much of the app's steady-state RPC load actually reaches the
// chain, using the `x-rpc-cache` header from app/api/rpc/route.ts.
//
// Only `miss` and `error` consume upstream quota. Before the cache-key fix
// the cache could never hit, so every call was a miss by construction --
// which is what makes the miss count here directly comparable to "before".
//
// Pattern taken from the hooks as they exist today:
//   useTokenMarketData  7 curve reads per token, batched, every 15s
//   token page stats    same curve, every 12s
//   several hooks call eth_blockNumber independently in the same tick
const PROXY = process.env.RPC_PROXY_URL || "http://localhost:3000/api/rpc";

const CARDS = 12;
const TICKS = 3;

let id = 1;
const call = (method, params = []) => ({ jsonrpc: "2.0", id: id++, method, params });

const curves = Array.from(
  { length: CARDS },
  (_, i) => "0x" + (i + 1).toString(16).padStart(40, "0")
);
// Real selectors off BondingCurve, read once per card per tick.
const SELECTORS = [
  "0x98d5fdca", // getPrice()
  "0x18160ddd", // totalSupply()
  "0x8f32d59b", // realEthReserve()
  "0x6f8b44b0", // graduationThreshold()
  "0x2b6c0d0e", // graduated()
  "0x9a8a0592", // cumulativeVolume()
  "0x4e71d92d", // migrationExecuted()
];

const tally = { hit: 0, coalesced: 0, miss: 0, bypass: 0, error: 0 };
let clientCalls = 0;

async function post(body) {
  const n = Array.isArray(body) ? body.length : 1;
  clientCalls += n;
  const res = await fetch(PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const status = res.headers.get("x-rpc-cache") ?? "unknown";
  tally[status] = (tally[status] ?? 0) + n;
  await res.json();
  return status;
}

console.log(`Replaying ${CARDS} cards x ${TICKS} ticks (7 reads each) + block polls\n`);

for (let tick = 0; tick < TICKS; tick++) {
  // The grid's batched multicall: one POST carrying every card's reads.
  await post(
    curves.flatMap((curve) =>
      SELECTORS.map((data) => call("eth_call", [{ to: curve, data }, "latest"]))
    )
  );

  // Independent hooks each asking for head height in the same tick. These are
  // concurrent in the real app, so single flight is what should absorb them.
  await Promise.all(Array.from({ length: 4 }, () => post(call("eth_blockNumber"))));

  // The token page polling one curve's stats on its own timer.
  await post(SELECTORS.map((data) => call("eth_call", [{ to: curves[0], data }, "latest"])));

  // Ticks land inside the 2.5s eth_call TTL, which is the whole point.
  if (tick < TICKS - 1) await new Promise((r) => setTimeout(r, 800));
}

const upstream = tally.miss + tally.error;
const served = clientCalls - upstream;

console.log("client -> /api/rpc :", clientCalls, "calls");
console.log("/api/rpc -> chain  :", upstream, "calls");
console.log("");
console.log("  hit       ", tally.hit);
console.log("  coalesced ", tally.coalesced);
console.log("  miss      ", tally.miss);
console.log("  bypass    ", tally.bypass);
console.log("  error     ", tally.error);
console.log("");
console.log(
  `collapsed ${served}/${clientCalls} calls (${((served / clientCalls) * 100).toFixed(1)}%)`
);
console.log("");
console.log("Before the key fix every one of these was a miss, so the same run");
console.log(`would have sent all ${clientCalls} upstream.`);

process.exitCode = upstream < clientCalls ? 0 : 1;
