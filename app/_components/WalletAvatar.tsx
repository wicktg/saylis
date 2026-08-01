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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://api.dicebear.com/7.x/identicon/svg?seed=${address}`}
      width={size}
      height={size}
      alt=""
      className={`rounded bg-lime-400/10 shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
