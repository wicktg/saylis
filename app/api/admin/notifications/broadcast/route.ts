/**
 * POST /api/admin/notifications/broadcast
 *
 * Team-only. Pushes one notification to every wallet in `registered_wallets`
 * AS OF RIGHT NOW — materialised as one `notifications` row per wallet, not
 * a query some future page runs live. That's deliberate: a wallet that
 * registers tomorrow must never retroactively see today's broadcast, and
 * the only way to guarantee that with a per-wallet feed is to snapshot the
 * audience at push time.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { INFOFI_TEAM_ADDRESS } from "@/app/_lib/contracts/config";
import { notifyMany } from "@/app/_lib/infofi/notify";

export const dynamic = "force-dynamic";

const TITLE_MAX = 80;
const BODY_MAX = 500;

export async function POST(request: Request) {
  let body: { walletAddress?: string; title?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const caller = body.walletAddress?.toLowerCase() ?? "";
  if (caller !== INFOFI_TEAM_ADDRESS.toLowerCase()) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const title = body.title?.trim() ?? "";
  const message = body.message?.trim() ?? "";
  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json(
      { error: `Title is required (max ${TITLE_MAX} characters).` },
      { status: 400 }
    );
  }
  if (!message || message.length > BODY_MAX) {
    return NextResponse.json(
      { error: `Message is required (max ${BODY_MAX} characters).` },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  const { data: wallets, error } = await admin.from("registered_wallets").select("wallet_address");
  if (error) {
    return NextResponse.json({ error: "Could not load the wallet audience." }, { status: 500 });
  }

  const recipients = (wallets ?? []).map((w) => w.wallet_address as string);
  await notifyMany(admin, recipients, {
    type: "announcement",
    title,
    body: message,
  });

  return NextResponse.json({ pushed: true, recipients: recipients.length });
}
