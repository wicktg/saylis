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

### `PONDER_RPC_WS_URL` — optional, and it is the OTHER endpoint

Set this to the **Alchemy `wss://` URL**, not the public node. It is the
one place in this project where those two swap round, so it is worth being
explicit about why.

The public node rejects WebSocket upgrades outright (HTTP 400 from its
CDN), and `ws.mainnet.chain.robinhood.com` does not resolve. Alchemy's
socket works. The 10-block `eth_getLogs` cap that rules Alchemy out above
does not apply here, because this socket is not used for log queries — it
carries new-block notifications only. The heavy historical reads still go
over `PONDER_RPC_URL` to the uncapped public node.

What it buys: new blocks are pushed rather than waited for, so a trade
reaches the database — and from there, via Supabase Realtime, every open
browser — in a few hundred milliseconds instead of on the next poll.

Leave it unset and everything still works; the chain is polled at
`pollingInterval` (250ms, see `ponder.config.ts`) instead.

This is also the single WebSocket listener that lets the frontend have
none: one always-on process holds one subscription, rather than every
visitor's browser holding its own.

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

**This needs a SERVICE OF ITS OWN.** The repo already has a Railway
service — `saylis`, running `next start` — and it is the Next.js app, not
this. Deploying from `indexer/` without creating a separate service just
redeploys the web app, and the indexer silently never runs at all: the
frontend keeps serving whatever rows are already in the table, so the site
looks fine while the trade feed quietly stops advancing.

That is not hypothetical. It is what happened between 2026-08-05 and
2026-08-06 — this only ever ran on a laptop, and stopped when that process
did, leaving the table 2.5M blocks behind the chain.

In the Railway dashboard, on the same project:

1. **New** → **GitHub Repo** → `wicktg/saylis`.
2. **Settings → Source → Root Directory:** `indexer`. This is the step
   that makes it this service rather than the web app — it points the
   build at `indexer/package.json`, whose `start` script is
   `generate-curve-addresses && ponder start`.
3. **Variables:** every one from `.env.local.example`. `DATABASE_SCHEMA`
   must be set — `ponder start` refuses to build without it.
4. Deploy. Then confirm it is actually indexing, not just "Online":

```bash
railway logs        # want "Synced block N", not "next start"
```

"Online" only means a process is running. The web app is online too.

Railway must keep this running continuously — Ponder is not a serverless
function, it holds an open connection to the chain. Do not put it on a
schedule or a scale-to-zero plan.

### Confirming it is current, not merely alive

A stalled indexer and a healthy one look identical from the outside. The
honest check compares its own head to the chain's:

```bash
# newest indexed block
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/chain_trades?select=block_number&order=timestamp.desc&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"

# chain head
curl -s -X POST https://rpc.mainnet.chain.robinhood.com \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

Those should be within a few hundred blocks of each other. The frontend
makes the same comparison (`STALE_INDEXER_BLOCKS` in
`app/_lib/useCurveTrades.ts`) and falls back to reading logs when the gap
is wide, so a dead indexer degrades the feed rather than freezing it — but
that fallback is the expensive path this whole component exists to avoid.

## What the frontend changed

`app/_lib/useCurveTrades.ts` now reads history from
`supabase.from("chain_trades")` in a single request instead of thousands of
chunked `eth_getLogs` windows, and the `clampScanRange` truncation no
longer applies on that path — full history comes back regardless of age.
Its return shape (`{ trades, isLoading, error, poolAddress,
historyTruncated }`) is unchanged, so nothing else in the app moved.

Two deliberate details:

- **New trades are PUSHED, not polled.** `indexer.chain_trades` is on the
  Supabase Realtime publication (see `supabase/indexer_realtime.sql`), so
  an INSERT here reaches every open browser in about the time Postgres
  takes to flush the WAL. The 4s `eth_getLogs` tail this used to run is
  gone — it was the app's heaviest consumer of upstream quota.
- **The chain is still read when this component cannot be trusted.** A
  curve with no indexed rows falls back to the chunked backfill (expected
  for a token launched after the address snapshot — see limitation 1
  below), and so does a curve whose newest indexed block trails the chain
  head by more than `STALE_INDEXER_BLOCKS`. The subscription stays up in
  both cases, and the first event to arrive stops the fallback, so
  recovery needs no reload.

`useTokenMarketData.ts` no longer reads contracts from the browser at all.
It calls `/api/market`, which batches every token on screen into one
Multicall3 call server-side and caches it, so a grid costs one read shared
by every visitor rather than seven reads per token per visitor. That route
also gets post-migration pool volume from `chain_trades` here, replacing a
per-token `eth_getLogs` sweep of each pool's whole history.

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
