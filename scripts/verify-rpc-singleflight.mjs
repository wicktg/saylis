// Single-flight check: 20 concurrent IDENTICAL eth_calls, which is what a
// 20-card grid mounting at once looks like. Without coalescing these serialize
// behind the 60ms pacing gate (~1200ms floor); with it, one upstream call.
const URL = process.env.RPC_PROXY_URL || "http://localhost:3000/api/rpc";

let id = 5000;
const body = () => ({
  jsonrpc: "2.0",
  id: id++,
  method: "eth_call",
  params: [
    {
      to: "0xcA11bde05977b3631167028862bE2a173976CA11",
      // Multicall3.getEthBalance(0x…dEaD)
      data: "0x4d2301cc000000000000000000000000000000000000000000000000000000000000dead",
    },
    "latest",
  ],
});

const reqs = Array.from({ length: 20 }, body);
const t0 = performance.now();
const out = await Promise.all(
  reqs.map(async (r) => {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    });
    return { sent: r.id, got: await res.json() };
  })
);
const ms = performance.now() - t0;

const idsOk = out.every((o) => o.sent === o.got.id);
const distinct = new Set(out.map((o) => JSON.stringify(o.got.result))).size;
const errors = out.filter((o) => o.got.error).length;

console.log("20 concurrent identical eth_call");
console.log("  wall time                       :", ms.toFixed(1) + "ms");
console.log("  every id matches its own request:", idsOk);
console.log("  distinct results                :", distinct, "(want 1)");
console.log("  errors                          :", errors);
console.log("");
console.log("  20 uncoalesced calls floor at ~1200ms behind the 60ms pacing gate.");
const ok = idsOk && distinct === 1 && errors === 0;
console.log("  Verdict:", ms < 600 && ok ? "COALESCED" : "NOT coalesced");

// Set the code and let the loop drain on its own. Calling process.exit() here
// trips a libuv assertion on Windows when keep-alive sockets are still open.
process.exitCode = ok ? 0 : 1;
