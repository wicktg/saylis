"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import ProfileMenu from "@/app/_components/ProfileMenu";
import ConnectWalletButton from "@/app/_components/ConnectWalletButton";

const NAV_LINKS = [
  { href: "/", label: "Explore" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/referral", label: "Referral" },
];

/**
 * The floating header bar.
 *
 * Identity and wallet only. "Create token" used to live here too, which put
 * a page-level action in global chrome — it followed you onto Campaigns and
 * Referrals, where there is nothing to create. It now sits in the board
 * head on Explore, opposite the title, as the reference design has it.
 *
 * Not a full-width rail: the pill hugs its own content and is centred over
 * the page, so the board's blueprint grid stays visible either side of it.
 * It firms up from translucent to near-solid once content scrolls beneath,
 * which is the only cue that it is floating rather than docked.
 */
export default function TopNav() {
  const pathname = usePathname();
  const [stuck, setStuck] = useState(false);
  const { isConnected } = useAccount();

  // Watches the window rather than an IntersectionObserver sentinel: the
  // shell scrolls the document itself, so this is the thing that moves.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-30 pt-3.5 px-[var(--gutter)]">
      <div
        data-stuck={stuck}
        className="header-pill mx-auto w-fit max-w-full min-h-[62px] flex items-center gap-3 lg:gap-6 pl-[22px] pr-3"
      >
        {/* The artwork carries ~22% transparent margin on every side, so
            the box is pulled back to keep the mark optically level with
            the pill inset and the nav gap. */}
        <Link href="/" aria-label="Home" className="flex items-center -ml-[9px] -mr-1 shrink-0">
          <Image
            src="/brand-logo.png"
            alt="Saylis"
            width={500}
            height={500}
            className="w-[42px] h-[42px] object-contain"
            priority
          />
        </Link>

        <nav className="flex items-center gap-2 lg:gap-[18px]" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className="nav-link px-1 py-2"
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          {isConnected ? <ProfileMenu /> : <ConnectWalletButton />}
        </div>
      </div>
    </header>
  );
}
