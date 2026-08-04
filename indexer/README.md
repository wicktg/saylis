# Saylis indexer

Replaces per-page-load `eth_getLogs` calls (the frontend's old approach)
with a small always-on [Ponder](https://ponder.sh) process that watches
this app's own contracts and writes trades into Supabase once. The
frontend then reads trade history with a normal `supabase-js` query —
fast, no RPC compute cost per pageview, and free at any read volume.

## Why this exists

The RPC this app is configured with (Alchemy free tier) caps a single
`eth_getLogs` call to a 10-block range. Robinhood Chain produces a block
roughly every 100ms, so a single 4-second UI poll alone spans ~40 blocks —
4x that cap, every tick, forever. Chunking around the cap (an earlier fix,
still present in `app/_lib/chunkedLogs.ts`) is *correct* but does not
scale: backfilling a token launched even a few hours ago meant ~30,000
chunked requests. An indexer that watches the chain once and serves reads
from its own database sidesteps the RPC limit entirely instead of working
around it per request.

## Setup

```bash
cd indexer
npm install
cp .env.local.example .env.local   # fill in the real values, see below
npm run start
```

`npm run start`/`npm run dev` first regenerates `addresses.generated.json`
from Supabase's `tokens` table, then starts Ponder. Ponder's own dashboard
(usually `http://localhost:42069`) shows indexing progress, and it serves
`/health` and `/ready` for process supervision.

**Prefer `npm run start` over `npm run dev` against a real Supabase
project.** `ponder dev` defaults its database schema to `public` — the
schema holding every production table this app has — and drops and
recreates tables on each schema change. `ponder start` has no default and
forces you to name a schema explicitly, which is why `DATABASE_SCHEMA` is
set to `indexer` in `.env.local.example`.

## Three things that must be in place, or nothing starts

These are non-obvious and each one fails the build outright:

1. **`DATABASE_SCHEMA` must be set.** `ponder start` refuses to build
   without it. Keep it off `public` — see above.
2. **`src/api/index.ts` must exist** and default-export a Hono app, even
   if it registers no routes. Ponder validates this at build time. Note
   that `/health` and `/ready` are reserved: defining either yourself
   fails the build with "API route is reserved for internal use".
3. **`PONDER_RPC_URL` should be the public endpoint**, not Alchemy —
   see below.

## Which RPC to point this at

Use `https://rpc.mainnet.chain.robinhood.com`, not the Alchemy URL the
frontend proxy uses.

Alchemy's free tier caps `eth_getLogs` at a **10-block range** — the very
limit that forced `app/_lib/chunkedLogs.ts` to exist. The backfill here
spans millions of blocks, so that cap would turn a single sync into
hundreds of thousands of sequential requests. The public node has no such
cap: it serves the entire range from `START_BLOCK` to head in one request.
Ponder logs a warning that a public RPC may be rate limited; that warning
is expected and, for this workload, not a problem — a curve emits a
handful of events, not a firehose.

## What each env var is

See `.env.local.example` for the full list and where to find each value.
The one most likely to trip you up: `SUPABASE_DB_URL` is the **direct
Postgres connection string** (Settings → Database → Connection string →
URI in the Supabase dashboard), not the `NEXT_PUBLIC_SUPABASE_URL` +
anon-key pair the Next.js app uses elsewhere — those go through
PostgREST, and Ponder needs a real `postgres://` connection with write
access.

## How the frontend actually reads this

Ponder writes into the `indexer` schema, which Supabase's PostgREST does
not expose. `supabase/indexer_views.sql` creates read-only views
`public.chain_trades` and `public.curve_status` over those tables, granted
`select` to `anon`/`authenticated` and nothing else. That keeps the
frontend query a plain `supabase.from("chain_trades")` with no `.schema()`
qualifier, while Ponder never touches the schema holding live app data.

Run that SQL **after** the indexer has started once, since the underlying
tables have to exist first.

## Deploying (Railway)

```bash
railway login
railway init          # inside indexer/
railway up
```

Set every var from `.env.local.example` as a real Railway environment
variable first (`railway variables set KEY=value`, or via the dashboard).
Railway keeps this running continuously, which is required — Ponder is
not a serverless function, it holds an open connection to the chain.

## What the frontend changed

`app/_lib/useCurveTrades.ts` now reads history from
`supabase.from("chain_trades")` in a single request instead of thousands of
chunked `eth_getLogs` windows, and the `clampScanRange` truncation no
longer applies on that path — full history comes back regardless of age.
Its return shape (`{ trades, isLoading, error, poolAddress,
historyTruncated }`) is unchanged, so nothing else in the app moved.

Two deliberate details:

- **New trades are still tailed from the chain**, on the same 4s poll as
  before, starting from the head block at load. History from the indexer,
  live from RPC. That way a lagging, restarting, or undeployed indexer can
  never freeze the feed.
- **A curve with no indexed rows falls back to the old chunked backfill.**
  That is the expected case for a token launched after the address snapshot
  (see limitation 1 below), so it must not render an empty feed.

`useTokenMarketData.ts` still reads contract state directly via multicall,
which is correct — it reads current on-chain values, not historical logs,
so there is nothing for the indexer to serve it.

## Numeric precision — do not remove the casts in indexer_views.sql

Ponder stores wei columns as `numeric(78,0)`, and PostgREST serializes
`numeric` as an **unquoted JSON number**. A real `tokens_wei` here is
`184781706545052039848055`, far past `Number.MAX_SAFE_INTEGER`, so
`JSON.parse` rounds it to `1.8478170654505204e+23` in the browser before
any application code runs. `supabase/indexer_views.sql` casts those columns
to `text` in the view so `BigInt()` round-trips them exactly. Dropping
those casts silently corrupts every amount on the chart and the feed.

## Known limitations — read before relying on this

1. **New token launches need a restart to be indexed.** BondingCurve has
   no on-chain factory (each launch is two raw `deployContract` calls from
   the frontend, not a `factory.createCurve()` call), so there is no event
   Ponder's real `factory()` pattern can key off for curve discovery. The
   watched-address list is a snapshot of Supabase's `tokens` table taken
   at process start (see `scripts/generate-curve-addresses.mjs`). A token
   launched after that snapshot is invisible until the indexer restarts.
   Pool discovery (once a token graduates) does NOT have this problem —
   `GraduationMigrator.Migrated` is a real factory event, so new pools are
   picked up automatically with no restart needed.

   Until this is worth a proper fix (a real on-chain factory, or a
   trigger that restarts the indexer from the launch flow), the practical
   mitigation is scheduling a periodic restart (e.g. every 10-15 minutes)
   on whatever platform runs this.

2. **Reorgs are not specially handled beyond what Ponder does by default.**
   Worth deliberately testing before treating this as fully production-hardened,
   the same rigor applied to every contract change this session — this
   scaffold has not had that pass yet.

3. **Backfill takes about 90 minutes from a cold start.** The first
   `START_BLOCK`-to-head walk spans ~2.1M blocks and took 1h23m against the
   public RPC. It is a one-time cost — `ponder_sync` caches every interval,
   so a restart resumes rather than rescanning — but a fresh environment
   serves no history until it finishes. The frontend degrades gracefully
   meanwhile (see "What the frontend changed"), falling back to RPC.

4. **The public RPC is not archival.** `eth_getLogs` works over the full
   range, which is all the indexer needs, but `eth_getCode` and other
   historical *state* reads fail with `metadata is not found` beyond a
   recent window. Anything needing old state needs a different endpoint.
