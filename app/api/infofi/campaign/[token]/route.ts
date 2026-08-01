/**
 * GET /api/infofi/campaign/[token]
 *
 * Everything the campaign page needs in one read: the campaign's mirrored
 * on-chain state, today's leaderboard with each participant's movement
 * since yesterday, and — once settled — the caller's own claim amount and
 * merkle proof.
 *
 * Read-only and public. Custody facts (pool size, state, root) are mirrored
 * from chain and are re-verified on-chain at claim time, so a stale or wrong
 * row here cannot cause a bad payout — only a confusing screen.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { withDailyDelta, type ScoredParticipant } from "@/app/_lib/infofi/mindshare";

export const dynamic = "force-dynamic";

type MindshareRow = {
  wallet_address: string;
  x_username: string;
  snapshot_date: string;
  rank: number;
  mindshare: number | string;
  raw_score: number | string;
  views: number | string;
  likes: number | string;
  comments: number | string;
  reposts: number | string;
  post_count: number;
};

function toScored(row: MindshareRow): ScoredParticipant {
  return {
    walletAddress: row.wallet_address,
    xUsername: row.x_username,
    rank: row.rank,
    mindshare: Number(row.mindshare),
    rawScore: Number(row.raw_score),
    engagement: {
      views: Number(row.views),
      likes: Number(row.likes),
      comments: Number(row.comments),
      reposts: Number(row.reposts),
      postCount: row.post_count,
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: { token: string } }
) {
  const tokenAddress = params.token?.toLowerCase();
  if (!tokenAddress || !isAddress(tokenAddress)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  const wallet = new URL(request.url).searchParams.get("wallet")?.toLowerCase() ?? null;
  const admin = getSupabaseAdmin();

  const { data: campaign, error: campaignError } = await admin
    .from("infofi_campaigns")
    .select("*")
    .eq("token_address", tokenAddress)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json({ error: "Could not load the campaign." }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "No InfoFi campaign for this token." }, { status: 404 });
  }

  // Latest snapshot date, then that date's full board plus the one before it
  // so movement can be computed without a second round trip per participant.
  const { data: latest } = await admin
    .from("infofi_mindshare_history")
    .select("snapshot_date")
    .eq("token_address", tokenAddress)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leaderboard: ReturnType<typeof withDailyDelta> = [];

  if (latest?.snapshot_date) {
    const today = latest.snapshot_date as string;
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);

    const [{ data: todayRows }, { data: yesterdayRows }] = await Promise.all([
      admin
        .from("infofi_mindshare_history")
        .select("*")
        .eq("token_address", tokenAddress)
        .eq("snapshot_date", today)
        .order("rank", { ascending: true }),
      admin
        .from("infofi_mindshare_history")
        .select("wallet_address, mindshare, rank")
        .eq("token_address", tokenAddress)
        .eq("snapshot_date", yesterdayKey),
    ]);

    leaderboard = withDailyDelta(
      ((todayRows ?? []) as MindshareRow[]).map(toScored),
      (
        (yesterdayRows ?? []) as {
          wallet_address: string;
          mindshare: number | string;
          rank: number;
        }[]
      ).map((r) => ({
        walletAddress: r.wallet_address,
        mindshare: Number(r.mindshare),
        rank: r.rank,
      }))
    );
  }

  // The caller's own participation + claim, only when they identify a wallet.
  let viewer: {
    joined: boolean;
    joinedAt: string | null;
    xUsername: string | null;
    allocation: { amountRaw: string; proof: string[]; finalMindshare: number } | null;
  } | null = null;

  if (wallet && isAddress(wallet)) {
    const [{ data: participant }, { data: allocation }] = await Promise.all([
      admin
        .from("infofi_participants")
        .select("joined_at, x_username")
        .eq("token_address", tokenAddress)
        .eq("wallet_address", wallet)
        .maybeSingle(),
      admin
        .from("infofi_allocations")
        .select("amount_raw, merkle_proof, final_mindshare")
        .eq("token_address", tokenAddress)
        .eq("wallet_address", wallet)
        .maybeSingle(),
    ]);

    viewer = {
      joined: Boolean(participant),
      joinedAt: (participant?.joined_at as string) ?? null,
      xUsername: (participant?.x_username as string) ?? null,
      allocation: allocation
        ? {
            amountRaw: allocation.amount_raw as string,
            proof: (allocation.merkle_proof as string[]) ?? [],
            finalMindshare: Number(allocation.final_mindshare),
          }
        : null,
    };
  }

  return NextResponse.json({
    campaign: {
      tokenAddress: campaign.token_address,
      curveAddress: campaign.curve_address,
      ownerWallet: campaign.owner_wallet,
      state: campaign.state,
      allocationRaw: campaign.allocation_raw,
      eligibleAt: campaign.eligible_at,
      openedAt: campaign.opened_at,
      windowEndsAt: campaign.window_ends_at,
      claimDeadlineAt: campaign.claim_deadline_at,
      merkleRoot: campaign.merkle_root,
      lastMcapUsd18: campaign.last_mcap_usd18,
      lastMcapAt: campaign.last_mcap_at,
    },
    leaderboard,
    viewer,
  });
}
