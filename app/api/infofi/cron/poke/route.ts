/**
 * POST /api/infofi/cron/poke
 *
 * Three jobs in one pass, because they read the same chain state:
 *
 *   1. SYNC — mirror each token's on-chain campaign into Supabase. This is
 *      also what CREATES the `infofi_campaigns` row: a pool is registered
 *      inside the curve's constructor, so there is no frontend moment to
 *      write it, and the chain is the only source of truth anyway.
 *
 *   2. POKE — call `recordMarketCap` on campaigns still awaiting
 *      eligibility. The contract cannot watch price on its own; without a
 *      poker, `aboveSince` never advances and NO token ever becomes
 *      eligible. This is the job that makes the $120k/24h rule real.
 *
 *   3. MIGRATE — call `GraduationMigrator.migrate(curve)` for any curve
 *      that has graduated but not yet migrated. BondingCurve deliberately
 *      never does this itself (see its NatSpec — DEX migration is kept out
 *      of the trading path on purpose), so without a poker it would sit
 *      graduated-but-illiquid forever, waiting on someone to call it by
 *      hand. `migrate` is fully permissionless (anyone can call it once
 *      `curve.graduated()`), same trust model as `recordMarketCap`.
 *
 * Poking is permissionless and non-custodial — it can only advance or reset
 * a timer (or trigger a migration) that anyone could trigger themselves. It
 * still costs gas, so it is skipped entirely when no
 * `INFOFI_POKER_PRIVATE_KEY` is configured.
 *
 * Sync always runs, even with no poker key, so the mirror stays fresh.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import {
  campaignAbi,
  campaignAddress,
  pokerWallet,
  publicClient,
  readCampaign,
  tsToIso,
} from "@/app/_lib/infofi/chain";
import { notify, notifyMany } from "@/app/_lib/infofi/notify";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { GRADUATION_MIGRATOR_ABI } from "@/app/_lib/contracts/GraduationMigrator";
import { GRADUATION_MIGRATOR_ADDRESS } from "@/app/_lib/contracts/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Only these states still care about price. */
const POKEABLE = new Set(["registered", "eligible"]);

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (/^0x0+$/.test(campaignAddress)) {
    return NextResponse.json(
      { error: "INFOFI_CAMPAIGN_ADDRESS is not set." },
      { status: 500 }
    );
  }

  const admin = getSupabaseAdmin();
  const poker = pokerWallet();

  // Every launched token is a candidate: a campaign row may not exist yet,
  // which is exactly the case sync is here to fix.
  const { data: tokens, error } = await admin
    .from("tokens")
    .select(
      "contract_address, curve_address, ticker, creator_wallet_address, graduated_notified_at, migrated_notified_at"
    );

  if (error) {
    return NextResponse.json({ error: "Could not load tokens." }, { status: 500 });
  }

  // Path A (mint-time allocation) never gets an `owner_wallet` any other
  // way — there is no frontend moment to write it, unlike Path B where the
  // admin's invite sets it explicitly. Fetched once, up front, so the loop
  // below can tell a Path B row (owner_wallet already the invited wallet,
  // NEVER the token's original launcher) apart from a Path A row that still
  // needs it backfilled from `tokens.creator_wallet_address`. Also carries
  // the one-time lifecycle notification markers so campaign_ended /
  // claim_period_ended never fire twice.
  const { data: existingCampaigns } = await admin
    .from("infofi_campaigns")
    .select("token_address, origin, owner_wallet, ended_notified_at, claim_closed_notified_at");
  const campaignMetaByToken = new Map(
    (existingCampaigns ?? []).map((c) => [
      c.token_address as string,
      {
        origin: c.origin as string | null,
        ownerWallet: c.owner_wallet as string | null,
        endedNotifiedAt: c.ended_notified_at as string | null,
        claimClosedNotifiedAt: c.claim_closed_notified_at as string | null,
      },
    ])
  );

  const synced: string[] = [];
  const poked: { token: string; txHash?: string; eligible?: boolean; error?: string }[] = [];
  const migrated: { token: string; curve: string; txHash?: string; pool?: string; error?: string }[] =
    [];

  for (const row of tokens ?? []) {
    const token = (row.contract_address as string)?.toLowerCase();
    const curveAddress = (row.curve_address as string)?.toLowerCase();
    if (!token || !isAddress(token)) continue;

    const creatorWallet = (row.creator_wallet_address as string | null)?.toLowerCase() ?? null;
    const ticker = (row.ticker as string) || token;

    // ---- Graduation/migration reads + notifications (read-only; no poker
    // needed) + the actual migrate trigger (mutating; needs a poker key) ----
    // Independent of the campaign state machine below — runs for every
    // token with a curve, not just ones that opted into InfoFi.
    if (curveAddress && isAddress(curveAddress)) {
      try {
        const [isGraduated, isMigratedBefore] = await Promise.all([
          publicClient().readContract({
            address: curveAddress as Address,
            abi: BONDING_CURVE_ABI,
            functionName: "graduated",
          }) as Promise<boolean>,
          publicClient().readContract({
            address: curveAddress as Address,
            abi: BONDING_CURVE_ABI,
            functionName: "migrationExecuted",
          }) as Promise<boolean>,
        ]);

        if (isGraduated && !row.graduated_notified_at && creatorWallet) {
          await notify(admin, {
            walletAddress: creatorWallet,
            type: "graduated",
            tokenAddress: token,
            title: "Your token graduated",
            body: `${ticker} has raised enough to graduate off the bonding curve.`,
            linkUrl: `/token/${token}`,
          });
          await admin
            .from("tokens")
            .update({ graduated_notified_at: new Date().toISOString() })
            .eq("contract_address", token);
        }

        let isMigratedAfter = isMigratedBefore;
        if (poker && isGraduated && !isMigratedBefore) {
          const { request: simulated, result } = await publicClient().simulateContract({
            address: GRADUATION_MIGRATOR_ADDRESS,
            abi: GRADUATION_MIGRATOR_ABI,
            functionName: "migrate",
            args: [curveAddress as Address],
            account: poker.account,
          });
          const txHash = await poker.client.writeContract(simulated);
          migrated.push({ token, curve: curveAddress, txHash, pool: result[0] });
          isMigratedAfter = true;
        }

        if (isMigratedAfter && !row.migrated_notified_at && creatorWallet) {
          await notify(admin, {
            walletAddress: creatorWallet,
            type: "migrated",
            tokenAddress: token,
            title: "Your token migrated",
            body: `${ticker} now has a live Uniswap pool.`,
            linkUrl: `/token/${token}`,
          });
          await admin
            .from("tokens")
            .update({ migrated_notified_at: new Date().toISOString() })
            .eq("contract_address", token);
        }
      } catch (err) {
        // Ordinary conditions (not yet graduated, already migrated by
        // someone else, stale migrator address for an older token) throw
        // here too — logged, not fatal to the rest of this pass.
        migrated.push({
          token,
          curve: curveAddress,
          error: err instanceof Error ? err.message.slice(0, 140) : "migrate failed",
        });
      }
    }

    let campaign;
    try {
      campaign = await readCampaign(token as Address);
    } catch {
      continue; // unreachable RPC for this token; next run picks it up
    }

    // `none` means this launch carved out nothing — there is no campaign to
    // track and never will be.
    if (campaign.state === "none") continue;

    // Only backfill owner_wallet for a Path A row (origin is 'launched',
    // the schema default, or the row doesn't exist yet). A Path B row's
    // origin is always 'post_launch' by the time poke ever sees it — the
    // invite route sets both together — so this never clobbers the
    // invited wallet with the token's original launcher.
    const meta = campaignMetaByToken.get(token);
    const isPathB = meta?.origin === "post_launch";
    // The real recipient for every campaign notification below — NEVER
    // on-chain `campaign.owner` (that's `msg.sender` of whichever call
    // registered the pool: the curve contract itself for Path A, or the
    // admin's own wallet for Path B — neither is the actual creator/invitee).
    const ownerWallet = meta?.ownerWallet ?? (isPathB ? null : creatorWallet);

    const { error: upsertError } = await admin.from("infofi_campaigns").upsert(
      {
        token_address: token,
        curve_address: campaign.curve.toLowerCase(),
        state: campaign.state,
        allocation_raw: campaign.allocation.toString(),
        eligible_at:
          campaign.state === "eligible" || campaign.aboveSince > 0n
            ? tsToIso(campaign.aboveSince)
            : null,
        opened_at: tsToIso(campaign.openedAt),
        window_ends_at: tsToIso(campaign.windowEnds),
        claim_deadline_at: tsToIso(campaign.claimDeadline),
        merkle_root:
          campaign.merkleRoot ===
          "0x0000000000000000000000000000000000000000000000000000000000000000"
            ? null
            : campaign.merkleRoot,
        updated_at: new Date().toISOString(),
        ...(isPathB || !creatorWallet ? {} : { owner_wallet: creatorWallet }),
      },
      { onConflict: "token_address" }
    );
    if (!upsertError) synced.push(token);

    // ---- Market-cap snapshot (free view call, no poker needed) ----
    // Feeds the admin dashboard's mini-chart. Deliberately decoupled from
    // the poke transaction below: this is read-only telemetry for a human
    // reviewer, not part of the eligibility state machine, so it should
    // keep working even when no poker key is configured.
    if (!campaign.isExternal) {
      try {
        const [mcap, valid] = (await publicClient().readContract({
          address: campaignAddress,
          abi: campaignAbi,
          functionName: "marketCapUsd",
          args: [token as Address],
        })) as [bigint, boolean];

        if (valid) {
          const nowIso = new Date().toISOString();
          await admin
            .from("infofi_campaigns")
            .update({ last_mcap_usd18: mcap.toString(), last_mcap_at: nowIso })
            .eq("token_address", token);
          await admin
            .from("infofi_mcap_snapshots")
            .insert({ token_address: token, mcap_usd18: mcap.toString(), sampled_at: nowIso });
        }
      } catch {
        // Best-effort telemetry only.
      }
    }

    // ---- Lifecycle notifications (read-only; no poker needed) ----
    const nowTs = BigInt(Math.floor(Date.now() / 1000));

    // Window closed: every participant who joined, plus the owner, told
    // once — regardless of whether the team has actually settled it yet.
    // The 7-day POSTING window closing is a fact about time, independent of
    // when a human gets around to publishing results.
    if (
      campaign.windowEnds > 0n &&
      nowTs >= campaign.windowEnds &&
      !meta?.endedNotifiedAt
    ) {
      const { data: participantRows } = await admin
        .from("infofi_participants")
        .select("wallet_address")
        .eq("token_address", token);
      const recipients = (participantRows ?? []).map((p) => p.wallet_address as string);
      if (ownerWallet) recipients.push(ownerWallet);

      if (recipients.length > 0) {
        await notifyMany(admin, recipients, {
          type: "campaign_ended",
          tokenAddress: token,
          title: "Campaign ended",
          body: `${ticker}'s InfoFi campaign window has closed. Results and claims follow once the team publishes them.`,
          linkUrl: `/campaigns/${token}`,
        });
      }
      await admin
        .from("infofi_campaigns")
        .update({ ended_notified_at: new Date().toISOString() })
        .eq("token_address", token);
    }

    // Claim window closed: only the actual winners (infofi_allocations),
    // never every participant — most joiners never earned an allocation.
    if (
      campaign.state === "settled" &&
      campaign.claimDeadline > 0n &&
      nowTs >= campaign.claimDeadline &&
      !meta?.claimClosedNotifiedAt
    ) {
      const { data: allocationRows } = await admin
        .from("infofi_allocations")
        .select("wallet_address")
        .eq("token_address", token);
      const recipients = (allocationRows ?? []).map((a) => a.wallet_address as string);

      if (recipients.length > 0) {
        await notifyMany(admin, recipients, {
          type: "claim_period_ended",
          tokenAddress: token,
          title: "Claim window closed",
          body: `${ticker}'s claim window has closed. Anything unclaimed is now burnable.`,
          linkUrl: `/campaigns/${token}`,
        });
      }
      await admin
        .from("infofi_campaigns")
        .update({ claim_closed_notified_at: new Date().toISOString() })
        .eq("token_address", token);
    }

    // ---- Poke (mutating; needs a poker key and gas) ----
    if (!poker || !POKEABLE.has(campaign.state) || campaign.isExternal) continue;

    try {
      // Simulate first. A poke reverts when the price feed is stale or the
      // token has graduated without a TWAP-capable pool yet — both are
      // ordinary conditions, not failures, and simulating means we neither
      // pay gas nor log noise for them.
      const { request: simulated, result } = await publicClient().simulateContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "recordMarketCap",
        args: [token as Address],
        account: poker.account,
      });

      const txHash = await poker.client.writeContract(simulated);
      poked.push({ token, txHash, eligible: Boolean(result) });

      // Fold the poke's own result back into the mirror.
      //
      // The upsert above ran BEFORE this transaction, so it recorded the
      // PRE-poke state. Without this, a token that just became eligible
      // kept showing as `registered` on the creator's Campaigns page until
      // the next cron tick happened to re-read it — the state changed
      // on-chain, the creator was notified it had changed, and the page
      // still disagreed for another full interval.
      if (result && campaign.state === "registered") {
        const nowIso = new Date().toISOString();
        await admin
          .from("infofi_campaigns")
          .update({ state: "eligible", eligible_at: nowIso, updated_at: nowIso })
          .eq("token_address", token);
      }

      // Notify the creator exactly on the registered -> eligible crossing,
      // not on every poke that merely confirms it is still eligible.
      if (result && campaign.state === "registered" && ownerWallet) {
        await notify(admin, {
          walletAddress: ownerWallet,
          type: "eligible",
          tokenAddress: token,
          title: "Your token hit InfoFi criteria",
          body: `${ticker} has met the eligibility criteria for an InfoFi campaign. Head to Campaigns to add a title and submit it for approval.`,
          linkUrl: "/campaigns",
        });
      }
    } catch (err) {
      poked.push({
        token,
        error: err instanceof Error ? err.message.slice(0, 140) : "poke failed",
      });
    }
  }

  return NextResponse.json({
    pokerConfigured: Boolean(poker),
    pokerAddress: poker?.account.address ?? null,
    synced: synced.length,
    syncedTokens: synced,
    poked,
    migrated,
  });
}

// Vercel Cron only ever issues GET requests, and automatically attaches
// `Authorization: Bearer $CRON_SECRET` to them when that env var is set on
// the project — the same header `isAuthorized` already checks above.
export const GET = POST;
