"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useReadContracts } from "wagmi";
import { isAddress, type Address } from "viem";
import AppShell from "@/app/_components/AppShell";
import TransactionsFeed from "@/app/_components/token/TransactionsFeed";
import SwapPanel from "@/app/_components/token/SwapPanel";
import TokenSocialLinks from "@/app/_components/token/TokenSocialLinks";
import { supabase } from "@/app/_lib/supabase";
import { useCurveTrades } from "@/app/_lib/useCurveTrades";
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

  const { data: stats, refetch: refetchStats } = useReadContracts({
    contracts: curveAddress
      ? [
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "getPrice" },
          { address: tokenAddress!, abi: IMMUTABLE_LAUNCH_TOKEN_ABI, functionName: "totalSupply" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "cumulativeVolume" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "graduated" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "migrationExecuted" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "realEthReserve" },
          { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "graduationThreshold" },
        ]
      : [],
    // No refetchInterval. Every value here — price, supply, volume,
    // graduation progress — moves only when someone trades, and a trade is
    // exactly what the Realtime subscription below reports. Polling on a
    // timer meant reading the chain constantly to discover that nothing had
    // changed, which is what put this app 10x over its RPC rate ceiling.
    query: { enabled: Boolean(curveAddress && tokenAddress) },
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

  /**
   * Re-read the curve when a trade lands, and only then.
   *
   * `trades` grows when the webhook writes a row and Postgres pushes it
   * here, so its length is a precise signal that on-chain state has moved.
   * That replaces a 12-second poll which, between trades, spent quota
   * confirming nothing had happened.
   */
  useEffect(() => {
    if (trades.length === 0) return;
    void refetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades.length]);

  const totalSupplyWhole = totalSupplyBase !== undefined ? totalSupplyBase / ONE_TOKEN : 0n;

  /**
   * Graduated but not yet migrated is a dead state — the curve has halted,
   * so the token has no market at all until `migrate` runs. The hourly poke
   * cron does it eventually, but "eventually" is up to an hour of a token
   * sitting visibly frozen, so nudge it the moment this page observes the
   * state (the stats above refresh whenever a trade lands).
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

        {/* ---- Trades + buy/sell ----
            The whole page, now that the chart is gone. The feed takes all
            the remaining height rather than the ~38% it used to share with
            a chart above it, which is the one thing a phone had no room
            for anyway.

            Desktop docks the swap panel beside the feed — the placement
            every trading UI converges on, because a trade panel you have to
            navigate away to reach is the opposite of fast. Mobile has no
            room for a second column, so the same panel opens as a sheet
            from MobileSwapBar; it is the identical component either way. */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <TransactionsFeed
              trades={trades}
              isLoading={tradesLoading}
              error={tradesError}
              ethUsdPrice={ethUsd}
              compact={isMobile}
            />
          </div>

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
