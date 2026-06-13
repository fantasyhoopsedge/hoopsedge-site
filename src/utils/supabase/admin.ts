import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. Bypasses RLS and the column-level grants that
 * keep browser/anon clients out of server-managed fields (edge_points, outcome,
 * prediction_games writes). Use ONLY in trusted server contexts — Route
 * Handlers and Server Actions — and only after you have verified the caller's
 * authorization yourself, because this key answers to no one.
 *
 * NEVER import this from a Client Component, and never expose
 * SUPABASE_SERVICE_ROLE_KEY with a NEXT_PUBLIC_ prefix.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service-role client is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    // No browser session to manage on the server.
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
