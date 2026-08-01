-- ---------------------------------------------------------------------
-- InfoFi campaigns — off-chain layer
-- ---------------------------------------------------------------------
--
-- Run this AFTER supabase/schema.sql. It is additive and idempotent.
--
-- The on-chain `InfoFiCampaign` singleton is the source of truth for
-- everything custodial: pool size, campaign state, the merkle root, and
-- burns. This schema exists only for what is not knowable on-chain — who
-- joined, what they posted, and how much attention it earned.
--
-- Nothing here can move tokens. A row in `infofi_allocations` is an
-- assertion about what the merkle root SHOULD contain; the root itself is
-- published on-chain by the team, and the contract caps every claim against
-- its own accounting no matter what this database says.

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- Campaign mirror
-- ---------------------------------------------------------------------

create table if not exists public.infofi_campaigns (
  token_address text primary key,
  curve_address text not null,
  -- Mirrors InfoFiCampaign.State:
  -- registered | eligible | open | settled | burned
  state text not null default 'registered',
  allocation_raw text not null,
  eligible_at timestamptz,
  opened_at timestamptz,
  window_ends_at timestamptz,
  claim_deadline_at timestamptz,
  merkle_root text,
  -- Most recent market cap seen by the poker, 18dp USD as text.
  last_mcap_usd18 text,
  last_mcap_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.infofi_campaigns is
  'Off-chain mirror of on-chain InfoFiCampaign state plus indexing metadata. Never authoritative for custody.';
comment on column public.infofi_campaigns.allocation_raw is
  'Pool size in token base units, stored as text because it exceeds the JS Number range';
comment on column public.infofi_campaigns.merkle_root is
  'The root actually published on-chain, once the campaign is settled';

create index if not exists infofi_campaigns_state_idx
  on public.infofi_campaigns (state);

alter table public.infofi_campaigns enable row level security;

drop policy if exists "infofi_campaigns_public_select" on public.infofi_campaigns;
create policy "infofi_campaigns_public_select"
  on public.infofi_campaigns for select
  using (true);

-- Writes are server-only (service-role): this table must track the chain,
-- so nothing client-side may edit it.


-- ---------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------
--
-- joinCampaign() is a frontend action with no wallet signature, so a join
-- is a statement of intent rather than proof of anything on its own. What
-- makes it meaningful is `x_accounts`: the wallet must ALREADY hold a
-- verified wallet-to-X binding (established by the bio-code flow) before it
-- can join, so the handle on a join row is one that wallet demonstrably
-- controls.
--
-- `joined_at` is the scoring cutoff. Only posts and quote-tweets timestamped
-- after this moment count. Replies never count at all.

create table if not exists public.infofi_participants (
  id uuid primary key default gen_random_uuid(),
  token_address text not null
    references public.infofi_campaigns (token_address) on delete cascade,
  wallet_address text not null,
  x_username text not null,
  joined_at timestamptz not null default now(),
  unique (token_address, wallet_address),
  -- One X account per campaign. Without this, one person could join from
  -- several wallets under the same handle and be scored once per wallet.
  unique (token_address, x_username)
);

comment on column public.infofi_participants.joined_at is
  'Scoring cutoff: only posts/quote-tweets after this timestamp are counted';

create index if not exists infofi_participants_token_idx
  on public.infofi_participants (token_address);

alter table public.infofi_participants enable row level security;

drop policy if exists "infofi_participants_public_select" on public.infofi_participants;
create policy "infofi_participants_public_select"
  on public.infofi_participants for select
  using (true);

-- Joins go through /api/infofi/join (service-role), which verifies the
-- x_accounts binding and the campaign state first. No public insert.


-- ---------------------------------------------------------------------
-- Daily mindshare snapshots
-- ---------------------------------------------------------------------
--
-- Append-only by design: the daily recompute INSERTS one row per
-- participant per day and never updates a previous one. That is what makes
-- a delta like "14.2 mindshare, up 3.1" a real historical comparison rather
-- than a diff against mutable state, and it means a disputed final standing
-- can always be reconstructed from the record.
--
-- mindshare is a share of a fixed 100-point pool:
--
--     raw_score   = views*1 + likes*3 + comments*5 + reposts*4
--     mindshare_i = 100 * raw_i / sum(raw)
--
-- so the column always sums to approximately 100 within a
-- (token_address, snapshot_date) pair.

create table if not exists public.infofi_mindshare_history (
  id uuid primary key default gen_random_uuid(),
  token_address text not null
    references public.infofi_campaigns (token_address) on delete cascade,
  wallet_address text not null,
  x_username text not null,
  snapshot_date date not null,
  rank integer not null,
  -- numeric, not float. This leaderboard decides payouts; binary
  -- floating-point rounding is not acceptable in a column people are paid
  -- from.
  mindshare numeric(9, 4) not null,
  raw_score bigint not null,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  reposts bigint not null default 0,
  post_count integer not null default 0,
  created_at timestamptz not null default now(),
  -- One snapshot per participant per day, so a re-run of the same day's
  -- cron collides here instead of silently double-writing history.
  unique (token_address, wallet_address, snapshot_date)
);

comment on table public.infofi_mindshare_history is
  'Append-only daily leaderboard snapshots. Never updated in place — the previous day row is what change-since-yesterday is measured against.';
comment on column public.infofi_mindshare_history.mindshare is
  'Share of a fixed 100-point pool; sums to approximately 100 per (token, date)';

create index if not exists infofi_mindshare_history_leaderboard_idx
  on public.infofi_mindshare_history (token_address, snapshot_date desc, rank asc);

alter table public.infofi_mindshare_history enable row level security;

drop policy if exists "infofi_mindshare_public_select" on public.infofi_mindshare_history;
create policy "infofi_mindshare_public_select"
  on public.infofi_mindshare_history for select
  using (true);

-- Written only by the daily recompute job (service-role).


-- ---------------------------------------------------------------------
-- Final allocations (merkle leaves)
-- ---------------------------------------------------------------------
--
-- Computed once, when a campaign window closes, from that campaign's final
-- mindshare snapshot. Stored so the frontend can show a claimant their
-- amount and proof. The contract verifies both independently.

create table if not exists public.infofi_allocations (
  id uuid primary key default gen_random_uuid(),
  token_address text not null
    references public.infofi_campaigns (token_address) on delete cascade,
  wallet_address text not null,
  x_username text not null,
  final_mindshare numeric(9, 4) not null,
  amount_raw text not null,
  -- Ordered JSON array of 32-byte hex sibling hashes.
  merkle_proof jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (token_address, wallet_address)
);

comment on column public.infofi_allocations.amount_raw is
  'Token base units as text. Must match the merkle leaf exactly or the on-chain proof fails.';

create index if not exists infofi_allocations_token_idx
  on public.infofi_allocations (token_address);

alter table public.infofi_allocations enable row level security;

drop policy if exists "infofi_allocations_public_select" on public.infofi_allocations;
create policy "infofi_allocations_public_select"
  on public.infofi_allocations for select
  using (true);
