-- ---------------------------------------------------------------------
-- Campaigns page: requests, approvals, airdrop sizing
-- ---------------------------------------------------------------------
--
-- Run AFTER supabase/infofi_schema.sql. Additive and idempotent.
--
-- Two routes reach the Campaigns page, and they need different records:
--
--   EXTERNAL  a project that launched somewhere else applies with its CA and
--             socials. The team reviews the application, then creates the
--             campaign shell. The project funds the pool and opens its own
--             window. `campaign_requests` is that application.
--
--   LAUNCHED  a token minted here with an InfoFi allocation already has an
--             on-chain pool from block one. It needs no application, only an
--             approval request once it meets the eligibility bar. That is
--             tracked on `infofi_campaigns` itself.
--
-- Custody still lives entirely on-chain. Nothing in this file can move,
-- open, or settle a pool.

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- Applications from external projects
-- ---------------------------------------------------------------------

create table if not exists public.campaign_requests (
  id uuid primary key default gen_random_uuid(),
  -- Wallet that applied. Also the wallet the resulting campaign is shown
  -- to, and the one that must own the on-chain pool.
  wallet_address text not null,
  project_name text not null,
  -- Contract address of a token that launched ELSEWHERE. Not a foreign key
  -- to public.tokens for exactly that reason.
  contract_address text not null,
  description text not null,
  x_handle text,
  website text,
  email text not null,
  -- submitted | approved | rejected
  status text not null default 'submitted',
  -- Free-text note from the team, surfaced to the applicant on rejection so
  -- a "no" is actionable rather than silent.
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- One live application per wallet+token. A resubmission after rejection
  -- is handled by the team clearing the row, not by stacking duplicates.
  unique (wallet_address, contract_address)
);

comment on table public.campaign_requests is
  'Applications from projects that launched elsewhere. Team review gate before an external campaign shell is created.';
comment on column public.campaign_requests.contract_address is
  'Token that launched elsewhere — deliberately NOT a reference to public.tokens';

create index if not exists campaign_requests_wallet_idx
  on public.campaign_requests (wallet_address);
create index if not exists campaign_requests_status_idx
  on public.campaign_requests (status, created_at desc);

alter table public.campaign_requests enable row level security;

-- Applicants read their own row through the API (service-role), which
-- filters by wallet. No public select: applications carry an email address
-- and should not be world-readable.


-- ---------------------------------------------------------------------
-- Campaign ownership, approval requests, airdrop sizing
-- ---------------------------------------------------------------------
--
-- Added to infofi_campaigns rather than a side table so a campaign is one
-- row wherever it came from.

alter table public.infofi_campaigns
  -- Wallet the campaign is rendered to. For a launched token this is the
  -- creator; for an external one, the applicant.
  add column if not exists owner_wallet text,
  -- 'launched' (curve-backed, minted here) or 'external' (applied for).
  add column if not exists origin text not null default 'launched',
  -- Links an external campaign back to the application that created it.
  add column if not exists request_id uuid references public.campaign_requests (id),
  -- Set when the developer presses "Submit for Approval". The team watches
  -- for these; clearing it back to null is how a rejection is expressed.
  add column if not exists approval_requested_at timestamptz,
  -- pending | approved | rejected, only meaningful once requested.
  add column if not exists approval_status text,
  add column if not exists approval_note text,
  -- How many wallets share the pool. 25-100, multiples of 5 — enforced by
  -- the check below so a bad value cannot reach the merkle build.
  add column if not exists winner_count integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'infofi_campaigns_winner_count_ck'
  ) then
    alter table public.infofi_campaigns
      add constraint infofi_campaigns_winner_count_ck
      check (
        winner_count is null
        or (winner_count between 25 and 100 and winner_count % 5 = 0)
      );
  end if;
end $$;

comment on column public.infofi_campaigns.owner_wallet is
  'The developer this campaign is rendered to. Not an authority — on-chain roles are what actually gate anything.';
comment on column public.infofi_campaigns.winner_count is
  'Wallets sharing the pool: 25-100 in steps of 5. Caps the merkle tree size at settle time.';
comment on column public.infofi_campaigns.origin is
  'launched = curve-backed InfoFi allocation; external = applied for and funded directly';

create index if not exists infofi_campaigns_owner_idx
  on public.infofi_campaigns (owner_wallet);
create index if not exists infofi_campaigns_approval_idx
  on public.infofi_campaigns (approval_status, approval_requested_at desc);
