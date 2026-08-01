/**
 * POST /api/campaigns/sync  { tokenAddress }
 *
 * Mirrors ONE token's on-chain campaign into `infofi_campaigns`, immediately.
 *
 * WHY THIS EXISTS
 *
 * A Path A campaign is registered on-chain inside the curve's constructor —
 * so the pool is locked and real from the very first block. But the
 * Campaigns page reads the Supabase mirror, and the only thing that ever
 * wrote that mirror was the poke cron. Until it happened to run, a creator
 * who had just locked 5% of their supply saw an empty page, with nothing
 * anywhere to tell them it had worked. That gap was an hour originally, ten
 * minutes now, and still long enough to look broken.
 *
 * The launch flow calls this the moment the token row is written, so the
 * campaign shows up as soon as the launch completes. The cron stays the
 * backstop for anything that never made this call — a closed tab, a failed
 * request, a token launched by some other client.
 *
 * WHY IT IS SAFE TO LEAVE UNAUTHENTICATED
 *
 * Nothing here is caller-supplied except which token to look at. Every value
 * written is read from the chain or from the token's own row: the caller
 * cannot set the state, the allocation, or — importantly — the owner. So the
 * worst an arbitrary caller can do is ask us to make the mirror agree with
 * the chain sooner, which is the whole point of the endpoint.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { readCampaign, tsToIso } from "@/app/_lib/infofi/chain";

export const dynamic = "force-dynamic";

const ZERO_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function POST(request: Request) {
  let body: { tokenAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const token = body.tokenAddress?.toLowerCase() ?? "";
  if (!isAddress(token)) {
    return NextResponse.json({ error: "A valid tokenAddress is required." }, { status: 400 });
  }

  let campaign;
  try {
    campaign = await readCampaign(token as Address);
  } catch {
    return NextResponse.json({ error: "Could not read campaign state." }, { status: 502 });
  }

  // `none` means this launch carved nothing out — there is no campaign to
  // mirror, and never will be. Not an error.
  if (campaign.state === "none") {
    return NextResponse.json({ synced: false, reason: "No campaign for this token." });
  }

  const admin = getSupabaseAdmin();

  // The creator, from the token's own row — never on-chain `campaign.owner`,
  // which for a Path A launch is the CURVE contract (it is the msg.sender of
  // the constructor's registerAllocation call), not a wallet anyone can see
  // a page with.
  const { data: tokenRow } = await admin
    .from("tokens")
    .select("creator_wallet_address")
    .eq("contract_address", token)
    .maybeSingle();
  const creatorWallet = (tokenRow?.creator_wallet_address as string | null)?.toLowerCase() ?? null;

  // Never clobber a Path B row's invited wallet with the token's original
  // launcher — the invite route owns `owner_wallet` for those.
  const { data: existing } = await admin
    .from("infofi_campaigns")
    .select("origin")
    .eq("token_address", token)
    .maybeSingle();
  const isPathB = existing?.origin === "post_launch";

  const { error } = await admin.from("infofi_campaigns").upsert(
    {
      token_address: token,
      curve_address: campaign.curve.toLowerCase(),
      state: campaign.state,
      allocation_raw: campaign.allocation.toString(),
      eligible_at:
        campaign.state === "eligible" || campaign.aboveSince > 0n
          ? tsToIso(campaign.aboveSince)
          : null,
      opened_at: tsToIso(campaign.openedAt),
      window_ends_at: tsToIso(campaign.windowEnds),
      claim_deadline_at: tsToIso(campaign.claimDeadline),
      merkle_root: campaign.merkleRoot === ZERO_ROOT ? null : campaign.merkleRoot,
      updated_at: new Date().toISOString(),
      ...(isPathB || !creatorWallet ? {} : { owner_wallet: creatorWallet }),
    },
    { onConflict: "token_address" }
  );

  if (error) {
    return NextResponse.json({ error: "Could not sync the campaign." }, { status: 500 });
  }

  return NextResponse.json({
    synced: true,
    tokenAddress: token,
    state: campaign.state,
    allocationRaw: campaign.allocation.toString(),
  });
}
