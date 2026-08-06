-- Trades, captured from Alchemy webhooks instead of a polling indexer.
--
-- Run this ONCE. It replaces the indexer/ + indexer_views.sql +
-- indexer_realtime.sql arrangement entirely.
--
-- WHY THIS REPLACED PONDER
--
-- The old design needed a process that never stops. That requirement, not
-- the indexing itself, produced every operational failure this project has
-- had: an indexer that was never deployed and left the table four days
-- stale while the site looked healthy, then a crash loop, then a Postgres
-- connection that worked from a laptop and not from the host.
--
-- A webhook has no such requirement. Alchemy calls /api/webhooks/alchemy
-- when a trade happens; that route is up because the site is up. What used
-- to be a service to keep alive is now a table and a POST handler.
--
-- WHY THE WEI COLUMNS ARE numeric AND THE VIEW CASTS THEM TO text
--
-- tokens_wei for a real trade here is 184781706545052039848055 — far past
-- Number.MAX_SAFE_INTEGER. PostgREST serializes numeric as an unquoted JSON
-- number, so JSON.parse silently rounds it before any application code can
-- see it, and BigInt() on the result throws. numeric keeps it exact in the
-- database and lets Postgres sum it; the view's ::text casts keep it exact
-- across the wire. Both are load-bearing.

create table if not exists public.trades (
  -- `${txHash}-${logIndex}`. Unique per log, which is what makes a webhook
  -- retry — and Alchemy does retry — a no-op rather than a duplicate trade.
  id              text primary key,

  token_address   text        not null,
  curve_address   text        not null,
  pool_address    text,

  type            text        not null check (type in ('buy', 'sell')),
  venue           text        not null check (venue in ('curve', 'pool')),
  wallet          text        not null,

  eth_wei         numeric(78,0) not null,
  tokens_wei      numeric(78,0) not null,
  -- Realized price: what the trader actually got, slippage and fee included.
  price_wei       numeric(78,0) not null,
  -- Marginal price immediately after the trade. This is what the chart
  -- plots; `price_wei` is what the feed shows. Charting the realized price
  -- prints a fee-sized sawtooth that is not price movement.
  spot_price_wei  numeric(78,0),

  block_number    bigint      not null,
  -- Unix seconds. Block timestamps on this chain are second-granularity
  -- despite ~100ms blocks, so this is as fine as the chain gets.
  timestamp       integer     not null,

  inserted_at     timestamptz not null default now()
);

-- Addresses are stored lowercased by the webhook handler, so plain equality
-- is correct and these indexes are usable. The old table needed `ilike`
-- because two writers disagreed about case.
create index if not exists trades_curve_idx  on public.trades (curve_address, timestamp);
create index if not exists trades_token_idx  on public.trades (token_address, timestamp);
create index if not exists trades_block_idx  on public.trades (block_number);
create index if not exists trades_pool_idx   on public.trades (pool_address) where pool_address is not null;

-- Which curves have graduated, and to which pool. Written when a Migrated
-- event arrives; read to attribute pool Swap events back to a curve.
create table if not exists public.curve_pools (
  curve_address text primary key,
  token_address text not null,
  pool_address  text not null,
  migrated_at   timestamptz not null default now()
);
create index if not exists curve_pools_pool_idx on public.curve_pools (pool_address);

-- Read-only for the browser. Writes come from the webhook route via the
-- service-role key, which bypasses RLS — so there is no policy for them,
-- and a client cannot forge trade history.
alter table public.trades      enable row level security;
alter table public.curve_pools enable row level security;

drop policy if exists "trades_public_select" on public.trades;
create policy "trades_public_select" on public.trades for select using (true);

drop policy if exists "curve_pools_public_select" on public.curve_pools;
create policy "curve_pools_public_select" on public.curve_pools for select using (true);

-- The exact-value projection the frontend reads. See the note above on why
-- every wei column is cast.
drop view if exists public.trades_exact;
create view public.trades_exact as
  select
    id,
    token_address,
    curve_address,
    pool_address,
    type,
    venue,
    wallet,
    eth_wei::text        as eth_wei,
    tokens_wei::text     as tokens_wei,
    price_wei::text      as price_wei,
    spot_price_wei::text as spot_price_wei,
    block_number::text   as block_number,
    -- Also exposed unquoted, because it is safely inside 2^53 and a numeric
    -- comparison is what cursor queries need. Ordering on the text column
    -- would be lexicographic, which puts "9999999" after "10000001".
    block_number         as block_num,
    timestamp
  from public.trades;

revoke all on public.trades_exact from anon, authenticated;
grant select on public.trades_exact to anon, authenticated;

-- Push. Ponder's INSERT used to reach browsers this way and the webhook's
-- does the same, so the frontend's subscription is unchanged apart from the
-- table it names.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trades'
  ) then
    alter publication supabase_realtime add table public.trades;
  end if;
end
$$;

comment on table public.trades is
  'Captured from Alchemy webhooks by app/api/webhooks/alchemy. Read through public.trades_exact — the ::text casts there are what keep wei values exact over PostgREST. Gaps are repaired by app/api/cron/reconcile.';
