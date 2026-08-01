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
 * Global live chat — purely a Supabase Realtime broadcast subscription, no
 * table backing the messages themselves. A client only ever sees messages
 * broadcast while it's connected, and only ever keeps the most recent 50 in
 * memory — scroll up past that and it's genuinely gone, by design (see
 * /api/chat/send for why: nothing is persisted server-side either).
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

  // Subscribe once, for the life of the component — not per-wallet, since
  // anyone (connected or not) can read the chat, only sending requires one.
  useEffect(() => {
    const channel = supabase.channel(CHANNEL);
    channel.on("broadcast", { event: "message" }, ({ payload }: BroadcastPayload) => {
      setMessages((prev) => [...prev, payload].slice(-MAX_MESSAGES));
    });
    channel.subscribe();
    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

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
