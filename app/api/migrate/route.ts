/**
 * POST /api/migrate  { curveAddress }
 *
 * Fires `GraduationMigrator.migrate(curve)` for a curve that has graduated
 * but not yet migrated.
 *
 * WHY THIS EXISTS ALONGSIDE THE CRON
 *
 * The hourly poke job (see /api/infofi/cron/poke) already migrates graduated
 * curves, and remains the backstop that guarantees it eventually happens with
 * nobody watching. But graduation is instantaneous and migration is what
 * turns a halted curve into a tradeable pool, so waiting up to an hour for
 * the next cron tick leaves the token frozen — visibly graduated, with no
 * market — for no reason. This route lets the token page trigger it the
 * moment it observes the state, cutting that window to seconds.
 *
 * WHY IT IS SAFE TO LEAVE UNAUTHENTICATED
 *
 * `migrate` is permissionless on-chain by design: anyone may call it once
 * `curve.graduated()` is true, and the assets can only ever land in the
 * newly-seeded pool and then the burn address regardless of who calls. So
 * this route grants no capability that isn't already public — it only pays
 * the gas on the caller's behalf.
 *
 * The gas cannot be drained either, because every call is simulated first
 * and a curve can only migrate once:
 *
 *   - not graduated yet        -> simulation reverts, no gas spent
 *   - already migrated         -> simulation reverts, no gas spent
 *   - not a real curve         -> simulation reverts, no gas spent
 *
 * The only thing an attacker can force is a migration that was going to
 * happen anyway, slightly sooner — which is the desired outcome, not an
 * attack.
 */
import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { publicClient, pokerWallet } from "@/app/_lib/infofi/chain";
import { GRADUATION_MIGRATOR_ABI } from "@/app/_lib/contracts/GraduationMigrator";
import { GRADUATION_MIGRATOR_ADDRESS } from "@/app/_lib/contracts/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { curveAddress?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const curve = body.curveAddress?.toLowerCase() ?? "";
  if (!isAddress(curve)) {
    return NextResponse.json({ error: "A valid curveAddress is required." }, { status: 400 });
  }

  const poker = pokerWallet();
  if (!poker) {
    // No key configured — the hourly cron is equally unable to migrate, so
    // say so plainly rather than pretending this succeeded.
    return NextResponse.json(
      { migrated: false, reason: "No poker key configured." },
      { status: 503 }
    );
  }

  try {
    // Simulating is what makes this endpoint free to call: every
    // "shouldn't migrate" case reverts here, before any gas is spent.
    const { request: simulated } = await publicClient().simulateContract({
      address: GRADUATION_MIGRATOR_ADDRESS as Address,
      abi: GRADUATION_MIGRATOR_ABI,
      functionName: "migrate",
      args: [curve as Address],
      account: poker.account,
    });

    const txHash = await poker.client.writeContract(simulated);
    return NextResponse.json({ migrated: true, txHash });
  } catch (err) {
    // Already migrated / not graduated yet are the ordinary cases here, not
    // failures — the caller polls state anyway, so a 200 with `migrated:
    // false` keeps this from looking like an error in the client's console.
    return NextResponse.json({
      migrated: false,
      reason: err instanceof Error ? err.message.slice(0, 140) : "migrate failed",
    });
  }
}
