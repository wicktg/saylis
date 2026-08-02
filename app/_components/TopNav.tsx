"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import ProfileMenu from "@/app/_components/ProfileMenu";
import ConnectWalletButton from "@/app/_components/ConnectWalletButton";
import CreateTokenModal from "@/app/_components/CreateTokenModal";
import ReferralPrompt from "@/app/_components/ReferralPrompt";
import { useEnsureCorrectChain } from "@/app/_lib/useEnsureCorrectChain";
import { useRegisterWallet } from "@/app/_lib/useRegisterWallet";
import { useCaptureReferralCode, useReferral } from "@/app/_lib/useReferral";

const NAV_LINKS = [
  { href: "/", label: "Explore" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/referral", label: "Referral" },
];

export default function TopNav() {
  const pathname = usePathname();
  const [createTokenOpen, setCreateTokenOpen] = useState(false);
  const { address, isConnected } = useAccount();
  useEnsureCorrectChain();
  useRegisterWallet(address);
  useCaptureReferralCode();
  const referral = useReferral(address);

  return (
    <header className="h-16 grid grid-cols-3 items-center px-6 border-b border-white/10">
      <div className="flex items-center justify-self-start">
        <Image
          src="/saylis-logo.png"
          alt="Saylis Logo"
          width={48}
          height={48}
          className="w-12 h-12 object-contain"
        />
      </div>

      <nav className="flex items-center gap-5 justify-self-center">
        {NAV_LINKS.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`inline-block text-xs py-1.5 lowercase transition-colors ${
                isActive ? "text-white" : "text-white/45 hover:text-white"
              }`}
            >
              {/* The active route is marked with a gutter caret rather than
                  a underline or pill, matching the `>` selection marker used
                  in every dropdown. The inactive spacer keeps the label from
                  shifting sideways as selection moves. */}
              <span className={isActive ? "text-[var(--accent)]" : "text-transparent"}>
                &gt;
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-4 justify-self-end">
        {isConnected ? (
          <>
            <button
              onClick={() => setCreateTokenOpen(true)}
              className="pixel-frame pixel-btn h-9 flex items-center text-white px-4 text-xs lowercase"
            >
              [+] create token
            </button>
            <ProfileMenu />
          </>
        ) : (
          <ConnectWalletButton />
        )}
      </div>

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
