-- Push notification for new trades.
--
-- Run this in the Supabase SQL editor AFTER indexer_views.sql, and re-run
-- BOTH whenever the Ponder indexer recreates its schema — publication
-- membership, grants and policies live on the table, so they go away with it.
--
-- WHY THIS EXISTS
--
-- The token page used to tail new trades by calling eth_getLogs every four
-- seconds, from every open tab, in ~10-block windows (Robinhood Chain caps
-- the range, and at ~100ms blocks four seconds is already ~40 blocks). That
-- is the single largest consumer of upstream RPC quota in the app, it costs
-- ~75 compute units per window, and it still shows a trade up to four
-- seconds late.
--
-- The indexer already sees every one of those trades. All that was missing
-- was a way for it to tell thea browser, so this puts indexer.chain_trades on
-- the Realtime publication: Ponder's INSERT reaches subscribed clients in
-- roughly the time it takes Postgres to flush the WAL, and the polling goes
-- away entirely.
--
-- The browser treats the event only as a DOORBELL and then re-reads the rows
-- through public.chain_trades. That is deliberate: the wei columns are
-- numeric(78,0), and only the view's ::text casts survive a JSON round-trip
-- intact (see indexer_views.sql). Nothing here should be read for its values.

-- Realtime replays changes as the subscribing role, so the role needs to be
-- able to reach the table at all. Granting schema usage does NOT expose it
-- over PostgREST: that is governed separately by the list of exposed schemas,
-- which is `public` only. The read-only views remain the sole REST surface.
grant usage on schema indexer to anon, authenticated;
grant select on indexer.chain_trades to anon, authenticated;

-- Row-level authorization for the subscription. Trades are public data —
-- they are already served to everyone through public.chain_trades — so the
-- policy is a straight allow, and its job is to satisfy Realtime's check
-- rather than to restrict anything.
--
-- This does not affect the indexer. Ponder connects as the role that owns
-- these tables, and ownership bypasses a policy that was not declared FORCE.
alter table indexer.chain_trades enable row level security;

drop policy if exists "chain_trades_public_select" on indexer.chain_trades;
create policy "chain_trades_public_select"
  on indexer.chain_trades
  for select
  using (true);

-- No insert/update/delete policy, on purpose. Writing is the indexer's job.

-- Idempotent: adding a table already in the publication is an error, not a
-- no-op, and this file is meant to be re-runnable after a Ponder redeploy.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'indexer'
      and tablename = 'chain_trades'
  ) then
    alter publication supabase_realtime add table indexer.chain_trades;
  end if;
end
$$;

-- Replica identity is left at its default (primary key) rather than FULL.
-- Only INSERT is subscribed to, and an INSERT's payload carries the whole new
-- row regardless; FULL would just widen every write in the WAL for nothing.

comment on table indexer.chain_trades is
  'Written by the Ponder indexer in indexer/. Read it through public.chain_trades — the ::text casts there are what keep wei values exact. On the Realtime publication so the app can stop polling eth_getLogs; see supabase/indexer_realtime.sql.';
