"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { resolveIpfsUrl } from "@/app/_lib/ipfs";
import { truncateAddress } from "@/app/_lib/format";
import { TOKEN_DECIMALS } from "@/app/_lib/contracts/config";
import type { MyCampaign } from "@/app/_lib/useMyCampaigns";
import { useWalletAuth } from "@/app/_lib/useWalletAuth";
import SendSupplyModal from "./SendSupplyModal";
import WinnerCountStepper from "./WinnerCountStepper";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;


function formatTokens(raw: string | null): string {
  try {
    const whole = formatUnits(BigInt(raw ?? "0"), TOKEN_DECIMALS);
    return Number(whole).toLocaleString("en-US", { maximumFractionDigits: 0 });
  } catch {
    return "0";
  }
}

/**
 * One campaign, rendered for the developer who owns it.
 *
 * The card's whole job is to be honest about where a campaign actually is,
 * because most of its life is spent waiting. Each state gets its own
 * sentence and only the actions that state genuinely allows.
 *
 * Path A (origin='launched') only shows the title/description form once the
 * token is eligible. Path B (origin='post_launch') is entirely admin-gated
 * now: a campaign starts as 'invited' (the team granted this wallet a
 * slot), moves to 'awaiting_review' once the creator sends supply and
 * submits details, then becomes a real on-chain pool once the admin
 * verifies the balance and registers it.
 */
export default function CampaignCard({
  campaign,
  onChanged,
}: {
  campaign: MyCampaign;
  onChanged: () => void;
}) {
  const { address: account } = useAccount();
  const { authorize } = useWalletAuth();
  const [winnerCount, setWinnerCount] = useState(campaign.winnerCount ?? 50);
  const [title, setTitle] = useState(campaign.title ?? "");
  const [description, setDescription] = useState(campaign.description ?? "");
  const [busy, setBusy] = useState<null | "winners" | "approval" | "details">(null);
  const [error, setError] = useState<string | null>(null);
  const [sendSupplyOpen, setSendSupplyOpen] = useState(false);

  const imageUrl = campaign.imageUrl ? resolveIpfsUrl(campaign.imageUrl) : null;
  const isPathA = campaign.origin === "launched";
  const needsDetails = isPathA && campaign.state === "eligible" && !campaign.title;

  async function post(body: Record<string, unknown>, kind: "winners" | "approval" | "details") {
    if (!account) return;
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.tokenAddress}/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(await authorize("campaigns:configure")), ...body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Could not update.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update.");
    } finally {
      setBusy(null);
    }
  }

  // ---- Path B, pre-on-chain states: their own short-circuited card ----
  if (campaign.state === "invited") {
    return (
      <>
        <div className="pixel-frame pixel-card p-4 flex flex-col gap-3">
          <CardHeader campaign={campaign} imageUrl={imageUrl} />
          <p className="text-[11px] leading-snug text-[#cf38dd]">
            You&apos;ve been invited to launch an InfoFi campaign for this
            token. Send the agreed supply to create the pool.
          </p>
          <button
            onClick={() => setSendSupplyOpen(true)}
            className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm"
          >
            Send Supply
          </button>
        </div>
        <SendSupplyModal
          open={sendSupplyOpen}
          onClose={() => setSendSupplyOpen(false)}
          campaign={campaign}
          onSubmitted={onChanged}
        />
      </>
    );
  }

  if (campaign.state === "awaiting_review") {
    return (
      <div className="pixel-frame pixel-card p-4 flex flex-col gap-3">
        <CardHeader campaign={campaign} imageUrl={imageUrl} />
        <p className="text-[11px] leading-snug text-white/40">
          Supply sent. Awaiting team confirmation before the pool goes live.
        </p>
        {campaign.title && (
          <div>
            <p className="text-xs font-bold">{campaign.title}</p>
            {campaign.description && (
              <p className="text-[11px] text-white/40 leading-snug mt-0.5">
                {campaign.description}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <Stat label="Reported amount" value={`${formatTokens(campaign.reportedAmountRaw)} tokens`} />
          <Stat label="Airdrop winners" value={campaign.winnerCount ? String(campaign.winnerCount) : "N/A"} />
        </div>
      </div>
    );
  }

  // ---- Everything below assumes a real on-chain state ----

  const sizeLocked = campaign.state !== "registered" && campaign.state !== "eligible";

  function statusLine(): { text: string; tone: "wait" | "action" | "live" | "done" } | null {
    if (campaign.state === "burned") {
      return { text: "Pool burned. This campaign is closed.", tone: "done" };
    }
    if (campaign.state === "settled") {
      return { text: "Results published. Winners can claim now.", tone: "live" };
    }
    if (campaign.state === "open") {
      return null;
    }
    if (campaign.approvalStatus === "pending") {
      return { text: "Submitted for approval. The team is reviewing it.", tone: "wait" };
    }
    if (campaign.approvalStatus === "rejected") {
      return {
        text: campaign.approvalNote ?? "Approval was declined. The team will follow up.",
        tone: "wait",
      };
    }
    if (campaign.state === "eligible") {
      if (needsDetails) {
        return {
          text: "Eligibility met. Add a title and description to submit for approval.",
          tone: "action",
        };
      }
      return { text: "Eligibility met. Submit for approval to start the campaign.", tone: "action" };
    }
    // registered
    if (!isPathA) {
      return { text: "Pool locked. Awaiting graduation to become eligible.", tone: "wait" };
    }
    return {
      text: "You have a memecoin for InfoFi. It is not approved yet and has yet to meet the market cap criteria.",
      tone: "wait",
    };
  }

  const status = statusLine();
  const toneClass = status
    ? {
        wait: "text-white/40",
        action: "text-[#cf38dd]",
        live: "text-[var(--accent)]",
        done: "text-white/30",
      }[status.tone]
    : "";

  const canRequestApproval =
    campaign.state === "eligible" && campaign.approvalStatus !== "pending" && !needsDetails;

  return (
    <div className="pixel-frame pixel-card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <CardHeader campaign={campaign} imageUrl={imageUrl} />
        <div className="text-right shrink-0">
          <p className="text-[9px] uppercase tracking-wide text-white/30">Pool</p>
          <p className="text-xs font-bold">{formatTokens(campaign.allocationRaw)}</p>
        </div>
      </div>

      {status && <p className={`text-[11px] leading-snug ${toneClass}`}>{status.text}</p>}

      {campaign.title && !needsDetails && (
        <div>
          <p className="text-xs font-bold">{campaign.title}</p>
          {campaign.description && (
            <p className="text-[11px] text-white/40 leading-snug mt-0.5">
              {campaign.description}
            </p>
          )}
        </div>
      )}

      {/* Path A, first time details are needed: title + description form. */}
      {needsDetails && (
        <div className="flex flex-col gap-2">
          <div className="pixel-frame pixel-input px-3 py-1.5">
            <input
              type="text"
              placeholder="Campaign title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full bg-transparent text-sm focus:outline-none placeholder:text-white/30"
            />
          </div>
          <div className="pixel-frame pixel-input px-3 py-1.5">
            <textarea
              placeholder="What is this campaign about?"
              rows={2}
              value={description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full bg-transparent text-sm resize-none focus:outline-none placeholder:text-white/30"
            />
          </div>
          <button
            onClick={() =>
              post({ title: title.trim(), description: description.trim() }, "details")
            }
            disabled={busy !== null || !title.trim() || !description.trim()}
            className="pixel-frame pixel-btn-ghost w-full text-white/80 font-bold py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "details" ? "Saving..." : "Save Details"}
          </button>
        </div>
      )}

      {/* Airdrop size. Editable only while the campaign has not opened —
          participants join on the strength of these odds. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1">
            Airdrop winners
          </p>
          {/* Locked once the campaign has opened OR once a count has already
              been committed — the number decides everyone's odds, so it is
              chosen once and then fixed rather than quietly adjustable. */}
          {sizeLocked || campaign.winnerCount != null ? (
            <p className="text-xs font-bold">
              {campaign.winnerCount != null ? (
                <>
                  {campaign.winnerCount}{" "}
                  <span className="font-normal text-white/40">winners</span>
                </>
              ) : (
                "Not set"
              )}
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <WinnerCountStepper
                value={winnerCount}
                onChange={setWinnerCount}
                disabled={busy !== null}
              />
              <button
                type="button"
                onClick={() => post({ winnerCount }, "winners")}
                disabled={busy !== null}
                className="pixel-frame pixel-btn px-2.5 py-1.5 text-[10px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === "winners" ? "Setting..." : "Set"}
              </button>
            </div>
          )}
        </div>

        {canRequestApproval && (
          <button
            onClick={() => post({ requestApproval: true }, "approval")}
            disabled={busy !== null}
            className="pixel-frame pixel-btn text-white font-bold px-3 py-2 text-[11px] shrink-0 disabled:cursor-not-allowed"
          >
            {busy === "approval" ? "Submitting..." : "Submit for Approval"}
          </button>
        )}
      </div>

      {error && <p className="text-[10px] text-red-400 leading-snug">{error}</p>}
    </div>
  );
}

function CardHeader({
  campaign,
  imageUrl,
}: {
  campaign: MyCampaign;
  imageUrl: string | null;
}) {
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={campaign.ticker ?? "Token"}
          className="w-10 h-10 object-cover bg-white/5 shrink-0"
        />
      ) : (
        <div className="w-10 h-10 bg-[var(--accent-tint)] flex items-center justify-center shrink-0">
          <span className="text-sm font-black text-[var(--accent)]">
            {(campaign.ticker ?? "?").charAt(0)}
          </span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold uppercase tracking-tight truncate">
            {campaign.ticker ?? truncateAddress(campaign.tokenAddress)}
          </h3>
        </div>
        {campaign.name && (
          <p className="text-[11px] text-white/40 truncate">{campaign.name}</p>
        )}
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
