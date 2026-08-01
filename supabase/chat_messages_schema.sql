-- ---------------------------------------------------------------------
-- Chat messages: capped history (last 50 only)
-- ---------------------------------------------------------------------
--
-- Run after chat_schema.sql. Additive and idempotent.
--
-- Chat still broadcasts live over Supabase Realtime for connected clients
-- (see /api/chat/send) — this table exists ONLY so a page refresh isn't a
-- full wipe: on load, the client hydrates from the last 50 rows here, then
-- keeps listening to the live channel for anything newer. /api/chat/send
-- prunes this table back down to 50 rows after every insert, so it can
-- never grow — the 51st message pushes the oldest out permanently, on
-- both the server and every connected client's own view.

create extension if not exists pgcrypto;

create table if not exists public.chat_messages (
  id uuid primary key,
  wallet_address text not null,
  message text not null,
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is
  'Capped at the 50 most recent rows by /api/chat/send — exists only so a page refresh can rehydrate recent history, not a full chat log.';

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_public_select" on public.chat_messages;
create policy "chat_messages_public_select"
  on public.chat_messages for select
  using (true);

-- Writes are server-only (service-role) via /api/chat/send.
