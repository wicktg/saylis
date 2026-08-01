-- ---------------------------------------------------------------------
-- Live chat: cooldown tracking ONLY — never message content
-- ---------------------------------------------------------------------
--
-- Run after schema.sql. Additive and idempotent.
--
-- This table exists purely to make the 30-second per-wallet send cooldown
-- enforceable SERVER-SIDE (so refreshing the page can't reset it) — it is
-- one row per wallet, always overwritten in place, never growing.
--
-- Message content itself lives separately, in chat_messages_schema.sql
-- (capped at the last 50 rows) — see that file for why.

create table if not exists public.chat_cooldowns (
  wallet_address text primary key,
  last_sent_at timestamptz not null
);

comment on table public.chat_cooldowns is
  'One row per wallet: when they last sent a chat message. Overwritten in place — never a history table. Enforces the 30s send cooldown server-side.';

alter table public.chat_cooldowns enable row level security;
-- No public select/insert policy: read and written only by
-- /api/chat/send (service-role).
