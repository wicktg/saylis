import { NextResponse, type NextRequest } from "next/server";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";

const AUTH_ACTION = "x:verify-confirm";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { fetchXProfile, TwitterApiIoError } from "@/app/_lib/twitterApiIo";

export const runtime = "nodejs";

/**
 * Confirms a bio-code verification: re-fetches the target username's
 * public profile via twitterapi.io and checks whether the pending code
 * appears in the bio. On success, writes the permanent wallet<->X binding
 * and deletes the pending attempt.
 */
export async function POST(request: NextRequest) {
  let body: AuthenticatedRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Same reasoning as /x/verify/start: this is the call that finalises the
  // handle-to-wallet binding, so it must be the wallet asking.
  const auth = await verifyWalletAuth(
    body,
    AUTH_ACTION
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const wallet = auth.address.toLowerCase();

  const supabase = getSupabaseAdmin();

  const { data: attempt, error: attemptError } = await supabase
    .from("x_verification_attempts")
    .select("username, code")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (attemptError) {
    return NextResponse.json({ error: "Could not reach the database." }, { status: 500 });
  }
  if (!attempt) {
    return NextResponse.json(
      { error: "No verification in progress. Start again." },
      { status: 404 }
    );
  }

  let profile;
  try {
    profile = await fetchXProfile(attempt.username as string);
  } catch (err) {
    if (err instanceof TwitterApiIoError && err.code === "not_found") {
      return NextResponse.json(
        { error: `Couldn't find @${attempt.username} on X.` },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't reach X right now. Try again shortly." },
      { status: 502 }
    );
  }

  if (!profile.bio.includes(attempt.code as string)) {
    return NextResponse.json(
      { error: "Code not found in that bio yet. Save your bio on X, then try again." },
      { status: 422 }
    );
  }

  const { error: insertError } = await supabase.from("x_accounts").insert({
    wallet_address: wallet,
    x_user_id: profile.id,
    username: profile.username,
    avatar_url: profile.avatarUrl,
  });

  if (insertError) {
    // 23505 = unique violation, on either wallet_address (PK) or
    // x_user_id (unique) — either way, someone got there first.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "That wallet or X account is already linked." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not save the link." }, { status: 500 });
  }

  // Best-effort cleanup — the attempt row has no bearing on anything once
  // x_accounts holds the real binding, so a failure here isn't fatal.
  await supabase.from("x_verification_attempts").delete().eq("wallet_address", wallet);

  return NextResponse.json({ username: profile.username, avatarUrl: profile.avatarUrl });
}
