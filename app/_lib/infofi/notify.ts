/**
 * SERVER-ONLY. Writes into `public.notifications`, which has no public
 * write policy — every row here comes from a trusted job (the poke cron,
 * the admin approve/reject routes), never directly from a wallet's own
 * request.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationTypeServer =
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

export async function notify(
  admin: SupabaseClient,
  params: {
    walletAddress: string;
    type: NotificationTypeServer;
    tokenAddress?: string;
    title: string;
    body: string;
    /** App route (e.g. "/campaigns/0x..") or external URL (e.g. a block
     *  explorer tx link) this notification links through to. */
    linkUrl?: string;
  }
) {
  await admin.from("notifications").insert({
    wallet_address: params.walletAddress.toLowerCase(),
    type: params.type,
    token_address: params.tokenAddress?.toLowerCase() ?? null,
    title: params.title,
    body: params.body,
    link_url: params.linkUrl ?? null,
  });
}

/** Same as `notify`, but for many wallets at once — used by campaign-wide
 *  events (ended, claim window closed) and admin broadcasts. Each wallet
 *  still only ever reads its own row (see /api/notifications). */
export async function notifyMany(
  admin: SupabaseClient,
  walletAddresses: string[],
  params: {
    type: NotificationTypeServer;
    tokenAddress?: string;
    title: string;
    body: string;
    linkUrl?: string;
  }
) {
  const unique = [...new Set(walletAddresses.map((w) => w.toLowerCase()))];
  if (unique.length === 0) return;

  await admin.from("notifications").insert(
    unique.map((wallet) => ({
      wallet_address: wallet,
      type: params.type,
      token_address: params.tokenAddress?.toLowerCase() ?? null,
      title: params.title,
      body: params.body,
      link_url: params.linkUrl ?? null,
    }))
  );
}
