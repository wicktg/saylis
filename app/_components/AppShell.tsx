"use client";

import TopNav from "@/app/_components/TopNav";
import ChatLauncher from "@/app/_components/ChatLauncher";
import BottomTabBar from "@/app/_components/mobile/BottomTabBar";
import MobileHeader from "@/app/_components/mobile/MobileHeader";
import { useIsMobile } from "@/app/_lib/useIsMobile";

/**
 * App chrome. Two genuinely different shells, not one shell restyled.
 *
 * Desktop is the floating header pill over a page that scrolls beneath it.
 * Mobile drops it: a top nav sits in the least reachable corner of a device
 * held one-handed, so navigation moves to a bottom tab bar and the header
 * keeps only what the tab bar cannot absorb (connect, create).
 *
 * This is conditional RENDERING rather than `hidden md:flex`, because the
 * two trees genuinely differ in structure rather than scale.
 *
 * WHY THE DOCUMENT SCROLLS
 *
 * This used to be a fixed `h-screen` frame with each page scrolling its own
 * overflow container. That was necessary when the chrome included a docked
 * full-height chat column; without it the frame only prevented the header
 * from ever moving, which is the one thing a floating header needs to do.
 * The body scrolls now, and the pill is `sticky`.
 *
 * Chat is a floating bottom-left launcher on both, rather than the docked
 * column it used to be — see ChatLauncher for why.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative z-[1] flex flex-col min-h-dvh w-full">
        <MobileHeader />
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
      </div>
    );
  }

  return (
    <div className="relative z-[1] flex flex-col min-h-dvh w-full">
      <TopNav />
      <main className="flex-1 flex flex-col">{children}</main>
      <ChatLauncher />
    </div>
  );
}
