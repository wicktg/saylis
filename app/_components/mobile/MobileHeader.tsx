"use client";

import Image from "next/image";
import Link from "next/link";
import { useAccount } from "wagmi";
import ConnectWalletButton from "@/app/_components/ConnectWalletButton";
import ReferralPrompt from "@/app/_components/ReferralPrompt";
import { useEnsureCorrectChain } from "@/app/_lib/useEnsureCorrectChain";
import { useRegisterWallet } from "@/app/_lib/useRegisterWallet";
import { useCaptureReferralCode, useReferral } from "@/app/_lib/useReferral";

/**
 * Slim mobile header.
 *
 * Navigation lives in the bottom tab bar, but two things cannot: connecting
 * a wallet, and launching a token. Without a home for them the app would be
 * unusable on a phone -- there would be no way to connect at all.
 *
 * So this keeps only what the tab bar cannot absorb, at roughly half the
 * height of the desktop header.
 *
 * It also carries the side-effect hooks that TopNav owns on desktop
 * (correct-chain enforcement, wallet registration, referral capture). Those
 * are mounted once per shell, and the mobile shell does not render TopNav,
 * so they would otherwise silently never run on a phone -- a referral link
 * opened on mobile would be dropped.
 */
export default function MobileHeader() {
  const { address, isConnected } = useAccount();
  useEnsureCorrectChain();
  useRegisterWallet(address);
  useCaptureReferralCode();
  const referral = useReferral(address);

  // Matches the desktop header: logo hard against the left edge, the
  // action keeping its gap on the right.
  return (
    <header className="sticky top-0 z-30 h-[54px] shrink-0 flex items-center justify-between pl-3 pr-3 border-b border-[var(--line)] bg-[rgba(255,255,255,0.92)] backdrop-blur-[14px] backdrop-saturate-150">
      <Link href="/" aria-label="Home" className="flex items-center">
        <Image
          src="/brand-logo.png"
          alt="Saylis"
          width={500}
          height={500}
          className="w-[38px] h-[38px] object-contain -ml-2"
          priority
        />
      </Link>

      {!isConnected && <ConnectWalletButton size="compact" />}

      {referral.pendingReferrer && (
        <ReferralPrompt
          referrer={referral.pendingReferrer}
          confirming={referral.confirming}
          error={referral.error}
          onConfirm={referral.confirm}
          onDismiss={referral.dismiss}
        />
      )}
    </header>
  );
}
