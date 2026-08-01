-- ---------------------------------------------------------------------
-- Campaigns: finalized two-path design
-- ---------------------------------------------------------------------
--
-- Run AFTER supabase/campaigns_schema.sql. Additive and idempotent.
--
-- Supersedes the "apply as an external project" flow with two paths, both
-- for tokens that exist inside loxley:
--
--   PATH A  pre-mint allocation. Creator reserves 0-5% of supply in
--           BondingCurve's constructor; nothing else. Title/description/
--           cohort size are NULL until the token becomes eligible
--           (currently: hits graduation) — only then does the creator fill
--           them in and submit for approval.
--
--   PATH B  post-launch buy+lock. Creator buys supply off their own token's
--           curve, transfers it to InfoFiCampaign, and calls
--           `registerExternalPool(token, amount, curve)` naming the real
--           curve — verified on-chain, so it earns eligibility exactly like
--           Path A. Title/description/cohort are set immediately, in the
--           SAME flow, since the creator already has full context.
--
-- `origin` values: 'launched' (Path A) | 'post_launch' (Path B) |
-- 'external' (the old true-external case — curve intentionally left zero on
-- registerExternalPool; no longer reachable from the UI, kept for the
-- contract's own backward compatibility).

alter table public.infofi_campaigns
  add column if not exists title text,
  add column if not exists description text;

comment on column public.infofi_campaigns.title is
  'Campaign title. NULL for Path A until eligibility triggers; set immediately at lock time for Path B.';
comment on column public.infofi_campaigns.description is
  'Campaign description, same null-until-eligible rule as title.';

-- 'post_launch' extends the origin values `campaigns_schema.sql` created;
-- the column has no CHECK constraint to widen, so this is a comment-only
-- migration marking the new value as valid.
comment on column public.infofi_campaigns.origin is
  'launched = pre-mint InfoFi allocation (Path A) | post_launch = buy+lock of a loxley token (Path B) | external = true external pool (legacy, unused by the UI)';

-- ---------------------------------------------------------------------
-- Market-cap history, for the admin dashboard's mini-chart
-- ---------------------------------------------------------------------
-- One row per poke. Small and append-only on purpose: the chart only ever
-- needs the last N points, and nothing here is authoritative — the chain
-- (`campaign.aboveSince`, `graduated()`) is what actually decides
-- eligibility. This is telemetry for a human reviewer, nothing more.

create table if not exists public.infofi_mcap_snapshots (
  id uuid primary key default gen_random_uuid(),
  token_address text not null,
  mcap_usd18 text not null,
  sampled_at timestamptz not null default now()
);

create index if not exists infofi_mcap_snapshots_token_idx
  on public.infofi_mcap_snapshots (token_address, sampled_at desc);

alter table public.infofi_mcap_snapshots enable row level security;
drop policy if exists "infofi_mcap_snapshots_public_select" on public.infofi_mcap_snapshots;
create policy "infofi_mcap_snapshots_public_select"
  on public.infofi_mcap_snapshots for select using (true);

-- Keep the table small: snapshots older than 60 days serve no purpose once
-- a campaign has settled or burned. Run manually or wire into the cron;
-- not required for the feature to work, just table hygiene.
comment on table public.infofi_mcap_snapshots is
  'Append-only mcap samples captured by the poke job, for the admin dashboard mini-chart. Not authoritative — the chain decides eligibility.';
