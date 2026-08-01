/**
 * POST /api/admin/campaigns/invite
 *
 * The team's power to render a Path B campaign to a specific wallet, after
 * agreeing terms off-platform (Telegram). This is the ONLY way a Path B
 * campaign now comes into existence — there is no more self-service "buy
 * and lock" entry point.
 *
 * Gated to tokens that have already graduated AND migrated: pre-graduation
 * the curve is still trading (an invite would be premature — supply sent
 * now could still be needed on the curve itself), and post-graduation but
 * pre-migration the curve is halted with no live pool yet, so there is
 * nothing meaningful to build a campaign against until migration has
 * actually seeded liquidity.
 *
 * Creates a DB-only row with no on-chain footprint at all yet — nothing has
 * moved. `state='invited'` is visible ONLY to `inviteWallet` (see
 * /api/campaigns/mine, scoped by owner_wallet), and grants no on-chain
 * authority whatsoever; it is purely "this row is now allowed to render for
 * you." The token must already exist here (have a real curve) since Path B
 * eligibility depends on verifying that curve on-chain later.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";

const AUTH_ACTION = "admin:campaign-invite";
import { publicClient } from "@/app/_lib/infofi/chain";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: AuthenticatedRequest & { tokenAddress?: string; inviteWallet?: string };
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

  const token = body.tokenAddress?.toLowerCase() ?? "";
  const inviteWallet = body.inviteWallet?.toLowerCase() ?? "";
  if (!isAddress(token)) {
    return NextResponse.json({ error: "Enter a valid token contract address." }, { status: 400 });
  }
  if (!isAddress(inviteWallet)) {
    return NextResponse.json({ error: "Enter a valid wallet address." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: tokenRow } = await admin
    .from("tokens")
    .select("contract_address, curve_address, ticker, name")
    .eq("contract_address", token)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json(
      { error: "This token was not launched here, so it has no curve to verify against." },
      { status: 404 }
    );
  }

  const curveAddress = (tokenRow.curve_address as string | null)?.toLowerCase();
  if (!curveAddress || !isAddress(curveAddress)) {
    return NextResponse.json(
      { error: "This token has no curve on record." },
      { status: 400 }
    );
  }

  try {
    const [graduated, migrationExecuted] = await Promise.all([
      publicClient().readContract({
        address: curveAddress as Address,
        abi: BONDING_CURVE_ABI,
        functionName: "graduated",
      }) as Promise<boolean>,
      publicClient().readContract({
        address: curveAddress as Address,
        abi: BONDING_CURVE_ABI,
        functionName: "migrationExecuted",
      }) as Promise<boolean>,
    ]);

    if (!graduated || !migrationExecuted) {
      return NextResponse.json(
        {
          error: !graduated
            ? "This token hasn't graduated yet. Invites only open once it has."
            : "This token has graduated but not migrated to a live pool yet. Try again shortly.",
        },
        { status: 409 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not read this token's curve state on-chain." },
      { status: 502 }
    );
  }

  const { data: existing } = await admin
    .from("infofi_campaigns")
    .select("token_address, state")
    .eq("token_address", token)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: `This token already has a campaign (state: ${existing.state}).` },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin.from("infofi_campaigns").insert({
    token_address: token,
    curve_address: tokenRow.curve_address,
    owner_wallet: inviteWallet,
    origin: "post_launch",
    state: "invited",
    allocation_raw: "0",
    invited_at: nowIso,
    invited_by: auth.address.toLowerCase(),
    updated_at: nowIso,
  });

  if (error) {
    return NextResponse.json({ error: "Could not create the invite." }, { status: 500 });
  }

  return NextResponse.json({
    invited: true,
    tokenAddress: token,
    ticker: tokenRow.ticker,
    inviteWallet,
  });
}
