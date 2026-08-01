-- ---------------------------------------------------------------------
-- Live chat: cooldown tracking ONLY — never message content
-- ---------------------------------------------------------------------
--
-- Run after schema.sql. Additive and idempotent.
--
-- Chat itself is intentionally NOT a database table: messages broadcast
-- live over a Supabase Realtime channel (see /api/chat/send) and are never
-- written to persistent storage. A client only ever sees messages sent
-- while it was connected, capped at the last 50 in memory — there is no
-- server-side history to query, by design.
--
-- This table exists purely to make the 30-second per-wallet send cooldown
-- enforceable SERVER-SIDE (so refreshing the page can't reset it) — it is
-- one row per wallet, always overwritten in place, never growing.

create table if not exists public.chat_cooldowns (
  wallet_address text primary key,
  last_sent_at timestamptz not null
);

comment on table public.chat_cooldowns is
  'One row per wallet: when they last sent a chat message. Overwritten in place — never a history table. Enforces the 30s send cooldown server-side.';

alter table public.chat_cooldowns enable row level security;
-- No public select/insert policy: read and written only by
-- /api/chat/send (service-role).
