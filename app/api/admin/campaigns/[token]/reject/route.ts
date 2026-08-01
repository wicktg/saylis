/**
 * POST /api/admin/campaigns/[token]/reject
 *
 * Non-final, off-chain only. Nothing on-chain changes — the campaign stays
 * exactly `eligible` — this only removes it from the review queue and
 * leaves a note for the creator.
 *
 * "Non-final, can re-enter the queue if criteria still met later" (per
 * spec) is satisfied by construction: the creator's own
 * `/api/campaigns/[token]/configure` route already resets
 * `approval_status` back to `pending` on a fresh approval request, and
 * nothing here touches on-chain eligibility — so as long as the token is
 * still `eligible` on-chain, resubmitting is always possible.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";

const AUTH_ACTION = "admin:campaign-reject";
import { notify } from "@/app/_lib/infofi/notify";

export const dynamic = "force-dynamic";

const NOTE_MAX = 500;

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token?.toLowerCase();
  if (!token || !isAddress(token)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  let body: AuthenticatedRequest & { note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Authorize against the signature-recovered address, never the body's
  // self-declared one. See app/_lib/walletAuth.ts.
  const auth = await verifyWalletAuth(body, AUTH_ACTION);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.address.toLowerCase() !== INFOFI_TEAM_ADDRESS.toLowerCase()) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();

  const { data: campaign } = await admin
    .from("infofi_campaigns")
    .select("token_address, state, approval_status, owner_wallet")
    .eq("token_address", token)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "No campaign for this token." }, { status: 404 });
  }
  if (campaign.state !== "eligible") {
    return NextResponse.json(
      { error: `Campaign is '${campaign.state}', not pending review.` },
      { status: 409 }
    );
  }

  const note = (body.note ?? "").trim().slice(0, NOTE_MAX) || null;

  const { error } = await admin
    .from("infofi_campaigns")
    .update({
      approval_status: "rejected",
      approval_note: note,
      updated_at: new Date().toISOString(),
    })
    .eq("token_address", token);

  if (error) {
    return NextResponse.json({ error: "Could not reject the campaign." }, { status: 500 });
  }

  if (campaign.owner_wallet) {
    const { data: tokenRow } = await admin
      .from("tokens")
      .select("ticker")
      .eq("contract_address", token)
      .maybeSingle();
    await notify(admin, {
      walletAddress: campaign.owner_wallet,
      type: "rejected",
      tokenAddress: token,
      title: "Your campaign was not approved",
      body: note
        ? `${tokenRow?.ticker ?? token}'s campaign was declined: ${note}`
        : `${tokenRow?.ticker ?? token}'s campaign was declined. You can resubmit if it's still eligible.`,
      linkUrl: "/campaigns",
    });
  }

  return NextResponse.json({ rejected: true, tokenAddress: token, note });
}
