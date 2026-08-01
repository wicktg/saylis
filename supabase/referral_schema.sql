-- ---------------------------------------------------------------------
-- Referral codes
-- ---------------------------------------------------------------------
--
-- Run after schema.sql. Additive and idempotent.
--
-- The actual referral relationship (who referred whom) lives entirely
-- on-chain in ReferralVault — it's what BondingCurve reads at deploy time
-- to wire a creator's fee-split cut, so it HAS to be on-chain to matter.
-- This table only maps a short, shareable CODE to the wallet it belongs
-- to, so a referral link doesn't have to be a raw 42-character address.
-- Resolving a code back to a wallet (see /api/referral/resolve) is what
-- actually feeds the on-chain `registerReferral(referrer)` call.

create extension if not exists pgcrypto;

create table if not exists public.referral_codes (
  wallet_address text primary key,
  code text not null unique,
  created_at timestamptz not null default now()
);

comment on table public.referral_codes is
  'One short shareable code per wallet, generated on first connect. Maps to a wallet for building /?ref=CODE links; the actual referral relationship is on-chain in ReferralVault.';

create index if not exists referral_codes_code_idx on public.referral_codes (code);

alter table public.referral_codes enable row level security;

drop policy if exists "referral_codes_public_select" on public.referral_codes;
create policy "referral_codes_public_select"
  on public.referral_codes for select
  using (true);

-- Writes are server-only (service-role) via /api/referral/ensure.
