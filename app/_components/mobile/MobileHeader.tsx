"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAccount } from "wagmi";
import ConnectWalletButton from "@/app/_components/ConnectWalletButton";
import CreateTokenModal from "@/app/_components/CreateTokenModal";
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
  const [createTokenOpen, setCreateTokenOpen] = useState(false);
  const { address, isConnected } = useAccount();
  useEnsureCorrectChain();
  useRegisterWallet(address);
  useCaptureReferralCode();
  const referral = useReferral(address);

  return (
    <header className="h-12 shrink-0 flex items-center justify-between px-3 border-b border-white/10">
      <Link href="/" aria-label="Home" className="flex items-center">
        <Image
          src="/saylis-logo.png"
          alt="Saylis"
          width={32}
          height={32}
          className="w-8 h-8 object-contain"
          priority
        />
      </Link>

      {isConnected ? (
        <button
          onClick={() => setCreateTokenOpen(true)}
          className="pixel-frame pixel-btn h-9 px-3 flex items-center text-white text-[11px] lowercase"
        >
          [+] create
        </button>
      ) : (
        <ConnectWalletButton />
      )}

      <CreateTokenModal open={createTokenOpen} onClose={() => setCreateTokenOpen(false)} />

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
