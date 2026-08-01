/**
 * GET /api/chat/cooldown?wallet=0x…
 *
 * Lets the client show an honest countdown immediately after a page
 * refresh, rather than only discovering the cooldown is still active on
 * the next failed send. Read-only, same `chat_cooldowns` row /api/chat/send
 * enforces against.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 30_000;

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet")?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("chat_cooldowns")
    .select("last_sent_at")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ nextAllowedAt: null });
  }

  const lastSentMs = new Date(data.last_sent_at as string).getTime();
  const nextAllowedMs = lastSentMs + COOLDOWN_MS;
  return NextResponse.json({
    nextAllowedAt: nextAllowedMs > Date.now() ? new Date(nextAllowedMs).toISOString() : null,
  });
}
