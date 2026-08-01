import { NextResponse, type NextRequest } from "next/server";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";

const AUTH_ACTION = "x:verify-start";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import {
  generateVerificationCode,
  isValidUsername,
  normalizeUsername,
} from "@/app/_lib/xVerification";

export const runtime = "nodejs";

/**
 * Starts a bio-code verification: generates a code and stashes it
 * (keyed by wallet) for /api/x/verify/confirm to check against once the
 * user has pasted it into their X bio.
 *
 * Calling this again for the same wallet overwrites any unconfirmed
 * attempt with a fresh username/code — there's nothing to "cancel", the
 * old code simply stops being the one `confirm` checks for.
 */
export async function POST(request: NextRequest) {
  let body: AuthenticatedRequest & { username?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // An X handle bound to a wallet decides who mindshare (and its payout) is
  // credited to, so the wallet side of that binding has to be proven.
  const auth = await verifyWalletAuth(
    body,
    AUTH_ACTION
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const wallet = auth.address.toLowerCase();

  const username = normalizeUsername(body.username ?? "");
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "That doesn't look like a valid X username." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Bindings are permanent and one-per-wallet — fail early with a clear
  // message rather than let the user go edit their bio for nothing.
  const { data: existing, error: existingError } = await supabase
    .from("x_accounts")
    .select("wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: "Could not reach the database." }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "This wallet already has an X account linked." },
      { status: 409 }
    );
  }

  const code = generateVerificationCode();

  const { error: upsertError } = await supabase
    .from("x_verification_attempts")
    .upsert({ wallet_address: wallet, username, code, created_at: new Date().toISOString() });
  if (upsertError) {
    return NextResponse.json({ error: "Could not start verification." }, { status: 500 });
  }

  return NextResponse.json({ code });
}
