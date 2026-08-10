/**
 * GET /api/campaigns/public
 *
 * Every campaign that has actually gone live at some point — `open`,
 * `settled`, or `burned` — regardless of who owns it. Unlike
 * /api/campaigns/mine, this is not wallet-scoped: anyone can browse it,
 * because a live campaign's whole point is public participation. Campaigns
 * still in `invited` / `awaiting_review` / `registered` / `eligible` never
 * appear here — those remain visible only to their owner (see
 * /api/campaigns/mine) until the team actually opens them.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const LIVE_STATES = ["open", "settled", "burned"];

export async function GET() {
  const admin = getSupabaseAdmin();

  const { data: campaigns, error } = await admin
    .from("infofi_campaigns")
    .select("*")
    .in("state", LIVE_STATES)
    .order("opened_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load campaigns." }, { status: 500 });
  }

  const tokenAddresses = [...new Set((campaigns ?? []).map((c) => c.token_address))];
  const { data: tokenRows } = tokenAddresses.length
    ? await admin
        .from("tokens")
        .select("contract_address, name, ticker, image_url")
        .in("contract_address", tokenAddresses)
    : { data: [] };
  const tokenByAddress = new Map((tokenRows ?? []).map((t) => [t.contract_address, t]));

  const items = (campaigns ?? []).map((c) => {
    const token = tokenByAddress.get(c.token_address);
    return {
      tokenAddress: c.token_address,
      name: token?.name ?? null,
      ticker: token?.ticker ?? null,
      imageUrl: token?.image_url ?? null,
      state: c.state as "open" | "settled" | "burned",
      allocationRaw: c.allocation_raw,
      title: c.title as string | null,
      description: c.description as string | null,
      winnerCount: c.winner_count as number | null,
      openedAt: c.opened_at,
      windowEndsAt: c.window_ends_at,
    };
  });

  // Live first, Ended (settled/burned) last — matches how the page renders
  // them (Ended sorts to the bottom, dimmed). `opened_at desc` already holds
  // within each group from the query order above.
  items.sort((a, b) => {
    const aLive = a.state === "open" ? 0 : 1;
    const bLive = b.state === "open" ? 0 : 1;
    return aLive - bLive;
  });

  return NextResponse.json({ campaigns: items });
}
