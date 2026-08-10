/**
 * GET /api/campaigns/mine?wallet=0x…
 *
 * Everything the Campaigns page renders for one wallet: every
 * `infofi_campaigns` row where `owner_wallet` matches, regardless of origin.
 *
 * Built directly from ownership rather than "tokens this wallet launched,
 * then join a campaign onto each" — that used to miss Path B invites for a
 * token this wallet did NOT itself launch, which is now the normal case:
 * the team can invite ANY wallet into a campaign for a token that already
 * exists here, and that wallet needs to see it even though `tokens.
 * creator_wallet_address` points at someone else.
 *
 * Campaign state is read from the MIRROR rather than the chain: this is a
 * list view that may hold dozens of rows, and an RPC round trip each would
 * make the page crawl. The poke job keeps the mirror fresh, and every action
 * the page offers re-checks on-chain before doing anything.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { DEV_MOCKS, MOCK_MY_CAMPAIGNS } from "@/app/_lib/devMocks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // DELIBERATELY UNSIGNED, unlike the admin queue route this otherwise
  // resembles. It runs on every /campaigns page load, so a signature here
  // would be a wallet prompt on navigation — and unlike the admin queue,
  // what it exposes is one wallet's own campaign list, not the whole review
  // pipeline. Read-only, address-scoped, and grants nothing.
  //
  // If this should become private, the right fix is a short-lived session
  // (sign once on connect, reuse for reads) rather than a per-request
  // signature — see the audit report.
  const wallet = new URL(request.url).searchParams.get("wallet")?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: campaigns, error } = await admin
    .from("infofi_campaigns")
    .select("*")
    .eq("owner_wallet", wallet)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load campaigns." }, { status: 500 });
  }

  const tokenAddresses = [...new Set((campaigns ?? []).map((c) => c.token_address))];
  const { data: tokenRows } = tokenAddresses.length
    ? await admin
        .from("tokens")
        .select("contract_address, name, ticker, image_url")
        .in("contract_address", tokenAddresses)
    : { data: [] };
  const tokenByAddress = new Map((tokenRows ?? []).map((t) => [t.contract_address, t]));

  const items = (campaigns ?? []).map((c) => {
    const token = tokenByAddress.get(c.token_address);
    return {
      origin: (c.origin ?? "launched") as "launched" | "post_launch" | "external",
      tokenAddress: c.token_address,
      curveAddress: c.curve_address,
      name: token?.name ?? null,
      ticker: token?.ticker ?? null,
      imageUrl: token?.image_url ?? null,
      state: c.state,
      allocationRaw: c.allocation_raw,
      title: c.title,
      description: c.description,
      winnerCount: c.winner_count,
      approvalStatus: c.approval_status,
      approvalRequestedAt: c.approval_requested_at,
      approvalNote: c.approval_note,
      openedAt: c.opened_at,
      windowEndsAt: c.window_ends_at,
      claimDeadlineAt: c.claim_deadline_at,
      merkleRoot: c.merkle_root,
      lastMcapUsd18: c.last_mcap_usd18,
      invitedAt: c.invited_at,
      reportedAmountRaw: c.reported_amount_raw,
    };
  });

  if (DEV_MOCKS) {
    return NextResponse.json({
      campaigns: [...items, ...MOCK_MY_CAMPAIGNS],
      requests: [],
    });
  }

  return NextResponse.json({ campaigns: items, requests: [] });
}
