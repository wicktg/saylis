/**
 * The one avatar this app ever shows for a wallet, everywhere: a Dicebear
 * identicon seeded by the wallet's own address. Same seed in every call
 * site means the same wallet renders the exact same avatar permanently,
 * wherever it shows up — profile dropdown, chat, leaderboards, trade
 * feeds, referral lists — never a different generator or a random seed.
 */
export default function WalletAvatar({
  address,
  size = 24,
  className = "",
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  // Dicebear seeds are case-sensitive strings, but callers pass addresses
  // in whatever case they happen to have on hand — wagmi's `useAccount()`
  // returns a checksummed (mixed-case) address, while values that round
  // tripped through Supabase (chat messages, leaderboard rows, etc.) are
  // always lowercased server-side. Without normalizing here, the SAME
  // wallet would render a DIFFERENT avatar depending only on which of
  // those two paths supplied the address.
  const seed = address.toLowerCase();

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`}
      width={size}
      height={size}
      alt=""
      className={`rounded bg-[rgba(207,56,221,0.1)] shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
