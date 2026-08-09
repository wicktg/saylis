"use client";

import { useEffect, useState } from "react";
import ChatPanel from "@/app/_components/ChatPanel";

/**
 * Mobile chat: a corner-anchored bubble that expands into an overlay.
 *
 * The desktop layout gives chat a permanent 288px column. On a phone that
 * would consume most of the viewport for something that is ambient rather
 * than primary, so here it occupies no layout space at all -- the bubble
 * floats above content, and the panel only exists while open.
 *
 * The panel is unmounted (not hidden) when closed, so its scroll position
 * resets and it costs nothing while idle. `useChat`'s subscription lives
 * inside ChatPanel, which means chat is not even connected until opened --
 * one fewer background socket on a metered connection.
 */
export default function MobileChatBubble() {
  const [open, setOpen] = useState(false);

  // Close on Escape, and stop the page behind from scrolling while the
  // overlay is up (otherwise dragging the panel scrolls the page under it).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          // Sits above the bottom tab bar rather than beside it, and clears
          // the home indicator via the same safe-area inset the bar uses.
          className="ascii fixed right-3 z-40 w-12 h-12 flex items-center justify-center border border-[var(--line)] bg-[var(--surface)] text-[var(--accent)] text-[13px] active:bg-[var(--surface-sunken)]"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.5rem)" }}
        >
          [~]
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-label="Chat">
          <button
            aria-label="Close chat"
            onClick={() => setOpen(false)}
            className="flex-1 bg-[rgba(20,18,34,0.28)]"
          />
          {/* Roughly two-thirds height: enough to read a conversation while
              still showing what is behind, so the overlay reads as
              temporary rather than as a route change. */}
          <div className="ascii h-[68%] flex flex-col border-t border-[var(--line)] bg-[var(--surface)]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--line)] shrink-0">
              <span className="text-[11px] text-[var(--ink-faint)] lowercase">./chat</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="text-[11px] text-[var(--ink-soft)] active:text-[var(--ink)] px-2 py-1"
              >
                [x]
              </button>
            </div>
            <ChatPanel compact />
          </div>
        </div>
      )}
    </>
  );
}
