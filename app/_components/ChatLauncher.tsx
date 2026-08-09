"use client";

import { useEffect, useState } from "react";
import ChatPanel from "@/app/_components/ChatPanel";
import Icon from "@/app/_components/Icon";
import { useIsMobile } from "@/app/_lib/useIsMobile";

/**
 * Global chat, as a floating launcher in the bottom-left corner.
 *
 * This replaces the old 288px docked sidebar column. Chat is ambient — you
 * glance at it, you don't work in it — so paying a fifth of every desktop
 * viewport for it permanently was the wrong trade. Floating costs no layout
 * space at all, and the board behind it is what the page is actually for.
 *
 * WHY THE PANEL IS UNMOUNTED WHEN CLOSED
 *
 * `useChat` opens a Supabase Realtime subscription and fetches history, and
 * that subscription lives inside `ChatPanel`. Unmounting rather than hiding
 * means chat is not even connected until someone opens it — no background
 * socket, no fetch, nothing to pay for while it sits idle. It also resets
 * scroll position, which is what you want on reopen anyway.
 *
 * One component for both breakpoints, because only the container geometry
 * differs: a corner-anchored popover on a desktop, a bottom sheet on a
 * phone (where a 360px popover would be most of the screen and would open
 * under the thumb rather than above it).
 */
export default function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  // Escape closes. On mobile the sheet also locks the page behind it —
  // without that, dragging the message list scrolls the board underneath,
  // which reads as the overlay being broken.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);

    if (!isMobile) return () => document.removeEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isMobile]);

  // Clears the fixed bottom tab bar (h-14) and the home indicator on
  // phones; sits at a plain inset on desktop, where neither exists.
  const launcherBottom = isMobile
    ? "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)"
    : "1.25rem";

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          className="fixed left-5 z-40 grid place-items-center w-12 h-12 rounded-[var(--r-lg)] border border-[var(--ink)] bg-[var(--surface)] text-[var(--brand)] transition-colors hover:bg-[var(--surface-sunken)]"
          style={{ bottom: launcherBottom }}
        >
          <Icon icon="pixelarticons:message" className="text-lg" />
        </button>
      )}

      {open &&
        (isMobile ? (
          <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-label="Chat">
            <button
              aria-label="Close chat"
              onClick={() => setOpen(false)}
              className="flex-1 bg-[rgba(20,18,34,0.28)]"
            />
            {/* Roughly two-thirds height: enough to read a conversation
                while still showing what is behind, so the sheet reads as
                temporary rather than as a route change. */}
            <div className="h-[68%] flex flex-col border-t border-[var(--ink)] bg-[var(--surface)]">
              <Header onClose={() => setOpen(false)} />
              <ChatPanel />
            </div>
          </div>
        ) : (
          <div
            role="dialog"
            aria-label="Chat"
            className="fixed left-5 z-40 flex flex-col w-[340px] max-w-[calc(100vw-2.5rem)] h-[460px] max-h-[calc(100vh-8rem)] rounded-[var(--r-lg)] border border-[var(--ink)] bg-[var(--surface)] overflow-hidden"
            style={{ bottom: launcherBottom }}
          >
            <Header onClose={() => setOpen(false)} />
            <ChatPanel />
          </div>
        ))}
    </>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-3 border-b border-[var(--line)]">
      <span className="text-[0.75rem] font-bold text-[var(--ink)] truncate">Pod Chatter</span>
      <button
        onClick={onClose}
        aria-label="Close chat"
        className="grid place-items-center w-7 h-7 shrink-0 rounded-[var(--r-sm)] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--ink)]"
      >
        <Icon icon="pixelarticons:close" className="text-xs" />
      </button>
    </div>
  );
}
