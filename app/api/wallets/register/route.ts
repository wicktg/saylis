/**
 * POST /api/wallets/register
 *
 * Records that a wallet has connected to the app at least once. This is the
 * ENTIRE audience source for admin broadcast notifications (see
 * /api/admin/notifications/broadcast) — there is no other "user account"
 * concept anywhere in this app. Idempotent: a wallet that reconnects a
 * hundred times still only ever has one row, keeping its original
 * `first_seen_at`.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { walletAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // DELIBERATELY UNSIGNED, unlike the campaign/join/verify routes.
  //
  // This fires automatically the moment any wallet connects, on every page.
  // Demanding a signature here would put a wallet prompt in front of someone
  // who has done nothing but arrive — which is both hostile and actively
  // counterproductive: it trains users to dismiss signing prompts, and the
  // prompts that matter are the ones on the routes that move value.
  //
  // The trade is acceptable because spoofing this grants nothing. The row is
  // an address and a first-seen timestamp; it confers no authority, no funds,
  // and no visibility into anything. The residual risk is padding the
  // broadcast audience with addresses that never connected, which is a
  // capacity problem, not a privilege one — see the audit report's
  // recommendation to rate-limit the unauthenticated public routes.
  const wallet = body.walletAddress?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid walletAddress is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  // ignoreDuplicates: never touch first_seen_at on a repeat connect.
  await admin
    .from("registered_wallets")
    .upsert({ wallet_address: wallet }, { onConflict: "wallet_address", ignoreDuplicates: true });

  return NextResponse.json({ registered: true });
}
