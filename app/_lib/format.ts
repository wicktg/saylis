export function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Formats a wei bigint as a short ETH string, e.g. "0.0123 ETH". */
export function formatEthShort(wei: bigint, maxDecimals = 4): string {
  const whole = wei / 10n ** 18n;
  const fraction = wei % 10n ** 18n;
  const fractionStr = fraction.toString().padStart(18, "0").slice(0, maxDecimals);
  const trimmed = fractionStr.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : `${whole}`;
}

/**
 * Formats a wei amount as a compact USD string, e.g. "$1.2M", using a
 * fixed ETH/USD reference price (the same one baked into the curve's
 * graduation-threshold math at deploy time — see DEFAULT_ETH_USD_PRICE_WHOLE
 * in app/_lib/contracts/config.ts). Not a live price feed.
 */
export function formatUsdCompact(weiAmount: bigint, ethUsdPriceWhole: number): string {
  const ethAmount = Number(weiAmount) / 1e18;
  const usd = ethAmount * ethUsdPriceWhole;

  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

/**
 * Formats a USD amount as a full price rather than a compact figure.
 *
 * Unlike `formatUsdCompact` (which rounds to whole dollars below $1K and
 * so collapses every token price to "$0"), this keeps roughly four
 * significant digits down into sub-cent territory — the range a freshly
 * launched token actually trades in.
 */
export function formatUsdPrice(usd: number): string {
  if (!Number.isFinite(usd)) return "...";
  if (usd === 0) return "$0";

  const abs = Math.abs(usd);
  const sign = usd < 0 ? "-" : "";

  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${trimTrailingZeros(abs.toFixed(4), 2)}`;

  // Sub-cent: scale decimals to the magnitude so small prices stay legible
  // instead of rounding away to zero.
  const decimals = Math.min(18, Math.max(6, 4 - Math.floor(Math.log10(abs))));
  return `${sign}$${trimTrailingZeros(abs.toFixed(decimals), 0)}`;
}

/** Drops padding zeros from a fixed-decimal string, keeping `minDecimals`. */
function trimTrailingZeros(value: string, minDecimals: number): string {
  if (!value.includes(".")) return value;
  const [whole, rawFraction] = value.split(".");
  let fraction = rawFraction.replace(/0+$/, "");
  while (fraction.length < minDecimals) fraction += "0";
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

/** Wei (of ETH) converted to a full USD price string. */
export function formatWeiAsUsdPrice(wei: bigint, ethUsdPriceWhole: number): string {
  return formatUsdPrice((Number(wei) / 1e18) * ethUsdPriceWhole);
}

/**
 * A raw token amount (base units, as a string — the shape every InfoFi pool
 * size is stored in) as a compact whole-token count: 15000000000000000000000000
 * (15,000,000 whole tokens at 18dp) -> "15M".
 */
export function formatCompactTokenAmount(rawAmount: string, decimals = 18): string {
  let raw: bigint;
  try {
    raw = BigInt(rawAmount);
  } catch {
    return "0";
  }
  const whole = Number(raw / 10n ** BigInt(decimals));
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    whole
  );
}
