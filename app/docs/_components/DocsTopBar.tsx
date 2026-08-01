import Image from "next/image";
import Link from "next/link";

/** Just the logo, in its usual spot — nothing else. No nav links, no
 *  wallet, no balance, no profile: this tab is docs only. */
export default function DocsTopBar() {
  return (
    <header className="h-16 flex items-center px-6 border-b border-white/10 shrink-0">
      <Link href="/docs" className="flex items-center">
        <Image
          src="/saylis-logo.png"
          alt="Saylis Logo"
          width={48}
          height={48}
          className="w-12 h-12 object-contain"
        />
      </Link>
    </header>
  );
}
