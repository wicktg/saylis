"use client";

import { useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { truncateAddress, formatWeiAsUsdPrice } from "@/app/_lib/format";
import { useCreatorFees } from "@/app/_lib/useCreatorFees";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import { useOutsideClick } from "@/app/_lib/useOutsideClick";
import WalletAvatar from "@/app/_components/WalletAvatar";
import MyTokensModal from "@/app/_components/MyTokensModal";
import { useXAccount } from "@/app/_lib/useXAccount";
import ConnectXModal from "@/app/_components/ConnectXModal";
import { useNotifications } from "@/app/_lib/useNotifications";
import NotificationsModal from "@/app/_components/NotificationsModal";
import Icon from "@/app/_components/Icon";

/**
 * The connected-wallet control in the header: an identicon chip that opens
 * a minimal dropdown — identity, one claimable figure, and a short list of
 * plain rows. No balance box, no hover tooltips, no shadow.
 *
 * The two-line tooltip explanations this used to carry for "Claimable" and
 * "In tokens" are gone. In their place, `.wm-note` states in one line what
 * the figure above it is money-wise, always visible rather than something
 * you had to find by hovering an info glyph.
 */
export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [myTokensOpen, setMyTokensOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false));

  const { address } = useAccount();
  const { disconnect } = useDisconnect();
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

  const {
    creatorFeesOwed,
    creatorTokensOwed,
    creatorTokensValueWei,
    isClaimBusy,
    hasClaimable,
    justClaimed,
    claim: handleClaim,
  } = useCreatorFees(address);

  const hasTokenFees = (creatorTokensOwed ?? 0n) > 0n;

  if (!address) return null;

  const note = hasTokenFees
    ? `Plus ${
        creatorTokensValueWei === undefined ? "—" : formatWeiAsUsdPrice(creatorTokensValueWei, ethUsdPrice)
      } owed in tokens, paid separately.`
    : "Fees across every token you launch, on the curve and the pool.";

  return (
    <div className="wallet-wrap" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="wallet-btn is-connected"
      >
        <span className="wallet-pfp" aria-hidden="true">
          <WalletAvatar address={address} size={22} />
        </span>
      </button>

      {open && (
        <div className="wallet-menu" role="menu">
          <div className="wm-head">
            <span className="wallet-pfp wm-pfp" aria-hidden="true">
              <WalletAvatar address={address} size={30} />
            </span>
            <div className="wm-id">
              <p className="wm-addr" title={address}>
                {truncateAddress(address)}
              </p>
              <p className="wm-state">Connected</p>
            </div>
          </div>

          <div className="wm-claim-block">
            <div className="wm-claim">
              <div>
                <p className="wm-label">Claimable</p>
                <p className="wm-amount">
                  {formatWeiAsUsdPrice(creatorFeesOwed ?? 0n, ethUsdPrice)}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClaim}
                disabled={isClaimBusy || !hasClaimable}
                className="btn btn-primary wm-claim-btn"
              >
                {isClaimBusy ? "Claiming…" : justClaimed ? "Claimed" : "Claim"}
              </button>
            </div>
            <p className="wm-note">{note}</p>
          </div>

          <div className="wm-items">
            <button
              type="button"
              role="menuitem"
              className="wm-item"
              onClick={() => {
                setMyTokensOpen(true);
                setOpen(false);
              }}
            >
              <Icon icon="pixelarticons:coin" className="ico" />
              My tokens
            </button>

            <button
              type="button"
              role="menuitem"
              className="wm-item"
              onClick={() => {
                setNotificationsOpen(true);
                setOpen(false);
                if (unreadCount > 0) markAllRead();
              }}
            >
              <Icon icon="pixelarticons:notification" className="ico" />
              Notifications
            </button>

            {/* Once bound, this row becomes the X identity itself — there
                is deliberately no disconnect, so it never reverts to a
                "Connect" affordance. */}
            {xAccount ? (
              <div className="wm-item" role="menuitem" aria-disabled="true">
                {xAccount.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={xAccount.avatarUrl}
                    alt=""
                    className="w-[14px] h-[14px] rounded-full object-cover shrink-0"
                  />
                ) : (
                  <Icon icon="ri:twitter-x-fill" className="ico" />
                )}
                <span className="truncate">@{xAccount.username}</span>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="wm-item"
                onClick={() => {
                  setConnectXOpen(true);
                  setOpen(false);
                }}
              >
                <Icon icon="ri:twitter-x-fill" className="ico" />
                Connect X
              </button>
            )}

            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              className="wm-item"
              onClick={() => setOpen(false)}
            >
              <Icon icon="pixelarticons:book-open" className="ico" />
              Docs
              <Icon icon="pixelarticons:external-link" className="ico wm-trail" />
            </a>

            <button
              type="button"
              role="menuitem"
              className="wm-item is-exit"
              onClick={() => disconnect()}
            >
              <Icon icon="pixelarticons:logout" className="ico" />
              Disconnect
            </button>
          </div>
        </div>
      )}

      <MyTokensModal
        open={myTokensOpen}
        onClose={() => setMyTokensOpen(false)}
        walletAddress={address}
      />
      <NotificationsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        items={notifications}
        isLoading={notificationsLoading}
      />
      <ConnectXModal
        open={connectXOpen}
        onClose={() => setConnectXOpen(false)}
        wallet={address}
        onLinked={refreshXAccount}
      />
    </div>
  );
}
