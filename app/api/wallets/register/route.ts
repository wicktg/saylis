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
