"use client";

import { useAccount } from "wagmi";
import TopNav from "@/app/_components/TopNav";
import ChatLauncher from "@/app/_components/ChatLauncher";
import ReferralPrompt from "@/app/_components/ReferralPrompt";
import BottomTabBar from "@/app/_components/mobile/BottomTabBar";
import { useIsMobile } from "@/app/_lib/useIsMobile";
import { useEnsureCorrectChain } from "@/app/_lib/useEnsureCorrectChain";
import { useRegisterWallet } from "@/app/_lib/useRegisterWallet";
import { useCaptureReferralCode, useReferral } from "@/app/_lib/useReferral";

/**
 * App chrome. Two genuinely different shells, not one shell restyled.
 *
 * Desktop is the floating header pill over a page that scrolls beneath it.
 * Mobile has no header at all: navigation is the bottom tab bar, and
 * connecting a wallet lives on the Profile tab, which already handles the
 * disconnected state. A header carrying only a logo was spending the least
 * reachable strip of a phone screen on decoration.
 *
 * This is conditional RENDERING rather than `hidden md:flex`, because the
 * two trees genuinely differ in structure rather than scale.
 *
 * WHY THE SIDE-EFFECT HOOKS LIVE HERE
 *
 * Correct-chain enforcement, wallet registration and referral capture are
 * global concerns that must run on every route and every breakpoint. They
 * used to be duplicated into TopNav AND the mobile header, purely because
 * only one of those renders at a time — which meant deleting the mobile
 * header would have silently dropped referral links opened on a phone.
 * Mounted once here instead, they cannot be lost by a chrome change.
 *
 * WHY THE DOCUMENT SCROLLS
 *
 * This used to be a fixed `h-screen` frame with each page scrolling its own
 * overflow container. That was necessary when the chrome included a docked
 * full-height chat column; without it the frame only prevented the header
 * from ever moving, which is the one thing a floating header needs to do.
 * The body scrolls now, and the pill is `sticky`.
 *
 * Chat is a floating bottom-left launcher on both — see ChatLauncher.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const { address } = useAccount();

  useEnsureCorrectChain();
  useRegisterWallet(address);
  useCaptureReferralCode();
  const referral = useReferral(address);

  const referralPrompt = referral.pendingReferrer ? (
    <ReferralPrompt
      referrer={referral.pendingReferrer}
      confirming={referral.confirming}
      error={referral.error}
      onConfirm={referral.confirm}
      onDismiss={referral.dismiss}
    />
  ) : null;

  if (isMobile) {
    return (
      <div className="relative z-[1] flex flex-col min-h-dvh w-full">
        <main className="flex-1 flex flex-col">{children}</main>
        {/* Spacer matching the fixed tab bar, so the last item in a
            scrolling list is never trapped underneath it. */}
        <div
          aria-hidden="true"
          className="shrink-0 h-14"
          style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        />
        <ChatLauncher />
        <BottomTabBar />
        {referralPrompt}
      </div>
    );
  }

  return (
    <div className="relative z-[1] flex flex-col min-h-dvh w-full">
      <TopNav />
      <main className="flex-1 flex flex-col">{children}</main>
      <ChatLauncher />
      {referralPrompt}
    </div>
  );
}
