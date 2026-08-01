/**
 * POST /api/infofi/cron/recompute
 *
 * The daily mindshare job. For every campaign still accepting or running,
 * pulls each participant's qualifying posts from twitterapi.io, scores them,
 * normalises the board into the fixed 100-point pool, and writes ONE
 * immutable snapshot row per participant per day.
 *
 * Deliberately append-only: a re-run for the same UTC day collides on the
 * (token, wallet, snapshot_date) unique constraint and is skipped rather
 * than overwriting. Yesterday's row is what "up 3.1 since yesterday" is
 * measured against, and a final standing that people are paid from should
 * not be silently rewritable.
 *
 * Protected by CRON_SECRET — this hits a metered third-party API once per
 * participant, so an open endpoint would be both a cost and a rate-limit
 * problem.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { computeMindshare, type ParticipantInput } from "@/app/_lib/infofi/mindshare";
import { fetchCampaignEngagement } from "@/app/_lib/infofi/xEngagement";
import { notify } from "@/app/_lib/infofi/notify";

export const dynamic = "force-dynamic";
/** Scoring many participants across many campaigns is not a 10s job. */
export const maxDuration = 300;

/** Campaigns whose leaderboards are still moving. */
const ACTIVE_STATES = ["registered", "eligible", "open"];

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed: with no secret configured the job cannot be triggered at
  // all, rather than becoming a public endpoint that spends API credits.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const snapshotDate = new Date().toISOString().slice(0, 10); // UTC day

  const { data: campaigns, error: campaignsError } = await admin
    .from("infofi_campaigns")
    .select("token_address, state")
    .in("state", ACTIVE_STATES);

  if (campaignsError) {
    return NextResponse.json({ error: "Could not load campaigns." }, { status: 500 });
  }

  const results: {
    tokenAddress: string;
    participants: number;
    written: number;
    failed: number;
  }[] = [];

  for (const campaign of campaigns ?? []) {
    const tokenAddress = campaign.token_address as string;

    const { data: participants } = await admin
      .from("infofi_participants")
      .select("wallet_address, x_username, joined_at, first_scored_at")
      .eq("token_address", tokenAddress);

    if (!participants || participants.length === 0) {
      results.push({ tokenAddress, participants: 0, written: 0, failed: 0 });
      continue;
    }

    // The ticker gates which posts count, so an unrelated viral post does
    // not earn this campaign's tokens.
    const { data: tokenRow } = await admin
      .from("tokens")
      .select("ticker")
      .eq("contract_address", tokenAddress)
      .maybeSingle();
    const ticker = (tokenRow?.ticker as string | undefined) ?? undefined;

    const inputs: ParticipantInput[] = [];
    let failed = 0;

    for (const p of participants) {
      const joinedAtMs = Date.parse(p.joined_at as string);
      try {
        const engagement = await fetchCampaignEngagement(
          p.x_username as string,
          Number.isFinite(joinedAtMs) ? joinedAtMs : 0,
          ticker
        );
        inputs.push({
          walletAddress: p.wallet_address as string,
          xUsername: p.x_username as string,
          engagement,
        });
      } catch {
        // One unreachable profile must not void the whole campaign's day.
        // Score them at zero for today; tomorrow's run picks them back up,
        // and the snapshot records exactly what was observable at the time.
        failed += 1;
        inputs.push({
          walletAddress: p.wallet_address as string,
          xUsername: p.x_username as string,
          engagement: { views: 0, likes: 0, comments: 0, reposts: 0, postCount: 0 },
        });
      }
    }

    const leaderboard = computeMindshare(inputs);

    const rows = leaderboard.map((entry) => ({
      token_address: tokenAddress,
      wallet_address: entry.walletAddress,
      x_username: entry.xUsername,
      snapshot_date: snapshotDate,
      rank: entry.rank,
      mindshare: entry.mindshare,
      raw_score: entry.rawScore,
      views: entry.engagement.views,
      likes: entry.engagement.likes,
      comments: entry.engagement.comments,
      reposts: entry.engagement.reposts,
      post_count: entry.engagement.postCount,
    }));

    // `upsert` with ignoreDuplicates keeps the append-only guarantee: a
    // second run today changes nothing rather than rewriting the snapshot.
    const { error: writeError, count } = await admin
      .from("infofi_mindshare_history")
      .upsert(rows, {
        onConflict: "token_address,wallet_address,snapshot_date",
        ignoreDuplicates: true,
        count: "exact",
      });

    results.push({
      tokenAddress,
      participants: participants.length,
      written: writeError ? 0 : (count ?? rows.length),
      failed,
    });

    // "You made the leaderboard" — the first time a participant ever posts
    // a non-zero score, not every day they continue to hold one. Gated by
    // `first_scored_at` rather than re-deriving it from history, so this
    // stays a single cheap check per participant regardless of how many
    // days a campaign has been running.
    const firstScoredAtByWallet = new Map(
      participants.map((p) => [
        (p.wallet_address as string).toLowerCase(),
        p.first_scored_at as string | null,
      ])
    );
    const newlyScored = leaderboard.filter(
      (entry) =>
        entry.rawScore > 0 &&
        firstScoredAtByWallet.get(entry.walletAddress.toLowerCase()) == null
    );
    for (const entry of newlyScored) {
      await notify(admin, {
        walletAddress: entry.walletAddress,
        type: "leaderboard_entry",
        tokenAddress,
        title: "You're on the leaderboard",
        body: `${ticker ?? tokenAddress}: your posts just earned you a spot on the mindshare leaderboard.`,
        linkUrl: `/campaigns/${tokenAddress}`,
      });
    }
    if (newlyScored.length > 0) {
      await admin
        .from("infofi_participants")
        .update({ first_scored_at: new Date().toISOString() })
        .eq("token_address", tokenAddress)
        .in(
          "wallet_address",
          newlyScored.map((e) => e.walletAddress)
        );
    }
  }

  return NextResponse.json({ snapshotDate, campaigns: results });
}

// Vercel Cron only ever issues GET requests, and automatically attaches
// `Authorization: Bearer $CRON_SECRET` to them when that env var is set on
// the project — the same header `isAuthorized` already checks above.
export const GET = POST;
