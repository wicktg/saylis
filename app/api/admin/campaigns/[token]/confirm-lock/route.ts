/**
 * POST /api/admin/campaigns/[token]/confirm-lock
 *
 * The final step of Path B's admin-gated flow. By the time this is called,
 * the admin's OWN CONNECTED WALLET has already signed
 * `registerExternalPool(token, amount, curve)` directly in the browser
 * (see app/admin/page.tsx) — this route does no signing at all. Its job is
 * to verify that call actually landed and produced a real on-chain pool,
 * then sync Supabase and notify the creator their pool is live.
 *
 * The creator's `reported_amount_raw` is never used for anything here — the
 * only amount that matters is whatever the admin's transaction actually
 * registered on-chain, read fresh.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";

const AUTH_ACTION = "admin:campaign-confirm-lock";
import { readCampaign } from "@/app/_lib/infofi/chain";
import { notify } from "@/app/_lib/infofi/notify";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token?.toLowerCase();
  if (!token || !isAddress(token)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  let body: AuthenticatedRequest & { txHash?: string };
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
    .select("token_address, owner_wallet, state")
    .eq("token_address", token)
    .maybeSingle();

  if (!campaign || campaign.state !== "awaiting_review") {
    return NextResponse.json(
      { error: `No campaign awaiting review for this token.` },
      { status: 409 }
    );
  }

  // The chain is what decides this happened — never the request body.
  const onChain = await readCampaign(token as Address);
  if (onChain.state === "none") {
    return NextResponse.json(
      {
        error:
          "No on-chain pool found yet. The registerExternalPool transaction may not have confirmed.",
      },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  await admin
    .from("infofi_campaigns")
    .update({
      state: onChain.state,
      curve_address: onChain.curve.toLowerCase(),
      allocation_raw: onChain.allocation.toString(),
      // Not the creator's owner_wallet — that stays as the invited wallet
      // for display purposes, deliberately decoupled from the on-chain
      // `owner` (which is now the admin's address, since they were the
      // one who called registerExternalPool). See campaigns_v3_schema.sql.
      reported_amount_raw: null,
      updated_at: nowIso,
    })
    .eq("token_address", token);

  const { data: tokenRow } = await admin
    .from("tokens")
    .select("ticker")
    .eq("contract_address", token)
    .maybeSingle();

  if (campaign.owner_wallet) {
    await notify(admin, {
      walletAddress: campaign.owner_wallet,
      type: "supply_confirmed",
      tokenAddress: token,
      title: "Your pool is live",
      body: `${tokenRow?.ticker ?? token}'s InfoFi pool has been confirmed and created. It will become eligible for review once the token graduates.`,
      linkUrl: "/campaigns",
    });
  }

  return NextResponse.json({
    confirmed: true,
    tokenAddress: token,
    allocationRaw: onChain.allocation.toString(),
    txHash: body.txHash ?? null,
  });
}
