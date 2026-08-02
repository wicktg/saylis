"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useBalance,
  useDisconnect,
  useReadContract,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import { BONDING_CURVE_ABI } from "@/app/_lib/contracts/BondingCurve";
import {
  getLatestLaunchedToken,
  LAUNCHED_TOKEN_EVENT,
  type LaunchedToken,
} from "@/app/_lib/launchedTokens";
import { truncateAddress, formatEthShort, formatWeiAsUsdPrice } from "@/app/_lib/format";
import { useEthUsdPrice } from "@/app/_lib/useEthUsdPrice";
import { useOutsideClick } from "@/app/_lib/useOutsideClick";
import WalletAvatar from "@/app/_components/WalletAvatar";
import MyTokensModal from "@/app/_components/MyTokensModal";
import { useXAccount } from "@/app/_lib/useXAccount";
import ConnectXModal from "@/app/_components/ConnectXModal";
import { useNotifications } from "@/app/_lib/useNotifications";
import NotificationsModal from "@/app/_components/NotificationsModal";
import Icon from "@/app/_components/Icon";

const CLAIMABLE_TOOLTIP = "Total fees earned across all your launches.";

export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [myTokensOpen, setMyTokensOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false));

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

  const [launchedToken, setLaunchedToken] = useState<LaunchedToken | null>(null);
  useEffect(() => {
    setLaunchedToken(getLatestLaunchedToken(address));
  }, [address]);

  // A launch recorded elsewhere in the app (the Create Token modal) during
  // this same session won't otherwise be picked up until `address`
  // changes — listen for it directly so the fee row appears immediately.
  useEffect(() => {
    function handleLaunched() {
      setLaunchedToken(getLatestLaunchedToken(address));
    }
    window.addEventListener(LAUNCHED_TOKEN_EVENT, handleLaunched);
    return () => window.removeEventListener(LAUNCHED_TOKEN_EVENT, handleLaunched);
  }, [address]);

  const curveAddress = launchedToken?.curveAddress;

  const {
    data: creatorFeesOwed,
    refetch: refetchCreatorFeesOwed,
  } = useReadContract({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    functionName: "creatorFeesOwed",
    query: { enabled: Boolean(curveAddress) },
  });

  // Real-time: any trade (Buy/Sell) or the one-time graduation bonus can
  // move creatorFeesOwed, so refetch on whichever event lands. wagmi polls
  // via eth_getLogs under the hood against the public HTTP RPC.
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "FeeCollected",
    enabled: Boolean(curveAddress),
    onLogs: () => refetchCreatorFeesOwed(),
  });
  useWatchContractEvent({
    address: curveAddress,
    abi: BONDING_CURVE_ABI,
    eventName: "Graduated",
    enabled: Boolean(curveAddress),
    onLogs: () => refetchCreatorFeesOwed(),
  });

  const { writeContractAsync, data: claimTxHash, isPending: isClaimPending } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: isClaimSuccess } =
    useWaitForTransactionReceipt({ hash: claimTxHash });

  const [justClaimed, setJustClaimed] = useState(false);
  useEffect(() => {
    if (isClaimSuccess) {
      setJustClaimed(true);
      refetchCreatorFeesOwed();
      const timeout = setTimeout(() => setJustClaimed(false), 2500);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClaimSuccess]);

  async function handleClaim() {
    if (!curveAddress) return;
    try {
      await writeContractAsync({
        address: curveAddress,
        abi: BONDING_CURVE_ABI,
        functionName: "withdrawCreatorFees",
      });
    } catch {
      // User rejected or the tx reverted (e.g. nothing owed yet) — the
      // button just returns to its normal state, no owed-amount change.
    }
  }

  const isClaimBusy = isClaimPending || isClaimConfirming;
  const hasClaimable = Boolean(curveAddress && creatorFeesOwed && creatorFeesOwed > 0n);

  if (!address) return null;

  return (
    <div className="flex items-center gap-4">
      <div className="pixel-frame pixel-btn-ghost flex items-center h-9 gap-2 text-white px-3">
        <span className="text-[11px] font-bold">
          {balance ? formatEthShort(balance.value) : "0"} ETH
        </span>
      </div>

      <NotificationsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        items={notifications}
        isLoading={notificationsLoading}
      />

      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="pixel-frame pixel-btn h-9 w-9 text-white flex items-center justify-center"
        >
          <Icon icon="pixelarticons:user" className="text-white text-sm" />
        </button>

        {open && (
          <div className="pixel-frame pixel-panel absolute right-0 top-full mt-2 w-64 z-50">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 rounded-t-xl">
              <WalletAvatar address={address} size={24} />
              <span className="text-xs font-medium text-white/80">{truncateAddress(address)}</span>
            </div>

            <button
              onClick={() => {
                setMyTokensOpen(true);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-3 text-xs font-medium hover:bg-white/5 transition-colors border-b border-white/5"
            >
              My Tokens
            </button>

            <button
              onClick={() => {
                setNotificationsOpen(true);
                setOpen(false);
                if (unreadCount > 0) markAllRead();
              }}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium hover:bg-white/5 transition-colors border-b border-white/5"
            >
              Notifications
              {unreadCount > 0 && (
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-[9px] font-bold flex items-center justify-center text-black">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="flex items-center gap-1.5 text-xs font-bold">
                {formatWeiAsUsdPrice(creatorFeesOwed ?? 0n, ethUsdPrice)}
                <span className="group relative flex items-center">
                  <Icon
                    icon="pixelarticons:info-box"
                    className="text-white/40 text-xs cursor-help"
                  />
                  <span className="pointer-events-none absolute left-1/2 bottom-full mb-2 w-48 -translate-x-1/2 rounded-md bg-black border border-white/10 px-2.5 py-1.5 text-[10px] font-normal leading-snug text-white/80 opacity-0 group-hover:opacity-100 transition-opacity z-[60]">
                    {CLAIMABLE_TOOLTIP}
                  </span>
                </span>
              </span>
              <button
                onClick={handleClaim}
                disabled={isClaimBusy || !hasClaimable}
                className="pixel-frame pixel-btn text-white font-bold px-3 py-1.5 text-[11px] disabled:cursor-not-allowed"
              >
                {isClaimBusy ? "Claiming..." : justClaimed ? "Claimed" : "Claim"}
              </button>
            </div>

            {/* Once bound, this row becomes the X identity itself — there
                is deliberately no disconnect, so it never reverts to a
                "Connect" affordance. */}
            {xAccount ? (
              <div className="w-full flex items-center gap-2 px-4 py-3 border-b border-white/5">
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
                onClick={() => {
                  setConnectXOpen(true);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium hover:bg-white/5 transition-colors border-b border-white/5"
              >
                Connect X
              </button>
            )}

            <a
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-white/70 hover:text-white hover:bg-white/5 transition-colors border-b border-white/5"
            >
              Docs
              <Icon icon="pixelarticons:external-link" className="text-sm shrink-0" />
            </a>

            <button
              onClick={() => disconnect()}
              className="w-full text-left px-4 py-3 text-xs font-bold text-white/70 hover:text-white hover:bg-white/5 transition-colors rounded-b-xl"
            >
              Disconnect
            </button>
          </div>
        )}

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
      </div>
    </div>
  );
}
