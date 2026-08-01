/**
 * POST /api/infofi/join
 *
 * Records a wallet joining a token's InfoFi campaign.
 *
 * There is no wallet signature here by design — joining is free, reversible
 * in effect, and grants nothing on its own. What gives the row meaning is
 * the `x_accounts` binding: the wallet must already have proven control of
 * an X handle through the bio-code flow, so the username attached to this
 * join is one that wallet demonstrably owns. A join by itself moves no
 * tokens and confers no allocation; only posting does, and only the daily
 * recompute scores it.
 *
 * `joined_at` becomes the participant's scoring cutoff, so joining late
 * genuinely costs reach rather than letting someone backfill old posts.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const AUTH_ACTION = "infofi:join";

/** Campaign states that still accept new participants. */
const JOINABLE_STATES = new Set(["registered", "eligible", "open"]);

export async function POST(request: Request) {
  let body: AuthenticatedRequest & { tokenAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tokenAddress = body.tokenAddress?.toLowerCase();
  if (!tokenAddress || !isAddress(tokenAddress)) {
    return NextResponse.json({ error: "A valid tokenAddress is required." }, { status: 400 });
  }

  // The participant set is the input to the off-chain mindshare computation
  // that produces the merkle root real tokens are claimed against, so who is
  // in it has to be proven, not asserted. See app/_lib/walletAuth.ts.
  const auth = await verifyWalletAuth(body, AUTH_ACTION);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const walletAddress = auth.address.toLowerCase();

  const admin = getSupabaseAdmin();

  // 1. The campaign must exist and still be accepting participants.
  const { data: campaign, error: campaignError } = await admin
    .from("infofi_campaigns")
    .select("token_address, state")
    .eq("token_address", tokenAddress)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json({ error: "Could not load the campaign." }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json(
      { error: "This token has no InfoFi campaign." },
      { status: 404 }
    );
  }
  if (!JOINABLE_STATES.has(campaign.state)) {
    return NextResponse.json(
      { error: `This campaign is ${campaign.state} and is no longer accepting entries.` },
      { status: 409 }
    );
  }

  // 2. The wallet must already hold a verified X binding. This is the only
  //    thing standing between "a wallet address in a POST body" and a real,
  //    attributable participant, so it is not optional.
  const { data: xAccount, error: xError } = await admin
    .from("x_accounts")
    .select("username")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (xError) {
    return NextResponse.json({ error: "Could not check the X binding." }, { status: 500 });
  }
  if (!xAccount) {
    return NextResponse.json(
      { error: "Connect your X account before joining a campaign.", code: "x_not_connected" },
      { status: 403 }
    );
  }

  // 3. Insert. The unique constraints on (token, wallet) and (token,
  //    username) make a repeat join a no-op rather than a second entry with
  //    a fresh — and more forgiving — cutoff.
  const { data: inserted, error: insertError } = await admin
    .from("infofi_participants")
    .insert({
      token_address: tokenAddress,
      wallet_address: walletAddress,
      x_username: xAccount.username,
    })
    .select("joined_at")
    .maybeSingle();

  if (insertError) {
    // 23505 = unique_violation: already joined, which is a success from the
    // caller's point of view.
    if ((insertError as { code?: string }).code === "23505") {
      const { data: existing } = await admin
        .from("infofi_participants")
        .select("joined_at, x_username")
        .eq("token_address", tokenAddress)
        .eq("wallet_address", walletAddress)
        .maybeSingle();

      return NextResponse.json({
        joined: true,
        alreadyJoined: true,
        xUsername: existing?.x_username ?? xAccount.username,
        joinedAt: existing?.joined_at ?? null,
      });
    }

    return NextResponse.json({ error: "Could not join the campaign." }, { status: 500 });
  }

  return NextResponse.json({
    joined: true,
    alreadyJoined: false,
    xUsername: xAccount.username,
    joinedAt: inserted?.joined_at ?? null,
  });
}
