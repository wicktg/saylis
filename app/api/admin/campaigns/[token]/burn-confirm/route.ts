/**
 * POST /api/admin/campaigns/[token]/burn-confirm
 *
 * Called after the admin's own connected wallet has already signed and
 * confirmed `burnUnclaimed` on-chain (see BurnSection in app/admin/page.tsx
 * — burning itself is permissionless, this route never signs anything). Its
 * only job: re-verify the on-chain state genuinely is `burned` before
 * syncing the mirror and notifying the creator, complete with a block
 * explorer link to the burn transaction.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS, BLOCK_EXPLORER_TX_URL } from "@/app/_lib/contracts/config";
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

  const onChain = await readCampaign(token as Address);
  if (onChain.state !== "burned") {
    return NextResponse.json(
      {
        error: `Campaign is '${onChain.state}' on-chain, not 'burned'. The burn transaction may not have confirmed yet.`,
        onChainState: onChain.state,
      },
      { status: 409 }
    );
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: existingCampaign } = await admin
    .from("infofi_campaigns")
    .select("owner_wallet")
    .eq("token_address", token)
    .maybeSingle();
  const ownerWallet = (existingCampaign?.owner_wallet as string | null) ?? null;

  await admin
    .from("infofi_campaigns")
    .update({ state: "burned", updated_at: nowIso })
    .eq("token_address", token);

  const { data: tokenRow } = await admin
    .from("tokens")
    .select("ticker")
    .eq("contract_address", token)
    .maybeSingle();

  if (ownerWallet) {
    await notify(admin, {
      walletAddress: ownerWallet,
      type: "burned",
      tokenAddress: token,
      title: "Unclaimed supply was burned",
      body: `${tokenRow?.ticker ?? token}'s unclaimed InfoFi pool remainder has been sent to the burn address.`,
      linkUrl: body.txHash ? `${BLOCK_EXPLORER_TX_URL}${body.txHash}` : undefined,
    });
  }

  return NextResponse.json({ burned: true, tokenAddress: token });
}
