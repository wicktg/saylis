/**
 * SERVER-ONLY chain access for the InfoFi jobs.
 *
 * Two clients with deliberately different trust levels:
 *
 *   - `publicClient()` reads. Needs nothing secret, so the sync job that
 *     mirrors chain state into Supabase can run anywhere.
 *   - `pokerWallet()` writes, and ONLY ever sends `recordMarketCap` — a
 *     permissionless, non-custodial call that advances a token's
 *     sustained-market-cap timer. It is a separate key from the team
 *     multisig on purpose: this one lives on a server and pays gas, so it
 *     is assumed to be hot, and there is nothing it can do beyond poking a
 *     public function anyone could already call.
 *
 * The team key is deliberately NOT here. `openCampaign` and
 * `publishResults` decide whether a pool pays out and to whom, so they stay
 * manual actions signed by the multisig, not something a compromised server
 * process can trigger.
 */
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";
import { INFO_FI_CAMPAIGN_ABI } from "@/app/_lib/contracts/InfoFiCampaign";
import { INFOFI_CAMPAIGN_ADDRESS } from "@/app/_lib/contracts/config";

function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ||
    "https://rpc.mainnet.chain.robinhood.com"
  );
}

export function publicClient() {
  return createPublicClient({ chain: robinhood, transport: http(rpcUrl()) });
}

/** `null` when no poker key is configured — callers should skip, not throw. */
export function pokerWallet() {
  const key = process.env.INFOFI_POKER_PRIVATE_KEY;
  if (!key) return null;

  const normalized = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  const account = privateKeyToAccount(normalized);
  return {
    account,
    client: createWalletClient({
      account,
      chain: robinhood,
      transport: http(rpcUrl()),
    }),
  };
}

export const campaignAddress = INFOFI_CAMPAIGN_ADDRESS as Address;
export const campaignAbi = INFO_FI_CAMPAIGN_ABI;

/** Mirrors `InfoFiCampaign.State`, index-aligned with the enum. */
export const CAMPAIGN_STATES = [
  "none",
  "registered",
  "eligible",
  "open",
  "settled",
  "burned",
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export type OnChainCampaign = {
  state: CampaignState;
  curve: Address;
  owner: Address;
  /** True only for a "true external" pool (curve left as zero on
   *  `registerExternalPool`) — no market to observe, cleared via
   *  `markEligible` instead of `recordMarketCap`. False for both Path A
   *  (mint-time) and Path B (post-launch buy+lock, curve verified). */
  isExternal: boolean;
  allocation: bigint;
  claimed: bigint;
  registeredAt: bigint;
  aboveSince: bigint;
  openedAt: bigint;
  windowEnds: bigint;
  claimDeadline: bigint;
  merkleRoot: `0x${string}`;
};

/** Reads a token's campaign straight from the contract. */
export async function readCampaign(token: Address): Promise<OnChainCampaign> {
  const raw = (await publicClient().readContract({
    address: campaignAddress,
    abi: campaignAbi,
    functionName: "getCampaign",
    args: [token],
  })) as {
    state: number;
    curve: Address;
    owner: Address;
    isExternal: boolean;
    allocation: bigint;
    claimed: bigint;
    registeredAt: bigint;
    aboveSince: bigint;
    openedAt: bigint;
    windowEnds: bigint;
    claimDeadline: bigint;
    merkleRoot: `0x${string}`;
  };

  return { ...raw, state: CAMPAIGN_STATES[raw.state] ?? "none" };
}

/** Zero timestamps mean "not set yet", never 1970 — keep them null. */
export function tsToIso(seconds: bigint): string | null {
  return seconds === 0n ? null : new Date(Number(seconds) * 1000).toISOString();
}
