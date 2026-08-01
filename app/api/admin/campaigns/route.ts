/**
 * GET /api/admin/campaigns?wallet=0x…
 *
 * Two lists for the admin dashboard's Campaigns tab:
 *
 *   pending   campaigns that are eligible on-chain, have title/description
 *             set (so there is something to review), and have not already
 *             been decided. NOT a frontend-controlled flag — every listed
 *             row still gets its on-chain state re-verified before either
 *             admin action executes.
 *   approved  campaigns the team has already approved (approval_status =
 *             'approved'), regardless of what state they've since moved to
 *             (open, settled, burned) — approving is a one-time decision,
 *             not a live status that tracks the campaign's later lifecycle.
 *
 * Gated by `wallet` matching the immutable `team` address — see
 * `INFOFI_TEAM_ADDRESS`. This only hides the queue from the wrong person;
 * it grants no authority (the admin action routes check independently).
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";

export const dynamic = "force-dynamic";

type CampaignRow = {
  token_address: string;
  curve_address: string | null;
  origin: string;
  title: string | null;
  description: string | null;
  winner_count: number | null;
  allocation_raw: string;
  state: string;
  approval_status: string | null;
  approval_requested_at: string | null;
  approval_note: string | null;
  eligible_at: string | null;
  opened_at: string | null;
  last_mcap_usd18: string | null;
  owner_wallet: string | null;
  reported_amount_raw: string | null;
};

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet")?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet is required." }, { status: 400 });
  }
  if (wallet !== INFOFI_TEAM_ADDRESS.toLowerCase()) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const [
    { data: pendingRows, error: pendingError },
    { data: approvedRows, error: approvedError },
    { data: reviewRows, error: reviewError },
  ] = await Promise.all([
    admin
      .from("infofi_campaigns")
      .select("*")
      .eq("state", "eligible")
      .not("title", "is", null)
      .or("approval_status.is.null,approval_status.eq.pending")
      .order("approval_requested_at", { ascending: true, nullsFirst: true }),
    admin
      .from("infofi_campaigns")
      .select("*")
      .eq("approval_status", "approved")
      .order("opened_at", { ascending: false }),
    // Path B pools awaiting the admin's on-chain confirm-and-register step
    // (the creator says they sent supply; the real balance still needs
    // verifying before anything is registered on-chain).
    admin
      .from("infofi_campaigns")
      .select("*")
      .eq("state", "awaiting_review")
      .order("updated_at", { ascending: true }),
  ]);

  if (pendingError || approvedError || reviewError) {
    return NextResponse.json({ error: "Could not load campaigns." }, { status: 500 });
  }

  const allRows: CampaignRow[] = [
    ...(pendingRows ?? []),
    ...(approvedRows ?? []),
    ...(reviewRows ?? []),
  ];
  const tokenAddresses = [...new Set(allRows.map((c) => c.token_address))];
  const ownerWallets = [...new Set(allRows.map((c) => c.owner_wallet).filter(Boolean))] as string[];

  const [{ data: tokenRows }, { data: mcapRows }, { data: launchCounts }] = await Promise.all([
    tokenAddresses.length
      ? admin
          .from("tokens")
          .select("contract_address, name, ticker, image_url, creator_wallet_address, created_at")
          .in("contract_address", tokenAddresses)
      : Promise.resolve({ data: [] }),
    tokenAddresses.length
      ? admin
          .from("infofi_mcap_snapshots")
          .select("token_address, mcap_usd18, sampled_at")
          .in("token_address", tokenAddresses)
          .order("sampled_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    ownerWallets.length
      ? admin.from("tokens").select("creator_wallet_address").in(
          "creator_wallet_address",
          ownerWallets
        )
      : Promise.resolve({ data: [] }),
  ]);

  const tokenByAddress = new Map((tokenRows ?? []).map((t) => [t.contract_address, t]));

  const mcapByToken = new Map<string, { mcapUsd18: string; sampledAt: string }[]>();
  for (const row of mcapRows ?? []) {
    const list = mcapByToken.get(row.token_address) ?? [];
    // Keep the last 30 samples only — plenty for a mini sparkline.
    list.push({ mcapUsd18: row.mcap_usd18, sampledAt: row.sampled_at });
    mcapByToken.set(row.token_address, list.slice(-30));
  }

  const launchCountByWallet = new Map<string, number>();
  for (const row of launchCounts ?? []) {
    const w = row.creator_wallet_address;
    launchCountByWallet.set(w, (launchCountByWallet.get(w) ?? 0) + 1);
  }

  function toItem(c: CampaignRow) {
    const token = tokenByAddress.get(c.token_address);
    return {
      tokenAddress: c.token_address,
      curveAddress: c.curve_address,
      origin: c.origin,
      name: token?.name ?? null,
      ticker: token?.ticker ?? null,
      imageUrl: token?.image_url ?? null,
      launchedAt: token?.created_at ?? null,
      title: c.title,
      description: c.description,
      winnerCount: c.winner_count,
      allocationRaw: c.allocation_raw,
      state: c.state,
      approvalStatus: c.approval_status,
      approvalRequestedAt: c.approval_requested_at,
      approvalNote: c.approval_note,
      eligibleAt: c.eligible_at,
      openedAt: c.opened_at,
      lastMcapUsd18: c.last_mcap_usd18,
      mcapHistory: mcapByToken.get(c.token_address) ?? [],
      reportedAmountRaw: c.reported_amount_raw,
      owner: {
        wallet: c.owner_wallet,
        tokensLaunched: c.owner_wallet
          ? launchCountByWallet.get(c.owner_wallet) ?? 0
          : 0,
      },
    };
  }

  return NextResponse.json({
    pending: (pendingRows ?? []).map(toItem),
    approved: (approvedRows ?? []).map(toItem),
    awaitingReview: (reviewRows ?? []).map(toItem),
  });
}
