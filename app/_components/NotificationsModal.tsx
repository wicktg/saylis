"use client";

import Link from "next/link";
import { formatTimeAgo } from "@/app/_lib/time";
import type { Notification, NotificationType } from "@/app/_lib/useNotifications";
import Icon from "@/app/_components/Icon";

const ICON_BY_TYPE: Record<NotificationType, string> = {
  eligible: "pixelarticons:trophy",
  approved: "pixelarticons:check",
  rejected: "pixelarticons:close-box",
  supply_sent: "pixelarticons:send",
  supply_confirmed: "pixelarticons:check",
  graduated: "pixelarticons:chart",
  migrated: "pixelarticons:reload",
  campaign_ended: "pixelarticons:clock",
  claim_period_ended: "pixelarticons:lock",
  burned: "pixelarticons:trash",
  leaderboard_entry: "pixelarticons:trophy",
  announcement: "pixelarticons:mail",
};

const TONE_BY_TYPE: Record<NotificationType, string> = {
  eligible: "text-[#cf38dd]",
  approved: "text-[#cf38dd]",
  rejected: "text-red-400",
  supply_sent: "text-white/50",
  supply_confirmed: "text-[#cf38dd]",
  graduated: "text-[#cf38dd]",
  migrated: "text-[#cf38dd]",
  campaign_ended: "text-white/50",
  claim_period_ended: "text-white/50",
  burned: "text-white/40",
  leaderboard_entry: "text-[#cf38dd]",
  announcement: "text-[var(--accent)]",
};

/**
 * All of a creator's notifications, opened from the profile dropdown bell.
 * Read-only display — the bell marks everything read the moment this opens,
 * so there is no per-row action here beyond an optional link to Campaigns
 * for anything token-related.
 */
export default function NotificationsModal({
  open,
  onClose,
  items,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  items: Notification[];
  isLoading: boolean;
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

        <h2 className="text-base font-bold mb-3">Notifications</h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-2 border-[rgba(207,56,221,0.3)] border-t-[#cf38dd] spinner-circle animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center text-center py-8 gap-2">
            <Icon icon="pixelarticons:bell" className="text-xl text-white/25" />
            <p className="text-[11px] text-white/35 max-w-[14rem] leading-relaxed">
              Nothing yet. We&apos;ll let you know when a token hits InfoFi
              criteria, or a campaign is approved or rejected.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-h-96 overflow-y-auto pixel-scrollbar -mx-1 px-1">
            {items.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRow({ notification }: { notification: Notification }) {
  const content = (
    <div
      className={`flex items-start gap-2.5 px-2.5 py-2.5 rounded-lg transition-colors ${
        notification.read ? "" : "bg-white/[0.04]"
      } ${notification.linkUrl ? "hover:bg-white/5" : ""}`}
    >
      <Icon
        icon={ICON_BY_TYPE[notification.type]}
        className={`text-sm mt-0.5 shrink-0 ${TONE_BY_TYPE[notification.type]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-bold truncate">{notification.title}</p>
          {!notification.read && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#cf38dd] shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-white/45 leading-snug mt-0.5">{notification.body}</p>
        <p className="text-[10px] text-white/25 mt-1">
          {formatTimeAgo(notification.createdAt)}
        </p>
      </div>
    </div>
  );

  if (!notification.linkUrl) return content;

  const isExternal = /^https?:\/\//.test(notification.linkUrl);

  if (isExternal) {
    return (
      <a href={notification.linkUrl} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }

  return (
    <Link href={notification.linkUrl} className="block">
      {content}
    </Link>
  );
}
