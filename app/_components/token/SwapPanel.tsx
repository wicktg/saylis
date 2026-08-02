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

const ONE_TOKEN = 10n ** 18n;

/** Quick-tap ETH presets for buying — the single biggest speed win over
 *  typing a number: covers a typical trade in one click. */
const BUY_PRESETS_ETH = ["0.01", "0.05", "0.1", "0.5"];

/** Quick-tap fractions of the connected wallet's balance, for selling. */
const SELL_PRESETS_PCT = [25, 50, 100];

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
  curveAddress,
  migrated,
  poolPriceWei,
  ethUsdPrice,
}: {
  tokenAddress: Address;
  curveAddress: Address | undefined;
  /** Once true, the curve is closed forever — trade via the pool instead. */
  migrated: boolean | undefined;
  /** Live pool spot price (wei per whole token), for the post-graduation
   *  estimate only. `undefined` pre-graduation / while loading. */
  poolPriceWei: bigint | undefined;
  ethUsdPrice: number;
}) {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [ethBalance, setEthBalance] = useState<bigint>(0n);

  // Refresh both balances on mount, on account change, and right after a
  // trade — enough to keep the presets (which are balance-relative for
  // selling) honest without polling constantly.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (!account || !publicClient) return;
    let cancelled = false;
    (async () => {
      const [tBal, eBal] = await Promise.all([
        publicClient.readContract({
          address: tokenAddress,
          abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
          functionName: "balanceOf",
          args: [account],
        }) as Promise<bigint>,
        publicClient.getBalance({ address: account }),
      ]);
      if (!cancelled) {
        setTokenBalance(tBal);
        setEthBalance(eBal);
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
    setSuccess(null);
  }, [mode]);

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
    return () => {
      cancelled = true;
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
  const maxBuyable = ethBalance > 0n ? ethBalance : 0n;

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
    setSuccess(null);

    try {
      if (migrated === false && curveAddress) {
        await tradeOnCurve();
      } else if (migrated === true) {
        await tradeOnPool();
      } else {
        throw new Error("Trading venue not ready yet — try again in a moment.");
      }
      setAmount("");
      setSuccess(mode === "buy" ? "Bought." : "Sold.");
      setRefreshTick((n) => n + 1);
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function tradeOnCurve() {
    if (!walletClient || !publicClient || !curveAddress || !account) return;

    // 2% slippage off the curve's OWN exact quote — tight, because the
    // quote is exact, not estimated.
    const quote = curveQuote ?? 0n;
    if (quote === 0n) throw new Error("Could not get a quote. Try again.");
    const minOut = (quote * 98n) / 100n;

    if (mode === "buy") {
      const hash = await walletClient.writeContract({
        address: curveAddress,
        abi: BONDING_CURVE_ABI,
        functionName: "buy",
        args: [minOut],
        value: amountWei,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } else {
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
        functionName: "allowance",
        args: [account, curveAddress],
      })) as bigint;

      if (allowance < amountWei) {
        const approveHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
          functionName: "approve",
          args: [curveAddress, amountWei],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const hash = await walletClient.writeContract({
        address: curveAddress,
        abi: BONDING_CURVE_ABI,
        functionName: "sell",
        args: [amountWei, minOut],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  async function tradeOnPool() {
    if (!walletClient || !publicClient || !account) return;
    if (!estimatedOut || estimatedOut === 0n) {
      throw new Error("Could not estimate a price. Try again.");
    }
    // Wider 3% floor — see the component doc comment on why the preview is
    // an estimate here, not an exact quote.
    const minOut = (estimatedOut * 97n) / 100n;

    if (mode === "buy") {
      const hash = await walletClient.writeContract({
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
      });
      await publicClient.waitForTransactionReceipt({ hash });
    } else {
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
        functionName: "allowance",
        args: [account, UNISWAP_SWAP_ROUTER_ADDRESS],
      })) as bigint;

      if (allowance < amountWei) {
        const approveHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
          functionName: "approve",
          args: [UNISWAP_SWAP_ROUTER_ADDRESS, amountWei],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

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

      const hash = await walletClient.writeContract({
        address: UNISWAP_SWAP_ROUTER_ADDRESS,
        abi: SWAP_ROUTER_02_ABI,
        functionName: "multicall",
        args: [[swapData, unwrapData]],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  const usdValue =
    amountWei > 0n && mode === "buy" ? formatWeiAsUsdPrice(amountWei, ethUsdPrice) : null;

  const canSubmit =
    Boolean(account) &&
    amountWei > 0n &&
    !busy &&
    (mode === "sell" ? amountWei <= maxSellable : true);

  return (
    <div className="w-72 shrink-0 flex flex-col border-l border-white/10">
      {/* ---- Buy / Sell tabs ---- */}
      <div className="grid grid-cols-2 border-b border-white/10 shrink-0">
        <button
          onClick={() => setMode("buy")}
          className={`py-2.5 text-[12px] font-bold uppercase tracking-wide transition-colors ${
            mode === "buy" ? "bg-[#2ebd85]/15 text-[#2ebd85]" : "text-white/40 hover:text-white"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setMode("sell")}
          className={`py-2.5 text-[12px] font-bold uppercase tracking-wide transition-colors ${
            mode === "sell" ? "bg-[#e2444b]/15 text-[#e2444b]" : "text-white/40 hover:text-white"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-3 overflow-y-auto custom-scrollbar">
        {/* ---- Amount input ---- */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-white/40 uppercase tracking-wide">
              {mode === "buy" ? "Pay (ETH)" : "Sell (tokens)"}
            </span>
            {account && (
              <span className="text-[10px] text-white/30">
                Balance:{" "}
                {mode === "buy"
                  ? `${Number(formatUnits(maxBuyable, 18)).toFixed(4)} ETH`
                  : `${Number(formatUnits(maxSellable, TOKEN_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              </span>
            )}
          </div>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="pixel-frame pixel-input w-full px-3 py-2 text-sm bg-transparent focus:outline-none placeholder:text-white/20"
          />
          {usdValue && <p className="text-[10px] text-white/30 mt-1">≈ {usdValue}</p>}
        </div>

        {/* ---- Quick presets ---- */}
        <div className="grid grid-cols-4 gap-1.5">
          {mode === "buy"
            ? BUY_PRESETS_ETH.map((p) => (
                <button
                  key={p}
                  onClick={() => applyBuyPreset(p)}
                  className="pixel-frame pixel-btn-ghost py-1.5 text-[10px] font-medium text-white/70 hover:text-white"
                >
                  {p}
                </button>
              ))
            : SELL_PRESETS_PCT.map((p) => (
                <button
                  key={p}
                  onClick={() => applySellPreset(p)}
                  className="pixel-frame pixel-btn-ghost py-1.5 text-[10px] font-medium text-white/70 hover:text-white col-span-1"
                >
                  {p === 100 ? "MAX" : `${p}%`}
                </button>
              ))}
        </div>

        {/* ---- Estimated output ---- */}
        <div className="pixel-frame pixel-input px-3 py-2 flex items-center justify-between">
          <span className="text-[10px] text-white/40 uppercase tracking-wide">
            {mode === "buy" ? "Est. Receive" : "Est. Receive"}
          </span>
          <span className="text-[12px] font-mono text-white">
            {estimatedOut !== null
              ? mode === "buy"
                ? `${Number(formatUnits(estimatedOut, TOKEN_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : `${Number(formatUnits(estimatedOut, 18)).toFixed(5)} ETH`
              : "—"}
          </span>
        </div>
        {migrated === true && (
          <p className="text-[9px] text-white/25 -mt-2">
            Estimated from live pool price — actual amount confirmed on-chain.
          </p>
        )}

        {error && <p className="text-[11px] text-[#e2444b] leading-snug">{error}</p>}
        {success && <p className="text-[11px] text-[#2ebd85] leading-snug">{success}</p>}

        {/* ---- Action ---- */}
        <div className="mt-auto pt-1">
          {!account ? (
            <ConnectKitButton.Custom>
              {({ show }) => (
                <button
                  onClick={show}
                  className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm"
                >
                  Connect Wallet
                </button>
              )}
            </ConnectKitButton.Custom>
          ) : (
            <button
              onClick={handleTrade}
              disabled={!canSubmit}
              className={`pixel-frame w-full font-bold py-2.5 text-sm text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed ${
                mode === "buy" ? "pixel-btn" : "bg-[#e2444b]"
              }`}
            >
              {busy
                ? mode === "buy"
                  ? "Buying..."
                  : "Selling..."
                : mode === "buy"
                  ? "Buy"
                  : "Sell"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
