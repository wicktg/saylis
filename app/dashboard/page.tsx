"use client";

import AppShell from "@/app/_components/AppShell";
import MobileProfile from "@/app/_components/mobile/MobileProfile";
import StubPage from "@/app/_components/StubPage";
import { useIsMobile } from "@/app/_lib/useIsMobile";

/**
 * The route behind the bottom tab bar's profile tab.
 *
 * Mobile-only by design: on desktop everything here is already reachable
 * from the ProfileMenu dropdown in the top nav, and nothing in the desktop
 * UI links to /dashboard. Rather than build a second desktop surface for
 * the same actions, desktop keeps the stub it has always had — so this
 * change is confined to the viewport that was actually missing the feature.
 */
export default function DashboardPage() {
  const isMobile = useIsMobile();

  if (!isMobile) return <StubPage title="Dashboard" />;

  return (
    <AppShell>
      <MobileProfile />
    </AppShell>
  );
}
