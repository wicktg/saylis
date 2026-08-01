/**
 * POST /api/notifications/read
 *
 * Marks notifications read for a wallet — either one `id`, or all of them
 * when `id` is omitted (opening the bell dropdown does the latter).
 * Scoped by wallet server-side so a wallet can only ever mark its own rows,
 * regardless of what `id` is passed.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { walletAddress?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const wallet = body.walletAddress?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  let query = admin
    .from("notifications")
    .update({ read_at: nowIso })
    .eq("wallet_address", wallet)
    .is("read_at", null);

  if (body.id) query = query.eq("id", body.id);

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: "Could not update notifications." }, { status: 500 });
  }

  return NextResponse.json({ updated: true });
}
