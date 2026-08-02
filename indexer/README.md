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
npm run dev
```

`npm run dev` first regenerates `addresses.generated.json` from Supabase's
`tokens` table, then starts Ponder against a local dev database. Ponder's
own dashboard (usually `http://localhost:42069`) shows indexing progress
and lets you query the tables directly while it backfills.

## What each env var is

See `.env.local.example` for the full list and where to find each value.
The one most likely to trip you up: `SUPABASE_DB_URL` is the **direct
Postgres connection string** (Settings → Database → Connection string →
URI in the Supabase dashboard), not the `NEXT_PUBLIC_SUPABASE_URL` +
anon-key pair the Next.js app uses elsewhere — those go through
PostgREST, and Ponder needs a real `postgres://` connection with write
access.

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

## What the frontend needs to change

Nothing about the table SHAPE — `ponder.schema.ts`'s `chain_trades` table
mirrors `app/_lib/useCurveTrades.ts`'s existing `Trade` type field-for-field
on purpose. The actual swap is in `useCurveTrades.ts` and
`useTokenMarketData.ts`: replace the `eth_getLogs`/`chunkedLogs.ts` calls
with a `supabase.from("chain_trades").select(...)` query, keeping each
hook's external return shape (`{ trades, isLoading, error, poolAddress }`)
identical so nothing else in the app has to change. **This swap has not
been made yet** — this indexer exists and can be run, but the frontend is
still reading from RPC until that follow-up lands.

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

3. **Not yet run end-to-end.** This was built and reasoned through against
   Ponder's current documented config/schema/indexing-function APIs, but
   has not been executed against a real Supabase Postgres connection in
   this environment (that needs real credentials this session was not
   given, deliberately). Run `npm run dev` locally and watch Ponder's own
   dashboard before deploying to Railway.
