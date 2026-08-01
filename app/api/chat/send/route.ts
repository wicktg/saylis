/**
 * POST /api/chat/send
 *
 * The only path a chat message can ever take. Two jobs:
 *
 *   1. Enforce the 30-second per-wallet cooldown SERVER-SIDE, against a
 *      tiny `chat_cooldowns` table (one row per wallet, always overwritten
 *      in place) — a client-only timer resets on refresh, so this is the
 *      part that can't be bypassed that way.
 *
 *   2. Broadcast the message over Supabase Realtime's `chat:global` channel
 *      (broadcast-only — no table backs the message itself). This route is
 *      the sole broadcaster; the browser client only ever LISTENS, it never
 *      sends directly, so the cooldown check above is never optional.
 *
 * Nothing here is ever written to persistent chat history — the row this
 * route touches records only "when did this wallet last send", not what
 * they sent.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const COOLDOWN_MS = 30_000;
const MESSAGE_MAX = 280;
const CHANNEL = "chat:global";

export async function POST(request: Request) {
  let body: { walletAddress?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const wallet = body.walletAddress?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  }

  const message = body.message?.trim() ?? "";
  if (!message) {
    return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  }
  if (message.length > MESSAGE_MAX) {
    return NextResponse.json(
      { error: `Message is too long (max ${MESSAGE_MAX} characters).` },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const now = Date.now();

  const { data: cooldownRow } = await admin
    .from("chat_cooldowns")
    .select("last_sent_at")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (cooldownRow) {
    const lastSentMs = new Date(cooldownRow.last_sent_at as string).getTime();
    const elapsed = now - lastSentMs;
    if (elapsed < COOLDOWN_MS) {
      const nextAllowedAt = new Date(lastSentMs + COOLDOWN_MS).toISOString();
      return NextResponse.json(
        { error: "Slow down.", nextAllowedAt, retryAfterMs: COOLDOWN_MS - elapsed },
        { status: 429 }
      );
    }
  }

  const nowIso = new Date(now).toISOString();
  await admin
    .from("chat_cooldowns")
    .upsert({ wallet_address: wallet, last_sent_at: nowIso }, { onConflict: "wallet_address" });

  const channel = admin.channel(CHANNEL);
  await channel.send({
    type: "broadcast",
    event: "message",
    payload: {
      id: crypto.randomUUID(),
      walletAddress: wallet,
      message,
      sentAt: nowIso,
    },
  });

  return NextResponse.json({
    sent: true,
    nextAllowedAt: new Date(now + COOLDOWN_MS).toISOString(),
  });
}
