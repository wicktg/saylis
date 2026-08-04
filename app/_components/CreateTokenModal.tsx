"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useReadContracts, useWatchContractEvent } from "wagmi";
import { isAddress } from "viem";
import { useLaunchToken } from "@/app/_lib/useLaunchToken";
import { recordLaunchedToken } from "@/app/_lib/launchedTokens";
import { celebrateTokenLaunch } from "@/app/_lib/celebrate";
import { formatEthShort, truncateAddress } from "@/app/_lib/format";
import { resolveIpfsUrl, uploadImageToIpfs } from "@/app/_lib/ipfs";
import { supabase } from "@/app/_lib/supabase";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import {
  DEFAULT_TOTAL_SUPPLY,
  MAX_INFOFI_BPS,
  MAX_SELL_TAX_BPS,
  TOKEN_DECIMALS,
} from "@/app/_lib/contracts/config";
import type { Address } from "viem";
import Icon from "@/app/_components/Icon";
import AsciiSlider from "@/app/_components/AsciiSlider";
import AsciiSpinner from "@/app/_components/AsciiSpinner";
import { useIsMobile } from "@/app/_lib/useIsMobile";

const DESCRIPTION_LIMIT = 280;
// Mirrors BondingCurve's MAX_SELL_TAX_BPS (300 = 3%) in the slider's own
// percent units, so the UI can never offer a value the contract rejects.
const WHALE_TAX_MAX = Number(MAX_SELL_TAX_BPS) / 100;
// Same idea for MAX_INFOFI_BPS (500 = 5%).
const INFOFI_MAX_PCT = Number(MAX_INFOFI_BPS) / 100;

type Stage = "form" | "launching" | "saving" | "success";

export default function CreateTokenModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { address: account } = useAccount();
  const { launch, status, error, result, reset: resetLaunch } = useLaunchToken();

  const [stage, setStage] = useState<Stage>("form");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isMobile = useIsMobile();
  const [whaleSellTax, setWhaleSellTax] = useState(1);
  const [feeRecipient, setFeeRecipient] = useState("");
  const [feeRecipientTouched, setFeeRecipientTouched] = useState(false);
  const [infoFiAllocation, setInfoFiAllocation] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Blank is valid and means "pay me" — the contract defaults a zero
   * address to the creator. Anything else must be a real address, checked
   * before submission so a typo cannot permanently redirect a launch's
   * entire fee stream to an address nobody controls.
   */
  const feeRecipientError = useMemo(() => {
    const trimmed = feeRecipient.trim();
    if (trimmed === "") return null;
    if (!isAddress(trimmed)) return "Enter a valid 0x address.";
    return null;
  }, [feeRecipient]);

  /** Human-readable preview of what the InfoFi slider actually locks up. */
  const infoFiTokens = useMemo(() => {
    const tokens = (Number(DEFAULT_TOTAL_SUPPLY) * infoFiAllocation) / 100;
    return tokens.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }, [infoFiAllocation]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && stage !== "launching" && stage !== "saving") handleClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage]);

  useEffect(() => {
    if (status === "deploying-token" || status === "deploying-curve") setStage("launching");
  }, [status]);

  useEffect(() => {
    if (status !== "success" || !result || !account) return;

    let cancelled = false;

    async function finalizeLaunch() {
      if (!result || !account) return;
      setStage("saving");
      setSaveError(null);

      try {
        let imageUri: string | null = null;
        if (imageFile) {
          imageUri = await uploadImageToIpfs(imageFile);
        }

        const { error: insertError } = await supabase.from("tokens").insert({
          contract_address: result.tokenAddress.toLowerCase(),
          curve_address: result.curveAddress.toLowerCase(),
          creator_wallet_address: account.toLowerCase(),
          name: name.trim(),
          ticker: ticker.trim().toUpperCase(),
          description: description.trim() || null,
          socials: {
            x: xHandle.trim() || undefined,
            telegram: telegram.trim() || undefined,
            website: website.trim() || undefined,
          },
          image_url: imageUri,
        });
        if (insertError) throw insertError;

        if (cancelled) return;

        // Mirror the on-chain campaign immediately, so a creator who just
        // locked supply sees it on /campaigns the moment the launch lands
        // rather than whenever the poke cron next happens to run. Only the
        // service-role key may write that table, hence the route.
        //
        // Best-effort and deliberately not awaited into the failure path:
        // the campaign is already real on-chain and the cron re-syncs it
        // regardless, so a hiccup here must never fail an otherwise
        // successful launch.
        if (infoFiAllocation > 0) {
          fetch("/api/campaigns/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tokenAddress: result.tokenAddress }),
          }).catch(() => {});
        }

        // Submit both contracts for source verification on the block
        // explorer. Same fire-and-forget contract as the sync above: this
        // is metadata, it changes nothing on-chain, and it must never be
        // able to fail a launch that already succeeded.
        //
        // Without it every launched token reads as "Unknown Contract" to
        // explorers and automated auditors, which then decompile and guess
        // — and they guess badly (see /api/verify-contract for the honeypot
        // false-positive this exists to prevent).
        fetch("/api/verify-contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenAddress: result.tokenAddress,
            curveAddress: result.curveAddress,
            ...result.constructorArgs,
          }),
        }).catch(() => {});

        recordLaunchedToken(account, {
          tokenAddress: result.tokenAddress,
          curveAddress: result.curveAddress,
          symbol: ticker.toUpperCase(),
          launchedAt: Date.now(),
        });
        setStage("success");
      } catch (err) {
        if (cancelled) return;
        // The on-chain deploy already succeeded and is fully live/tradable
        // regardless of what happens here — a failure at this step only
        // means the token won't show up in the grid/trending yet, not
        // that anything on-chain needs retrying. Surface it but still
        // move on to the success view since the contracts ARE live.
        setSaveError(
          err instanceof Error ? err.message : "Saving token details failed."
        );
        recordLaunchedToken(account, {
          tokenAddress: result.tokenAddress,
          curveAddress: result.curveAddress,
          symbol: ticker.toUpperCase(),
          launchedAt: Date.now(),
        });
        setStage("success");
      }
    }

    finalizeLaunch();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, result, account]);

  // Fire the celebration the instant the success view appears — keyed on
  // `stage` itself (not `status`) so it triggers exactly once per launch,
  // right as the modal transitions into showing the new token.
  useEffect(() => {
    if (stage === "success") celebrateTokenLaunch();
  }, [stage]);

  if (!open) return null;

  function handleClose() {
    onClose();
    // Reset after the close animation-less unmount — next open starts fresh.
    setStage("form");
    setImageFile(null);
    setImagePreview(null);
    setName("");
    setTicker("");
    setDescription("");
    setXHandle("");
    setTelegram("");
    setWebsite("");
    setAdvancedOpen(false);
    setWhaleSellTax(1);
    setFeeRecipient("");
    setFeeRecipientTouched(false);
    setInfoFiAllocation(0);
    setSaveError(null);
    resetLaunch();
  }

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!account || !name.trim() || !ticker.trim() || !imageFile) return;

    // Surface a bad redirect address rather than silently launching with it.
    if (feeRecipientError) {
      setFeeRecipientTouched(true);
      setAdvancedOpen(true);
      return;
    }

    try {
      const trimmedRecipient = feeRecipient.trim();
      await launch({
        name: name.trim(),
        symbol: ticker.trim().toUpperCase(),
        sellTaxBps: Math.round(whaleSellTax * 100),
        creatorFeeRecipient: trimmedRecipient === "" ? undefined : (trimmedRecipient as Address),
        infoFiBps: Math.round(infoFiAllocation * 100),
      });
    } catch {
      // Error state surfaced via `error` from useLaunchToken; stage stays
      // on "form" so the user can retry without re-filling anything.
      setStage("form");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/50">
      <div className="mobile-sheet surface-circuit relative w-full max-w-sm mx-4 bg-[var(--bg-main)] border border-white/20 rounded-2xl p-6">
        <button
          onClick={handleClose}
          disabled={stage === "launching" || stage === "saving"}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Icon icon="pixelarticons:close" className="text-base" />
        </button>

        {stage === "form" && (
          <>
            <h2 className="text-lg font-bold mb-5">Create Token</h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 rounded-xl border border-dashed border-white/20 bg-white/5 hover:border-[rgba(207,56,221,0.5)] transition-colors flex items-center justify-center overflow-hidden shrink-0"
                >
                  {imagePreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imagePreview}
                      alt="Token preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Icon icon="pixelarticons:image-plus" className="text-xl text-white/30" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  aria-label="Toggle advanced options"
                  aria-expanded={advancedOpen}
                  className="flex items-center gap-1 text-white/40 hover:text-white transition-colors"
                >
                  {/* Desktop leaves this a bare chevron, as it was — the
                      panel it opens flies out in plain sight beside the
                      modal. On mobile the panel expands further down a
                      scrolling sheet, so the control needs to say what it
                      does or it reads as decoration. */}
                  {isMobile && (
                    <span className="text-[10px] uppercase tracking-wider">Advanced</span>
                  )}
                  <Icon
                    icon="pixelarticons:chevron-right"
                    className={`text-lg transition-transform duration-200 ${
                      advancedOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />

              <input
                type="text"
                placeholder="Token Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[rgba(207,56,221,0.5)] placeholder:text-white/30"
              />

              <input
                type="text"
                placeholder="Ticker Symbol"
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
                required
                maxLength={10}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:border-[rgba(207,56,221,0.5)] placeholder:text-white/30 placeholder:normal-case"
              />

              <div>
                <textarea
                  placeholder="Short description..."
                  rows={3}
                  maxLength={DESCRIPTION_LIMIT}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[rgba(207,56,221,0.5)] placeholder:text-white/30"
                />
                <div className="text-right text-[10px] text-white/30 mt-1">
                  {description.length}/{DESCRIPTION_LIMIT}
                </div>
              </div>

              {error && (
                <div className="py-3 text-center">
                  <p className="text-sm font-bold text-white border border-white/20 rounded-lg px-3 py-2 inline-block">
                    {error}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-2">
                  <Icon icon="ri:twitter-x-fill" className="text-white/40 text-xs shrink-0" />
                  <input
                    type="text"
                    placeholder="X"
                    value={xHandle}
                    onChange={(event) => setXHandle(event.target.value)}
                    className="w-full bg-transparent text-xs focus:outline-none placeholder:text-white/30"
                  />
                </div>
                <div className="flex-1 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-2">
                  <Icon icon="mdi:telegram" className="text-white/40 text-xs shrink-0" />
                  <input
                    type="text"
                    placeholder="Telegram"
                    value={telegram}
                    onChange={(event) => setTelegram(event.target.value)}
                    className="w-full bg-transparent text-xs focus:outline-none placeholder:text-white/30"
                  />
                </div>
                <div className="flex-1 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2.5 py-2">
                  <Icon icon="pixelarticons:globe" className="text-white/40 text-xs shrink-0" />
                  <input
                    type="text"
                    placeholder="Website"
                    value={website}
                    onChange={(event) => setWebsite(event.target.value)}
                    className="w-full bg-transparent text-xs focus:outline-none placeholder:text-white/30"
                  />
                </div>
              </div>

              {/* Mobile: the desktop popover is positioned `left-full`,
                  which on a phone is off the right edge of a sheet that
                  already fills the viewport — the settings were rendered
                  but unreachable. Here they expand inline in the form's own
                  flow instead (the sheet scrolls), so the same three
                  controls are actually usable. Mounted only when open, so
                  nothing invisible sits in the tab order. */}
              {isMobile && advancedOpen && (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-[10px] uppercase tracking-wider text-white/40 mb-3">
                    Advanced Settings
                  </p>
                  <AdvancedFields
                    disabled={false}
                    whaleSellTax={whaleSellTax}
                    onWhaleSellTaxChange={setWhaleSellTax}
                    feeRecipient={feeRecipient}
                    onFeeRecipientChange={setFeeRecipient}
                    feeRecipientTouched={feeRecipientTouched}
                    onFeeRecipientBlur={() => setFeeRecipientTouched(true)}
                    feeRecipientError={feeRecipientError}
                    infoFiAllocation={infoFiAllocation}
                    onInfoFiAllocationChange={setInfoFiAllocation}
                    infoFiTokens={infoFiTokens}
                  />
                </div>
              )}

              {!account && (
                <p className="text-[11px] text-white/40 leading-snug">
                  Connect a wallet to launch a token.
                </p>
              )}
              {account && (!name.trim() || !ticker.trim() || !imageFile) && (
                <p className="text-[11px] text-white/40 leading-snug">
                  Add an image, name, and ticker to launch.
                </p>
              )}

              <button
                type="submit"
                disabled={!account || !name.trim() || !ticker.trim() || !imageFile}
                className="w-full bg-[var(--accent-fill)] text-white font-bold py-3 rounded-xl text-sm hover:bg-[var(--accent-fill-hover)] transition-colors mt-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--accent-fill)]"
              >
                Launch Token
              </button>
            </form>

            {/* Desktop: the settings live in a popover flown out to the
                right of the modal. Untouched — same absolute positioning,
                same fly-out transition, same always-mounted/opacity-toggled
                behaviour as before. */}
            {!isMobile && (
              <div
                aria-hidden={!advancedOpen}
                className={`surface-circuit absolute top-0 left-full ml-3 w-60 bg-[var(--bg-main)] border border-white/20 rounded-2xl p-5 origin-left transition-all duration-200 ease-out ${
                  advancedOpen
                    ? "opacity-100 scale-100"
                    : "opacity-0 scale-90 pointer-events-none"
                }`}
              >
                <AdvancedFields
                  disabled={!advancedOpen}
                  whaleSellTax={whaleSellTax}
                  onWhaleSellTaxChange={setWhaleSellTax}
                  feeRecipient={feeRecipient}
                  onFeeRecipientChange={setFeeRecipient}
                  feeRecipientTouched={feeRecipientTouched}
                  onFeeRecipientBlur={() => setFeeRecipientTouched(true)}
                  feeRecipientError={feeRecipientError}
                  infoFiAllocation={infoFiAllocation}
                  onInfoFiAllocationChange={setInfoFiAllocation}
                  infoFiTokens={infoFiTokens}
                />
              </div>
            )}
          </>
        )}

        {(stage === "launching" || stage === "saving") && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <AsciiSpinner className="text-2xl text-[#cf38dd]" />
            <p className="text-sm font-bold">Launching...</p>
            {stage === "launching" && (
              <p className="text-[11px] text-white/40 text-center leading-relaxed">
                {status === "deploying-token"
                  ? "Deploying your token..."
                  : "Deploying the bonding curve..."}
                <br />
                Confirm each transaction in your wallet.
              </p>
            )}
          </div>
        )}

        {stage === "success" && result && (
          <LaunchSuccess
            imagePreview={imagePreview}
            ticker={ticker.toUpperCase()}
            tokenAddress={result.tokenAddress}
            curveAddress={result.curveAddress}
            saveError={saveError}
            onClose={handleClose}
          />
        )}
      </div>
    </div>
  );
}

function LaunchSuccess({
  imagePreview,
  ticker,
  tokenAddress,
  curveAddress,
  saveError,
  onClose,
}: {
  imagePreview: string | null;
  ticker: string;
  tokenAddress: Address;
  curveAddress: Address;
  saveError: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const { data, refetch } = useReadContracts({
    contracts: [
      { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "getPrice" },
      { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "ethReserve" },
      { address: curveAddress, abi: BONDING_CURVE_ABI, functionName: "tokenReserve" },
    ],
  });

  // Live: refresh price/reserves the moment a trade happens on this curve.
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "Buy",
    onLogs: () => refetch(),
  });
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "Sell",
    onLogs: () => refetch(),
  });

  const price = data?.[0]?.result as bigint | undefined;
  const ethReserve = data?.[1]?.result as bigint | undefined;
  const tokenReserve = data?.[2]?.result as bigint | undefined;

  async function handleCopy() {
    await navigator.clipboard.writeText(tokenAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col items-center text-center py-4">
      <div className="w-20 h-20 rounded-xl border border-white/10 bg-white/5 overflow-hidden flex items-center justify-center mb-4">
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagePreview} alt={ticker} className="w-full h-full object-cover" />
        ) : (
          <Icon icon="pixelarticons:coin" className="text-2xl text-[#cf38dd]" />
        )}
      </div>

      <h2 className="text-lg font-bold mb-1">{ticker || "TOKEN"}</h2>

      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white/80 transition-colors mb-5"
      >
        {truncateAddress(tokenAddress)}
        <Icon icon={copied ? "pixelarticons:check" : "pixelarticons:copy"} className="text-xs" />
      </button>

      {saveError && (
        <p className="text-[10px] text-orange-400 leading-snug mb-4 px-2">
          Live and tradable on-chain, but saving its details failed ({saveError}). It
          won&apos;t show up in the token grid yet.
        </p>
      )}

      <div className="w-full grid grid-cols-3 gap-2 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-2">
          <div className="text-[9px] text-white/40 mb-1">Price</div>
          <div className="text-[11px] font-bold">
            {price !== undefined ? `${formatEthShort(price, 8)} ETH` : "..."}
          </div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-2">
          <div className="text-[9px] text-white/40 mb-1">ETH Reserve</div>
          <div className="text-[11px] font-bold">
            {ethReserve !== undefined ? `${formatEthShort(ethReserve, 4)} ETH` : "..."}
          </div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-lg py-2.5 px-2">
          <div className="text-[9px] text-white/40 mb-1">Token Reserve</div>
          <div className="text-[11px] font-bold">
            {tokenReserve !== undefined
              ? Number(tokenReserve / 10n ** BigInt(TOKEN_DECIMALS)).toLocaleString()
              : "..."}
          </div>
        </div>
      </div>

      <button
        onClick={onClose}
        className="w-full bg-[var(--accent-fill)] text-white font-bold py-3 rounded-xl text-sm hover:bg-[var(--accent-fill-hover)] transition-colors"
      >
        Done
      </button>
    </div>
  );
}

/**
 * The three optional launch parameters behind the Advanced toggle: whale
 * sell tax, fee redirection, and the InfoFi allocation.
 *
 * These are extracted into one component precisely because they render in
 * two different containers — a fly-out popover on desktop, an inline
 * expanding section on mobile. Each of the three writes a value into the
 * deploy transaction, so a second copy of this markup would be a second
 * place for a cap, a validation rule, or a helper string to drift out of
 * sync with the contract. The container differs; the controls cannot.
 *
 * Stateless by design — every value and setter belongs to CreateTokenModal,
 * so which layout is on screen has no bearing on what gets deployed.
 */
function AdvancedFields({
  disabled,
  whaleSellTax,
  onWhaleSellTaxChange,
  feeRecipient,
  onFeeRecipientChange,
  feeRecipientTouched,
  onFeeRecipientBlur,
  feeRecipientError,
  infoFiAllocation,
  onInfoFiAllocationChange,
  infoFiTokens,
}: {
  /** Desktop keeps the panel mounted while closed and relies on this to
   *  hold it out of the tab order; mobile only mounts it when open. */
  disabled: boolean;
  whaleSellTax: number;
  onWhaleSellTaxChange: (value: number) => void;
  feeRecipient: string;
  onFeeRecipientChange: (value: string) => void;
  feeRecipientTouched: boolean;
  onFeeRecipientBlur: () => void;
  feeRecipientError: string | null;
  infoFiAllocation: number;
  onInfoFiAllocationChange: (value: number) => void;
  infoFiTokens: string;
}) {
  return (
    <>
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-white/70">Whale Sell Tax</span>
          <span className="text-xs font-bold text-[#cf38dd]">{whaleSellTax.toFixed(1)}%</span>
        </div>
        <AsciiSlider
          min={0}
          max={WHALE_TAX_MAX}
          step={0.1}
          value={whaleSellTax}
          onChange={onWhaleSellTaxChange}
          disabled={disabled}
          ariaLabel="Whale sell tax percentage"
        />
      </div>

      <div className="mb-5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/70">Redirect Creator Fees</span>
          {feeRecipientTouched && feeRecipientError && (
            <span className="text-[9px] font-bold text-red-400">Invalid</span>
          )}
        </div>
        <input
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="0x... (defaults to you)"
          value={feeRecipient}
          onChange={(event) => onFeeRecipientChange(event.target.value)}
          onBlur={onFeeRecipientBlur}
          disabled={disabled}
          aria-invalid={feeRecipientTouched && Boolean(feeRecipientError)}
          className={`w-full bg-white/5 border rounded-lg px-2.5 py-1.5 text-[11px] font-mono focus:outline-none focus:border-white/30 transition-colors placeholder:font-sans placeholder:text-white/25 ${
            feeRecipientTouched && feeRecipientError ? "border-red-400/60" : "border-white/15"
          }`}
        />
        <p className="text-[10px] text-white/30 leading-snug">
          {feeRecipientTouched && feeRecipientError
            ? feeRecipientError
            : "Where trading fees are paid. Permanent, cannot be changed later."}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-white/70">InfoFi Allocation</span>
          <span className="text-xs font-bold text-[#cf38dd]">{infoFiAllocation.toFixed(1)}%</span>
        </div>
        <AsciiSlider
          min={0}
          max={INFOFI_MAX_PCT}
          step={0.1}
          value={infoFiAllocation}
          onChange={onInfoFiAllocationChange}
          disabled={disabled}
          ariaLabel="InfoFi allocation percentage"
        />
        <p className="text-[10px] text-white/30 leading-snug">
          {infoFiAllocation > 0
            ? `${infoFiTokens} tokens locked at launch for the campaign pool. Never sold on the curve; unclaimed tokens burn.`
            : "Reserve supply to reward people who post about your token."}
        </p>
      </div>
    </>
  );
}
