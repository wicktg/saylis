/**
 * GET /api/referral/[wallet]
 *
 * Everything the /referral page needs for one wallet: their shareable
 * code, current withdrawable balance (live on-chain read), and the full
 * list of everyone they've referred with a join date and lifetime earnings
 * generated from each.
 *
 * The referral relationship and every dollar it ever earned are on-chain
 * facts (ReferralVault's `ReferralRegistered`/`ReferralAccrued` events) —
 * this route is read-only indexing over those logs, the same pattern
 * the app uses elsewhere. `referralFeesOwed` (current
 * balance) is a live read since it changes on withdrawal; the event logs
 * are the append-only record "earnings generated" is computed from, so a
 * withdrawal never erases where the money came from.
 */
import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  isAddress,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Log,
} from "viem";
import { robinhood } from "viem/chains";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { REFERRAL_VAULT_ADDRESS } from "@/app/_lib/contracts/config";
import { REFERRAL_VAULT_ABI } from "@/app/_lib/contracts/ReferralVault";
import { DEV_MOCKS, MOCK_REFERRALS } from "@/app/_lib/devMocks";

export const dynamic = "force-dynamic";

const REGISTERED_EVENT = parseAbiItem(
  "event ReferralRegistered(address indexed referred, address indexed referrer)"
);
const ACCRUED_EVENT = parseAbiItem(
  "event ReferralAccrued(address indexed referrer, address indexed curve, uint256 amount)"
);

/**
 * Block ReferralVault was deployed in. No vault event can predate it, so
 * starting here rather than at 0 is free accuracy — and it keeps the scan
 * proportional to the vault's life rather than the chain's, which matters
 * on a network producing ten blocks a second. Verified against the
 * contract-creation transaction
 * (0xdb907779...e829) on Robinhood Chain's Blockscout.
 */
const VAULT_DEPLOY_BLOCK = 25_747_533n;

/**
 * The endpoint WITHOUT a log-range cap.
 *
 * `upstreamRpcUrl()` is Alchemy, whose free tier rejects any `eth_getLogs`
 * spanning more than 10 blocks. The vault has ~4.6M blocks of history, so
 * every history read failed and the page told users their referral list
 * "cannot be read right now" — which was never true of the chain, only of
 * the endpoint we happened to ask. Measured: the public node returns that
 * entire range in one request.
 *
 * Deliberately NOT `upstreamRpcUrl()` and deliberately not configurable:
 * pointing this at a capped endpoint silently reintroduces the bug, and
 * the failure mode is a plausible-looking empty state rather than an
 * error.
 */
const UNCAPPED_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

function client() {
  // Server-side route, so it hits the endpoint directly rather than the
  // browser's /api/rpc proxy.
  return createPublicClient({ chain: robinhood, transport: http(UNCAPPED_RPC_URL) });
}

/**
 * One wide `eth_getLogs` over the vault's whole lifetime.
 *
 * Against `UNCAPPED_RPC_URL` this is the normal path and it succeeds: the
 * node has no range limit, so ~4.6M blocks come back in a single request.
 * It used to run against a capped endpoint, where it could only ever fail —
 * and chunking around a 10-block cap was never an option either, since that
 * span needs ~460,000 requests, far beyond one serverless invocation.
 *
 * `null` is kept for a genuine failure (the node is down or slow), because
 * it must never be conflated with `[]` ("no referrals"): showing a real
 * referrer a confident zero is worse than showing them nothing. What
 * changed is that `null` is now the exception rather than the guaranteed
 * outcome.
 */
async function tryGetLogs<const abiEvent extends AbiEvent>(
  publicClient: ReturnType<typeof client>,
  params: { address: Address; event: abiEvent; args?: Record<string, unknown> }
): Promise<Log[] | null> {
  try {
    return await publicClient.getLogs({
      address: params.address,
      event: params.event,
      // viem types `args` against the exact literal event shape, which this
      // generic wrapper deliberately erases (callers pass whatever
      // indexed-arg filter their own event needs) -- narrowed back with
      // `as never` at this one boundary rather than losing the wrapper.
      args: params.args as never,
      fromBlock: VAULT_DEPLOY_BLOCK,
      toBlock: "latest",
    });
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: { wallet: string } }
) {
  const wallet = params.wallet?.toLowerCase();
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  }

  try {
    const response = await buildResponse(wallet);
    // Substituted rather than merged, and only when there is genuinely
    // nothing to show: blending fixture balances into real ones would
    // produce totals that mean nothing. A wallet with real referrals keeps
    // seeing them.
    if (DEV_MOCKS) {
      const body = await response.clone().json();
      if (!body.referred?.length) return NextResponse.json(MOCK_REFERRALS);
    }
    return response;
  } catch (error) {
    // Anything escaping here previously produced a 500 with an empty body,
    // which the browser reported as a JSON parse error rather than as a
    // server failure. Always emit a JSON body so the client's
    // `payload?.error` path has something real to show.
    // A dev box usually has no vault deployed and no archive node, so the
    // read above throws long before it can report "no referrals".
    if (DEV_MOCKS) return NextResponse.json(MOCK_REFERRALS);

    console.error("[referral] failed for", wallet, error);
    return NextResponse.json(
      { error: "Could not load referral data. Please try again." },
      { status: 500 }
    );
  }
}

async function buildResponse(wallet: string) {
  const admin = getSupabaseAdmin();
  const publicClient = client();

  const { data: codeRow } = await admin
    .from("referral_codes")
    .select("code")
    .eq("wallet_address", wallet)
    .maybeSingle();

  const [currentBalance, registeredLogs, accruedLogs] = await Promise.all([
    publicClient.readContract({
      address: REFERRAL_VAULT_ADDRESS as Address,
      abi: REFERRAL_VAULT_ABI,
      functionName: "referralFeesOwed",
      args: [wallet as Address],
    }) as Promise<bigint>,
    tryGetLogs(publicClient, {
      address: REFERRAL_VAULT_ADDRESS as Address,
      event: REGISTERED_EVENT,
      args: { referrer: wallet as Address },
    }),
    tryGetLogs(publicClient, {
      address: REFERRAL_VAULT_ADDRESS as Address,
      event: ACCRUED_EVENT,
      args: { referrer: wallet as Address },
    }),
  ]);

  // The balance is a plain contract read and always works, so the page can
  // still show what is owed and still let the user claim it even when log
  // history is unavailable. Those are the two things that involve real
  // money; the referred-wallet breakdown is reporting.
  if (registeredLogs === null || accruedLogs === null) {
    return NextResponse.json({
      code: codeRow?.code ?? null,
      currentBalanceRaw: currentBalance.toString(),
      lifetimeTotalRaw: "0",
      referred: [],
      historyAvailable: false,
    });
  }

  // Join dates: one block-timestamp lookup per distinct block among the
  // (usually small) set of registration events.
  const blockNumbers = [
    ...new Set(registeredLogs.map((log) => log.blockNumber).filter((b): b is bigint => b !== null)),
  ];
  const timestampByBlock = new Map<string, number>();
  await Promise.all(
    blockNumbers.map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber });
      timestampByBlock.set(blockNumber.toString(), Number(block.timestamp));
    })
  );

  const referredWallets = registeredLogs
    .map((log) => {
      const args = (log as unknown as { args: { referred?: Address } }).args;
      const referred = args.referred?.toLowerCase();
      if (!referred || log.blockNumber === null) return null;
      const ts = timestampByBlock.get(log.blockNumber.toString());
      return {
        walletAddress: referred,
        joinedAt: ts ? new Date(ts * 1000).toISOString() : null,
      };
    })
    .filter((r): r is { walletAddress: string; joinedAt: string | null } => r !== null);

  // Resolve every accrual's curve -> that curve's creator wallet, so
  // earnings can be attributed to the REFERRED WALLET (which may run
  // several curves over its lifetime) rather than left as opaque
  // per-curve numbers.
  const curveAddresses = [
    ...new Set(
      accruedLogs
        .map((log) => (log as unknown as { args: { curve?: Address } }).args.curve?.toLowerCase())
        .filter((c): c is string => Boolean(c))
    ),
  ];
  const { data: tokenRows } = curveAddresses.length
    ? await admin
        .from("tokens")
        .select("curve_address, creator_wallet_address")
        .in("curve_address", curveAddresses)
    : { data: [] };
  const creatorByCurve = new Map(
    (tokenRows ?? []).map((t) => [t.curve_address as string, t.creator_wallet_address as string])
  );

  const earningsByReferred = new Map<string, bigint>();
  let lifetimeTotal = 0n;
  for (const log of accruedLogs) {
    const args = (log as unknown as { args: { curve?: Address; amount?: bigint } }).args;
    const curve = args.curve?.toLowerCase();
    const amount = args.amount ?? 0n;
    lifetimeTotal += amount;
    const creator = curve ? creatorByCurve.get(curve) : undefined;
    if (creator) {
      earningsByReferred.set(creator, (earningsByReferred.get(creator) ?? 0n) + amount);
    }
  }

  const referred = referredWallets.map((r) => ({
    walletAddress: r.walletAddress,
    joinedAt: r.joinedAt,
    earningsRaw: (earningsByReferred.get(r.walletAddress) ?? 0n).toString(),
  }));

  return NextResponse.json({
    code: codeRow?.code ?? null,
    currentBalanceRaw: currentBalance.toString(),
    lifetimeTotalRaw: lifetimeTotal.toString(),
    referred,
    historyAvailable: true,
  });
}
