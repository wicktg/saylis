"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

export type NotificationType =
  | "eligible"
  | "approved"
  | "rejected"
  | "supply_sent"
  | "supply_confirmed"
  | "graduated"
  | "migrated"
  | "campaign_ended"
  | "claim_period_ended"
  | "burned"
  | "leaderboard_entry"
  | "announcement";

export type Notification = {
  id: string;
  type: NotificationType;
  tokenAddress: string | null;
  title: string;
  body: string;
  linkUrl: string | null;
  read: boolean;
  createdAt: string;
};

/**
 * A wallet's notification feed, polled rather than realtime — this is a
 * dropdown a user checks occasionally, not a live chat, so a 60s interval
 * is plenty and avoids holding a Supabase realtime channel open just for
 * the profile menu.
 */
export function useNotifications(wallet: Address | undefined) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setItems([]);
      setUnreadCount(0);
      setIsLoading(false);
      return;
    }
    try {
      const response = await fetch(`/api/notifications?wallet=${wallet}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (response.ok) {
        setItems(payload.items ?? []);
        setUnreadCount(payload.unreadCount ?? 0);
      }
    } finally {
      setIsLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  /** Marks every currently-unread notification read, optimistically. */
  const markAllRead = useCallback(async () => {
    if (!wallet || unreadCount === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: wallet }),
    });
  }, [wallet, unreadCount]);

  return { items, unreadCount, isLoading, refresh, markAllRead };
}
