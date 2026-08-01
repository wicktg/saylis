-- loxley.wtf off-chain data layer.
--
-- Wallet address is the sole identity key across the app — there is no
-- Supabase Auth / users table. Every record's owner is just the connected
-- wallet's address, stored as plain text. This means writes are NOT
-- cryptographically tied to actual wallet ownership (that would require
-- verifying a signed message server-side, which is out of scope here) —
-- consistent with "no separate user table/auth" in the spec, but worth
-- knowing: the anon key can insert rows for any wallet address it likes.
-- In practice this is low-risk today since a token row is only ever
-- written immediately after a real on-chain deployment (which costs real
-- gas), but if spam becomes a problem later, tighten `tokens_insert` to
-- go through a server route that verifies a wallet signature first.

create extension if not exists pgcrypto;

create table if not exists public.tokens (
  
  id uuid primary key default gen_random_uuid(),
  contract_address text not null unique,
  curve_address text not null unique,
  creator_wallet_address text not null,
  name text not null,
  ticker text not null,
  description text,
  socials jsonb not null default '{}'::jsonb,
  image_url text,
  created_at timestamptz not null default now()
);

comment on column public.tokens.contract_address is 'ImmutableLaunchToken address (lowercase)';
comment on column public.tokens.curve_address is 'BondingCurve address (lowercase)';
comment on column public.tokens.creator_wallet_address is 'Connected wallet that launched this token (lowercase) — the sole identity key';
comment on column public.tokens.image_url is 'ipfs:// URI (pinned via Pinata) — resolved to an https gateway URL at render time, never stored as https here';

create index if not exists tokens_creator_wallet_address_idx
  on public.tokens (creator_wallet_address);

create index if not exists tokens_created_at_idx
  on public.tokens (created_at desc);

alter table public.tokens enable row level security;

-- Public read: the token grid, trending panel, and My Tokens modal all
-- read through the anon key with no session/auth of any kind.
drop policy if exists "tokens_public_select" on public.tokens;
create policy "tokens_public_select"
  on public.tokens for select
  using (true);

-- Public insert: see the note at the top of this file re: no signature
-- verification. Anyone holding the anon key can insert a row, same as any
-- other unauthenticated public table.
drop policy if exists "tokens_public_insert" on public.tokens;
create policy "tokens_public_insert"
  on public.tokens for insert
  with check (true);

-- No update/delete policies: token records are treated as immutable once
-- created, mirroring the immutability of the on-chain contracts they
-- describe.

-- Enable Realtime so the token grid updates live as rows are inserted,
-- without a manual refresh.
alter publication supabase_realtime add table public.tokens;


-- ---------------------------------------------------------------------
-- X (Twitter) account bindings
-- ---------------------------------------------------------------------
--
-- Maps a wallet to an X account, ONE TIME and PERMANENTLY — there is
-- deliberately no disconnect flow.
--
-- Unlike `tokens` above, this table does NOT get a public insert policy,
-- and the difference matters: a `tokens` row costs real gas to fake and can
-- be superseded, whereas a binding here is unrevocable. If the anon key
-- could write, anyone could permanently squat any wallet's X identity with
-- no way to undo it. Writes therefore go only through /api/x/callback using
-- the service-role key, after that route has verified BOTH a wallet
-- signature (proving wallet ownership) and a completed X OAuth exchange
-- (proving X ownership).

create table if not exists public.x_accounts (
  wallet_address text primary key,
  x_user_id text not null unique,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.x_accounts is 'Permanent, one-time wallet <-> X bindings. Server-write only.';
comment on column public.x_accounts.wallet_address is 'Connected wallet (lowercase) — one binding per wallet, enforced by the PK';
comment on column public.x_accounts.x_user_id is 'X numeric user id — unique, so one X account cannot bind to two wallets';
comment on column public.x_accounts.avatar_url is 'X profile image URL. Only pfp + username are stored; no tokens, email, or posts.';

alter table public.x_accounts enable row level security;

-- Public read: the profile dropdown renders the pfp/username for the
-- connected wallet, unauthenticated like everything else here.
drop policy if exists "x_accounts_public_select" on public.x_accounts;
create policy "x_accounts_public_select"
  on public.x_accounts for select
  using (true);

-- No insert/update/delete policies at all. The service-role key bypasses
-- RLS, so /api/x/verify/confirm can still write; the anon key cannot,
-- which is exactly the intent.


-- ---------------------------------------------------------------------
-- X (Twitter) bio-code verification — pending attempts
-- ---------------------------------------------------------------------
--
-- Ownership of an X account is proven by asking the user to paste a random
-- code into their own bio, then checking for it via a read-only public API
-- (twitterapi.io) — no password, no OAuth. This table holds the in-flight
-- code while the user edits their bio; `x_accounts` (below, pre-existing)
-- is only written once the code is confirmed present.
--
-- One row per wallet (starting again overwrites any unconfirmed attempt).
-- No public policies at all: only the server (service-role key) ever
-- reads or writes this table, via /api/x/verify/start and .../confirm.

create table if not exists public.x_verification_attempts (
  wallet_address text primary key,
  username text not null,
  code text not null,
  created_at timestamptz not null default now()
);

comment on table public.x_verification_attempts is 'In-flight bio-code challenges. Server-only, no public RLS policies.';

alter table public.x_verification_attempts enable row level security;
-- Deliberately no policies: RLS with zero policies denies all access to
-- the anon/authenticated roles, leaving only the service-role key (which
-- bypasses RLS entirely) able to touch this table.
