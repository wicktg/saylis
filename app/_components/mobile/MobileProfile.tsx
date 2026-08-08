"use client";

import { useState } from "react";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { truncateAddress, formatEthShort, formatWeiAsUsdPrice } from "@/app/_lib/format";
import { useCreatorFees } from "@/app/_lib/useCreatorFees";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import { useNotifications } from "@/app/_lib/useNotifications";
import { useXAccount } from "@/app/_lib/useXAccount";
import ConnectWalletButton from "@/app/_components/ConnectWalletButton";
import ConnectXModal from "@/app/_components/ConnectXModal";
import Icon from "@/app/_components/Icon";
import MyTokensModal from "@/app/_components/MyTokensModal";
import NotificationsModal from "@/app/_components/NotificationsModal";
import WalletAvatar from "@/app/_components/WalletAvatar";

const CLAIMABLE_TOOLTIP = "Total fees earned across all your launches.";

/**
 * The mobile Profile tab.
 *
 * Desktop reaches all of this through the ProfileMenu dropdown in the top
 * nav, which the mobile shell does not render — the bottom tab bar's
 * profile tab pointed at /dashboard, and /dashboard was a "Coming soon"
 * stub. So on a phone there was no way to see your balance, view your
 * tokens, read notifications, claim creator fees, link an X account, or
 * disconnect.
 *
 * This is a full page rather than a dropdown because a 264px-wide menu
 * anchored to a header button is a desktop idiom; the same rows work far
 * better as a phone screen. The behaviour behind them is identical — the
 * same hooks, the same modals, and the same `useCreatorFees` claim path
 * the dropdown uses, so the two cannot drift.
 */
export default function MobileProfile() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });
  const ethUsdPrice = useEthUsdPrice();

  const { account: xAccount, refresh: refreshXAccount } = useXAccount(address);
  const [connectXOpen, setConnectXOpen] = useState(false);

  const {
    items: notifications,
    unreadCount,
    isLoading: notificationsLoading,
    markAllRead,
  } = useNotifications(address);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [myTokensOpen, setMyTokensOpen] = useState(false);

  const {
    creatorFeesOwed,
    creatorTokensOwed,
    creatorTokensValueWei,
    isClaimBusy,
    hasClaimable,
    justClaimed,
    claim,
  } =
    useCreatorFees(address);

  // Every row below is scoped to a wallet, so with none connected there is
  // nothing to show and nothing to fake — offer the connect flow instead.
  if (!address) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Icon icon="pixelarticons:user" className="text-3xl text-white/20" />
        <p className="text-[11px] text-white/40 leading-relaxed">
          Connect a wallet to see your tokens, notifications and creator fees.
        </p>
        <ConnectWalletButton />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* ---- Identity ---- */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
        <WalletAvatar address={address} size={40} />
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{truncateAddress(address)}</p>
          <p className="text-[11px] text-white/40">
            {balance ? formatEthShort(balance.value) : "0"} ETH
          </p>
        </div>
      </div>

      {/* ---- Creator fees ----
          Given its own block rather than a list row: it is the only thing
          on this screen that sends a transaction, and the amount needs to
          be readable before anyone taps Claim. */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="ascii-label text-[9px]">creator fees</span>
          <span
            className="text-white/30 text-[9px]"
            title={CLAIMABLE_TOOLTIP}
            aria-label={CLAIMABLE_TOOLTIP}
          >
            <Icon icon="pixelarticons:info-box" className="text-xs" />
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-bold">
            {formatWeiAsUsdPrice(creatorFeesOwed ?? 0n, ethUsdPrice)}
          </span>
          <button
            onClick={claim}
            disabled={isClaimBusy || !hasClaimable}
            className="pixel-frame pixel-btn text-white font-bold px-4 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isClaimBusy ? "Claiming..." : justClaimed ? "Claimed" : "Claim"}
          </button>
        </div>
        {(creatorTokensOwed ?? 0n) > 0n && (
          <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-white/5">
            <span className="text-[11px] text-white/50">In tokens</span>
            <span className="text-[11px] font-bold">
              {creatorTokensValueWei === undefined
                ? "—"
                : formatWeiAsUsdPrice(creatorTokensValueWei, ethUsdPrice)}
            </span>
          </div>
        )}
        <p className="text-[10px] text-white/30 leading-snug mt-2">{CLAIMABLE_TOOLTIP}</p>
      </div>

      {/* ---- Rows ---- */}
      <button
        onClick={() => setMyTokensOpen(true)}
        className="w-full flex items-center justify-between px-4 py-4 text-xs font-medium hover:bg-white/5 active:bg-white/5 transition-colors border-b border-white/10"
      >
        My Tokens
        <Icon icon="pixelarticons:chevron-right" className="text-base text-white/30" />
      </button>

      <button
        onClick={() => {
          setNotificationsOpen(true);
          if (unreadCount > 0) markAllRead();
        }}
        className="w-full flex items-center justify-between px-4 py-4 text-xs font-medium hover:bg-white/5 active:bg-white/5 transition-colors border-b border-white/10"
      >
        Notifications
        <span className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-[9px] font-bold flex items-center justify-center text-black">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          <Icon icon="pixelarticons:chevron-right" className="text-base text-white/30" />
        </span>
      </button>

      {/* Once bound, this row becomes the X identity itself — there is
          deliberately no disconnect, so it never reverts to a "Connect"
          affordance. Same rule as the desktop dropdown. */}
      {xAccount ? (
        <div className="w-full flex items-center gap-2 px-4 py-4 border-b border-white/10">
          {xAccount.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={xAccount.avatarUrl}
              alt={`@${xAccount.username}`}
              className="photo w-5 h-5 object-cover shrink-0"
            />
          ) : (
            <Icon icon="ri:twitter-x-fill" className="text-white text-sm shrink-0" />
          )}
          <span className="text-xs font-medium text-white/80 truncate">
            @{xAccount.username}
          </span>
        </div>
      ) : (
        <button
          onClick={() => setConnectXOpen(true)}
          className="w-full flex items-center justify-between px-4 py-4 text-xs font-medium hover:bg-white/5 active:bg-white/5 transition-colors border-b border-white/10"
        >
          <span className="flex items-center gap-2">
            <Icon icon="ri:twitter-x-fill" className="text-white text-sm shrink-0" />
            Connect X
          </span>
          <Icon icon="pixelarticons:chevron-right" className="text-base text-white/30" />
        </button>
      )}

      <a
        href="/docs"
        target="_blank"
        rel="noopener noreferrer"
        className="w-full flex items-center justify-between px-4 py-4 text-xs font-bold text-white/70 hover:text-white active:bg-white/5 transition-colors border-b border-white/10"
      >
        Docs
        <Icon icon="pixelarticons:external-link" className="text-base shrink-0" />
      </a>

      <button
        onClick={() => disconnect()}
        className="w-full text-left px-4 py-4 text-xs font-bold text-white/70 hover:text-white active:bg-white/5 transition-colors border-b border-white/10"
      >
        Disconnect
      </button>

      <MyTokensModal
        open={myTokensOpen}
        onClose={() => setMyTokensOpen(false)}
        walletAddress={address}
      />
      <ConnectXModal
        open={connectXOpen}
        onClose={() => setConnectXOpen(false)}
        wallet={address}
        onLinked={refreshXAccount}
      />
      <NotificationsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        items={notifications}
        isLoading={notificationsLoading}
      />
    </div>
  );
}
