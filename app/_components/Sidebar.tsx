"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useChat } from "@/app/_lib/useChat";
import { truncateAddress } from "@/app/_lib/format";
import WalletAvatar from "@/app/_components/WalletAvatar";

const CHAR_LIMIT = 280;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Global live chat. Purely ephemeral — see useChat's own doc comment for
 * why: broadcast-only, capped at the last 50 messages this client has seen,
 * nothing persisted server-side. Username is always the sender's own
 * truncated wallet address; there is no separate nickname/identity system.
 */
export default function Sidebar() {
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
    <aside className="w-72 flex flex-col border-r border-white/10 shrink-0">
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        {messages.length === 0 ? (
          <p className="text-[11px] text-white/25 text-center py-10">
            No messages yet. Say something.
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="group">
              <div className="flex items-start gap-3">
                <WalletAvatar address={msg.walletAddress} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-bold text-white font-mono">
                      {truncateAddress(msg.walletAddress)}
                    </span>
                    <span className="text-[9px] text-white/30">{formatTime(msg.sentAt)}</span>
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed break-words">
                    {msg.message}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="p-4 border-t border-white/10">
        {/* The sprite lives on this wrapper, not the input: `<input>` is a
            replaced element and cannot render ::before. */}
        <div className="pixel-frame pixel-input relative group">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, CHAR_LIMIT))}
            placeholder={account ? "Type Message Here..." : "Connect a wallet to chat"}
            disabled={!account}
            className="w-full bg-transparent text-xs py-3 pl-4 pr-10 focus:outline-none placeholder:text-white/30 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!canSend || !draft.trim()}
            aria-label="Send message"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-lime-400 disabled:text-lime-400/30 disabled:cursor-not-allowed transition-colors"
          >
            <iconify-icon icon="pixelarticons:send" />
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
    </aside>
  );
}
