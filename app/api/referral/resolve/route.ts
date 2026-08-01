/**
 * GET /api/referral/resolve?code=ABC1234
 *
 * Resolves a shareable referral code back to the wallet it belongs to —
 * the input the actual on-chain `registerReferral(referrer)` call needs.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!code) {
    return NextResponse.json({ error: "A code is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("referral_codes")
    .select("wallet_address")
    .eq("code", code)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: "Unknown referral code." }, { status: 404 });
  }

  return NextResponse.json({ walletAddress: data.wallet_address });
}
