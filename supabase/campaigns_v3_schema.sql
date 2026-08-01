-- ---------------------------------------------------------------------
-- Campaigns: Path B becomes admin-gated (invite -> send -> confirm)
-- ---------------------------------------------------------------------
--
-- Run AFTER campaigns_v2_schema.sql. Additive and idempotent.
--
-- Path B no longer lets any creator self-serve a buy+lock flow. The new
-- sequence:
--
--   1. Creator talks to the team off-platform (Telegram: @valor0x).
--   2. Admin "invites" a specific wallet for a specific token — a row with
--      state='invited' appears, visible ONLY to that wallet. No tokens
--      have moved yet.
--   3. The creator sends the agreed supply directly to the InfoFiCampaign
--      contract address (a plain ERC-20 transfer, not a buy), and submits
--      title/description/cohort size + how much they say they sent.
--      state -> 'awaiting_review'.
--   4. The admin verifies the REAL on-chain balance (never trusts the
--      creator's reported figure), then calls `registerExternalPool`
--      themselves. Once that lands, the poke job's normal sync takes over
--      and state becomes whatever the chain reports ('registered', then
--      'eligible' once graduation hits, exactly like every other pool).
--
-- `state` has never been a CHECK-constrained enum in this schema — it is
-- free text mirroring the on-chain enum PLUS these two off-chain-only
-- values that exist before anything is on-chain at all: 'invited',
-- 'awaiting_review'.

alter table public.infofi_campaigns
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by text,
  -- Creator's own claim of how much they sent, entered at submission time.
  -- NEVER trusted for the on-chain call — the admin dashboard reads the
  -- real contract balance directly. Kept only so the admin has a number to
  -- cross-check against, and so a mismatch is visible rather than silent.
  add column if not exists reported_amount_raw text;

comment on column public.infofi_campaigns.invited_at is
  'When the team granted this wallet visibility into a Path B campaign for this token.';
comment on column public.infofi_campaigns.invited_by is
  'Team wallet that issued the invite.';
comment on column public.infofi_campaigns.reported_amount_raw is
  'Creator-reported "I sent this much" figure. Unverified — the admin dashboard reads the real on-chain balance before registering anything.';
