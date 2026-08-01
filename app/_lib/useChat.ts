"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/app/_lib/supabase";

const CHANNEL = "chat:global";
const MAX_MESSAGES = 50;

export type ChatMessage = {
  id: string;
  walletAddress: string;
  message: string;
  sentAt: string;
};

type BroadcastPayload = {
  payload: ChatMessage;
};

/**
 * Global live chat. Two sources feed the same capped 50-message window:
 *
 *   - On mount, the last 50 rows are fetched from `chat_messages` (a public,
 *     read-only table pruned by /api/chat/send) so a page refresh rehydrates
 *     recent history instead of showing an empty box.
 *   - From then on, new messages arrive live over Supabase Realtime's
 *     `chat:global` broadcast channel. Both paths are id-deduped when
 *     merged, since a message sent right around mount could otherwise show
 *     up twice (once from the fetch, once from the broadcast).
 *
 * Sending goes through /api/chat/send, never a direct client broadcast —
 * that's what makes the 30s per-wallet cooldown actually enforceable
 * (see that route) rather than just a client-side timer anyone could
 * bypass by refreshing.
 */
export function useChat(wallet: Address | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextAllowedAt, setNextAllowedAt] = useState<Date | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const appendMessage = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === incoming.id)) return prev;
      return [...prev, incoming].slice(-MAX_MESSAGES);
    });
  }, []);

  // Hydrate recent history once on mount, so a refresh isn't a blank chat.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("chat_messages")
      .select("id, wallet_address, message, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const history: ChatMessage[] = data
          .slice()
          .reverse()
          .map((row) => ({
            id: row.id as string,
            walletAddress: row.wallet_address as string,
            message: row.message as string,
            sentAt: row.created_at as string,
          }));
        setMessages((prev) => {
          const merged = [...history];
          for (const m of prev) {
            if (!merged.some((h) => h.id === m.id)) merged.push(m);
          }
          return merged.slice(-MAX_MESSAGES);
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe once, for the life of the component — not per-wallet, since
  // anyone (connected or not) can read the chat, only sending requires one.
  useEffect(() => {
    const channel = supabase.channel(CHANNEL);
    channel.on("broadcast", { event: "message" }, ({ payload }: BroadcastPayload) => {
      appendMessage(payload);
    });
    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [appendMessage]);

  // Honest countdown across a refresh — check the server's own record of
  // this wallet's cooldown rather than assuming a fresh client means no
  // cooldown is active.
  useEffect(() => {
    if (!wallet) {
      setNextAllowedAt(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/chat/cooldown?wallet=${wallet}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (cancelled) return;
        setNextAllowedAt(payload.nextAllowedAt ? new Date(payload.nextAllowedAt) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  // Tick the visible countdown every second while a cooldown is active.
  useEffect(() => {
    if (!nextAllowedAt) {
      setCooldownSeconds(0);
      return;
    }
    const tick = () => {
      const remainingMs = nextAllowedAt.getTime() - Date.now();
      if (remainingMs <= 0) {
        setCooldownSeconds(0);
        setNextAllowedAt(null);
        return;
      }
      setCooldownSeconds(Math.ceil(remainingMs / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [nextAllowedAt]);

  const send = useCallback(
    async (text: string) => {
      if (!wallet) {
        setError("Connect a wallet to chat.");
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;

      setSending(true);
      setError(null);
      try {
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: wallet, message: trimmed }),
        });
        const payload = await response.json();
        if (!response.ok) {
          if (payload?.nextAllowedAt) setNextAllowedAt(new Date(payload.nextAllowedAt));
          throw new Error(payload?.error ?? "Could not send.");
        }
        setNextAllowedAt(new Date(payload.nextAllowedAt));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send.");
      } finally {
        setSending(false);
      }
    },
    [wallet]
  );

  return {
    messages,
    send,
    sending,
    error,
    cooldownSeconds,
    canSend: Boolean(wallet) && cooldownSeconds === 0 && !sending,
  };
}
