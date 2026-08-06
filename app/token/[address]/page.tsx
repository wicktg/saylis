"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useReadContracts } from "wagmi";
import { isAddress, type Address } from "viem";
import AppShell from "@/app/_components/AppShell";
import dynamic from "next/dynamic";
/**
 * Code-split. The drawing toolset (trendline, Fibonacci, XABCD, brush,
 * text, scale) is desktop-only and never rendered under the mobile
 * breakpoint, so a dynamic import keeps it and its drawing machinery out
 * of the bundle a phone downloads entirely -- not merely out of the DOM.
 * `ssr: false` because it is interactive chrome with no server-rendered
 * value.
 */
const ChartToolbar = dynamic(() => import("@/app/_components/token/ChartToolbar"), {
  ssr: false,
});
/**
 * Lazy. klinecharts is by far the heaviest dependency on this page and
 * nothing above it depends on the module being present, so deferring it
 * lets the header, timeframes and trade bar paint first -- which matters
 * most on a phone on a slow connection.
 */
const TokenChart = dynamic(() => import("@/app/_components/token/TokenChart"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-[11px] text-white/30">loading chart...</p>
    </div>
  ),
});
import TransactionsFeed from "@/app/_components/token/TransactionsFeed";
import SwapPanel from "@/app/_components/token/SwapPanel";
import TokenSocialLinks from "@/app/_components/token/TokenSocialLinks";
import { supabase } from "@/app/_lib/supabase";
import { useCurveTrades } from "@/app/_lib/useCurveTrades";
import {
  buildCandles,
  anchorToLivePrice,
  reconstructSpotPrices,
  TIMEFRAMES,
  type TimeframeLabel,
} from "@/app/_lib/candles";
import type { ToolId } from "@/app/_lib/drawings";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import { usePoolSpotPrice } from "@/app/_lib/poolPrice";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { formatUsdCompact, formatWeiAsUsdPrice, truncateAddress } from "@/app/_lib/format";
import type { TokenRecord } from "@/app/_lib/types";
import MobileSwapBar from "@/app/_components/mobile/MobileSwapBar";
import { useIsMobile } from "@/app/_lib/useIsMobile";
import Icon from "@/app/_components/Icon";

const ONE_TOKEN = 10n ** 18n;

export default function TokenDetailPage() {
  const params = useParams<{ address: string }>();
  const routeAddress = (params?.address ?? "").toLowerCase();

  const [token, setToken] = useState<TokenRecord | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "found" | "missing">("loading");

  const [timeframe, setTimeframe] = useState<TimeframeLabel>("1m");
  const [activeTool, setActiveTool] = useState<ToolId>("cursor");
  const [clearSignal, setClearSignal] = useState(0);
  /**
   * Chart Y axis: raw token price, or price scaled to market cap. Purely a
   * display transform -- market cap IS price x total supply, so no separate
   * data source is involved and nothing about the candles changes.
   */
  const [chartMode, setChartMode] = useState<"price" | "mcap">("price");
  const isMobile = useIsMobile();

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
    query: { enabled: Boolean(curveAddress && tokenAddress), refetchInterval: 12_000 },
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
  // Read the pool directly rather than inferring price from the trade feed.
  // See app/_lib/poolPrice.ts — one definition, shared with the token grid.
  const { priceWei: poolPriceWei } = usePoolSpotPrice(tokenAddress, migrationExecuted);

  const livePriceWei = useMemo(() => {
    // Once migrated, `getPrice()` is frozen garbage: migration drains
    // `realEthReserve` to zero, leaving it derived from virtual reserves
    // alone. So a migrated token is priced by its pool or not at all.
    //
    // This previously fell back to the curve price whenever a pool price
    // was not yet available, which on every refresh meant a real, plausible,
    // WRONG price rendered for the second or two before the data arrived —
    // header and market cap disagreeing with the chart, then silently
    // correcting. `undefined` makes the loading state honest instead.
    if (migrationExecuted) return poolPriceWei;
    return priceWei;
  }, [migrationExecuted, poolPriceWei, priceWei]);

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
  //
  // The indexer now records the curve's marginal price alongside each trade
  // (see indexer/src/index.ts), so a stored value is preferred wherever one
  // exists — it is a fact about the trade rather than something inferred
  // from two live reads that must both still be correct.
  //
  // Reconstruction stays for the rows that have none: trades indexed before
  // that change, and trades read straight from logs when the indexer has
  // never seen a curve. It still runs over the FULL curve sequence, not just
  // the gaps, because the walk-back derives each reserve from the trade
  // after it — skipping entries would break the chain it depends on.
  const spotPricesWei = useMemo(() => {
    const curveTrades = trades.filter((trade) => trade.venue === "curve");
    const curvePrices =
      curveK !== undefined && tokenReserve !== undefined
        ? reconstructSpotPrices(curveTrades, curveK, tokenReserve)
        : [];

    let curveIndex = 0;
    return trades.map((trade) => {
      if (trade.venue !== "curve") return trade.spotPriceWei ?? trade.priceWei;
      const reconstructed = curvePrices[curveIndex++];
      return trade.spotPriceWei ?? reconstructed ?? trade.priceWei;
    });
  }, [trades, curveK, tokenReserve]);

  const candles = useMemo(() => {
    const built = buildCandles(trades, spotPricesWei, bucketSeconds, ethUsd);
    // Pin the last bar to the same price the header prints, so the chart can
    // never visibly disagree with it. See `anchorToLivePrice`.
    const liveUsd =
      livePriceWei !== undefined ? (Number(livePriceWei) / 1e18) * ethUsd : undefined;
    return anchorToLivePrice(built, liveUsd, bucketSeconds, Math.floor(Date.now() / 1000));
  }, [trades, spotPricesWei, bucketSeconds, ethUsd, livePriceWei]);
  /**
   * Candles as displayed. In mcap mode every OHLC value is scaled by total
   * supply, since market cap is exactly price x supply -- so the curve's
   * SHAPE is identical and only the axis labels change. Scaling here rather
   * than rebuilding the series keeps one source of truth for the data.
   */
  const displayCandles = useMemo(() => {
    if (chartMode === "price" || totalSupplyWhole === 0n) return candles;
    const supply = Number(totalSupplyWhole);
    return candles.map((candle) => ({
      ...candle,
      open: candle.open * supply,
      high: candle.high * supply,
      low: candle.low * supply,
      close: candle.close * supply,
    }));
  }, [candles, chartMode, totalSupplyWhole]);

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

  /**
   * The four header figures, declared once and rendered into whichever of
   * the two layouts below is active. Deliberately a single array rather
   * than two copies of the same JSX: these are live financial numbers, and
   * two hand-maintained copies is exactly how a mobile "vol" quietly ends
   * up reading a different source than the desktop one.
   */
  const headerStats: { label: string; value: string }[] = [
    {
      label: "price",
      // `livePriceWei`, never the raw `priceWei` from the curve.
      // Market Cap below is `livePriceWei * totalSupply`, so reading
      // the curve here put two different prices side by side on the
      // same panel — post-migration the curve's `getPrice()` is
      // frozen, so Price and Market Cap disagreed by whatever the
      // token had moved since it graduated.
      value: livePriceWei !== undefined ? formatWeiAsUsdPrice(livePriceWei, ethUsd) : "...",
    },
    {
      label: "mcap",
      value: marketCapWei !== undefined ? formatUsdCompact(marketCapWei, ethUsd) : "...",
    },
    {
      label: "vol",
      value: volumeWei !== undefined ? formatUsdCompact(totalVolumeWei, ethUsd) : "...",
    },
    { label: "bonding", value: `${progressPct.toFixed(1)}%` },
  ];

  return (
    <AppShell>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* ---- Token header ---- */}
        <div className="flex items-center gap-3 px-3 md:px-4 py-2.5 border-b border-white/10 shrink-0">
          <Link
            href="/"
            aria-label="Back to Explore"
            title="Back to Explore"
            className="w-8 h-8 flex items-center justify-center shrink-0 border border-white/15 text-white/60 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
          >
            <Icon icon="pixelarticons:arrow-left" className="text-base" />
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

          {/* Desktop keeps all four figures on the identity row — there is
              room for them there and nothing below moves. */}
          {!isMobile && (
            <div className="ml-auto flex items-center gap-5 shrink-0">
              {headerStats.map((stat) => (
                <Stat key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          )}
        </div>

        {/* On a phone the same four figures need ~450px of the ~375px the
            viewport has, which is what was driving them into the ticker and
            contract address. They get their own full-width row instead, as
            an even 4-up grid so the columns line up regardless of how wide
            any individual value renders. */}
        {isMobile && (
          <div className="grid grid-cols-4 gap-2 px-3 py-1.5 border-b border-white/10 shrink-0">
            {headerStats.map((stat) => (
              <Stat key={stat.label} label={stat.label} value={stat.value} compact />
            ))}
          </div>
        )}

        {/* ---- Chart top bar: timeframes + price/mcap ---- */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 shrink-0 overflow-x-auto no-scrollbar">
          {TIMEFRAMES.map((frame) => (
            <button
              key={frame.label}
              onClick={() => setTimeframe(frame.label)}
              className={`shrink-0 px-2 py-1.5 md:py-1 text-[11px] font-medium transition-colors ${
                timeframe === frame.label
                  ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                  : "text-white/40 hover:text-white hover:bg-white/5"
              }`}
            >
              {frame.label}
            </button>
          ))}

          {/* Price / market-cap axis switch. Mobile drops the drawing
              toolset entirely, so this and the timeframes are the only
              chart controls a phone gets -- both live here. */}
          <div className="ml-auto flex items-center gap-1 shrink-0 pl-2">
            {(["price", "mcap"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setChartMode(mode)}
                aria-pressed={chartMode === mode}
                className={`px-2 py-1.5 md:py-1 text-[11px] lowercase transition-colors ${
                  chartMode === mode
                    ? "text-[var(--accent)]"
                    : "text-white/40 hover:text-white"
                }`}
              >
                {chartMode === mode ? `[${mode}]` : mode}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Chart + left drawing toolbar ---- */}
        <div className="flex flex-1 min-h-0">
          {/* Desktop only, and genuinely ABSENT rather than hidden: the
              whole drawing toolset is meaningless without a pointer, and
              its bundle is dynamically imported so a phone never fetches
              it either. */}
          {!isMobile && (
            <ChartToolbar
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              onClear={() => setClearSignal((n) => n + 1)}
            />
          )}
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
                candles={displayCandles}
                // Everything that rebuckets or rescales the series. Anything
                // NOT in here — history arriving, a new trade, the USD rate
                // resolving — is the same series still filling in, and must
                // not cost the user their zoom.
                seriesKey={`${tokenAddress}:${bucketSeconds}:${chartMode}`}
                activeTool={isMobile ? "cursor" : activeTool}
                onToolConsumed={() => setActiveTool("cursor")}
                clearSignal={clearSignal}
              />
            )}
          </div>

          {/* ---- Buy/Sell, docked beside the chart ----
              Same placement every trading UI converges on (DexScreener,
              Photon, pump.fun): always visible next to the thing the user
              is watching, never a click or a scroll away. */}
          {tokenAddress && !isMobile && (
            <SwapPanel
              tokenAddress={tokenAddress}
              curveAddress={curveAddress}
              migrated={migrationExecuted}
              poolPriceWei={poolPriceWei}
              ethUsdPrice={ethUsd}
            />
          )}
        </div>

        {/* ---- Live transactions ----
            Mobile takes a slightly smaller share than it used to (32% ->
            29%) purely to pay for the stats row added above it. The chart
            is the thing a phone has least room for and most needs, so the
            new row is funded out of the feed rather than out of the chart;
            the feed scrolls, the chart does not. Desktop is untouched. */}
        <div className="h-[29%] md:h-[38%] shrink-0 flex flex-col min-h-0">
          <TransactionsFeed
            trades={trades}
            isLoading={tradesLoading}
            error={tradesError}
            ethUsdPrice={ethUsd}
            compact={isMobile}
          />
        </div>

        {/* Clears the fixed trade bar so the feed's last row is reachable. */}
        {isMobile && <div aria-hidden="true" className="h-16 shrink-0" />}
      </div>

      {isMobile && tokenAddress && (
        <MobileSwapBar
          tokenAddress={tokenAddress}
          curveAddress={curveAddress}
          migrated={migrationExecuted}
          poolPriceWei={poolPriceWei}
          ethUsdPrice={ethUsd}
        />
      )}
    </AppShell>
  );
}

/**
 * One labelled figure from the token header.
 *
 * `compact` is for the mobile grid, where each column is a hard quarter of
 * the viewport: it lets a long value ellipsize inside its column instead of
 * widening it and pushing the other three out of alignment, and exposes the
 * full untruncated figure on tap-and-hold via `title`. Desktop passes it
 * nothing and renders exactly as before — the row there is `shrink-0`, so
 * `min-w-0` never engages.
 */
function Stat({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="ascii flex flex-col leading-tight min-w-0">
      <span className="ascii-label text-[9px]">{label}</span>
      <span
        className={`ascii-value text-[11px]${compact ? " truncate" : ""}`}
        title={compact ? value : undefined}
      >
        {value}
      </span>
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
      <Icon
        icon={copied ? "pixelarticons:check" : "pixelarticons:copy"}
        className={`text-[11px] shrink-0 ${copied ? "text-[var(--accent)]" : ""}`}
      />
      <span>{copied ? "Copied" : truncateAddress(address)}</span>
    </button>
  );
}
