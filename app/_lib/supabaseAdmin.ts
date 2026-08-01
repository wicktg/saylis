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
  });
}
