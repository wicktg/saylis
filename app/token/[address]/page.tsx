"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useReadContracts } from "wagmi";
import { isAddress, type Address } from "viem";
import AppShell from "@/app/_components/AppShell";
import ChartToolbar from "@/app/_components/token/ChartToolbar";
import TokenChart from "@/app/_components/token/TokenChart";
import TransactionsFeed from "@/app/_components/token/TransactionsFeed";
import TokenSocialLinks from "@/app/_components/token/TokenSocialLinks";
import { supabase } from "@/app/_lib/supabase";
import { useCurveTrades } from "@/app/_lib/useCurveTrades";
import {
  buildCandles,
  reconstructSpotPrices,
  TIMEFRAMES,
  type TimeframeLabel,
} from "@/app/_lib/candles";
import type { ToolId } from "@/app/_lib/drawings";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact, formatWeiAsUsdPrice, truncateAddress } from "@/app/_lib/format";
import type { TokenRecord } from "@/app/_lib/types";

const ONE_TOKEN = 10n ** 18n;

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const routeAddress = (params?.address ?? "").toLowerCase();

  const [token, setToken] = useState<TokenRecord | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "found" | "missing">("loading");

  const [timeframe, setTimeframe] = useState<TimeframeLabel>("1m");
  const [activeTool, setActiveTool] = useState<ToolId>("cursor");
  const [clearSignal, setClearSignal] = useState(0);

  // Resolve the token record by either its token address or curve address,
  // so links from anywhere in the app land correctly.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isAddress(routeAddress)) {
        setLookupState("missing");
        return;
      }
      setLookupState("loading");
      const { data } = await supabase
        .from("tokens")
        .select("*")
        .or(`contract_address.eq.${routeAddress},curve_address.eq.${routeAddress}`)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (data) {
        setToken(data as TokenRecord);
        setLookupState("found");
      } else {
        setLookupState("missing");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [routeAddress]);

  const curveAddress = token ? (token.curve_address as Address) : undefined;
  const tokenAddress = token ? (token.contract_address as Address) : undefined;

  const {
    trades,
    isLoading: tradesLoading,
    error: tradesError,
  } = useCurveTrades(curveAddress, tokenAddress);

  const { data: stats } = useReadContracts({
    contracts: curveAddress
      ? [
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "getPrice" },
          { address: tokenAddress!, abi: IMMUTABLE_LAUNCH_TOKEN_ABI, functionName: "totalSupply" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "cumulativeVolume" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "graduated" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "migrationExecuted" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "realEthReserve" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "graduationThreshold" },
          // Live token reserve anchors the historical spot-price
          // reconstruction, so the chart's last close equals getPrice().
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "tokenReserve" },
          // Immutables. `k` is derived from these rather than from live
          // reserves: migration zeroes realEthReserve, which would collapse
          // a live-derived k and rescale the entire price history.
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "virtualEthReserve" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "virtualTokenReserve" },
          {
            address: curveAddress,
            abi: BONDING_CURVE_ABI,
            functionName: "liquidityReserveTokens",
          },
        ]
      : [],
    query: { enabled: Boolean(curveAddress && tokenAddress), refetchInterval: 8_000 },
  });

  const priceWei = stats?.[0]?.status === "success" ? (stats[0].result as bigint) : undefined;
  const totalSupplyBase =
    stats?.[1]?.status === "success" ? (stats[1].result as bigint) : undefined;
  const volumeWei = stats?.[2]?.status === "success" ? (stats[2].result as bigint) : undefined;
  const graduated = stats?.[3]?.status === "success" ? (stats[3].result as boolean) : undefined;
  const migrationExecuted =
    stats?.[4]?.status === "success" ? (stats[4].result as boolean) : undefined;
  const realEthReserve = stats?.[5]?.status === "success" ? (stats[5].result as bigint) : undefined;
  const graduationThreshold =
    stats?.[6]?.status === "success" ? (stats[6].result as bigint) : undefined;
  const tokenReserve = stats?.[7]?.status === "success" ? (stats[7].result as bigint) : undefined;
  const virtualEthReserve =
    stats?.[8]?.status === "success" ? (stats[8].result as bigint) : undefined;
  const virtualTokenReserve =
    stats?.[9]?.status === "success" ? (stats[9].result as bigint) : undefined;
  const liquidityReserveTokens =
    stats?.[10]?.status === "success" ? (stats[10].result as bigint) : undefined;

  const totalSupplyWhole = totalSupplyBase !== undefined ? totalSupplyBase / ONE_TOKEN : 0n;

  /**
   * Graduated but not yet migrated is a dead state — the curve has halted,
   * so the token has no market at all until `migrate` runs. The hourly poke
   * cron does it eventually, but "eventually" is up to an hour of a token
   * sitting visibly frozen, so nudge it the moment this page observes the
   * state (the stats poll above refreshes every 8s).
   *
   * `migrate` is permissionless on-chain and the server route simulates
   * before spending anything, so this is only ever asking for something
   * that was already going to happen, sooner. The ref keeps one mounted
   * page to a single request rather than one per poll; the cron and the
   * contract's own one-way latch cover everything else.
   */
  const migrateRequestedRef = useRef(false);
  useEffect(() => {
    if (!curveAddress) return;
    if (graduated !== true || migrationExecuted !== false) return;
    if (migrateRequestedRef.current) return;

    migrateRequestedRef.current = true;
    fetch("/api/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curveAddress }),
    }).catch(() => {
      // Best-effort: the cron is the guarantee, this is just the fast path.
    });
  }, [curveAddress, graduated, migrationExecuted]);

  /**
   * The curve's constant product, computed from immutables so it stays
   * correct forever:
   *
   *   k = virtualEth * (virtualToken + sellableSupply)
   *
   * where sellableSupply is the 80% the curve was seeded with. Deriving it
   * from live reserves instead breaks the moment a token graduates, since
   * `withdrawForMigration` sets realEthReserve to 0.
   */
  const curveK = useMemo(() => {
    if (
      virtualEthReserve === undefined ||
      virtualTokenReserve === undefined ||
      liquidityReserveTokens === undefined ||
      totalSupplyBase === undefined
    ) {
      return undefined;
    }
    const sellableSupply = totalSupplyBase - liquidityReserveTokens;
    return virtualEthReserve * (virtualTokenReserve + sellableSupply);
  }, [virtualEthReserve, virtualTokenReserve, liquidityReserveTokens, totalSupplyBase]);

  /**
   * Live price of one whole token, in wei.
   *
   * `getPrice()` reads the curve's reserves, which migration drains — so
   * after graduation it reports a stale, meaningless number. Once the
   * token trades on the pool, the most recent trade IS the market price,
   * so the header, market cap and chart all agree on one source.
   */
  const livePriceWei = useMemo(() => {
    if (graduated) {
      const lastPoolTrade = [...trades].reverse().find((trade) => trade.venue === "pool");
      // `spotPriceWei` (decoded from the swap's `sqrtPriceX96`), never
      // `priceWei`. The latter is a slippage-inclusive average of one
      // trade, so a single large sell would leave the header and market cap
      // reading ABOVE the real market — and disagreeing with both the chart
      // and the token grid, which price migrated tokens off the pool's
      // marginal `slot0`. All three now report the same quantity.
      if (lastPoolTrade?.spotPriceWei !== undefined) return lastPoolTrade.spotPriceWei;
    }
    return priceWei;
  }, [graduated, trades, priceWei]);

  const marketCapWei =
    livePriceWei !== undefined && totalSupplyWhole > 0n
      ? livePriceWei * totalSupplyWhole
      : undefined;

  /**
   * Lifetime traded volume across BOTH venues.
   *
   * The curve's own `cumulativeVolume` already counts buys and sells alike
   * (`buy` adds `msg.value`, `sell` adds the gross ETH out — see
   * BondingCurve), but it stops dead at migration: a Uniswap swap never
   * touches the curve, so the figure froze at whatever it read the moment
   * the token graduated, and a busy migrated pool still displayed its
   * graduation-day total forever.
   *
   * Pool volume is summed from the same Swap logs the trade feed and chart
   * are built from, so all three agree, and both sides of a swap count —
   * `ethWei` is the ETH leg either way, in or out.
   */
  const totalVolumeWei = useMemo(() => {
    const poolVolume = trades.reduce(
      (sum, trade) => (trade.venue === "pool" ? sum + trade.ethWei : sum),
      0n
    );
    return (volumeWei ?? 0n) + poolVolume;
  }, [volumeWei, trades]);

  // Live ETH/USD price — the same feed every curve reads on-chain for its
  // whale-tax gating, refreshed periodically rather than a fixed constant.
  const ethUsd = useEthUsdPrice();

  const bucketSeconds = useMemo(
    () => TIMEFRAMES.find((frame) => frame.label === timeframe)?.seconds ?? 60,
    [timeframe]
  );

  // Price plotted for each trade, by venue.
  //
  // Curve trades get the reconstructed MARGINAL spot price — the same
  // quantity getPrice() reports — so the chart and the header agree rather
  // than drifting apart (a trade's realized price is a slippage-and-fee
  // inclusive average).
  //
  // Pool trades can't use that: the reconstruction walks backwards through
  // the CURVE's reserves, and a Uniswap swap never touches them. Feeding
  // pool trades into it would corrupt every historical price. They instead
  // use `spotPriceWei`, decoded from the Swap event's own `sqrtPriceX96` —
  // the pool's MARGINAL price right after the swap, which is the direct
  // analogue of the curve's reconstructed price and of the `slot0` read the
  // token grid uses. Both venues therefore plot the same quantity.
  //
  // Plotting `priceWei` here instead (as this did) is what produced green
  // candles on sells: a realized price is a slippage-inclusive AVERAGE, so
  // it sits systematically ABOVE spot on a sell and BELOW it on a buy. A
  // large sell would print a close above the previous candle's — a green
  // bar on a trade that actually pushed the price down. `priceWei` remains
  // the right number for the trade feed (it is what the trader really got);
  // it is only wrong as a charted series.
  const spotPricesWei = useMemo(() => {
    const curveTrades = trades.filter((trade) => trade.venue === "curve");
    const curvePrices =
      curveK !== undefined && tokenReserve !== undefined
        ? reconstructSpotPrices(curveTrades, curveK, tokenReserve)
        : [];

    let curveIndex = 0;
    return trades.map((trade) =>
      trade.venue === "curve"
        ? (curvePrices[curveIndex++] ?? trade.priceWei)
        : (trade.spotPriceWei ?? trade.priceWei)
    );
  }, [trades, curveK, tokenReserve]);

  const candles = useMemo(
    () => buildCandles(trades, spotPricesWei, bucketSeconds, ethUsd),
    [trades, spotPricesWei, bucketSeconds, ethUsd]
  );

  const progressPct =
    graduated === true
      ? 100
      : realEthReserve !== undefined && graduationThreshold !== undefined && graduationThreshold > 0n
        ? Math.min(100, Number((realEthReserve * 10_000n) / graduationThreshold) / 100)
        : 0;

  if (lookupState === "missing") {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-sm font-bold">Token not found.</p>
          <Link href="/" className="text-[11px] text-[var(--accent)] hover:underline">
            Back to Explore
          </Link>
        </div>
      </AppShell>
    );
  }

  if (lookupState === "loading" || !token) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[11px] text-white/30">Loading token...</p>
        </div>
      </AppShell>
    );
  }

  const imageUrl = resolveIpfsUrl(token.image_url);

  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* ---- Token header ---- */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 shrink-0">
          <Link
            href="/"
            aria-label="Back to Explore"
            title="Back to Explore"
            className="w-8 h-8 flex items-center justify-center shrink-0 border border-white/15 text-white/60 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
          >
            <iconify-icon icon="pixelarticons:arrow-left" className="text-base" />
          </Link>

          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={token.ticker}
              width={32}
              height={32}
              priority
              className="w-8 h-8 object-cover bg-white/5 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
              <span className="text-xs font-black text-[var(--accent)]">
                {token.ticker.charAt(0)}
              </span>
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold uppercase tracking-tight truncate">
                {token.ticker}
              </h1>
              <span className="text-[11px] text-white/40 truncate">{token.name}</span>
              <TokenSocialLinks socials={token.socials} />
              {graduated && (
                <span
                  className={
                    migrationExecuted
                      ? "text-[9px] font-bold uppercase bg-white/10 text-white/60 px-1.5 py-0.5"
                      : "text-[9px] font-bold uppercase bg-[var(--accent-tint)] text-[var(--accent)] px-1.5 py-0.5 animate-pulse"
                  }
                >
                  {migrationExecuted ? "Migrated" : "Migrating"}
                </span>
              )}
            </div>
            <CopyAddress address={token.contract_address} />
          </div>

          <div className="ml-auto flex items-center gap-5 shrink-0">
            <Stat
              label="Price"
              value={priceWei !== undefined ? formatWeiAsUsdPrice(priceWei, ethUsd) : "..."}
            />
            <Stat
              label="Market Cap"
              value={marketCapWei !== undefined ? formatUsdCompact(marketCapWei, ethUsd) : "..."}
            />
            <Stat
              label="Volume"
              value={volumeWei !== undefined ? formatUsdCompact(totalVolumeWei, ethUsd) : "..."}
            />
            <Stat label="Bonding" value={`${progressPct.toFixed(1)}%`} />
          </div>
        </div>

        {/* ---- Chart top bar: timeframes ---- */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 shrink-0">
          {TIMEFRAMES.map((frame) => (
            <button
              key={frame.label}
              onClick={() => setTimeframe(frame.label)}
              className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                timeframe === frame.label
                  ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                  : "text-white/40 hover:text-white hover:bg-white/5"
              }`}
            >
              {frame.label}
            </button>
          ))}

          <span className="ml-auto text-[10px] text-white/30 pr-2">
            {candles.length} candles · {trades.length} trades
          </span>
        </div>

        {/* ---- Chart + left drawing toolbar ---- */}
        <div className="flex flex-1 min-h-0">
          <ChartToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onClear={() => setClearSignal((n) => n + 1)}
          />
          <div className="flex-1 flex flex-col min-w-0">
            {tradesLoading && trades.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[11px] text-white/30">Loading on-chain trade history...</p>
              </div>
            ) : trades.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[11px] text-white/30">
                  No trades on this curve yet. The chart starts at the first buy.
                </p>
              </div>
            ) : (
              <TokenChart
                candles={candles}
                activeTool={activeTool}
                onToolConsumed={() => setActiveTool("cursor")}
                clearSignal={clearSignal}
              />
            )}
          </div>
        </div>

        {/* ---- Live transactions ---- */}
        <div className="h-[38%] shrink-0 flex flex-col min-h-0">
          <TransactionsFeed
            trades={trades}
            isLoading={tradesLoading}
            error={tradesError}
            ethUsdPrice={ethUsd}
          />
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wide text-white/30">{label}</span>
      <span className="text-[11px] font-bold font-mono">{value}</span>
    </div>
  );
}

/**
 * Contract address with a copy button. Copies the FULL address (the label
 * is truncated for space, but a truncated address pasted into a wallet or
 * explorer is useless), and confirms with a brief checkmark.
 */
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure origin, permissions) —
      // leave the label as-is rather than falsely reporting success.
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? "Copied" : `Copy ${address}`}
      aria-label={copied ? "Address copied" : "Copy contract address"}
      className="group flex items-center gap-1 text-[10px] font-mono text-white/30 hover:text-white/70 transition-colors"
    >
      <iconify-icon
        icon={copied ? "pixelarticons:check" : "pixelarticons:copy"}
        className={`text-[11px] shrink-0 ${copied ? "text-[var(--accent)]" : ""}`}
      />
      <span>{copied ? "Copied" : truncateAddress(address)}</span>
    </button>
  );
}
