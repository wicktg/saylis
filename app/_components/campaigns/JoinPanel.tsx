"use client";

import { useState } from "react";
import type { Address } from "viem";
import ConnectXModal from "@/app/_components/ConnectXModal";
import { useXAccount } from "@/app/_lib/useXAccount";
import { useWalletAuth } from "@/app/_lib/useWalletAuth";

/**
 * Joining is free and reversible in effect — it only creates a row the
 * scoring cron reads from. The one real gate is proof of X ownership (see
 * /api/infofi/join), so this panel is a two-step affordance: connect X if
 * not already bound, then join.
 */
export default function JoinPanel({
  tokenAddress,
  campaignState,
  account,
  isOwner,
  joined,
  joinedXUsername,
  onJoined,
}: {
  tokenAddress: string;
  campaignState: string;
  account: Address | undefined;
  /** The connected wallet is this campaign's own creator/invitee — joining
   *  your own campaign doesn't mean anything, so the button just hides. */
  isOwner: boolean;
  joined: boolean;
  joinedXUsername: string | null;
  onJoined: () => void;
}) {
  const { account: xAccount, isLoading: xLoading, refresh: refreshX } = useXAccount(account);
  const { authorize } = useWalletAuth();
  const [connectXOpen, setConnectXOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (campaignState !== "open") return null;
  if (isOwner) return null;

  if (!account) {
    return <p className="text-[11px] text-white/40">Connect your wallet to join this campaign.</p>;
  }

  if (joined) {
    return (
      <p className="text-[11px] text-lime-400 flex items-center gap-1.5">
        <iconify-icon icon="pixelarticons:check" className="text-sm" />
        Joined{joinedXUsername ? ` as @${joinedXUsername}` : ""}
      </p>
    );
  }

  if (xLoading) return null;

  if (!xAccount) {
    return (
      <>
        <button
          onClick={() => setConnectXOpen(true)}
          className="pixel-frame pixel-btn text-white font-bold px-4 py-2 text-[11px] flex items-center gap-1.5"
        >
          <iconify-icon icon="pixelarticons:link" className="text-sm" />
          Connect X to Join
        </button>
        <ConnectXModal
          open={connectXOpen}
          onClose={() => setConnectXOpen(false)}
          wallet={account}
          onLinked={() => {
            refreshX();
            setConnectXOpen(false);
          }}
        />
      </>
    );
  }

  async function handleJoin() {
    if (!account) return;
    setJoining(true);
    setError(null);
    try {
      const response = await fetch("/api/infofi/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("infofi:join")),
          tokenAddress,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not join.");
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={handleJoin}
        disabled={joining}
        className="pixel-frame pixel-btn text-white font-bold px-4 py-2 text-[11px] disabled:cursor-not-allowed"
      >
        {joining ? "Joining..." : "Join Campaign"}
      </button>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
