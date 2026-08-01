-- ---------------------------------------------------------------------
-- Notifications: profile dropdown bell
-- ---------------------------------------------------------------------
--
-- Run after the other schema files. Additive and idempotent.
--
-- Written server-side only (poke job, admin approve/reject routes) — there
-- is no public write policy, since a wallet must never be able to write
-- into another wallet's notification feed.

create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  -- eligible | approved | rejected | (room to grow: settled, claim_ready, ...)
  type text not null,
  token_address text,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_wallet_idx
  on public.notifications (wallet_address, created_at desc);
create index if not exists notifications_wallet_unread_idx
  on public.notifications (wallet_address) where read_at is null;

alter table public.notifications enable row level security;
-- No public select/insert policy: read via /api/notifications (service-role,
-- filtered by wallet), written only by trusted server jobs.

comment on table public.notifications is
  'Per-wallet notification feed for the profile dropdown bell. Server-written only.';
