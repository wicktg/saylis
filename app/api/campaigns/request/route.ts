/**
 * POST /api/campaigns/request
 *
 * An external project applying to run a campaign. Team review happens off
 * this record; nothing here creates or funds anything on-chain.
 *
 * No wallet signature, consistent with the rest of the app's write paths.
 * That is acceptable because an application grants nothing — the team reads
 * it, and every subsequent step (funding the pool, opening the window) is a
 * transaction signed by the wallet that actually owns the tokens.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const NAME_MAX = 80;
const DESCRIPTION_MAX = 1000;

/** Deliberately permissive: real addresses get typo'd, not spoofed, here. */
function cleanOptional(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const walletAddress = String(body.walletAddress ?? "").toLowerCase();
  const contractAddress = String(body.contractAddress ?? "").toLowerCase();
  const projectName = String(body.projectName ?? "").trim();
  const description = String(body.description ?? "").trim();
  const email = String(body.email ?? "").trim();

  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "Connect a wallet first." }, { status: 400 });
  }
  if (!isAddress(contractAddress)) {
    return NextResponse.json(
      { error: "Enter a valid contract address." },
      { status: 400 }
    );
  }
  if (!projectName || projectName.length > NAME_MAX) {
    return NextResponse.json(
      { error: `Project name is required (max ${NAME_MAX} characters).` },
      { status: 400 }
    );
  }
  if (!description || description.length > DESCRIPTION_MAX) {
    return NextResponse.json(
      { error: `Description is required (max ${DESCRIPTION_MAX} characters).` },
      { status: 400 }
    );
  }
  // Loose on purpose: the team emails a human, so an over-strict regex that
  // rejects a valid address costs more than a typo the team can see.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const { data, error } = await admin
    .from("campaign_requests")
    .insert({
      wallet_address: walletAddress,
      contract_address: contractAddress,
      project_name: projectName.slice(0, NAME_MAX),
      description: description.slice(0, DESCRIPTION_MAX),
      x_handle: cleanOptional(body.xHandle),
      website: cleanOptional(body.website),
      email: email.slice(0, 200),
    })
    .select("id, created_at")
    .maybeSingle();

  if (error) {
    // 23505 = already applied for this token from this wallet.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        {
          error: "You have already applied for this token. The team will be in touch.",
          code: "already_applied",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not submit the application." }, { status: 500 });
  }

  return NextResponse.json({
    submitted: true,
    requestId: data?.id ?? null,
    submittedAt: data?.created_at ?? null,
  });
}
