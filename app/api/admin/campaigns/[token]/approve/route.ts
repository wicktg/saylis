/**
 * POST /api/admin/campaigns/[token]/approve
 *
 * "Approve & Open" itself — `InfoFiCampaign.openCampaign(token)` — is now
 * signed by the TEAM'S OWN CONNECTED WALLET in the browser (see
 * app/admin/page.tsx), not by a server-held key. `team` is a real,
 * official project wallet; its private key must never exist in this
 * codebase or server environment.
 *
 * This route runs AFTER that transaction has already confirmed on-chain.
 * Its job is narrow: verify the caller really is `team`, verify the
 * on-chain state genuinely is `open` now (never trust the client's word for
 * it), then sync the mirror and notify the creator. It cannot open a
 * campaign by itself — there is no signing here at all.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";
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

  let body: { walletAddress?: string; txHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const wallet = body.walletAddress?.toLowerCase() ?? "";
  if (wallet !== INFOFI_TEAM_ADDRESS.toLowerCase()) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // The chain, not the request body, is what confirms this happened. A
  // campaign still `eligible` here means the client's tx either hasn't
  // landed yet or never actually succeeded — either way there is nothing
  // to sync.
  const onChain = await readCampaign(token as Address);
  if (onChain.state !== "open") {
    return NextResponse.json(
      {
        error: `Campaign is '${onChain.state}' on-chain, not 'open'. The openCampaign transaction may not have confirmed yet.`,
        onChainState: onChain.state,
      },
      { status: 409 }
    );
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // The real recipient — never on-chain `campaign.owner` (that's whichever
  // wallet CALLED registerAllocation/registerExternalPool: the curve
  // contract itself for Path A, or the admin's own wallet for Path B —
  // neither is the actual creator/invitee). The Supabase row's
  // `owner_wallet` is the one place that's tracked correctly.
  const { data: existingCampaign } = await admin
    .from("infofi_campaigns")
    .select("owner_wallet")
    .eq("token_address", token)
    .maybeSingle();
  const ownerWallet = (existingCampaign?.owner_wallet as string | null) ?? null;

  await admin
    .from("infofi_campaigns")
    .update({
      state: onChain.state,
      opened_at: nowIso,
      window_ends_at: new Date(Number(onChain.windowEnds) * 1000).toISOString(),
      approval_status: "approved",
      approval_note: null,
      updated_at: nowIso,
    })
    .eq("token_address", token);

  const { data: tokenRow } = await admin
    .from("tokens")
    .select("ticker")
    .eq("contract_address", token)
    .maybeSingle();
  if (ownerWallet) {
    await notify(admin, {
      walletAddress: ownerWallet,
      type: "approved",
      tokenAddress: token,
      title: "Your campaign was approved",
      body: `${tokenRow?.ticker ?? token}'s InfoFi campaign is now live. The 7-day window has started.`,
      linkUrl: `/campaigns/${token}`,
    });
  }

  return NextResponse.json({
    approved: true,
    tokenAddress: token,
    txHash: body.txHash ?? null,
    windowEndsAt: new Date(Number(onChain.windowEnds) * 1000).toISOString(),
  });
}
