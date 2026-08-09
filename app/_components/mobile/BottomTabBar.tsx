"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/app/_components/Icon";

/**
 * Mobile primary navigation.
 *
 * Replaces the desktop top bar entirely rather than shrinking it. The top
 * of a phone screen is the hardest place to reach one-handed, and it is
 * also where the browser chrome lives; every native app of this shape puts
 * primary navigation at the bottom, so this does too.
 *
 * Rendered only under the mobile breakpoint (see AppShell), so the desktop
 * TopNav is completely untouched and this never appears beside it.
 *
 * "Profile" is a route rather than a dropdown here. The desktop profile
 * menu is a hover/click popover anchored to the top-right, which has
 * nowhere sensible to open from a bottom tab and would cover the content
 * it is anchored to.
 */
const TABS = [
  { href: "/", label: "Explore", icon: "pixelarticons:dashboard" },
  { href: "/campaigns", label: "Campaigns", icon: "pixelarticons:trophy" },
  { href: "/referral", label: "Referral", icon: "pixelarticons:users" },
  { href: "/dashboard", label: "Profile", icon: "pixelarticons:user" },
] as const;

export default function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-[var(--line)] bg-[rgba(255,255,255,0.94)] backdrop-blur-[14px] backdrop-saturate-150"
      // Keeps the bar clear of the iOS home indicator / Android gesture
      // area, which would otherwise sit on top of the right-hand tab.
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        // Explore is the root, so it must match exactly or it would light
        // up on every route.
        const isActive =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            // min-h-14 keeps every tab at/above the ~44px touch target
            // guidance, which the desktop nav's 12px text does not meet.
            className={`flex-1 min-h-14 flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors ${
              isActive ? "text-[var(--brand)]" : "text-[var(--ink-faint)] active:text-[var(--ink)]"
            }`}
          >
            <Icon icon={tab.icon} className="text-base leading-none" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
