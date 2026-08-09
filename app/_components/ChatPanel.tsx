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
 * it sits. `ChatLauncher` supplies the container — a popover on desktop, a
 * bottom sheet on a phone — so this component is shared rather than
 * duplicated between the two.
 *
 * Purely ephemeral — see `useChat`: the last 50 messages, hydrated once on
 * mount and then fed by a broadcast channel. Identity is always the
 * sender's own truncated wallet address; there is no nickname system.
 */
export default function ChatPanel() {
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
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-[0.75rem] font-medium text-[var(--ink-faint)]">
            No messages yet.
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex gap-2.5">
              <span className="shrink-0 mt-0.5">
                <WalletAvatar address={msg.walletAddress} size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[0.6875rem] font-bold text-[var(--ink)] font-mono truncate">
                    {truncateAddress(msg.walletAddress)}
                  </span>
                  <span className="text-[0.5625rem] font-medium text-[var(--ink-faint)] shrink-0">
                    {formatTime(msg.sentAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-[var(--ink-soft)] break-words">
                  {msg.message}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="shrink-0 p-3 border-t border-[var(--line)]">
        <div className="pixel-frame pixel-input relative flex items-center">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, CHAR_LIMIT))}
            placeholder={account ? "Say something…" : "Connect a wallet to chat"}
            disabled={!account}
            className="w-full bg-transparent text-[0.75rem] font-medium pl-3 pr-10 py-2.5 text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!canSend || !draft.trim()}
            aria-label="Send message"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--brand)] disabled:text-[var(--ink-faint)] disabled:cursor-not-allowed transition-colors"
          >
            <Icon icon="pixelarticons:send" className="text-sm" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mt-1.5 px-0.5">
          {cooldownSeconds > 0 ? (
            <span className="text-[0.5625rem] font-semibold text-[var(--ink-soft)]">
              Wait {cooldownSeconds}s
            </span>
          ) : error ? (
            <span className="text-[0.5625rem] font-semibold text-[var(--down)]">{error}</span>
          ) : (
            <span />
          )}
          <span className="text-[0.5625rem] font-medium text-[var(--ink-faint)] tabular-nums shrink-0">
            {draft.length}/{CHAR_LIMIT}
          </span>
        </div>
      </form>
    </>
  );
}
