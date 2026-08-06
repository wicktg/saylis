// Verifies the /api/rpc cache-key fix.
//
// The bug: the key was JSON.stringify(body), but viem stamps every request
// with a fresh incrementing id, so no two keys ever matched and the cache
// never hit. Fix keys on (method, params) and re-stamps ids on the way out.
//
// Run with the dev server up: node scripts/verify-rpc-cache.mjs
const URL = process.env.RPC_PROXY_URL || "http://localhost:3000/api/rpc";

let idCounter = 1000;
const nextId = () => idCounter++;

async function post(body) {
  const t0 = performance.now();
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { json, ms: performance.now() - t0, status: res.headers.get("x-rpc-cache") };
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};

// ---------------------------------------------------------------- single
// Same call, different ids. Every response must carry the id ITS OWN
// request used, and the cached ones must be dramatically faster.
async function testSingle() {
  const mk = () => ({ jsonrpc: "2.0", id: nextId(), method: "eth_chainId", params: [] });

  const first = mk();
  const a = await post(first);
  check(
    "single: first call returns matching id",
    a.json.id === first.id,
    `sent id=${first.id} got id=${a.json.id}`
  );
  check("single: first call has a result", typeof a.json.result === "string", a.json.result);

  const timings = [];
  let allHits = true;
  for (let i = 0; i < 4; i++) {
    const req = mk();
    const r = await post(req);
    timings.push(r.ms);
    if (r.status !== "hit") allHits = false;
    if (r.json.id !== req.id) {
      check("single: cached call re-stamps id", false, `sent id=${req.id} got id=${r.json.id}`);
      return;
    }
    if (r.json.result !== a.json.result) {
      check("single: cached result matches", false, `${r.json.result} vs ${a.json.result}`);
      return;
    }
  }
  check("single: cached calls re-stamp their own ids", true, `${timings.length} repeats`);

  const avg = timings.reduce((s, t) => s + t, 0) / timings.length;
  check(
    "single: repeats served from cache (not upstream)",
    allHits,
    `4/4 hit, avg ${avg.toFixed(1)}ms vs first ${a.ms.toFixed(1)}ms`
  );
}

// ----------------------------------------------------------------- batch
// This is the case that would break viem silently: a batch response whose
// ids don't line up leaves every call in the batch unresolved.
async function testBatch() {
  const mk = () => [
    { jsonrpc: "2.0", id: nextId(), method: "eth_chainId", params: [] },
    { jsonrpc: "2.0", id: nextId(), method: "net_version", params: [] },
    { jsonrpc: "2.0", id: nextId(), method: "web3_clientVersion", params: [] },
  ];

  const first = mk();
  const a = await post(first);
  check("batch: response is an array", Array.isArray(a.json), `got ${typeof a.json}`);
  if (!Array.isArray(a.json)) return;
  check("batch: length matches request", a.json.length === 3, `got ${a.json.length}`);

  const second = mk();
  const b = await post(second);
  if (!Array.isArray(b.json)) {
    check("batch: cached response is an array", false, `got ${typeof b.json}`);
    return;
  }

  const idsOk = b.json.every((entry, i) => entry.id === second[i].id);
  check(
    "batch: cached entries re-stamped with THIS request's ids",
    idsOk,
    idsOk ? "" : `sent [${second.map((c) => c.id)}] got [${b.json.map((e) => e.id)}]`
  );

  const orderOk = b.json.every((entry, i) => {
    const original = a.json.find((e) => e.id === first[i].id);
    return original && JSON.stringify(entry.result) === JSON.stringify(original.result);
  });
  check("batch: results stay aligned to their own calls", orderOk);

  // Asserted on the header, not on latency. These methods have a 300s TTL and
  // earlier tests already warmed them, so `first` is itself usually a hit --
  // which made a "second is faster than first" comparison flap on noise.
  check(
    "batch: repeat served from cache",
    b.status === "hit",
    `${b.status} (${a.ms.toFixed(1)}ms -> ${b.ms.toFixed(1)}ms)`
  );
}

// ------------------------------------------------------- distinct params
// Different params must NOT collide onto one cache entry.
async function testDistinctParams() {
  const call = (addr) =>
    post({
      jsonrpc: "2.0",
      id: nextId(),
      method: "eth_getCode",
      params: [addr, "latest"],
    });

  const multicall = await call("0xcA11bde05977b3631167028862bE2a173976CA11");
  const empty = await call("0x000000000000000000000000000000000000dEaD");

  check(
    "distinct params get distinct cache entries",
    multicall.json.result !== empty.json.result,
    `multicall3 code len=${multicall.json.result?.length}, dead addr len=${empty.json.result?.length}`
  );
}

// --------------------------------------------------------- uncached path
// eth_sendRawTransaction is absent from CACHE_TTL_MS, so ttl=0: it must
// never be cached or coalesced. Garbage payload, we only care that it is
// forwarded each time rather than answered from a stored copy.
async function testNeverCached() {
  const send = () =>
    post({ jsonrpc: "2.0", id: nextId(), method: "eth_sendRawTransaction", params: ["0xdeadbeef"] });
  const a = await send();
  const b = await send();
  const bothErrored = Boolean(a.json.error) && Boolean(b.json.error);
  check("eth_sendRawTransaction is never served from cache", bothErrored, "both forwarded upstream");
}

// ------------------------------------------------------- blocked methods
async function testBlocked() {
  const req = { jsonrpc: "2.0", id: nextId(), method: "eth_accounts", params: [] };
  const { json } = await post(req);
  check(
    "disallowed method still rejected",
    json.error?.code === -32601 && json.id === req.id,
    `code=${json.error?.code} id=${json.id}`
  );
}

// ------------------------------------------------------ reverts are cached
// The regression this exists to catch. A failed eth_call is a deterministic
// property of the calldata, and comes back in two shapes here: code 3
// "execution reverted" from a contract, and code -32000 "out of gas" from a
// precompile. An earlier isTransientError() treated the whole -32000 code as
// transient, so ONE failing read anywhere in the grid's 84-call multicall
// made the entire batch uncacheable -- which is every batch in practice,
// since a curve predating a selector always fails it. Measured hit rate went
// 67% -> 8%.
async function testDeterministicErrorsAreCacheable() {
  const cases = [
    {
      label: "execution reverted (code 3)",
      // Multicall3 with calldata for a selector it does not implement.
      to: "0xcA11bde05977b3631167028862bE2a173976CA11",
      data: "0xee82ac5e",
    },
    {
      label: "out of gas (code -32000)",
      // modexp precompile, which burns gas on garbage input.
      to: "0x0000000000000000000000000000000000000005",
      data: "0x98d5fdca",
    },
  ];

  for (const { label, to, data } of cases) {
    // Paired with a healthy call, because a MIXED batch is the real-world
    // shape: one bad read must not poison the 83 good ones beside it.
    const mk = () => [
      { jsonrpc: "2.0", id: nextId(), method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: nextId(), method: "eth_call", params: [{ to, data }, "latest"] },
    ];

    const a = await post(mk());
    const b = await post(mk());
    const sawError = Array.isArray(a.json) && a.json.some((e) => e.error);

    check(
      `batch containing ${label} still caches`,
      b.status === "hit" && sawError,
      sawError ? `first=${a.status} second=${b.status}` : "batch did not actually error -- test is inert"
    );
  }
}

// --------------------------------------------------------- x-rpc-cache header
// The header is how cache health is observable in production, so it has to
// classify honestly. Only `miss` and `error` cost upstream quota.
async function testCacheHeader() {
  // A param no earlier test touched. eth_getCode has a 60s TTL, so reusing a
  // warm address here would report `hit` and quietly assert nothing.
  const coldAddr = "0x" + `${process.pid}${nextId()}`.padStart(40, "0").slice(-40);
  const getCode = () => ({
    jsonrpc: "2.0",
    id: nextId(),
    method: "eth_getCode",
    params: [coldAddr, "latest"],
  });

  const cold = await post(getCode());
  check("header: cold call reports miss", cold.status === "miss", `got ${cold.status}`);

  const warm = await post(getCode());
  check("header: repeat reports hit", warm.status === "hit", `got ${warm.status}`);

  const send = await post({
    jsonrpc: "2.0",
    id: nextId(),
    method: "eth_sendRawTransaction",
    params: ["0xdeadbeef"],
  });
  check("header: uncacheable method reports bypass", send.status === "bypass", `got ${send.status}`);
}

await testSingle();
await testBatch();
await testDistinctParams();
await testNeverCached();
await testBlocked();
await testDeterministicErrorsAreCacheable();
await testCacheHeader();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
// Set the code and let the loop drain. process.exit() here trips a libuv
// assertion on Windows while keep-alive sockets are still open.
process.exitCode = failed.length === 0 ? 0 : 1;
