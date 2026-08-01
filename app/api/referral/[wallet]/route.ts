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
 * useCurveTrades uses for trade history. `referralFeesOwed` (current
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
import { arbitrumSepolia } from "viem/chains";
import { getSupabaseAdmin } from "@/app/_lib/supabaseAdmin";
import { REFERRAL_VAULT_ADDRESS } from "@/app/_lib/contracts/config";
import { REFERRAL_VAULT_ABI } from "@/app/_lib/contracts/ReferralVault";

export const dynamic = "force-dynamic";

const REGISTERED_EVENT = parseAbiItem(
  "event ReferralRegistered(address indexed referred, address indexed referrer)"
);
const ACCRUED_EVENT = parseAbiItem(
  "event ReferralAccrued(address indexed referrer, address indexed curve, uint256 amount)"
);

const FALLBACK_CHUNK_BLOCKS = 500_000n;
const FALLBACK_MAX_CHUNKS = 24;

function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ||
    "https://sepolia-rollup.arbitrum.io/rpc"
  );
}

function client() {
  return createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl()) });
}

/** Same "try the full range, fall back to chunked scanning" pattern
 *  useCurveTrades.ts uses — some RPCs reject an unbounded fromBlock:0. */
async function getLogsSafely<const abiEvent extends AbiEvent>(
  publicClient: ReturnType<typeof client>,
  params: { address: Address; event: abiEvent; args?: Record<string, unknown> }
): Promise<Log[]> {
  // viem's `getLogs` types `args` against the exact literal event shape,
  // which this generic wrapper deliberately erases (callers pass whatever
  // indexed-arg filter their own event needs) — narrowed back with `as
  // never` at this one boundary rather than losing the wrapper entirely.
  const baseParams = {
    address: params.address,
    event: params.event,
    args: params.args as never,
  };
  try {
    return await publicClient.getLogs({ ...baseParams, fromBlock: 0n, toBlock: "latest" });
  } catch {
    const latest = await publicClient.getBlockNumber();
    let toBlock = latest;
    let all: Log[] = [];
    for (let i = 0; i < FALLBACK_MAX_CHUNKS; i++) {
      const fromBlock = toBlock > FALLBACK_CHUNK_BLOCKS ? toBlock - FALLBACK_CHUNK_BLOCKS : 0n;
      const logs = await publicClient.getLogs({ ...baseParams, fromBlock, toBlock });
      all = [...logs, ...all];
      if (fromBlock === 0n) break;
      toBlock = fromBlock - 1n;
    }
    return all;
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
    getLogsSafely(publicClient, {
      address: REFERRAL_VAULT_ADDRESS as Address,
      event: REGISTERED_EVENT,
      args: { referrer: wallet as Address },
    }),
    getLogsSafely(publicClient, {
      address: REFERRAL_VAULT_ADDRESS as Address,
      event: ACCRUED_EVENT,
      args: { referrer: wallet as Address },
    }),
  ]);

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
  });
}
