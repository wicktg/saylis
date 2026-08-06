"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { ConnectKitButton } from "connectkit";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import MiniSparkline from "@/app/_components/admin/MiniSparkline";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { useWalletAuth } from "@/app/_lib/useWalletAuth";
import { formatCompactTokenAmount, truncateAddress } from "@/app/_lib/format";
import { INFO_FI_CAMPAIGN_ABI } from "@/app/_lib/contracts/InfoFiCampaign";
import { IMMUTABLE_LAUNCH_TOKEN_ABI } from "@/app/_lib/contracts/ImmutableLaunchToken";
import Icon from "@/app/_components/Icon";
import AsciiSpinner from "@/app/_components/AsciiSpinner";
import { waitForReceipt } from "@/app/_lib/txReceipt";
import {
  INFOFI_CAMPAIGN_ADDRESS,
  INFOFI_TEAM_ADDRESS,
  TOKEN_DECIMALS,
} from "@/app/_lib/contracts/config";

type CampaignItem = {
  tokenAddress: string;
  curveAddress: string | null;
  origin: string;
  name: string | null;
  ticker: string | null;
  imageUrl: string | null;
  title: string;
  description: string;
  winnerCount: number | null;
  allocationRaw: string;
  state: string;
  approvalStatus: string | null;
  approvalNote: string | null;
  openedAt: string | null;
  lastMcapUsd18: string | null;
  mcapHistory: { mcapUsd18: string; sampledAt: string }[];
  reportedAmountRaw: string | null;
  owner: { wallet: string | null; tokensLaunched: number };
};

function formatMcap(usd18: string | null): string {
  if (!usd18) return "N/A";
  const n = Number(usd18) / 1e18;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPool(raw: string): string {
  try {
    const whole = formatUnits(BigInt(raw), 18);
    return Number(whole).toLocaleString("en-US", { maximumFractionDigits: 0 });
  } catch {
    return "0";
  }
}

type Tab = "campaigns" | "tickets" | "notifications";

/**
 * Team-only admin. Deliberately NOT wrapped in the normal app chrome —
 * no top nav, no chat sidebar, no profile/balance — this is a standalone
 * surface, not part of the public app. No content renders until a wallet
 * is connected, and even then only the team's own wallet sees anything
 * beyond an "unauthorized" message. Every mutating action is re-checked
 * server-side regardless, so this gate hides the queue from the wrong
 * person; it isn't the actual security boundary.
 */
export default function AdminPage() {
  const { address: account } = useAccount();
  const isTeam = account?.toLowerCase() === INFOFI_TEAM_ADDRESS.toLowerCase();
  const [tab, setTab] = useState<Tab>("campaigns");

  if (!account) {
    return <CenteredConnect />;
  }

  if (!isTeam) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-black">
        <Empty
          icon="pixelarticons:shield"
          title="Not authorized"
          body="This wallet is not the campaign team address."
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-black text-white text-sm">
      <div className="flex items-center justify-center gap-1 px-6 pt-5 pb-3 border-b border-white/10 shrink-0">
        <TabButton active={tab === "campaigns"} onClick={() => setTab("campaigns")}>
          Campaigns
        </TabButton>
        <TabButton active={tab === "tickets"} onClick={() => setTab("tickets")}>
          Tickets
        </TabButton>
        <TabButton active={tab === "notifications"} onClick={() => setTab("notifications")}>
          Notifications
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto pixel-scrollbar">
        {tab === "campaigns" ? (
          <CampaignsTab account={account} />
        ) : tab === "tickets" ? (
          <TicketsTab />
        ) : (
          <NotificationsTab account={account} />
        )}
      </div>
    </div>
  );
}

function CenteredConnect() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-4 text-center">
        <ConnectKitButton.Custom>
          {({ show, isConnecting }) => (
            <button
              onClick={show}
              disabled={isConnecting}
              className="pixel-frame pixel-btn text-white font-bold px-5 py-2.5 text-sm"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
        active
          ? "bg-[rgba(207,56,221,0.1)] text-[#cf38dd]"
          : "text-white/40 hover:text-white/70"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Force the Supabase mirror to agree with on-chain state for one token.
 *
 * Every admin action here is a wallet-signed transaction followed by a POST
 * that records it. The transaction is the real event; the POST is only
 * bookkeeping — so whenever the two can come apart, the chain wins and the
 * mirror has to be brought back to it.
 *
 * Best-effort by design: this runs in a `finally`, so it must never itself
 * throw and mask the original error the admin needs to see.
 */
async function syncCampaignFromChain(tokenAddress: string): Promise<void> {
  try {
    await fetch("/api/campaigns/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenAddress }),
    });
  } catch {
    // The poke cron reconciles it on its next pass regardless.
  }
}

function CampaignsTab({ account }: { account: string }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { authorize } = useWalletAuth();
  const [pending, setPending] = useState<CampaignItem[]>([]);
  const [approved, setApproved] = useState<CampaignItem[]>([]);
  const [awaitingReview, setAwaitingReview] = useState<CampaignItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const auth = await authorize("admin:campaign-queue");
      const query = new URLSearchParams({
        wallet: auth.walletAddress,
        signature: auth.signature,
        issuedAt: String(auth.issuedAt),
      });
      const response = await fetch(`/api/admin/campaigns?${query}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load campaigns.");
      setPending(payload.pending ?? []);
      setApproved(payload.approved ?? []);
      setAwaitingReview(payload.awaitingReview ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load campaigns.");
    } finally {
      setIsLoading(false);
    }
  }, [account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * "Approve & Open" signs `openCampaign` with the connected wallet, right
   * here in the browser — this is the project's official `team` wallet, so
   * its key must never be held server-side. The API call afterward only
   * syncs Supabase and sends the creator's notification; it does no
   * signing and cannot open a campaign by itself.
   */
  async function approve(tokenAddress: string) {
    if (!walletClient || !publicClient) {
      setError("Wallet not ready.");
      return;
    }
    setBusy(tokenAddress);
    setError(null);
    try {
      const txHash = await walletClient.writeContract({
        address: INFOFI_CAMPAIGN_ADDRESS as Address,
        abi: INFO_FI_CAMPAIGN_ABI,
        functionName: "openCampaign",
        args: [tokenAddress as Address],
      });
      const receipt = await waitForReceipt(publicClient, txHash);
      if (receipt.status !== "success") throw new Error("openCampaign transaction failed.");

      const response = await fetch(`/api/admin/campaigns/${tokenAddress}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("admin:campaign-approve")),
          txHash,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not sync the campaign.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the campaign.");
    } finally {
      // Reconcile the mirror against the chain no matter how the above went.
      //
      // The transaction is what actually opens a campaign; the POST above
      // only records that it happened. So any failure AFTER the tx confirms
      // — the route 409ing because the server's RPC has not yet caught up,
      // an expired signature, a dropped request — leaves a campaign open
      // on-chain while the dashboard still shows an Approve button. Clicking
      // it again then reverts with WrongState, which wallets surface as an
      // absurd gas estimate rather than anything an admin can act on.
      //
      // Syncing from chain here makes that state unreachable: the mirror
      // ends up agreeing with the chain whether or not the POST landed.
      await syncCampaignFromChain(tokenAddress);
      await refresh();
      setBusy(null);
    }
  }

  async function reject(tokenAddress: string) {
    setBusy(tokenAddress);
    setError(null);
    try {
      const response = await fetch(`/api/admin/campaigns/${tokenAddress}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("admin:campaign-reject")),
          note: rejectNote[tokenAddress] ?? "",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not reject the campaign.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject the campaign.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * The final step of Path B's admin-gated flow: verify the REAL on-chain
   * balance (never the creator's reported figure), sign
   * `registerExternalPool` with the connected wallet right here in the
   * browser, then sync Supabase once it lands.
   */
  async function confirmLock(item: CampaignItem, amountWhole: string) {
    if (!walletClient || !publicClient || !item.curveAddress) {
      setError("Wallet not ready, or this campaign has no curve on record.");
      return;
    }
    setBusy(item.tokenAddress);
    setError(null);
    try {
      const amount = parseUnits(amountWhole || "0", TOKEN_DECIMALS);
      if (amount <= 0n) throw new Error("Enter an amount greater than zero.");

      const txHash = await walletClient.writeContract({
        address: INFOFI_CAMPAIGN_ADDRESS as Address,
        abi: INFO_FI_CAMPAIGN_ABI,
        functionName: "registerExternalPool",
        args: [item.tokenAddress as Address, amount, item.curveAddress as Address],
      });
      const receipt = await waitForReceipt(publicClient, txHash);
      if (receipt.status !== "success") throw new Error("registerExternalPool failed.");

      const response = await fetch(`/api/admin/campaigns/${item.tokenAddress}/confirm-lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("admin:campaign-confirm-lock")),
          txHash,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not sync the campaign.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the pool.");
    } finally {
      // Same reasoning as `approve`: registerExternalPool has already landed
      // on-chain by this point, so the mirror must follow it regardless of
      // what the confirm-lock POST did.
      await syncCampaignFromChain(item.tokenAddress);
      await refresh();
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <AsciiSpinner className="text-xl text-[#cf38dd]" />
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-8">
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <InviteSection account={account} onInvited={refresh} />

      <section>
        <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
          Awaiting review ({awaitingReview.length})
        </h2>
        {awaitingReview.length === 0 ? (
          <Empty
            icon="pixelarticons:send"
            title="Nothing awaiting review"
            body="Invited campaigns appear here once a creator sends supply and submits their details."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {awaitingReview.map((item) => (
              <ReviewRow
                key={item.tokenAddress}
                item={item}
                busy={busy === item.tokenAddress}
                onConfirm={(amount) => confirmLock(item, amount)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
          Pending approval ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <Empty
            icon="pixelarticons:zap"
            title="Queue is empty"
            body="Nothing is eligible and awaiting review right now."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((item) => (
              <CampaignRow
                key={item.tokenAddress}
                item={item}
                busy={busy === item.tokenAddress}
                rejectNote={rejectNote[item.tokenAddress] ?? ""}
                onRejectNoteChange={(value) =>
                  setRejectNote((prev) => ({ ...prev, [item.tokenAddress]: value }))
                }
                onApprove={() => approve(item.tokenAddress)}
                onReject={() => reject(item.tokenAddress)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
          Approved ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <Empty
            icon="pixelarticons:check"
            title="Nothing approved yet"
            body="Campaigns you approve appear here, whatever state they move to next."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {approved.map((item) => (
              <CampaignRow key={item.tokenAddress} item={item} readOnly />
            ))}
          </div>
        )}
      </section>

      <BurnSection account={account} />
    </div>
  );
}

/**
 * Compose-and-push broadcast to every registered wallet (see
 * /api/wallets/register, /api/admin/notifications/broadcast). Pushed once,
 * immediately, to whoever is registered at that moment — there is no
 * scheduling or audience targeting here, deliberately: this is a blunt
 * "tell everyone something" tool, not a campaign system of its own.
 */
function NotificationsTab({ account }: { account: string }) {
  const { authorize } = useWalletAuth();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const TITLE_MAX = 80;
  const BODY_MAX = 500;

  async function handlePush() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("admin:broadcast")),
          title: title.trim(),
          message: message.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not push the notification.");
      setSuccess(`Pushed to ${payload.recipients} registered wallet${payload.recipients === 1 ? "" : "s"}.`);
      setTitle("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not push the notification.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = title.trim().length > 0 && message.trim().length > 0;

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
        Push a notification
      </h2>
      <div className="pixel-frame pixel-card p-4 flex flex-col gap-2.5">
        <p className="text-[11px] text-white/40 leading-snug">
          Sends to every wallet that has ever connected to the app, right
          now. Wallets that connect for the first time afterward will not
          see it.
        </p>
        <div className="pixel-frame pixel-input px-3 py-1.5">
          <input
            type="text"
            placeholder="Title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full bg-transparent text-sm focus:outline-none placeholder:text-white/30"
          />
        </div>
        <div className="pixel-frame pixel-input px-3 py-1.5">
          <textarea
            placeholder="Message"
            rows={4}
            value={message}
            maxLength={BODY_MAX}
            onChange={(event) => setMessage(event.target.value)}
            className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder:text-white/30"
          />
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        {success && <p className="text-[10px] text-[#cf38dd]">{success}</p>}
        <button
          onClick={handlePush}
          disabled={!canSubmit || busy}
          className="pixel-frame pixel-btn self-start text-white font-bold px-4 py-2 text-[11px] disabled:cursor-not-allowed"
        >
          {busy ? "Pushing..." : "Push to Everyone"}
        </button>
      </div>
    </div>
  );
}

function TicketsTab() {
  return (
    <div className="p-6">
      <Empty
        icon="pixelarticons:ticket"
        title="Tickets"
        body="Coming soon."
      />
    </div>
  );
}

function CampaignRow({
  item,
  readOnly = false,
  busy = false,
  rejectNote = "",
  onRejectNoteChange,
  onApprove,
  onReject,
}: {
  item: CampaignItem;
  readOnly?: boolean;
  busy?: boolean;
  rejectNote?: string;
  onRejectNoteChange?: (value: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const imageUrl = item.imageUrl ? resolveIpfsUrl(item.imageUrl) : null;

  return (
    <div className="pixel-frame pixel-card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.ticker ?? "Token"}
            className="w-10 h-10 object-cover bg-white/5 shrink-0"
          />
        ) : (
          <div className="w-10 h-10 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
            <span className="text-sm font-black text-[var(--accent)]">
              {(item.ticker ?? "?").charAt(0)}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-tight">
              {item.ticker ?? truncateAddress(item.tokenAddress)}
            </h3>
            {readOnly && (
              <span className="text-[9px] font-bold uppercase bg-[rgba(207,56,221,0.1)] text-[#cf38dd] px-1.5 py-0.5">
                {item.state}
              </span>
            )}
            {!readOnly && item.approvalStatus === "rejected" && (
              <span className="text-[9px] font-bold uppercase bg-red-400/10 text-red-400 px-1.5 py-0.5">
                Previously rejected
              </span>
            )}
          </div>
          <p className="text-xs font-bold text-white/80 mt-0.5">{item.title}</p>
          <p className="text-[11px] text-white/40 leading-snug mt-0.5">
            {item.description}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-[9px] uppercase tracking-wide text-white/30">Mcap</p>
          <p className="text-xs font-bold">{formatMcap(item.lastMcapUsd18)}</p>
          <MiniSparkline points={item.mcapHistory} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-3 text-[11px]">
        <Stat label="Pool" value={`${formatPool(item.allocationRaw)} tokens`} />
        <Stat label="Winners" value={item.winnerCount ? String(item.winnerCount) : "N/A"} />
        <Stat
          label="Creator"
          value={
            item.owner.wallet
              ? `${truncateAddress(item.owner.wallet)} - ${item.owner.tokensLaunched} launched`
              : "N/A"
          }
        />
      </div>

      {!readOnly && item.approvalNote && item.approvalStatus === "rejected" && (
        <p className="text-[10px] text-white/40 italic">
          Previous note: {item.approvalNote}
        </p>
      )}

      {!readOnly && (
        <div className="flex items-center gap-2 border-t border-white/10 pt-3">
          <input
            type="text"
            placeholder="Rejection note (optional)"
            value={rejectNote}
            onChange={(event) => onRejectNoteChange?.(event.target.value)}
            className="pixel-frame pixel-input flex-1 bg-transparent text-[11px] px-2 py-1.5 focus:outline-none placeholder:text-white/25"
          />
          <button
            onClick={onReject}
            disabled={busy}
            className="pixel-frame pixel-btn-ghost text-white/70 font-bold px-3 py-2 text-[11px] shrink-0 disabled:cursor-not-allowed"
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            disabled={busy}
            className="pixel-frame pixel-btn text-white font-bold px-3 py-2 text-[11px] shrink-0 disabled:cursor-not-allowed"
          >
            {busy ? "Working..." : "Approve & Open"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The team's power to render a Path B campaign to a specific wallet, after
 * agreeing terms off-platform. This is now the ONLY way a Path B campaign
 * comes into existence — see supabase/campaigns_v3_schema.sql.
 */
function InviteSection({
  account,
  onInvited,
}: {
  account: string;
  onInvited: () => void;
}) {
  const { authorize } = useWalletAuth();
  const [tokenAddress, setTokenAddress] = useState("");
  const [inviteWallet, setInviteWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit = isAddress(tokenAddress.trim()) && isAddress(inviteWallet.trim());

  async function handleInvite() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/campaigns/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("admin:campaign-invite")),
          tokenAddress: tokenAddress.trim(),
          inviteWallet: inviteWallet.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not create the invite.");
      setSuccess(`Invited ${truncateAddress(inviteWallet.trim())} for ${payload.ticker ?? tokenAddress}.`);
      setTokenAddress("");
      setInviteWallet("");
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
        Invite a campaign
      </h2>
      <div className="pixel-frame pixel-card p-4 flex flex-col gap-2.5">
        <p className="text-[11px] text-white/40 leading-snug">
          Renders a campaign to a specific wallet after terms are agreed
          off-platform. Nothing moves on-chain until the creator sends
          supply and it's confirmed below.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Token contract address"
            value={tokenAddress}
            onChange={(event) => setTokenAddress(event.target.value)}
            className="pixel-frame pixel-input bg-transparent text-[11px] font-mono px-2.5 py-2 focus:outline-none placeholder:font-sans placeholder:text-white/25"
          />
          <input
            type="text"
            placeholder="Wallet address to invite"
            value={inviteWallet}
            onChange={(event) => setInviteWallet(event.target.value)}
            className="pixel-frame pixel-input bg-transparent text-[11px] font-mono px-2.5 py-2 focus:outline-none placeholder:font-sans placeholder:text-white/25"
          />
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        {success && <p className="text-[10px] text-[#cf38dd]">{success}</p>}
        <button
          onClick={handleInvite}
          disabled={!canSubmit || busy}
          className="pixel-frame pixel-btn self-start text-white font-bold px-4 py-2 text-[11px] disabled:cursor-not-allowed"
        >
          {busy ? "Inviting..." : "Invite Wallet"}
        </button>
      </div>
    </section>
  );
}

type BurnCandidate = {
  tokenAddress: string;
  ticker: string | null;
  imageUrl: string | null;
  state: "open" | "settled" | "burned";
};

/**
 * The ONLY post-campaign action exposed to the admin: burning whatever's
 * left unclaimed once a campaign's window (and, if settled, its 7-day claim
 * period) has closed. `burnUnclaimed` is permissionless on-chain — anyone
 * could call it — this section just gives the team a place to trigger it
 * with their own connected wallet, and only ever lists campaigns where the
 * contract itself (via a live simulation) confirms there's something
 * burnable right now. Nothing else about a finished campaign is editable
 * from here.
 */
function BurnSection({ account }: { account: string }) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { authorize } = useWalletAuth();
  const [candidates, setCandidates] = useState<BurnCandidate[]>([]);
  const [burnable, setBurnable] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/campaigns/public", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not load campaigns.");
      const items: BurnCandidate[] = (payload.campaigns ?? []).filter(
        (c: BurnCandidate) => c.state === "open" || c.state === "settled"
      );
      setCandidates(items);

      if (publicClient) {
        const checks = await Promise.all(
          items.map(async (item) => {
            try {
              const onChain = (await publicClient.readContract({
                address: INFOFI_CAMPAIGN_ADDRESS as Address,
                abi: INFO_FI_CAMPAIGN_ABI,
                functionName: "getCampaign",
                args: [item.tokenAddress as Address],
              })) as { allocation: bigint; claimed: bigint };
              const remaining = onChain.allocation - onChain.claimed;
              if (remaining <= 0n) return [item.tokenAddress, null] as const;

              // Simulate rather than assume from timestamps — this is the
              // exact same check the contract itself makes, so a candidate
              // only ever shows up here when the real transaction would
              // actually succeed.
              await publicClient.simulateContract({
                address: INFOFI_CAMPAIGN_ADDRESS as Address,
                abi: INFO_FI_CAMPAIGN_ABI,
                functionName: "burnUnclaimed",
                args: [item.tokenAddress as Address],
                account: account as Address,
              });
              return [item.tokenAddress, remaining] as const;
            } catch {
              return [item.tokenAddress, null] as const;
            }
          })
        );
        setBurnable(
          Object.fromEntries(
            checks.filter((c): c is [string, bigint] => c[1] !== null)
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load campaigns.");
    } finally {
      setLoading(false);
    }
  }, [publicClient, account]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleBurn(tokenAddress: string) {
    if (!walletClient || !publicClient) return;
    setBusy(tokenAddress);
    setError(null);
    try {
      const txHash = await walletClient.writeContract({
        address: INFOFI_CAMPAIGN_ADDRESS as Address,
        abi: INFO_FI_CAMPAIGN_ABI,
        functionName: "burnUnclaimed",
        args: [tokenAddress as Address],
      });
      const receipt = await waitForReceipt(publicClient, txHash);
      if (receipt.status !== "success") throw new Error("burnUnclaimed transaction failed.");

      const response = await fetch(`/api/admin/campaigns/${tokenAddress}/burn-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(await authorize("admin:campaign-burn-confirm")),
          txHash,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not sync the burn.");

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not burn.");
    } finally {
      // burnUnclaimed is terminal on-chain, so a mirror left saying
      // otherwise would keep offering a Burn button that can only revert.
      await syncCampaignFromChain(tokenAddress);
      await refresh();
      setBusy(null);
    }
  }

  const burnableItems = candidates.filter((c) => burnable[c.tokenAddress] !== undefined);

  if (loading || burnableItems.length === 0) return null;

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-wide text-white/30 mb-3">
        Burnable ({burnableItems.length})
      </h2>
      <p className="text-[10px] text-white/25 leading-snug mb-3">
        Campaigns whose claim window has closed with tokens still unclaimed.
        Burning only ever moves the unclaimed remainder to the burn address;
        already-claimed amounts are untouched, and this is the only
        action available on a finished campaign.
      </p>
      <div className="flex flex-col gap-3">
        {burnableItems.map((item) => {
          const imageUrl = item.imageUrl ? resolveIpfsUrl(item.imageUrl) : null;
          return (
            <div
              key={item.tokenAddress}
              className="pixel-frame pixel-card p-4 flex items-center gap-3"
            >
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={item.ticker ?? "Token"}
                  className="w-9 h-9 object-cover bg-white/5 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
                  <span className="text-xs font-black text-[var(--accent)]">
                    {(item.ticker ?? "?").charAt(0)}
                  </span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">
                  {item.ticker ?? truncateAddress(item.tokenAddress)}
                </p>
                <p className="text-[10px] text-white/40">
                  {formatCompactTokenAmount(burnable[item.tokenAddress].toString())} tokens
                  will be burned
                </p>
              </div>
              <button
                onClick={() => handleBurn(item.tokenAddress)}
                disabled={busy === item.tokenAddress}
                className="pixel-frame pixel-btn text-white font-bold px-4 py-2 text-[11px] shrink-0 disabled:cursor-not-allowed"
              >
                {busy === item.tokenAddress ? "Burning..." : "Burn Unclaimed"}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
    </section>
  );
}

/**
 * A Path B pool awaiting confirmation. Shows the creator's own claim next
 * to the REAL on-chain balance InfoFiCampaign is holding for this token —
 * the two are expected to differ if the creator hasn't sent yet, or sent a
 * different amount, and that mismatch should be visible before registering
 * anything.
 */
function ReviewRow({
  item,
  busy,
  onConfirm,
}: {
  item: CampaignItem;
  busy: boolean;
  onConfirm: (amountWhole: string) => void;
}) {
  const publicClient = usePublicClient();
  const [liveBalance, setLiveBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    publicClient
      .readContract({
        address: item.tokenAddress as Address,
        abi: IMMUTABLE_LAUNCH_TOKEN_ABI,
        functionName: "balanceOf",
        args: [INFOFI_CAMPAIGN_ADDRESS as Address],
      })
      .then((balance) => {
        if (cancelled) return;
        const value = balance as bigint;
        setLiveBalance(value);
        setAmount(formatUnits(value, TOKEN_DECIMALS));
      })
      .catch(() => {
        if (!cancelled) setLiveBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [publicClient, item.tokenAddress]);

  const imageUrl = item.imageUrl ? resolveIpfsUrl(item.imageUrl) : null;
  const reportedWhole = (() => {
    try {
      return formatUnits(BigInt(item.reportedAmountRaw ?? "0"), TOKEN_DECIMALS);
    } catch {
      return "0";
    }
  })();
  const mismatch =
    liveBalance !== null &&
    item.reportedAmountRaw !== null &&
    liveBalance.toString() !== item.reportedAmountRaw;

  return (
    <div className="pixel-frame pixel-card p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={item.ticker ?? "Token"}
            className="w-10 h-10 object-cover bg-white/5 shrink-0"
          />
        ) : (
          <div className="w-10 h-10 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
            <span className="text-sm font-black text-[var(--accent)]">
              {(item.ticker ?? "?").charAt(0)}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold uppercase tracking-tight">
            {item.ticker ?? truncateAddress(item.tokenAddress)}
          </h3>
          {item.title && <p className="text-xs font-bold text-white/80 mt-0.5">{item.title}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <Stat label="Creator reported" value={`${reportedWhole} tokens`} />
        <Stat
          label="Live contract balance"
          value={liveBalance === null ? "Reading..." : `${formatUnits(liveBalance, TOKEN_DECIMALS)} tokens`}
        />
      </div>

      {mismatch && (
        <p className="text-[10px] text-orange-400 leading-snug">
          Reported amount does not match the live balance. Double-check
          before confirming.
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-white/10 pt-3">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="pixel-frame pixel-input flex-1 bg-transparent text-[11px] px-2.5 py-2 focus:outline-none"
        />
        <button
          onClick={() => onConfirm(amount)}
          disabled={busy || !item.curveAddress}
          className="pixel-frame pixel-btn text-white font-bold px-3 py-2 text-[11px] shrink-0 disabled:cursor-not-allowed"
        >
          {busy ? "Working..." : "Confirm & Create Pool"}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-white/30">{label}</p>
      <p className="font-bold text-white/80 truncate">{value}</p>
    </div>
  );
}

function Empty({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
      <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-1">
        <Icon icon={icon} className="text-xl text-white/25" />
      </div>
      <h2 className="text-sm font-bold text-white/70">{title}</h2>
      <p className="text-[11px] text-white/35 max-w-xs leading-relaxed">{body}</p>
    </div>
  );
}
