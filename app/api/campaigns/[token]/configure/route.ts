/**
 * POST /api/campaigns/[token]/configure
 *
 * Developer actions on their own campaign, all off-chain:
 *
 *   title, description  campaign metadata
 *   winnerCount          how many wallets share the pool (25-100, step 5)
 *   requestApproval       flag it for team review once eligible on-chain
 *
 * None of this moves tokens. Metadata and airdrop size only feed the admin
 * review and the settle job; an approval request is a notification, not a
 * state change — the campaign still opens on-chain, team-signed.
 *
 * Path A (pre-mint allocation) vs Path B (post-launch buy+lock) differ only
 * in WHEN title/description get set:
 *
 *   - Path A: null until the token is eligible (on-chain state ===
 *     "eligible"). The creator reserved supply blind at mint with no
 *     campaign context yet, so this route refuses to accept metadata before
 *     eligibility — there is nothing meaningful to review before then.
 *   - Path B: the lock route (`/api/campaigns/[token]/lock`) sets metadata
 *     immediately in the same flow as the on-chain lock, since the creator
 *     already has full context. This route can still be used afterwards to
 *     edit it, under the same "locked once open" rule as winnerCount.
 *
 * Eligibility is re-read FROM CHAIN here rather than trusted from the
 * mirror, so a stale row cannot let someone request approval for a campaign
 * that has not actually qualified.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { verifyWalletAuth, type AuthenticatedRequest } from "@/app/_lib/walletAuth";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { readCampaign } from "@/app/_lib/infofi/chain";

export const dynamic = "force-dynamic";

const AUTH_ACTION = "campaigns:configure";

const MIN_WINNERS = 25;
const MAX_WINNERS = 100;
const WINNER_STEP = 5;

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token?.toLowerCase();
  if (!token || !isAddress(token)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  let body: AuthenticatedRequest & {
    winnerCount?: number;
    requestApproval?: boolean;
    title?: string;
    description?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Ownership of this campaign is checked against `owner_wallet` below, so
  // the caller identity feeding that check must be proven, not asserted.
  const auth = await verifyWalletAuth(body, AUTH_ACTION);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const wallet = auth.address.toLowerCase();

  const admin = getSupabaseAdmin();

  const { data: campaign } = await admin
    .from("infofi_campaigns")
    .select("token_address, owner_wallet, state, approval_status, origin")
    .eq("token_address", token)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "No campaign for this token." }, { status: 404 });
  }
  if (String(campaign.owner_wallet ?? "").toLowerCase() !== wallet) {
    return NextResponse.json(
      { error: "This campaign belongs to another wallet." },
      { status: 403 }
    );
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const TITLE_MAX = 80;
  const DESCRIPTION_MAX = 500;

  // ---- Title / description ----
  if (body.title !== undefined || body.description !== undefined) {
    // Locked once open, same principle as winnerCount below.
    if (campaign.state !== "registered" && campaign.state !== "eligible") {
      return NextResponse.json(
        { error: "Campaign details are locked once a campaign opens." },
        { status: 409 }
      );
    }
    // Path A: no context to review before the token has actually earned
    // eligibility. Path B sets these via /lock at register time, when the
    // on-chain state is already "registered" — so this gate is specifically
    // "no Path A metadata while still Registered", not "never Registered".
    if (campaign.origin === "launched" && campaign.state !== "eligible") {
      return NextResponse.json(
        {
          error:
            "Campaign details stay blank until this token meets the eligibility criteria.",
        },
        { status: 409 }
      );
    }

    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title || title.length > TITLE_MAX) {
        return NextResponse.json(
          { error: `Title is required (max ${TITLE_MAX} characters).` },
          { status: 400 }
        );
      }
      update.title = title;
    }
    if (body.description !== undefined) {
      const description = body.description.trim();
      if (!description || description.length > DESCRIPTION_MAX) {
        return NextResponse.json(
          { error: `Description is required (max ${DESCRIPTION_MAX} characters).` },
          { status: 400 }
        );
      }
      update.description = description;
    }
  }

  // ---- Airdrop size ----
  if (body.winnerCount !== undefined) {
    const count = Number(body.winnerCount);
    if (
      !Number.isInteger(count) ||
      count < MIN_WINNERS ||
      count > MAX_WINNERS ||
      count % WINNER_STEP !== 0
    ) {
      return NextResponse.json(
        {
          error: `Winner count must be a whole number from ${MIN_WINNERS} to ${MAX_WINNERS}, in steps of ${WINNER_STEP}.`,
        },
        { status: 400 }
      );
    }
    // Once a campaign is live the size is fixed: participants joined on the
    // strength of it, and changing it mid-flight would move everyone's odds
    // after they had already done the work.
    if (campaign.state !== "registered" && campaign.state !== "eligible") {
      return NextResponse.json(
        { error: "The airdrop size is locked once a campaign opens." },
        { status: 409 }
      );
    }
    update.winner_count = count;
  }

  // ---- Approval request ----
  if (body.requestApproval) {
    const onChain = await readCampaign(token as Address);

    if (onChain.state !== "eligible") {
      return NextResponse.json(
        {
          error:
            onChain.state === "registered"
              ? "This campaign has not met the eligibility criteria yet."
              : `Campaign is '${onChain.state}' on-chain and cannot be submitted for approval.`,
          onChainState: onChain.state,
        },
        { status: 409 }
      );
    }
    if (campaign.approval_status === "pending") {
      return NextResponse.json(
        { error: "Already submitted. The team will review it shortly." },
        { status: 409 }
      );
    }
    // A title must exist by now, either just set above (Path A, this same
    // request) or set earlier at lock time (Path B) — the admin queue has
    // nothing to review without it.
    const { data: current } = await admin
      .from("infofi_campaigns")
      .select("title")
      .eq("token_address", token)
      .maybeSingle();
    if (!update.title && !current?.title) {
      return NextResponse.json(
        { error: "Set a title and description before requesting approval." },
        { status: 400 }
      );
    }

    update.approval_requested_at = new Date().toISOString();
    update.approval_status = "pending";
    update.approval_note = null;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await admin
    .from("infofi_campaigns")
    .update(update)
    .eq("token_address", token);

  if (error) {
    return NextResponse.json({ error: "Could not update the campaign." }, { status: 500 });
  }

  return NextResponse.json({
    updated: true,
    title: update.title ?? null,
    description: update.description ?? null,
    winnerCount: update.winner_count ?? null,
    approvalStatus: update.approval_status ?? campaign.approval_status ?? null,
  });
}
