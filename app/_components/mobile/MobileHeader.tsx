"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import ConnectWalletButton from "@/app/_components/ConnectWalletButton";

/**
 * Mobile header, minus the header.
 *
 * No bar, no border, no background, no blur: just the logo and the connect
 * button sitting directly on the page, scrolling away with it. The chrome
 * was the part worth removing, not the two controls inside it, so this
 * keeps them and drops everything that framed them.
 *
 * Not sticky either. A translucent bar that follows you down the page earns
 * its keep when it holds navigation; this holds a logo, and navigation is
 * the bottom tab bar.
 *
 * Deliberately stateless. The global side-effect hooks this used to own
 * (correct-chain enforcement, wallet registration, referral capture) now
 * live in AppShell, mounted once for both breakpoints, so nothing is lost
 * if this component changes again.
 */
export default function MobileHeader() {
  const { isConnected } = useAccount();
  const pathname = usePathname();

  // Connect belongs on the board and nowhere else. Campaigns and Referrals
  // both explain themselves without a wallet, and the Profile tab already
  // offers the connect flow to anyone who needs it, so repeating the button
  // on every route was noise rather than a second chance to convert.
  const showConnect = !isConnected && pathname === "/";

  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-[var(--gutter)] pt-4 pb-1">
      <Link href="/" aria-label="Home" className="flex items-center -ml-2">
        <Image
          src="/brand-logo.png"
          alt="Saylis"
          width={500}
          height={500}
          className="w-9 h-9 object-contain"
          priority
        />
      </Link>

      {showConnect && <ConnectWalletButton size="compact" />}
    </div>
  );
}
