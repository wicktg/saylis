"use client";

import { useEffect, useMemo, useState } from "react";
import {
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { TAXABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/TaxableLaunchToken";
import { TOKEN_FEE_COLLECTOR_ABI } from "@/app/_lib/contracts/TokenFeeCollector";
import { useTokenMarketData } from "@/app/_lib/useTokenMarketData";
import { supabase } from "@/app/_lib/supabase";
import { LAUNCHED_TOKEN_EVENT, type LaunchedToken } from "@/app/_lib/launchedTokens";
import { waitForReceipt } from "@/app/_lib/txReceipt";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE_TOKEN = 10n ** 18n;

export type CreatorFees = {
  /** The launch whose fees this is reading, or null if the wallet has none. */
  launchedToken: LaunchedToken | null;
  /**
   * ETH owed to the creator right now, across BOTH venues — the curve
   * before graduation and the fee collector after. `undefined` until the
   * reads land.
   */
  creatorFeesOwed: bigint | undefined;
  /**
   * Tokens owed to the creator on the fee collector: their 75% of the
   * pool's token-side fees plus 100% of the whale sell tax. Always
   * `undefined` before graduation — the curve pays only in ETH.
   */
  creatorTokensOwed: bigint | undefined;
  /**
   * `creatorTokensOwed` valued in wei at the token's live price, so it can
   * be shown in USD with the same formatter as every other figure.
   */
  creatorTokensValueWei: bigint | undefined;
  /** True once this token has graduated and a fee collector exists. */
  hasCollector: boolean;
  /** True while a claim tx is being signed or is awaiting confirmation. */
  isClaimBusy: boolean;
  /** True when there is anything worth pressing the button for. */
  hasClaimable: boolean;
  /** Briefly true after a successful claim, to drive a "Claimed" label. */
  justClaimed: boolean;
  claim: () => Promise<void>;
};

/**
 * Creator fee balances + the claim transactions, for a connected wallet.
 *
 * WHY THIS READS TWO CONTRACTS
 *
 * A token earns in two different places over its life, and this used to
 * know about only the first. Before graduation, trade fees accrue on the
 * `BondingCurve` as `creatorFeesOwed`. At graduation the curve halts and
 * stops earning entirely, and everything after that — the Uniswap
 * position's fees on both assets, plus the whale sell tax — accrues on a
 * `TokenFeeCollector` deployed for that token instead.
 *
 * Reading only the curve meant a creator's dashboard froze at whatever the
 * curve last owed them the moment their token succeeded, while their real
 * earnings piled up in a contract the app never mentioned. `creatorFeesOwed`
 * below is now the sum of both, so every consumer picked that up without
 * changing.
 *
 * The collector's address is not configuration — there is one per token —
 * and it does not need indexing either: the token itself exposes
 * `feeCollector()`, set once at migration and immutable after.
 *
 * WHY THE CLAIM IS A SEQUENCE
 *
 * Post-graduation fees sit inside the LP position until someone calls
 * `collect()`, which is permissionless and moves them into the owed
 * balances. So a claim may need up to four transactions: collect, then
 * withdraw ETH from the curve, the collector, and finally the tokens. Each
 * is skipped when it has nothing to do, so the common cases are one or two.
 *
 * Reads the wallet's most recent launch only — same scope this has always
 * had. A creator with several launches sees the latest; widening that is a
 * product decision, not a refactor, so it is left alone.
 */
export function useCreatorFees(address: Address | undefined): CreatorFees {
  /**
   * The wallet's most recent launch, from Supabase.
   *
   * This used to read `localStorage`, which is why creator fees appeared to
   * be broken: the store is only written by the Create Token modal, in the
   * browser the launch happened in. Open the site on a phone, in another
   * browser, after clearing site data, or from a token launched before that
   * store existed, and the hook found no curve — so it read no balance and
   * rendered nothing, while the fees sat on-chain the whole time.
   *
   * `tokens` is the actual registry, and it already carries
   * `creator_wallet_address`. It follows the wallet rather than the device,
   * which is the property that was missing.
   *
   * `ilike` rather than `eq`: rows are written lowercased but wagmi hands
   * back EIP-55 checksummed addresses, and an `eq` would silently match
   * nothing — the same class of bug all over again.
   */
  const [launchedToken, setLaunchedToken] = useState<LaunchedToken | null>(null);

  useEffect(() => {
    if (!address) {
      setLaunchedToken(null);
      return;
    }

    let cancelled = false;

    async function load(wallet: Address) {
      const { data } = await supabase
        .from("tokens")
        .select("contract_address,curve_address,ticker,created_at")
        .ilike("creator_wallet_address", wallet)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setLaunchedToken(
        data
          ? {
              tokenAddress: data.contract_address as Address,
              curveAddress: data.curve_address as Address,
              symbol: data.ticker as string,
              launchedAt: new Date(data.created_at as string).getTime(),
            }
          : null
      );
    }

    load(address);

    // A launch completed during this session should surface immediately
    // rather than on the next mount, so re-read when the Create Token flow
    // announces one.
    const onLaunched = () => void load(address);
    window.addEventListener(LAUNCHED_TOKEN_EVENT, onLaunched);
    return () => {
      cancelled = true;
      window.removeEventListener(LAUNCHED_TOKEN_EVENT, onLaunched);
    };
  }, [address]);

  const curveAddress = launchedToken?.curveAddress;
  const tokenAddress = launchedToken?.tokenAddress;

  /* ---------------------------- The curve ---------------------------- */

  const { data: curveFeesOwed, refetch: refetchCurveFees } = useReadContract({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: "creatorFeesOwed",
    query: { enabled: Boolean(curveAddress) },
  });

  // Real-time: any trade (Buy/Sell) or the one-time graduation bonus can
  // move creatorFeesOwed, so refetch on whichever event lands.
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "FeeCollected",
    enabled: Boolean(curveAddress),
    onLogs: () => refetchCurveFees(),
  });
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "Graduated",
    enabled: Boolean(curveAddress),
    onLogs: () => refetchCurveFees(),
  });

  /* -------------------------- The collector -------------------------- */

  // Set once, at migration, and immutable after — so this needs no
  // watching. Zero before graduation, and for legacy non-taxable tokens.
  const { data: feeCollector } = useReadContract({
    address: tokenAddress,
    abi: TAXABLE_LAUNCH_TOKEN_ABI,
    functionName: "feeCollector",
    query: { enabled: Boolean(tokenAddress) },
  });

  const collectorAddress =
    feeCollector && feeCollector !== ZERO_ADDRESS ? (feeCollector as Address) : undefined;

  const { data: collectorFeesOwed, refetch: refetchCollectorFees } = useReadContract({
    address: collectorAddress,
    abi: TOKEN_FEE_COLLECTOR_ABI,
    functionName: "creatorFeesOwed",
    query: { enabled: Boolean(collectorAddress) },
  });

  const { data: collectorTokensOwed, refetch: refetchCollectorTokens } = useReadContract({
    address: collectorAddress,
    abi: TOKEN_FEE_COLLECTOR_ABI,
    functionName: "creatorTokensOwed",
    query: { enabled: Boolean(collectorAddress) },
  });

  useWatchContractEvent({
    address: collectorAddress,
    abi: TOKEN_FEE_COLLECTOR_ABI,
    eventName: "FeesCollected",
    enabled: Boolean(collectorAddress),
    onLogs: () => {
      refetchCollectorFees();
      refetchCollectorTokens();
    },
  });

  /* ------------------- Valuing the token side in USD ------------------ */

  // One entry, but through the same cached /api/market the grid uses, so
  // this costs no extra chain reads. `priceWei` is wei per WHOLE token and
  // comes from the live pool once migrated.
  const pairs = useMemo(
    () =>
      curveAddress && tokenAddress ? [{ curveAddress, tokenAddress }] : [],
    [curveAddress, tokenAddress]
  );
  const { data: marketData } = useTokenMarketData(pairs);
  const priceWei = curveAddress ? marketData[curveAddress]?.priceWei : undefined;

  const creatorTokensValueWei =
    collectorTokensOwed !== undefined && priceWei !== undefined
      ? ((collectorTokensOwed as bigint) * priceWei) / ONE_TOKEN
      : undefined;

  /* ----------------------------- Claiming ---------------------------- */

  const publicClient = usePublicClient();
  const { writeContractAsync, data: claimTxHash, isPending: isClaimPending } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({ hash: claimTxHash });

  const [isSequenceRunning, setIsSequenceRunning] = useState(false);
  const [justClaimed, setJustClaimed] = useState(false);

  useEffect(() => {
    if (isClaimSuccess) {
      setJustClaimed(true);
      const timeout = setTimeout(() => setJustClaimed(false), 2500);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClaimSuccess]);

  function refetchAll() {
    refetchCurveFees();
    refetchCollectorFees();
    refetchCollectorTokens();
  }

  async function claim() {
    if (!curveAddress) return;
    setIsSequenceRunning(true);
    try {
      // Each step is independently attempted and independently swallowed.
      // A step reverts when it has nothing to do — `NothingOwed`,
      // `NothingCollected` — which is a normal outcome here, not a failure,
      // and wagmi simulates first so a doomed one costs no gas. A user
      // rejecting one step also just stops that step.
      //
      // `attempt` waits for each receipt before returning, and that is
      // load-bearing rather than politeness: `collect()` is what MOVES the
      // position's fees into `creatorFeesOwed`/`creatorTokensOwed`, and
      // `writeContractAsync` resolves on submission, not on confirmation.
      // Firing the withdrawals straight after would simulate them against
      // pre-collect state, see nothing owed, revert, and get swallowed —
      // silently paying the creator nothing on the exact click that was
      // supposed to pay them.
      if (collectorAddress) {
        await attempt(collectorAddress, "collect");
      }
      if ((curveFeesOwed as bigint | undefined) ?? 0n) {
        await attempt(curveAddress, "withdrawCreatorFees", BONDING_CURVE_ABI);
      }
      if (collectorAddress) {
        await attempt(collectorAddress, "withdrawCreatorFees");
        await attempt(collectorAddress, "withdrawCreatorTokens");
      }
    } finally {
      setIsSequenceRunning(false);
      refetchAll();
    }
  }

  async function attempt(
    to: Address,
    functionName: "collect" | "withdrawCreatorFees" | "withdrawCreatorTokens",
    abi: typeof BONDING_CURVE_ABI | typeof TOKEN_FEE_COLLECTOR_ABI = TOKEN_FEE_COLLECTOR_ABI
  ) {
    try {
      const hash = await writeContractAsync({
        address: to,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: abi as any,
        functionName,
      });
      // See `claim` — the next step's simulation depends on this one having
      // actually landed.
      if (publicClient) await waitForReceipt(publicClient, hash);
    } catch {
      // See `claim` — nothing to do, or the user declined this step.
    }
  }

  const totalEthOwed =
    curveFeesOwed === undefined && collectorFeesOwed === undefined
      ? undefined
      : ((curveFeesOwed as bigint | undefined) ?? 0n) +
        ((collectorFeesOwed as bigint | undefined) ?? 0n);

  return {
    launchedToken,
    creatorFeesOwed: totalEthOwed,
    creatorTokensOwed: collectorTokensOwed as bigint | undefined,
    creatorTokensValueWei,
    hasCollector: Boolean(collectorAddress),
    isClaimBusy: isClaimPending || isClaimConfirming || isSequenceRunning,
    // Once a collector exists the button stays live even at zero: fees sit
    // inside the LP position until `collect()` runs, so a balance of zero
    // does NOT mean there is nothing to claim — it usually means nobody has
    // swept it yet, and pressing the button is what sweeps it.
    hasClaimable: Boolean(
      (totalEthOwed && totalEthOwed > 0n) ||
        ((collectorTokensOwed as bigint | undefined) ?? 0n) > 0n ||
        collectorAddress
    ),
    justClaimed,
    claim,
  };
}
