"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { supabase } from "@/app/_lib/supabase";

/**
 * A single executed trade. Every field comes from a real on-chain event —
 * nothing here is synthesized or estimated.
 */
export type Trade = {
  /** `${txHash}-${logIndex}` — stable and unique per log. */
  id: string;
  type: "buy" | "sell";
  wallet: Address;
  /** ETH paid in (buy) or received out (sell), wei. */
  ethWei: bigint;
  /** Tokens received (buy) or sold (sell), base units. */
  tokensWei: bigint;
  /** Realized execution price: wei of ETH per ONE WHOLE token. */
  priceWei: bigint;
  blockNumber: bigint;
  /** Block timestamp, unix seconds. */
  timestamp: number;
  /**
   * Where the trade happened. A token trades on `curve` until it graduates,
   * then on `pool` forever after — the feed spans both so it doesn't go
   * silent at migration.
   */
  venue: "curve" | "pool";
};

/** Columns the feed needs, from the exact-value view. */
const TRADE_COLUMNS = "id,type,venue,wallet,eth_wei,tokens_wei,price_wei,block_number,timestamp";

/** How many trades the feed holds. Older ones are a page away, not lost. */
const FEED_LIMIT = 200;

type TradeRow = {
  id: string;
  type: string;
  venue: string;
  wallet: string;
  eth_wei: string;
  tokens_wei: string;
  price_wei: string;
  block_number: string;
  timestamp: number;
};

/**
 * Every wei column arrives as a STRING, not a number.
 *
 * Postgres stores them as numeric(78,0) and PostgREST would serialize that
 * as a bare JSON number, which JSON.parse rounds away above 2^53 — a real
 * trade here has tokens_wei = 184781706545052039540116. The view casts them
 * to text so BigInt() round-trips the exact value.
 */
function rowToTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    type: row.type === "sell" ? "sell" : "buy",
    wallet: row.wallet as Address,
    ethWei: BigInt(row.eth_wei),
    tokensWei: BigInt(row.tokens_wei),
    priceWei: BigInt(row.price_wei),
    blockNumber: BigInt(row.block_number),
    timestamp: row.timestamp,
    venue: row.venue === "pool" ? "pool" : "curve",
  };
}

/** Chain order: block, then position within it. */
function sortTrades(list: Trade[]): Trade[] {
  return list.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Trades for one token, read once and then PUSHED.
 *
 * There is no polling here, and no chain reading of any kind. The webhook
 * (app/api/webhooks/alchemy) writes a row when a trade happens; Postgres
 * replicates that INSERT to every subscribed browser; this hook merges it
 * in. Between trades, nothing runs.
 *
 * WHAT THIS REPLACED, AND WHY IT IS SHORTER
 *
 * The previous version was ~800 lines: a chunked eth_getLogs backfill in
 * 10-block windows, a four-second poll, per-block timestamp fetches, log
 * decoding for two venues, a staleness check against the chain head, and a
 * fallback path for when the indexer could not be trusted. Almost all of it
 * existed to answer one question — "what do we show when the indexed data
 * might be wrong or missing?" — and every branch of that answer cost
 * upstream quota on every page view.
 *
 * With a webhook the question does not arise. Either the row is in the
 * table or the trade has not been captured, and if it has not been captured
 * that is a real bug to fix rather than a case to paper over. The fallback
 * was also actively harmful: it made a broken capture path invisible for
 * four days, because the UI kept working by reading the chain directly.
 */
export function useCurveTrades(
  curveAddress: Address | undefined,
  tokenAddress: Address | undefined
) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seenRef = useRef<Set<string>>(new Set());

  const merge = useCallback((incoming: Trade[]) => {
    const fresh = incoming.filter((trade) => !seenRef.current.has(trade.id));
    if (fresh.length === 0) return;
    for (const trade of fresh) seenRef.current.add(trade.id);
    setTrades((prev) => sortTrades([...prev, ...fresh]));
  }, []);

  useEffect(() => {
    if (!curveAddress) return;

    let cancelled = false;
    const curve = curveAddress.toLowerCase();
    seenRef.current = new Set();
    setTrades([]);
    setIsLoading(true);
    setError(null);

    async function load() {
      const { data, error: queryError } = await supabase
        .from("trades_exact")
        .select(TRADE_COLUMNS)
        .eq("curve_address", curve)
        .order("timestamp", { ascending: false })
        .limit(FEED_LIMIT);

      if (cancelled) return;
      if (queryError) {
        setError("Couldn't load trades.");
        setIsLoading(false);
        return;
      }

      const loaded = (data as TradeRow[]).map(rowToTrade);
      for (const trade of loaded) seenRef.current.add(trade.id);
      setTrades(sortTrades(loaded));
      setIsLoading(false);
    }

    load();

    // Unique per effect run. React Strict Mode double-invokes effects in dev
    // and `removeChannel` is async, so a fixed name can collide with a
    // same-named channel still tearing down.
    const channel = supabase
      .channel(`trades-${curve}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trades",
          // The webhook writes addresses lowercased, so equality is exact.
          filter: `curve_address=eq.${curve}`,
        },
        (payload) => {
          // The payload's numeric columns would be rounded by JSON.parse, so
          // it is used only as a signal that something arrived; the values
          // are re-read through the view, where they are text.
          if (!cancelled) void load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // `tokenAddress` is part of the signature for callers but the query is
    // keyed on the curve, which is what the webhook stamps every row with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curveAddress, tokenAddress]);

  return { trades, isLoading, error, merge };
}
