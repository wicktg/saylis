#!/usr/bin/env node
/**
 * Writes `addresses.generated.json` — the list of every BondingCurve
 * address this indexer should watch — by reading Supabase's `tokens`
 * table, the same authoritative registry the frontend already uses.
 *
 * WHY THIS IS A SEPARATE STARTUP STEP, NOT PART OF ponder.config.ts DIRECTLY
 *
 * BondingCurve instances have no on-chain factory — every launch deploys
 * one with two raw `deployContract` calls from the frontend, not a
 * `factory.createCurve()` call — so there is no event Ponder's real
 * `factory()` pattern (used for pool discovery below) can key off. Without
 * SOME registry, Ponder has no way to know which addresses to watch at all.
 *
 * Supabase's `tokens.curve_address` column IS that registry. Querying it
 * here, at process start, rather than trying to import the Supabase client
 * inside `ponder.config.ts` itself, keeps the config file a plain
 * synchronous module — simpler to reason about than depending on whether
 * Ponder's own config loader supports an async default export.
 *
 * THE REAL LIMITATION THIS CREATES
 *
 * This list is a snapshot taken at indexer startup. A token launched AFTER
 * that snapshot is invisible to this indexer until it restarts — there is
 * no live "watch Supabase for new rows" path. Re-run `npm run dev`/`start`
 * (or schedule a periodic restart on whatever host runs this) to pick up
 * new launches. This is a known, deliberate tradeoff of not having an
 * on-chain factory to discover instances from — see the project README.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them in indexer/.env.local " +
      "(same values as the main app's .env.local)."
  );
  process.exit(1);
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from("tokens")
  .select("curve_address, contract_address")
  .order("created_at", { ascending: true });

if (error) {
  console.error("Could not read tokens table:", error.message);
  process.exit(1);
}

const curveAddresses = (data ?? []).map((row) => row.curve_address);
const tokenByCurve = Object.fromEntries(
  (data ?? []).map((row) => [row.curve_address, row.contract_address])
);

writeFileSync(
  join(__dirname, "..", "addresses.generated.json"),
  JSON.stringify({ curveAddresses, tokenByCurve }, null, 2)
);

console.log(`wrote ${curveAddresses.length} curve address(es) to addresses.generated.json`);
