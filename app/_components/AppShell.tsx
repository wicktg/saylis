"use client";

import Sidebar from "@/app/_components/Sidebar";
import TopNav from "@/app/_components/TopNav";
import BottomTabBar from "@/app/_components/mobile/BottomTabBar";
import MobileChatBubble from "@/app/_components/mobile/MobileChatBubble";
import MobileHeader from "@/app/_components/mobile/MobileHeader";
import { useIsMobile } from "@/app/_lib/useIsMobile";

/**
 * App chrome. Two genuinely different shells, not one shell restyled.
 *
 * Desktop is unchanged from before the mobile work: top nav across the
 * top, docked chat column on the left, content filling the rest.
 *
 * Mobile drops both. The 288px chat column would eat most of a phone
 * screen, and a top nav sits in the least reachable corner of a device
 * held one-handed. Chat becomes a floating bubble that occupies no layout
 * space, and navigation moves to a bottom tab bar.
 *
 * This is conditional RENDERING rather than `hidden md:flex`, because the
 * two trees genuinely differ: the desktop Sidebar mounts `useChat` and
 * opens a realtime subscription, so merely hiding it with CSS would still
 * pay for it on every phone.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative z-[1] flex flex-col h-screen w-full text-sm">
        <MobileHeader />
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
        {/* Spacer matching the fixed tab bar, so the last item in a
            scrolling list is never trapped underneath it. */}
        <div
          aria-hidden="true"
          className="shrink-0 h-14"
          style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
        />
        <MobileChatBubble />
        <BottomTabBar />
      </div>
    );
  }

  return (
    <div className="relative z-[1] flex flex-col h-screen w-full text-sm">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
