"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { Address } from "viem";
import AppShell from "@/app/_components/AppShell";
import WalletAvatar from "@/app/_components/WalletAvatar";
import { formatWeiAsUsdPrice, truncateAddress } from "@/app/_lib/format";
import { REFERRAL_VAULT_ADDRESS } from "@/app/_lib/contracts/config";
import { REFERRAL_VAULT_ABI } from "@/app/_lib/contracts/ReferralVault";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import Icon from "@/app/_components/Icon";
import Spinner from "@/app/_components/Spinner";
import { waitForReceipt } from "@/app/_lib/txReceipt";
import { getFriendlyErrorMessage } from "@/app/_lib/errors";

type ReferredWallet = {
  walletAddress: string;
  joinedAt: string | null;
  earningsRaw: string;
};

type ReferralData = {
  code: string | null;
  currentBalanceRaw: string;
  lifetimeTotalRaw: string;
  referred: ReferredWallet[];
  /**
   * False when the vault's event history could not be read at all — the
   * node was unreachable or slow. The link, the owed balance, and claiming
   * all still work; only the referred-wallet breakdown and lifetime total
   * are unknown. Distinguishing this from "genuinely zero referrals"
   * matters -- telling a real referrer they have none would be a confident
   * lie.
   */
  historyAvailable?: boolean;
};

/**
 * A referrer's own dashboard: their shareable link, everyone they've
 * referred, and what each has earned them — see BondingCurve.sol's
 * "REFERRALS" NatSpec for the mechanics (5% of a referred creator's own
 * fee share, forever, across every token they ever launch).
 */
export default function ReferralPage() {
  const { address: account } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const ethUsdPrice = useEthUsdPrice();

  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!account) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/referral/${account}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load referral data.");
      setData(payload);
    } catch (err) {
      setError(getFriendlyErrorMessage(err, "Could not load referral data."));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCopy() {
    if (!data?.code) return;
    const link = `${window.location.origin}/?ref=${data.code}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleClaim() {
    if (!walletClient || !publicClient) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const txHash = await walletClient.writeContract({
        address: REFERRAL_VAULT_ADDRESS as Address,
        abi: REFERRAL_VAULT_ABI,
        functionName: "withdrawReferralFees",
      });
      const receipt = await waitForReceipt(publicClient, txHash);
      if (receipt.status !== "success") throw new Error("Claim transaction failed.");
      await refresh();
    } catch (err) {
      setClaimError(getFriendlyErrorMessage(err, "Could not claim."));
    } finally {
      setClaiming(false);
    }
  }

  const shareLink = data?.code && typeof window !== "undefined"
    ? `${window.location.origin}/?ref=${data.code}`
    : null;
  const currentBalance = data ? BigInt(data.currentBalanceRaw) : 0n;
  const lifetimeTotal = data ? BigInt(data.lifetimeTotalRaw) : 0n;
  // Only true once data has actually loaded and the server said so, so a
  // pending/failed request never renders the "unavailable" explanation.
  const historyUnavailable = data?.historyAvailable === false;

  return (
    <AppShell>
      <div className="w-full max-w-[var(--shell)] mx-auto px-[var(--gutter)] pt-[clamp(24px,4vh,40px)] pb-[clamp(40px,7vh,72px)]">
        <header>
          <h1 className="font-display text-[clamp(1.375rem,2.6vw,1.875rem)] leading-tight text-[#2e2e2e] m-0">
            Referrals
          </h1>
          <p className="board-lede">
            Earn 5% of the creator fee share of every wallet you refer, forever, across every
            token they ever launch.
          </p>
        </header>

        {!account ? (
          <EmptyState
            title="Connect your wallet"
            body="Your referral link is tied to the wallet that shares it."
          />
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="text-xl text-[var(--brand)]" />
          </div>
        ) : error ? (
          <EmptyState title="Could not load referral data" body={error} />
        ) : (
          <div className="split-layout">
            <section aria-label="Your referrals">
              {/* ---- Shareable link ---- */}
              <div className="side-panel ref-link-panel">
                <h2 className="side-title">Your referral link</h2>
                <div className="ref-link">
                  <input
                    className="ref-url"
                    type="text"
                    value={shareLink ?? ""}
                    readOnly
                    aria-label="Your referral link"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!shareLink}
                    className="ref-copy"
                    data-copied={copied || undefined}
                  >
                    <Icon
                      icon={copied ? "pixelarticons:check" : "pixelarticons:copy"}
                      className="text-sm"
                    />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="ref-hint">
                  Anyone who connects a wallet through this link is bound to you permanently.
                  there is no expiry and no cap.
                </p>
              </div>

              {/* ---- Referred wallets ---- */}
              <h2 className="side-title ref-list-title">
                Referred{" "}
                {!historyUnavailable && <span>({data?.referred.length ?? 0})</span>}
              </h2>

              {historyUnavailable ? (
                <div className="side-panel text-center py-10">
                  <h3 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">
                    History unavailable
                  </h3>
                  <p className="mt-2 mx-auto max-w-sm text-[0.6875rem] font-medium leading-relaxed text-[var(--ink-faint)]">
                    Couldn&apos;t reach the network to read your referral history just now. Try
                    again in a moment. Your link still works, and any balance shown here is live
                    and claimable.
                  </p>
                </div>
              ) : !data || data.referred.length === 0 ? (
                <div className="side-panel text-center py-10">
                  <h3 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">Nobody yet</h3>
                  <p className="mt-2 mx-auto max-w-xs text-[0.6875rem] font-medium leading-relaxed text-[var(--ink-faint)]">
                    Share your link above. Once someone connects through it and confirms,
                    they&apos;ll show up here.
                  </p>
                </div>
              ) : (
                <ul className="ref-list">
                  {data.referred.map((r) => (
                    <li key={r.walletAddress} className="ref-row">
                      <span className="ref-mark" aria-hidden="true">
                        <WalletAvatar address={r.walletAddress} size={30} />
                      </span>
                      <span className="ref-who">
                        <span className="ref-addr">{truncateAddress(r.walletAddress)}</span>
                        <span className="ref-when">
                          {r.joinedAt
                            ? `joined ${new Date(r.joinedAt).toLocaleDateString()}`
                            : "join date unknown"}
                        </span>
                      </span>
                      <span className="ref-earned">
                        {formatWeiAsUsdPrice(BigInt(r.earningsRaw), ethUsdPrice)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- Earnings rail ---- */}
            <aside className="split-side" aria-label="Your earnings">
              <div className="side-panel">
                <h2 className="side-title">Lifetime revenue</h2>
                {/* A zero here would be indistinguishable from a real zero,
                    so when history could not be read we show nothing at all
                    rather than a number we cannot stand behind. */}
                <p className="ref-figure">
                  {historyUnavailable ? "-" : formatWeiAsUsdPrice(lifetimeTotal, ethUsdPrice)}
                </p>
                <p className="ref-sub">
                  {historyUnavailable
                    ? "History could not be read just now."
                    : `across ${data?.referred.length ?? 0} referred wallet${
                        (data?.referred.length ?? 0) === 1 ? "" : "s"
                      }`}
                </p>
              </div>

              <div className="side-panel">
                <h2 className="side-title">Withdrawable now</h2>
                <p className="ref-figure is-brand">
                  {formatWeiAsUsdPrice(currentBalance, ethUsdPrice)}
                </p>
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={claiming || currentBalance === 0n}
                  className="btn btn-primary ref-claim"
                >
                  {claiming ? "Claiming…" : "Claim"}
                </button>
                {claimError && (
                  <p className="mt-2 text-[0.625rem] font-semibold leading-snug text-[var(--down)]">
                    {claimError}
                  </p>
                )}
              </div>

              <p className="side-note">
                A wallet counts once it connects through your link and confirms. Earnings accrue
                on every trade of every token they launch, for as long as they launch.
              </p>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** Text only, matching Campaigns — see that file for why. */
function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 gap-2">
      <h2 className="text-[0.875rem] font-bold text-[var(--ink-soft)]">{title}</h2>
      {body && (
        <p className="max-w-xs text-[0.6875rem] font-medium leading-relaxed text-[var(--ink-faint)]">
          {body}
        </p>
      )}
    </div>
  );
}
