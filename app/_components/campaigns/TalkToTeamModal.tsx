"use client";

import Icon from "@/app/_components/Icon";

/**
 * Path B no longer has a self-service entry point. A creator who wants a
 * campaign for a token they didn't reserve InfoFi supply for at mint has to
 * talk to the team first — this modal is just that pointer, nothing else.
 *
 * The team then invites the specific wallet from the admin dashboard once
 * terms are agreed (see app/admin/page.tsx), and only then does anything
 * appear on this wallet's Campaigns page.
 */
export default function TalkToTeamModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="pixel-frame pixel-panel relative w-full max-w-sm mx-4 p-5">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors"
        >
          <Icon icon="pixelarticons:close" className="text-base" />
        </button>

        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <Icon icon="mdi:telegram" className="text-xl text-[#2ea6de]" />
          </div>
          <h2 className="text-base font-bold">Talk to the Team</h2>
          <p className="text-[11px] text-white/45 leading-relaxed max-w-[16rem]">
            Campaigns for tokens without an InfoFi allocation at mint are set
            up directly with the team. Reach out on Telegram and we&apos;ll
            work out the details with you.
          </p>

          <a
            href="https://t.me/valor0x"
            target="_blank"
            rel="noopener noreferrer"
            className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm mt-2 flex items-center justify-center gap-2"
          >
            <Icon icon="mdi:telegram" className="text-base" />
            Message @valor0x
          </a>

          <p className="text-[10px] text-white/25 leading-snug mt-1">
            Once terms are agreed, the team invites your wallet and a
            campaign appears here for you to complete.
          </p>
        </div>
      </div>
    </div>
  );
}
