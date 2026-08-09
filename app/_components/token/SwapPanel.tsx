"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { ConnectKitButton } from "connectkit";
import { encodeFunctionData, formatUnits, parseUnits, type Address } from "viem";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import { SWAP_ROUTER_02_ABI } from "@/app/_lib/contracts/SwapRouter02";
import {
  TOKEN_DECIMALS,
  UNISWAP_SWAP_ROUTER_ADDRESS,
  UNISWAP_V3_POOL_FEE,
  WETH9_ADDRESS,
} from "@/app/_lib/contracts/config";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";
import { formatWeiAsUsdPrice } from "@/app/_lib/format";
import { waitForReceipt } from "@/app/_lib/txReceipt";
import { writeWithGas } from "@/app/_lib/txGas";
import Icon from "@/app/_components/Icon";
import EthIcon from "@/app/_components/EthIcon";
import Image from "next/image";
import SwipeToConfirm from "@/app/_components/SwipeToConfirm";
import SwapSuccessCard from "@/app/_components/SwapSuccessCard";

const ONE_TOKEN = 10n ** 18n;

/** Quick-tap ETH presets for buying — the single biggest speed win over
 *  typing a number: covers a typical trade in one click. */
const BUY_PRESETS_ETH = ["0.01", "0.05", "0.1", "0.5"];

/** Quick-tap fractions of the connected wallet's balance, for selling. */
const SELL_PRESETS_PCT = [10, 25, 50, 100];

/**
 * Gas units held back from a MAX buy, so the wallet can still pay for the
 * transaction that spends the rest.
 *
 * "Buy with my whole balance" is the most natural thing a user can do and
 * it cannot work: `value` and the gas fee come out of the same ETH. Sending
 * the entire balance leaves nothing to pay the fee, and the wallet either
 * refuses it or the transaction fails — which reads to the user as the app
 * being broken, not as arithmetic.
 *
 * Deliberately generous. This is an Arbitrum Orbit chain, where the L1 data
 * cost is folded into the L2 gas figure and a router swap can be an order
 * of magnitude more units than the same swap on mainnet. At this chain's
 * gas price the reserve is worth a tiny fraction of a cent, so erring high
 * costs the user nothing and erring low costs them a failed trade.
 */
const GAS_RESERVE_UNITS = 5_000_000n;

/**
 * How long the input sits still before a quote is requested.
 *
 * Without this, every keystroke in the amount field was its own eth_call —
 * typing "0.05" fired four. The delay is under the threshold where an
 * interface feels laggy, and it collapses a burst of typing into one read.
 */
const QUOTE_DEBOUNCE_MS = 250;

/** Slippage floor on the curve, whose quote is exact to the wei. */
const CURVE_SLIPPAGE_BPS = 200n;

/** Slippage floor on the pool, which has other traders in it. */
const POOL_SLIPPAGE_BPS = 300n;

const BPS = 10_000n;

function applySlippage(amount: bigint, bps: bigint): bigint {
  return (amount * (BPS - bps)) / BPS;
}

/** Trims a typed amount for display on the confirmation, without the
 *  rounding hiding that a very small trade happened at all. */
function formatAmount(raw: string, isEth: boolean): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString(undefined, { maximumFractionDigits: isEth ? 5 : 2 });
}

/**
 * Buy/sell panel, permanently docked next to the chart — the same
 * placement DexScreener/Photon/pump.fun all converge on, because a trade
 * panel that requires navigating away from the chart you're watching is
 * the opposite of fast.
 *
 * TWO COMPLETELY DIFFERENT TRADE PATHS, ONE UI
 *
 * Pre-graduation, every trade is `BondingCurve.buy`/`sell` — this is the
 * ONLY venue; there is no pool yet. Post-graduation the curve is
 * permanently closed (`TokenGraduated()`), so every trade instead goes
 * through Uniswap's SwapRouter02 against the real pool the migration
 * seeded. The panel switches paths automatically based on `migrated`; nothing
 * about the user's side of the interaction changes.
 *
 * WHY QUOTES ARE "ESTIMATED", NOT EXACT, POST-GRADUATION
 *
 * Pre-graduation, `quoteBuy`/`quoteSell` are exact — the curve is a closed
 * formula, so the contract's own quote is authoritative to the wei, and
 * that is the number used for the real on-chain slippage floor too.
 *
 * Post-graduation there is no equivalent free exact quote without a
 * `QuoterV2` static call (a second contract dependency and a slower round
 * trip for every keystroke) — so this panel estimates from the pool's own
 * live spot price instead, which is already being read every few seconds
 * for the price header. The wider default slippage post-graduation (3% vs
 * 2%) exists specifically to cover that estimate being approximate rather
 * than exact — the swap itself always executes at the pool's real price;
 * only the PREVIEW number shown before signing is approximate.
 */
export default function SwapPanel({
  tokenAddress,
  tokenSymbol,
  tokenImageUrl,
  curveAddress,
  migrated,
  poolPriceWei,
  ethUsdPrice,
  fill = false,
  onSettledChange,
  initialMode,
}: {
  tokenAddress: Address;
  /** Ticker shown on the token side of both fields. */
  tokenSymbol: string;
  /** Token art for the token side of both fields, or null/undefined to fall
   *  back to a lettered tile. */
  tokenImageUrl?: string | null;
  curveAddress: Address | undefined;
  /** Once true, the curve is closed forever — trade via the pool instead. */
  migrated: boolean | undefined;
  /** Live pool spot price (wei per whole token), for the post-graduation
   *  estimate only. `undefined` pre-graduation / while loading. */
  poolPriceWei: bigint | undefined;
  ethUsdPrice: number;
  /** Fill the parent instead of being a fixed-width docked column. Set by
   *  the mobile sheet; the desktop panel leaves it false and is unchanged. */
  fill?: boolean;
  /** Fires when a trade settles (and again when the confirmation is
   *  dismissed), so a host can clear chrome that the confirmation replaces.
   *  Optional: the panel is fully usable standalone without it. */
  onSettledChange?: (settled: boolean) => void;
  /** Which tab to open on. The mobile bar has separate Buy and Sell
   *  buttons, so it opens the sheet already on the right one. */
  initialMode?: "buy" | "sell";
}) {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [mode, setMode] = useState<"buy" | "sell">(initialMode ?? "buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once a trade lands, which swaps the panel body for the
   *  confirmation card. Null means "still trading". */
  const [receipt, setReceipt] = useState<{ paid: string; received: string } | null>(null);

  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [ethBalance, setEthBalance] = useState<bigint>(0n);
  const [gasReserveWei, setGasReserveWei] = useState<bigint>(0n);

  // Refresh both balances on mount, on account change, and right after a
  // trade — enough to keep the presets (which are balance-relative for
  // selling) honest without polling constantly.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!account || !publicClient) return;
    let cancelled = false;
    (async () => {
      const [tBal, eBal, gasPrice] = await Promise.all([
        publicClient.readContract({
          address: tokenAddress,
          abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
          functionName: "balanceOf",
          args: [account],
        }) as Promise<bigint>,
        publicClient.getBalance({ address: account }),
        // Cached upstream for 30s (see app/api/rpc/route.ts) — this costs
        // nothing on top of what the wallet is about to ask for anyway.
        publicClient.getGasPrice().catch(() => 0n),
      ]);
      if (!cancelled) {
        setTokenBalance(tBal);
        setEthBalance(eBal);
        setGasReserveWei(gasPrice * GAS_RESERVE_UNITS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, publicClient, tokenAddress, refreshTick]);

  // Reset the amount when switching tabs — a leftover ETH figure typed for
  // a buy is not a sensible token amount for a sell, and vice versa.
  useEffect(() => {
    setAmount("");
    setError(null);
  }, [mode]);

  // Mirrored out to the host rather than derived there, so the panel stays
  // the single owner of whether a trade has settled.
  useEffect(() => {
    onSettledChange?.(receipt !== null);
  }, [receipt, onSettledChange]);

  const amountWei = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return 0n;
      return parseUnits(amount, mode === "buy" ? 18 : TOKEN_DECIMALS);
    } catch {
      return 0n;
    }
  }, [amount, mode]);

  // ---- Live quote (pre-graduation: exact; post-graduation: estimated) ----
  const [curveQuote, setCurveQuote] = useState<bigint | null>(null);
  useEffect(() => {
    if (migrated !== false || !curveAddress || !publicClient || amountWei === 0n) {
      setCurveQuote(null);
      return;
    }
    let cancelled = false;
    const fn = mode === "buy" ? "quoteBuy" : "quoteSell";
    const timer = setTimeout(() => {
      publicClient
        .readContract({
          address: curveAddress,
          abi: BONDING_CURVE_ABI,
          functionName: fn,
          args: [amountWei],
          account,
        })
        .then((result) => {
          if (!cancelled) setCurveQuote(result as bigint);
        })
        .catch(() => {
          if (!cancelled) setCurveQuote(null);
        });
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [migrated, curveAddress, publicClient, amountWei, mode, account]);

  const estimatedOut = useMemo(() => {
    if (amountWei === 0n) return null;
    if (migrated === false) return curveQuote;
    if (migrated === true && poolPriceWei && poolPriceWei > 0n) {
      // Spot-price estimate only — see the component doc comment.
      return mode === "buy"
        ? (amountWei * ONE_TOKEN) / poolPriceWei
        : (amountWei * poolPriceWei) / ONE_TOKEN;
    }
    return null;
  }, [amountWei, migrated, curveQuote, poolPriceWei, mode]);

  const maxSellable = tokenBalance;
  // Never the whole balance — see GAS_RESERVE_UNITS.
  const maxBuyable = ethBalance > gasReserveWei ? ethBalance - gasReserveWei : 0n;

  function applyBuyPreset(ethAmount: string) {
    setAmount(ethAmount);
  }

  function applySellPreset(pct: number) {
    if (maxSellable === 0n) return;
    const portion = (maxSellable * BigInt(pct)) / 100n;
    // 100% must use the exact stored balance, not a rounded-down fraction,
    // or "sell all" would leave dust behind.
    const raw = pct === 100 ? maxSellable : portion;
    setAmount(formatUnits(raw, TOKEN_DECIMALS));
  }

  async function handleTrade() {
    if (!account || !walletClient || !publicClient || amountWei === 0n) return;
    setBusy(true);
    setError(null);

    try {
      // Checked here rather than only in `canSubmit`, because the balance
      // and the gas price both move underneath a panel that is already
      // open. Catching it now costs a wallet prompt the user would have
      // had to reject, and a fee they would have paid for a failure.
      if (mode === "buy" && amountWei + gasReserveWei > ethBalance) {
        throw new Error(
          "Not enough ETH to cover this trade and its gas fee. Try a smaller amount."
        );
      }
      if (mode === "sell" && amountWei > tokenBalance) {
        throw new Error("You don't have that many tokens.");
      }

      if (migrated === false && curveAddress) {
        await tradeOnCurve();
      } else if (migrated === true) {
        await tradeOnPool();
      } else {
        throw new Error("Trading venue not ready yet -- try again in a moment.");
      }
      // Captured before `setAmount("")`, which would otherwise wipe the
      // figures the confirmation is about to show.
      setReceipt({
        paid: `${formatAmount(amount, mode === "buy")} ${mode === "buy" ? "ETH" : tokenSymbol}`,
        received:
          estimatedOut === null
            ? `- ${mode === "buy" ? tokenSymbol : "ETH"}`
            : `${
                mode === "buy"
                  ? Number(formatUnits(estimatedOut, TOKEN_DECIMALS)).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })
                  : Number(formatUnits(estimatedOut, 18)).toFixed(5)
              } ${mode === "buy" ? tokenSymbol : "ETH"}`,
      });
      setAmount("");
      setRefreshTick((n) => n + 1);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Makes sure the connected wallet has already approved `spender` for at
   * least `amountWei`, waiting for the approval to be mined if not.
   *
   * Must happen BEFORE the swap is simulated: a simulation run without the
   * allowance in place reverts on the transfer, which would look like the
   * trade itself being impossible.
   */
  async function ensureAllowance(spender: Address) {
    if (!walletClient || !publicClient || !account) return;

    const allowance = (await publicClient.readContract({
      address: tokenAddress,
      abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
      functionName: "allowance",
      args: [account, spender],
    })) as bigint;
    if (allowance >= amountWei) return;

    // Simulated like every other write, so a failing approval is caught
    // before the wallet opens, and its gas is calculated here rather than by
    // the wallet — an approval is the FIRST transaction a new seller sends,
    // so it is the one most likely to hit a wallet that cannot estimate.
    const { request } = await publicClient.simulateContract({
      address: tokenAddress,
      abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
      functionName: "approve",
      args: [spender, amountWei],
      account,
    });
    await waitForReceipt(
      publicClient,
      await writeWithGas(publicClient, walletClient, request, account)
    );
  }

  async function tradeOnCurve() {
    if (!walletClient || !publicClient || !curveAddress || !account) return;

    // Re-read the quote instead of reusing the one on screen. That one was
    // taken when the user stopped typing, and anyone else's trade between
    // then and now moves the curve — a slippage floor derived from a stale
    // quote is the single most likely way an otherwise valid trade reverts.
    const quote = (await publicClient.readContract({
      address: curveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: mode === "buy" ? "quoteBuy" : "quoteSell",
      args: [amountWei],
      account,
    })) as bigint;
    if (quote === 0n) throw new Error("Could not get a quote. Try again.");

    // Tight, because the curve's quote is exact to the wei.
    const minOut = applySlippage(quote, CURVE_SLIPPAGE_BPS);

    if (mode === "buy") {
      const { request } = await publicClient.simulateContract({
        address: curveAddress,
        abi: BONDING_CURVE_ABI,
        functionName: "buy",
        args: [minOut],
        value: amountWei,
        account,
      });
      await waitForReceipt(publicClient, await writeWithGas(publicClient, walletClient, request, account));
      return;
    }

    await ensureAllowance(curveAddress);
    const { request } = await publicClient.simulateContract({
      address: curveAddress,
      abi: BONDING_CURVE_ABI,
      functionName: "sell",
      args: [amountWei, minOut],
      account,
    });
    await waitForReceipt(publicClient, await writeWithGas(publicClient, walletClient, request, account));
  }

  /**
   * The pool's exact output for this trade, price impact included.
   *
   * `exactInputSingle` RETURNS `amountOut`, so simulating it with a floor of
   * zero is a quote — the same number a QuoterV2 would give, from a contract
   * already in use here rather than a second dependency to deploy and
   * configure.
   *
   * This replaces deriving the floor from the pool's spot price. Spot price
   * is the marginal price of an infinitely small trade and ignores impact
   * entirely, so it always over-estimates the output, and the shortfall
   * grows with trade size. A fixed 3% floor on top of that number was fine
   * for dust and reverted a large buy, which is exactly the trade a user
   * least wants to see fail.
   */
  async function quotePool(recipient: Address, forSell: boolean): Promise<bigint> {
    if (!publicClient || !account) return 0n;
    const { result } = await publicClient.simulateContract({
      address: UNISWAP_SWAP_ROUTER_ADDRESS,
      abi: SWAP_ROUTER_02_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: forSell ? tokenAddress : WETH9_ADDRESS,
          tokenOut: forSell ? WETH9_ADDRESS : tokenAddress,
          fee: UNISWAP_V3_POOL_FEE,
          recipient,
          amountIn: amountWei,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
      ...(forSell ? {} : { value: amountWei }),
      account,
    });
    return result as bigint;
  }

  async function tradeOnPool() {
    if (!walletClient || !publicClient || !account) return;

    if (mode === "buy") {
      const quote = await quotePool(account, false);
      if (quote === 0n) throw new Error("Could not get a quote. Try again.");
      const minOut = applySlippage(quote, POOL_SLIPPAGE_BPS);

      const { request } = await publicClient.simulateContract({
        address: UNISWAP_SWAP_ROUTER_ADDRESS,
        abi: SWAP_ROUTER_02_ABI,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn: WETH9_ADDRESS,
            tokenOut: tokenAddress,
            fee: UNISWAP_V3_POOL_FEE,
            recipient: account,
            amountIn: amountWei,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
        value: amountWei,
        account,
      });
      await waitForReceipt(publicClient, await writeWithGas(publicClient, walletClient, request, account));
      return;
    }

    // The allowance has to exist before the quote, not just before the
    // swap: quoting is itself a simulated transfer and reverts without it.
    await ensureAllowance(UNISWAP_SWAP_ROUTER_ADDRESS);

    // Quote against the router as recipient, matching how the real swap
    // below routes the WETH, so the number covers the same code path.
    const quote = await quotePool(UNISWAP_SWAP_ROUTER_ADDRESS, true);
    if (quote === 0n) throw new Error("Could not get a quote. Try again.");
    const minOut = applySlippage(quote, POOL_SLIPPAGE_BPS);

    // Two chained calls in one transaction: swap token -> WETH, holding
    // the WETH in the router itself (recipient = the router's own
    // address), then unwrap that exact router-held balance to real ETH
    // sent to the seller. See the ABI file's doc comment for why this
    // can't be a single call.
    const swapData = encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: tokenAddress,
          tokenOut: WETH9_ADDRESS,
          fee: UNISWAP_V3_POOL_FEE,
          recipient: UNISWAP_SWAP_ROUTER_ADDRESS,
          amountIn: amountWei,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const unwrapData = encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: "unwrapWETH9",
      args: [minOut, account],
    });

    const { request } = await publicClient.simulateContract({
      address: UNISWAP_SWAP_ROUTER_ADDRESS,
      abi: SWAP_ROUTER_02_ABI,
      functionName: "multicall",
      args: [[swapData, unwrapData]],
      account,
    });
    await waitForReceipt(publicClient, await writeWithGas(publicClient, walletClient, request, account));
  }

  const usdValue =
    amountWei > 0n && mode === "buy" ? formatWeiAsUsdPrice(amountWei, ethUsdPrice) : null;

  const canSubmit =
    Boolean(account) &&
    amountWei > 0n &&
    !busy &&
    (mode === "sell" ? amountWei <= maxSellable : true);

  // Which asset sits in which field. The flip button swaps the direction,
  // which is the same thing as switching between buy and sell — so there
  // is one control where the old panel had two tabs.
  const payingEth = mode === "buy";
  const fromSymbol = payingEth ? "ETH" : tokenSymbol;
  const toSymbol = payingEth ? tokenSymbol : "ETH";
  const fromBalance = payingEth
    ? Number(formatUnits(maxBuyable, 18)).toFixed(4)
    : Number(formatUnits(maxSellable, TOKEN_DECIMALS)).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
  const toBalance = payingEth
    ? Number(formatUnits(maxSellable, TOKEN_DECIMALS)).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })
    : Number(formatUnits(maxBuyable, 18)).toFixed(4);

  const receiveText =
    estimatedOut !== null
      ? payingEth
        ? Number(formatUnits(estimatedOut, TOKEN_DECIMALS)).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })
        : Number(formatUnits(estimatedOut, 18)).toFixed(5)
      : "";

  /** The pay/receive fields swap ETH and the token between them, so this
   *  renders whichever the field currently holds — a real ETH mark, or the
   *  token's own art with a lettered fallback. */
  function AssetIcon({ symbol }: { symbol: string }) {
    if (symbol === "ETH") {
      return <EthIcon className="w-7 h-7 shrink-0 rounded-full" />;
    }
    return (
      <span className="token-thumb relative grid place-items-center w-7 h-7 shrink-0 rounded-[var(--r-md)] overflow-hidden text-white text-[13px] font-bold">
        {tokenImageUrl ? (
          <Image src={tokenImageUrl} alt="" fill sizes="28px" className="object-cover" unoptimized />
        ) : (
          symbol.charAt(0)
        )}
      </span>
    );
  }

  function applyPct(pct: number) {
    if (payingEth) {
      if (maxBuyable === 0n) return;
      const portion = (maxBuyable * BigInt(pct)) / 100n;
      setAmount(formatUnits(portion, 18));
    } else {
      applySellPreset(pct);
    }
  }

  if (receipt) {
    return (
      <div className={fill ? "w-full flex-1 flex flex-col min-h-0" : "w-full flex flex-col"}>
        <SwapSuccessCard
          paid={receipt.paid}
          received={receipt.received}
          onDone={() => setReceipt(null)}
        />
      </div>
    );
  }

  return (
    <div className={fill ? "w-full flex-1 flex flex-col min-h-0" : "w-full flex flex-col"}>
      <div className="flex-1 flex flex-col px-[18px] pb-[18px] overflow-y-auto custom-scrollbar">
        {/* ---- You pay ---- */}
        <div className="p-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface-sunken)]">
          <div className="flex items-center justify-between gap-2.5 text-[0.6875rem] font-semibold text-[var(--ink-faint)]">
            <span>You pay</span>
            {account && (
              <span>
                Balance{" "}
                <b className="font-bold text-[var(--ink-soft)] tabular-nums">{fromBalance}</b>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-2.5">
            <span className="inline-flex items-center gap-2 shrink-0 max-w-[45%]">
              <AssetIcon symbol={fromSymbol} />
              <span className="text-[0.8125rem] font-bold text-[var(--ink)] truncate">
                {fromSymbol}
              </span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.0"
              aria-label="Amount to pay"
              className="w-full min-w-0 border-0 bg-transparent text-right text-[1.0625rem] font-bold tabular-nums text-[var(--ink)] placeholder:font-semibold placeholder:text-[var(--ink-faint)] focus:outline-none"
            />
          </div>

          <div className="flex gap-1.5 mt-2.5">
            {SELL_PRESETS_PCT.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPct(pct)}
                className="flex-1 h-7 rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--surface)] text-[0.6875rem] font-bold text-[var(--ink-soft)] transition-colors hover:border-[var(--brand-soft)] hover:text-[var(--brand)]"
              >
                {pct === 100 ? "Max" : `${pct}%`}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Flip ---- */}
        <button
          type="button"
          onClick={() => {
            setMode(payingEth ? "sell" : "buy");
            setAmount("");
          }}
          aria-label="Switch swap direction"
          className="relative z-[1] grid place-items-center w-8 h-8 mx-auto -my-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)] transition-colors hover:border-[var(--brand-soft)] hover:text-[var(--brand)]"
        >
          <Icon icon="pixelarticons:arrow-down" className="text-sm" />
        </button>

        {/* ---- You receive ---- */}
        <div className="p-3 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface-sunken)]">
          <div className="flex items-center justify-between gap-2.5 text-[0.6875rem] font-semibold text-[var(--ink-faint)]">
            <span>You receive</span>
            {account && (
              <span>
                Balance <b className="font-bold text-[var(--ink-soft)] tabular-nums">{toBalance}</b>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-2.5">
            <span className="inline-flex items-center gap-2 shrink-0 max-w-[45%]">
              <AssetIcon symbol={toSymbol} />
              <span className="text-[0.8125rem] font-bold text-[var(--ink)] truncate">
                {toSymbol}
              </span>
            </span>
            {/* Read-only: the amount received is quoted from the chain, not
                chosen. Left as an input purely so both fields share a shape. */}
            <input
              type="text"
              readOnly
              value={receiveText}
              placeholder="0.0"
              aria-label="Amount to receive"
              className="w-full min-w-0 border-0 bg-transparent text-right text-[1.0625rem] font-bold tabular-nums text-[var(--ink)] placeholder:font-semibold placeholder:text-[var(--ink-faint)] focus:outline-none"
            />
          </div>
        </div>

        {usdValue && (
          <p className="mt-2.5 text-[0.6875rem] font-semibold text-[var(--ink-faint)] text-right">
            ≈ {usdValue}
          </p>
        )}

        {migrated === true && (
          <p className="mt-2 text-[0.625rem] font-medium text-[var(--ink-faint)] leading-snug">
            Estimated from the live pool price. The exact amount is confirmed on-chain.
          </p>
        )}

        {error && (
          <p className="mt-2.5 text-[0.6875rem] font-semibold leading-snug text-[var(--down)]">
            {error}
          </p>
        )}
        {/* ---- Action ---- */}
        <div className="mt-3">
          {!account ? (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button onClick={show} className="btn btn-primary w-full">
                  Connect wallet
                </button>
              )}
            </ConnectKitButton.Custom>
          ) : (
            <SwipeToConfirm
              label={payingEth ? "Swipe to buy" : "Swipe to sell"}
              busyLabel={payingEth ? "Buying…" : "Selling…"}
              onConfirm={handleTrade}
              disabled={!canSubmit}
              busy={busy}
            />
          )}
        </div>
      </div>
    </div>
  );
}
