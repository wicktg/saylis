"use client";

import ChatPanel from "@/app/_components/ChatPanel";

/**
 * Desktop chat: a permanently docked column beside the page content.
 *
 * The chat itself lives in ChatPanel, shared with the mobile overlay. This
 * component is now only the desktop container, and renders unchanged from
 * before the mobile work -- AppShell simply stops mounting it below the md
 * breakpoint, where a 288px fixed column would eat most of the screen.
 */
export default function Sidebar() {
  return (
    <aside className="w-72 flex flex-col border-r border-[var(--line)] shrink-0">
      <div className="px-3 py-2 border-b border-[var(--line)] text-[11px] text-[var(--ink-faint)] lowercase">
        ./chat
      </div>
      <ChatPanel />
    </aside>
  );
}
