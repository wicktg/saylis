/**
 * POST /api/infofi/settle/[token]
 *
 * Turns a finished campaign's final mindshare snapshot into payable
 * allocations: computes each participant's share of the pool, builds the
 * merkle tree, stores every leaf and proof, and returns the root.
 *
 * It deliberately does NOT publish the root on-chain. `publishResults` is
 * team-only and decides who gets paid, so it stays a manual transaction
 * signed by the multisig — a compromised server should not be able to
 * redirect a payout. This endpoint only prepares the root; a human still
 * looks at it and sends it.
 *
 * Safe to re-run: it recomputes from the same immutable snapshot and
 * overwrites its own allocation rows. Once the root is published on-chain,
 * re-running cannot change anything that matters, because the contract
 * verifies proofs against the published root, not against this table.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { allocatePool, type ScoredParticipant } from "@/app/_lib/infofi/mindshare";
import { buildMerkleTree, verifyProof } from "@/app/_lib/infofi/merkle";
import { readCampaign } from "@/app/_lib/infofi/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const token = params.token?.toLowerCase();
  if (!token || !isAddress(token)) {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // The CHAIN decides whether this is settleable, not our mirror — the
  // mirror can lag, and computing a root for a campaign that is not
  // actually finished would produce numbers someone might act on.
  const campaign = await readCampaign(token as Address);

  if (campaign.state !== "open") {
    return NextResponse.json(
      {
        error: `Campaign is '${campaign.state}' on-chain; only an 'open' campaign can be settled.`,
      },
      { status: 409 }
    );
  }

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (nowSec < campaign.windowEnds) {
    return NextResponse.json(
      {
        error: "Campaign window has not closed yet.",
        windowEndsAt: new Date(Number(campaign.windowEnds) * 1000).toISOString(),
      },
      { status: 409 }
    );
  }

  // Final standing = the most recent daily snapshot. Snapshots are
  // append-only, so this is a fixed historical record rather than a fresh
  // recompute that could shift after the fact.
  const { data: latest } = await admin
    .from("infofi_mindshare_history")
    .select("snapshot_date")
    .eq("token_address", token)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest?.snapshot_date) {
    return NextResponse.json(
      { error: "No mindshare snapshots exist for this campaign." },
      { status: 409 }
    );
  }

  const { data: rows } = await admin
    .from("infofi_mindshare_history")
    .select("wallet_address, x_username, rank, mindshare, raw_score")
    .eq("token_address", token)
    .eq("snapshot_date", latest.snapshot_date)
    .order("rank", { ascending: true });

  const leaderboard: ScoredParticipant[] = (rows ?? []).map((r) => ({
    walletAddress: r.wallet_address as string,
    xUsername: r.x_username as string,
    rank: r.rank as number,
    mindshare: Number(r.mindshare),
    rawScore: Number(r.raw_score),
    engagement: { views: 0, likes: 0, comments: 0, reposts: 0, postCount: 0 },
  }));

  const allocations = allocatePool(leaderboard, campaign.allocation);

  if (allocations.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nobody scored above zero, so there is nothing to allocate. Let the claim window lapse and burn the pool.",
        snapshotDate: latest.snapshot_date,
      },
      { status: 409 }
    );
  }

  const tree = buildMerkleTree(
    allocations.map((a) => ({
      account: a.walletAddress as `0x${string}`,
      amountRaw: a.amountRaw,
    }))
  );

  // Verify every proof locally before this root can be published. A root is
  // immutable once on-chain and the pool is already committed, so a tree bug
  // discovered afterwards would strand real tokens until they burn.
  for (const a of allocations) {
    const proof = tree.proofs.get(a.walletAddress.toLowerCase()) ?? [];
    const ok = verifyProof(
      tree.root,
      { account: a.walletAddress as `0x${string}`, amountRaw: a.amountRaw },
      proof
    );
    if (!ok) {
      return NextResponse.json(
        { error: `Internal: proof verification failed for ${a.walletAddress}.` },
        { status: 500 }
      );
    }
  }

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amountRaw, 0n);
  if (totalAllocated > campaign.allocation) {
    return NextResponse.json(
      { error: "Internal: allocations exceed the pool." },
      { status: 500 }
    );
  }

  await admin.from("infofi_allocations").delete().eq("token_address", token);

  const { error: insertError } = await admin.from("infofi_allocations").insert(
    allocations.map((a) => ({
      token_address: token,
      wallet_address: a.walletAddress,
      x_username: a.xUsername,
      final_mindshare: a.mindshare,
      amount_raw: a.amountRaw.toString(),
      merkle_proof: tree.proofs.get(a.walletAddress.toLowerCase()) ?? [],
    }))
  );

  if (insertError) {
    return NextResponse.json(
      { error: "Could not store allocations." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    tokenAddress: token,
    snapshotDate: latest.snapshot_date,
    merkleRoot: tree.root,
    winners: allocations.length,
    poolRaw: campaign.allocation.toString(),
    allocatedRaw: totalAllocated.toString(),
    // Largest-remainder should leave nothing behind; surfaced so a non-zero
    // value is visible rather than quietly burning later.
    unallocatedRaw: (campaign.allocation - totalAllocated).toString(),
    nextStep: {
      description:
        "Publish this root on-chain from the team multisig. Nothing is claimable until then.",
      contract: "InfoFiCampaign",
      method: "publishResults(address token, bytes32 merkleRoot)",
      args: [token, tree.root],
    },
  });
}
