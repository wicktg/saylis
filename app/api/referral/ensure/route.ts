/**
 * POST /api/referral/ensure
 *
 * Returns `wallet`'s referral code, generating one on first call if it
 * doesn't exist yet. Idempotent — a wallet calling this a hundred times
 * gets the same code back every time, never a new one.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I — hard to mis-copy
const CODE_LENGTH = 7;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export async function POST(request: Request) {
  let body: { walletAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // DELIBERATELY UNSIGNED — same reasoning as /api/wallets/register: this
  // fires automatically on connect, so a signature prompt here would greet
  // arrival rather than any decision the user made.
  //
  // Safe because the code grants nothing. It is a public lookup key pointing
  // AT a wallet, and referral earnings are held on-chain by `ReferralVault`
  // against that wallet's own address — minting someone else's code does not
  // let the minter claim a wei of it, since `withdrawReferralFees` pays
  // `msg.sender` and nobody else.
  const wallet = body.walletAddress?.toLowerCase() ?? "";
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "A valid walletAddress is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data: existing } = await admin
    .from("referral_codes")
    .select("code")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ code: existing.code as string });
  }

  // Collision odds at 7 chars from a 32-symbol alphabet are astronomically
  // low, but a unique constraint backs this regardless — retry on the rare
  // clash rather than trusting randomness alone.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error } = await admin
      .from("referral_codes")
      .insert({ wallet_address: wallet, code });
    if (!error) {
      return NextResponse.json({ code });
    }
    if ((error as { code?: string }).code !== "23505") {
      return NextResponse.json({ error: "Could not create a referral code." }, { status: 500 });
    }
    // 23505 on wallet_address (not code) means a concurrent request already
    // created this wallet's row — fetch and return that instead of retrying.
    const { data: raced } = await admin
      .from("referral_codes")
      .select("code")
      .eq("wallet_address", wallet)
      .maybeSingle();
    if (raced) return NextResponse.json({ code: raced.code as string });
  }

  return NextResponse.json({ error: "Could not generate a unique code." }, { status: 500 });
}
