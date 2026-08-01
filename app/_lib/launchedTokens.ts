import type { Address } from "viem";

export type LaunchedToken = {
  tokenAddress: Address;
  curveAddress: Address;
  symbol: string;
  launchedAt: number;
};

const STORAGE_KEY = "saylis:launchedTokens";

/** Fired on `window` whenever a new token/curve pair is recorded, so any
 * already-mounted component (e.g. ProfileMenu, which only re-reads
 * localStorage when the connected address changes) can react immediately
 * instead of waiting for a remount or address change. */
export const LAUNCHED_TOKEN_EVENT = "saylis:launchedTokenRecorded";

type StoredMap = Record<string, LaunchedToken[]>;

function readStore(): StoredMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoredMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/**
 * Records a token/curve pair the given wallet just launched. There is no
 * "My Tokens" page (out of scope) or on-chain registry to enumerate a
 * wallet's launches, so this is deliberately minimal: it only tracks
 * enough to let the Profile dropdown show/claim creator fees for the most
 * recently launched curve.
 */
export function recordLaunchedToken(owner: Address, token: LaunchedToken) {
  const store = readStore();
  const existing = store[owner.toLowerCase()] ?? [];
  store[owner.toLowerCase()] = [token, ...existing];
  writeStore(store);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LAUNCHED_TOKEN_EVENT, { detail: { owner, token } }));
  }
}

/** The most recently launched token/curve pair for a given wallet, if any. */
export function getLatestLaunchedToken(owner: Address | undefined): LaunchedToken | null {
  if (!owner) return null;
  const store = readStore();
  const entries = store[owner.toLowerCase()];
  return entries && entries.length > 0 ? entries[0] : null;
}
