import { Hono } from "hono";

/**
 * Ponder requires this file to exist and to default-export a Hono app —
 * `ponder start` refuses to build without it, which is what was stopping
 * this indexer from ever running.
 *
 * It is deliberately minimal — in fact it registers no routes at all.
 * Ponder's HTTP server is not part of this project's data path: the
 * frontend reads trades from Supabase over PostgREST (see
 * supabase/indexer_views.sql), not from this process. So there is no
 * GraphQL schema or REST surface to expose here, and adding one would be a
 * second, unversioned way to read the same data.
 *
 * No health route either: Ponder reserves `/health` and `/ready` for its
 * own use and rejects the build if you define them, so process supervision
 * should use those built-ins rather than anything defined here.
 */
const app = new Hono();

export default app;
