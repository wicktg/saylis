/**
 * POST /api/campaigns/[token]/lock
 *
 * Path B, step 3: the creator has already sent their agreed token supply
 * directly to the InfoFiCampaign contract address (a plain ERC-20
 * transfer — nothing signed through this app). This route just records
 * that they say they've done it, together with title/description/cohort
 * size, and flags the campaign for admin review.
 *
 * Nothing on-chain happens here. `reported_amount_raw` is the creator's own
 * claim and is NEVER trusted for anything on-chain — the admin dashboard
 * reads the real contract balance directly before registering anything
 * (see /api/admin/campaigns/[token]/confirm-lock).
 *
 * Only callable on a campaign the team has already invited this wallet
 * into (`state='invited'`, `owner_wallet` matching the caller) — there is
 * no self-service path to reach this state anymore.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";
import { notify } from "@/app/_lib/infofi/notify";

export const dynamic = "force-dynamic";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const MIN_WINNERS = 25;
const MAX_WINNERS = 100;
const WINNER_STEP = 5;

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token?.toLowerCase();
  if (!token || !isAddress(token)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  let body: {
    walletAddress?: string;
    title?: string;
    description?: string;
    winnerCount?: number;
    reportedAmount?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const wallet = body.walletAddress?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";
  const description = body.description?.trim() ?? "";
  const winnerCount = Number(body.winnerCount);
  const reportedAmount = body.reportedAmount?.trim() ?? "";

  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json(
      { error: `Title is required (max ${TITLE_MAX} characters).` },
      { status: 400 }
    );
  }
  if (!description || description.length > DESCRIPTION_MAX) {
    return NextResponse.json(
      { error: `Description is required (max ${DESCRIPTION_MAX} characters).` },
      { status: 400 }
    );
  }
  if (
    !Number.isInteger(winnerCount) ||
    winnerCount < MIN_WINNERS ||
    winnerCount > MAX_WINNERS ||
    winnerCount % WINNER_STEP !== 0
  ) {
    return NextResponse.json(
      {
        error: `Winner count must be a whole number from ${MIN_WINNERS} to ${MAX_WINNERS}, in steps of ${WINNER_STEP}.`,
      },
      { status: 400 }
    );
  }
  let reportedAmountRaw: bigint;
  try {
    reportedAmountRaw = BigInt(reportedAmount);
    if (reportedAmountRaw <= 0n) throw new Error();
  } catch {
    return NextResponse.json(
      { error: "Enter how much supply you sent, in base units." },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  const { data: campaign } = await admin
    .from("infofi_campaigns")
    .select("token_address, owner_wallet, state")
    .eq("token_address", token)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "No invite exists for this token." }, { status: 404 });
  }
  if (String(campaign.owner_wallet ?? "").toLowerCase() !== wallet) {
    return NextResponse.json(
      { error: "This campaign was not invited to your wallet." },
      { status: 403 }
    );
  }
  if (campaign.state !== "invited") {
    return NextResponse.json(
      { error: `This campaign is '${campaign.state}', not awaiting a supply submission.` },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("infofi_campaigns")
    .update({
      state: "awaiting_review",
      title,
      description,
      winner_count: winnerCount,
      reported_amount_raw: reportedAmountRaw.toString(),
      updated_at: nowIso,
    })
    .eq("token_address", token);

  if (error) {
    return NextResponse.json({ error: "Could not submit for review." }, { status: 500 });
  }

  const { data: tokenRow } = await admin
    .from("tokens")
    .select("ticker")
    .eq("contract_address", token)
    .maybeSingle();
  await notify(admin, {
    walletAddress: INFOFI_TEAM_ADDRESS,
    type: "supply_sent",
    tokenAddress: token,
    title: "Supply sent for review",
    body: `${tokenRow?.ticker ?? token}'s creator reports sending supply for their InfoFi pool. Verify the balance and confirm.`,
    linkUrl: "/admin",
  });

  return NextResponse.json({ submitted: true, tokenAddress: token, title, winnerCount });
}
