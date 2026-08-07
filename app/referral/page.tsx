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
import AsciiSpinner from "@/app/_components/AsciiSpinner";
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
      <div className="flex-1 overflow-y-auto pixel-scrollbar">
        <div className="px-6 py-5 border-b border-white/10">
          <h1 className="text-lg font-bold">Referral</h1>
          <p className="text-[11px] text-white/40 mt-0.5">
            Earn 5% of every wallet you refer&apos;s own creator fee share, forever, across
            every token they ever launch.
          </p>
        </div>

        {!account ? (
          <div className="flex flex-col items-center justify-center text-center py-20 gap-2">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-1">
              <Icon icon="pixelarticons:wallet" className="text-xl text-white/25" />
            </div>
            <h2 className="text-sm font-bold text-white/70">Connect your wallet</h2>
            <p className="text-[11px] text-white/35 max-w-xs leading-relaxed">
              Your referral link is tied to the wallet that shares it.
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <AsciiSpinner className="text-xl text-[#cf38dd]" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center text-center py-20 gap-2">
            <h2 className="text-sm font-bold text-white/70">Could not load referral data</h2>
            <p className="text-[11px] text-white/35 max-w-xs leading-relaxed">{error}</p>
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-6">
            {/* ---- Shareable link ---- */}
            <div className="pixel-frame pixel-card p-4">
              <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-2">
                Your referral link
              </h2>
              <button
                onClick={handleCopy}
                disabled={!shareLink}
                className="pixel-frame pixel-input w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left"
              >
                <span className="text-[12px] font-mono truncate">
                  {shareLink ?? "..."}
                </span>
                <Icon
                  icon={copied ? "pixelarticons:check" : "pixelarticons:copy"}
                  className="text-white/40 text-sm shrink-0"
                />
              </button>
            </div>

            {/* ---- Totals ---- */}
            <div className="grid grid-cols-2 gap-3">
              <div className="pixel-frame pixel-card p-4">
                <p className="text-[9px] uppercase tracking-wide text-white/30">
                  Lifetime earnings
                </p>
                {/* A zero here would be indistinguishable from a real zero,
                    so when history could not be read we show nothing at all
                    rather than a number we cannot stand behind. */}
                <p className="text-lg font-bold mt-1">
                  {historyUnavailable
                    ? "n/a"
                    : formatWeiAsUsdPrice(lifetimeTotal, ethUsdPrice)}
                </p>
              </div>
              <div className="pixel-frame pixel-card p-4">
                <p className="text-[9px] uppercase tracking-wide text-white/30">
                  Withdrawable now
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-lg font-bold text-[var(--accent)] leading-none">
                    {formatWeiAsUsdPrice(currentBalance, ethUsdPrice)}
                  </p>
                  <button
                    onClick={handleClaim}
                    disabled={claiming || currentBalance === 0n}
                    aria-label="Claim withdrawable earnings"
                    title={currentBalance === 0n ? "Nothing to claim" : "Claim earnings"}
                    className="text-[var(--accent)] disabled:text-white/20 disabled:cursor-not-allowed shrink-0 transition-colors flex items-center"
                  >
                    <Icon
                      icon="pixelarticons:briefcase"
                      className={`text-lg leading-none ${claiming ? "animate-pulse" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {claimError && <p className="text-[11px] text-red-400">{claimError}</p>}

            {/* ---- Referred wallets ---- */}
            <div>
              <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
                Referred {historyUnavailable ? "" : `(${data?.referred.length ?? 0})`}
              </h2>
              {historyUnavailable ? (
                <div className="flex flex-col items-center justify-center text-center py-16 gap-2 pixel-frame pixel-card">
                  <h3 className="text-sm font-bold text-white/70">History unavailable</h3>
                  <p className="text-[11px] text-white/35 max-w-sm leading-relaxed">
                    Couldn&apos;t reach the network to read your referral history just
                    now — try again in a moment. Your link still works, and any
                    balance shown above is live and claimable.
                  </p>
                </div>
              ) : !data || data.referred.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 gap-2 pixel-frame pixel-card">
                  <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-1">
                    <Icon icon="pixelarticons:users" className="text-xl text-white/25" />
                  </div>
                  <h3 className="text-sm font-bold text-white/70">Nobody yet</h3>
                  <p className="text-[11px] text-white/35 max-w-xs leading-relaxed">
                    Share your link above. Once someone connects through it and confirms,
                    they&apos;ll show up here.
                  </p>
                </div>
              ) : (
                <div className="pixel-frame pixel-card overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-white/30 uppercase text-[9px] tracking-wide">
                        <th className="text-left font-medium px-4 py-2">Wallet</th>
                        <th className="text-left font-medium px-4 py-2">Joined</th>
                        <th className="text-right font-medium px-4 py-2">Earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.referred.map((r) => (
                        <tr key={r.walletAddress} className="border-t border-white/5">
                          <td className="px-4 py-2 font-mono">
                            <div className="flex items-center gap-2">
                              <WalletAvatar address={r.walletAddress} size={18} />
                              {truncateAddress(r.walletAddress)}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-white/50">
                            {r.joinedAt ? new Date(r.joinedAt).toLocaleDateString() : "N/A"}
                          </td>
                          <td className="px-4 py-2 text-right font-bold text-[var(--accent)]">
                            {formatWeiAsUsdPrice(BigInt(r.earningsRaw), ethUsdPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
