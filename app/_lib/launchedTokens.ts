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
 * Records a token/curve pair the given wallet just launched.
 *
 * This is NOT the registry. Supabase `tokens` is — it carries
 * `creator_wallet_address` and follows the wallet rather than the device,
 * which is what useCreatorFees reads. This store used to be that source,
 * and the result was creator fees that existed on-chain but rendered
 * nowhere the moment the creator opened the site in another browser.
 *
 * What survives is the event: a launch completed in this session should
 * surface immediately rather than on the next mount, and dispatching here
 * is how already-mounted components learn about it without polling.
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
