import { createClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY Supabase client using the service-role key, which bypasses
 * RLS.
 *
 * Never import this from a client component. It exists solely so
 * /api/x/callback can write `x_accounts`, a table that intentionally has no
 * public insert policy — those bindings are permanent and unrevocable, so
 * they must only ever be created by a route that has already verified both
 * wallet ownership and X ownership.
 */
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin env vars missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Opt every query out of Next.js's Data Cache.
      //
      // supabase-js issues its requests through the global `fetch`, which
      // Next patches and caches independently of the route. That cache is
      // NOT covered by `export const dynamic = "force-dynamic"` — the route
      // re-executes on each request (the CDN reports a MISS), and then its
      // database reads are served from stale cached responses anyway.
      //
      // The failure is silent and looks like a data bug: /api/campaigns/mine
      // returned a campaign that had been deleted from the table, and later
      // returned an empty list for a wallet whose row demonstrably existed —
      // each response frozen at whatever the table held the first time that
      // exact query ran. Reads are the dangerous half: a creator seeing a
      // stale campaign list cannot tell it is stale.
      //
      // `no-store` is correct for ALL of it rather than only the reads that
      // looked wrong. Nothing here is a static asset — every query is either
      // live protocol state or per-wallet data, and none of it is safe to
      // serve from a cache keyed only on the request shape.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
