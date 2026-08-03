"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useChat } from "@/app/_lib/useChat";
import { truncateAddress } from "@/app/_lib/format";
import WalletAvatar from "@/app/_components/WalletAvatar";
import Icon from "@/app/_components/Icon";

const CHAR_LIMIT = 280;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The chat itself: message list plus composer, with no opinion about where
 * it sits.
 *
 * Extracted from Sidebar so the desktop docked column and the mobile
 * floating overlay are the SAME component rather than two copies of the
 * same logic that drift apart. Only the container differs, which is
 * exactly the part each caller supplies.
 *
 * Purely ephemeral -- see useChat's own doc comment: broadcast-only,
 * capped at the last 50 messages this client has seen, nothing persisted
 * server-side. Username is always the sender's own truncated wallet
 * address; there is no separate nickname/identity system.
 */
export default function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { address: account } = useAccount();
  const { messages, send, error, cooldownSeconds, canSend } = useChat(account);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom as new messages arrive, the way every chat UI does.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !canSend) return;
    const text = draft;
    setDraft("");
    await send(text);
  }

  return (
    <>
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {messages.length === 0 ? (
          <p className="text-[11px] text-white/25 text-center py-10">
            <span className="text-white/15">{"// "}</span>no messages yet
          </p>
        ) : (
          // Log-line layout rather than chat bubbles: timestamp, then
          // sender, then message, the way a terminal transcript reads.
          messages.map((msg) => (
            <div key={msg.id} className="group text-[11px] leading-relaxed">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-white/25 shrink-0">[{formatTime(msg.sentAt)}]</span>
                <WalletAvatar address={msg.walletAddress} size={14} />
                <span className="text-white truncate">
                  {truncateAddress(msg.walletAddress)}
                </span>
              </div>
              <p className="text-white/65 break-words pl-1">
                <span className="text-[var(--accent)]">&gt; </span>
                {msg.message}
              </p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className={compact ? "p-3 border-t border-white/10" : "p-4 border-t border-white/10"}>
        <div className="pixel-frame pixel-input relative group flex items-center">
          <span className="pl-2 text-[11px] text-[var(--accent)] shrink-0">&gt;</span>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, CHAR_LIMIT))}
            placeholder={account ? "type message" : "connect a wallet to chat"}
            disabled={!account}
            // py-3 on mobile keeps the composer a comfortable tap target;
            // the desktop column stays at its original density.
            className={`w-full bg-transparent text-xs pl-2 pr-10 focus:outline-none placeholder:text-white/30 disabled:cursor-not-allowed ${
              compact ? "py-3" : "py-2.5"
            }`}
          />
          <button
            type="submit"
            disabled={!canSend || !draft.trim()}
            aria-label="Send message"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#cf38dd] disabled:text-[rgba(207,56,221,0.3)] disabled:cursor-not-allowed transition-colors"
          >
            <Icon icon="pixelarticons:send" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          {cooldownSeconds > 0 ? (
            <span className="text-[10px] text-white/40">wait {cooldownSeconds}s</span>
          ) : error ? (
            <span className="text-[10px] text-red-400">{error}</span>
          ) : (
            <span />
          )}
          <span className="text-[10px] text-white/30">
            {draft.length}/{CHAR_LIMIT}
          </span>
        </div>
      </form>
    </>
  );
}
