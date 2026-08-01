-- ---------------------------------------------------------------------
-- Notifications v2: link URLs, admin broadcasts, lifecycle markers
-- ---------------------------------------------------------------------
--
-- Run after notifications_schema.sql, infofi_schema.sql, and schema.sql.
-- Additive and idempotent.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- notifications: optional link (app route or block explorer URL)
-- ---------------------------------------------------------------------

alter table public.notifications
  add column if not exists link_url text;

comment on column public.notifications.link_url is
  'Where this notification links to, if anywhere — an app route (e.g. /campaigns/0x..) or an external URL (e.g. a block explorer tx link). Null for notifications with nothing to click through to.';

-- ---------------------------------------------------------------------
-- registered_wallets: every wallet that has ever connected
-- ---------------------------------------------------------------------
--
-- The audience for admin broadcasts. One row per wallet, written the first
-- time it connects anywhere in the app (see /api/wallets/register). A
-- broadcast pushed today only reaches wallets already in this table at
-- push time — a wallet that registers tomorrow does not retroactively see
-- it, since the broadcast itself is materialised as one notifications row
-- per wallet at push time, not read dynamically against this table later.

create table if not exists public.registered_wallets (
  wallet_address text primary key,
  first_seen_at timestamptz not null default now()
);

comment on table public.registered_wallets is
  'Every wallet that has ever connected. Audience source for admin broadcast notifications — snapshotted at push time, not read live.';

alter table public.registered_wallets enable row level security;
-- No public select/insert policy: written only via /api/wallets/register
-- (service-role), read only by the admin broadcast route.

-- ---------------------------------------------------------------------
-- Lifecycle notification markers — avoid re-notifying every poke run
-- ---------------------------------------------------------------------

alter table public.tokens
  add column if not exists graduated_notified_at timestamptz,
  add column if not exists migrated_notified_at timestamptz;

comment on column public.tokens.graduated_notified_at is
  'Set the first time the poke cron notifies the creator that this token graduated. Prevents re-notifying on every subsequent poke.';
comment on column public.tokens.migrated_notified_at is
  'Set the first time the poke cron notifies the creator that this token migrated to a live pool.';

alter table public.infofi_campaigns
  add column if not exists ended_notified_at timestamptz,
  add column if not exists claim_closed_notified_at timestamptz;

comment on column public.infofi_campaigns.ended_notified_at is
  'Set the first time the poke cron notifies every participant that this campaign''s window closed.';
comment on column public.infofi_campaigns.claim_closed_notified_at is
  'Set the first time the poke cron notifies eligible winners that the claim window closed.';

alter table public.infofi_participants
  add column if not exists first_scored_at timestamptz;

comment on column public.infofi_participants.first_scored_at is
  'Set the first time the daily recompute gives this participant a non-zero score — the moment they actually appear on the leaderboard. Drives the one-time "you made the leaderboard" notification.';
