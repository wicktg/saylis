import Image from "next/image";
import Link from "next/link";

/** Just the logo, in its usual spot — nothing else. No nav links, no
 *  wallet, no balance, no profile: this tab is docs only. */
export default function DocsTopBar() {
  return (
    <header className="h-16 flex items-center px-6 border-b border-[var(--line)] shrink-0">
      <Link href="/docs" className="flex items-center -ml-1.5">
        <Image
          src="/brand-logo.png"
          alt="Saylis"
          width={500}
          height={500}
          className="w-9 h-9 object-contain"
        />
      </Link>
    </header>
  );
}
