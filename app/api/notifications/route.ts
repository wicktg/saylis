/**
 * GET /api/notifications?wallet=0x…
 *
 * A wallet's notification feed. `notifications` has no public select
 * policy, so this route (service-role, filtered by wallet) is the only way
 * to read it — a wallet can never see another wallet's notifications.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet")?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid wallet is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("notifications")
    .select("id, type, token_address, title, body, link_url, read_at, created_at")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }

  const items = (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    tokenAddress: n.token_address,
    title: n.title,
    body: n.body,
    linkUrl: n.link_url,
    read: n.read_at !== null,
    createdAt: n.created_at,
  }));

  return NextResponse.json({
    items,
    unreadCount: items.filter((n) => !n.read).length,
  });
}
