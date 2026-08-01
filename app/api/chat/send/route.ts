/**
 * POST /api/chat/send
 *
 * The only path a chat message can ever take. Three jobs:
 *
 *   1. Enforce the 30-second per-wallet cooldown SERVER-SIDE, against a
 *      tiny `chat_cooldowns` table (one row per wallet, always overwritten
 *      in place) — a client-only timer resets on refresh, so this is the
 *      part that can't be bypassed that way.
 *
 *   2. Broadcast the message over Supabase Realtime's `chat:global` channel
 *      for anyone connected right now. This route is the sole broadcaster;
 *      the browser client only ever LISTENS, it never sends directly, so
 *      the cooldown check above is never optional.
 *
 *   3. Persist the message into `chat_messages`, then prune anything past
 *      the 50 most recent rows. This is what lets a page refresh rehydrate
 *      recent history instead of showing an empty box — it's a capped
 *      recent-history buffer, not an unbounded chat log.
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

  const id = crypto.randomUUID();

  const channel = admin.channel(CHANNEL);
  await channel.send({
    type: "broadcast",
    event: "message",
    payload: {
      id,
      walletAddress: wallet,
      message,
      sentAt: nowIso,
    },
  });

  await admin.from("chat_messages").insert({ id, wallet_address: wallet, message, created_at: nowIso });

  // Keep only the 50 most recent rows: find the 50th-newest row's
  // timestamp, then delete everything older than it.
  const { data: cutoffRow } = await admin
    .from("chat_messages")
    .select("created_at")
    .order("created_at", { ascending: false })
    .range(49, 49);

  if (cutoffRow && cutoffRow.length > 0) {
    await admin.from("chat_messages").delete().lt("created_at", cutoffRow[0].created_at as string);
  }

  return NextResponse.json({
    sent: true,
    nextAllowedAt: new Date(now + COOLDOWN_MS).toISOString(),
  });
}
