-- Read-only views exposing the Ponder indexer's tables to the frontend.
--
-- WHY VIEWS AND NOT JUST WRITING INTO public
--
-- The indexer (see indexer/) is a separate Ponder process that owns its
-- tables outright: it creates them, migrates them, and reserves the right
-- to drop and rebuild them on a schema change. Pointing it at `public`
-- would have put that under the same roof as every production table this
-- app has -- tokens, registered_wallets, notifications, chat_messages and
-- the rest -- and Ponder's documentation does not state what it does to
-- tables in its schema that it did not create. Not a risk worth taking
-- with live data to save two views.
--
-- So Ponder writes into a dedicated `indexer` schema (set via
-- DATABASE_SCHEMA in indexer/.env.local), and these views project it into
-- `public`, which is the only schema Supabase's PostgREST exposes by
-- default. The frontend therefore keeps the plain
-- `supabase.from("chain_trades")` call that indexer/ponder.schema.ts was
-- written for -- no `.schema()` qualifier, no client changes.
--
-- SECURITY POSTURE
--
-- These are ordinary (security-definer) views, so a reader needs no
-- privileges on the `indexer` schema itself -- only SELECT on the view.
-- SELECT is granted to `anon` and `authenticated`; nothing is granted to
-- INSERT/UPDATE/DELETE. `curve_status` is a view over a single table with
-- no WHERE clause, which Postgres makes auto-updatable, so those revokes
-- are load-bearing rather than decorative. (`chain_trades` casts columns
-- and so is not auto-updatable, but it is revoked identically rather than
-- relying on that as a security boundary.) Every row here is public
-- on-chain data that anyone can already read from an RPC node, so exposing
-- it for read is correct; allowing writes would let a client forge trade
-- history.
--
-- WHY THE WEI COLUMNS ARE CAST TO text
--
-- Ponder stores these as numeric(78,0), and PostgREST serializes numeric as
-- an UNQUOTED JSON number. `tokens_wei` for a real trade here is
-- 184781706545052039848055 -- far past Number.MAX_SAFE_INTEGER -- so
-- JSON.parse silently rounds it to 1.8478170654505204e+23 in the browser,
-- destroying the exact value before any application code can see it, and
-- BigInt() on the result then throws. Casting to text in the view means the
-- client receives "184781706545052039848055" and BigInt() round-trips it
-- exactly, which is the same guarantee the old eth_getLogs path had.
--
-- Run this AFTER the indexer has started once, since it must have created
-- indexer.chain_trades and indexer.curve_status first.

-- Idempotent: safe to re-run after an indexer schema change.
drop view if exists public.chain_trades;
drop view if exists public.curve_status;

create view public.chain_trades as
  select
    id,
    token_address,
    curve_address,
    pool_address,
    type,
    venue,
    wallet,
    eth_wei::text       as eth_wei,
    tokens_wei::text    as tokens_wei,
    price_wei::text     as price_wei,
    spot_price_wei::text as spot_price_wei,
    block_number::text  as block_number,
    timestamp
  from indexer.chain_trades;

create view public.curve_status as
  select * from indexer.curve_status;

-- Read-only, for both the anonymous and logged-in PostgREST roles.
revoke all on public.chain_trades from anon, authenticated;
revoke all on public.curve_status from anon, authenticated;

grant select on public.chain_trades to anon, authenticated;
grant select on public.curve_status to anon, authenticated;

comment on view public.chain_trades is
  'Read-only projection of indexer.chain_trades, written by the Ponder indexer in indexer/. Do not write to this or to the underlying table from the app.';
comment on view public.curve_status is
  'Read-only projection of indexer.curve_status, written by the Ponder indexer in indexer/. Do not write to this or to the underlying table from the app.';
