import "server-only";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Deep Edge pre-launch tester allowlist (table de_testers, migration
 * supabase/migrations/20260907000000_deep_edge_testers.sql).
 *
 * Separate from rb_admins on purpose, and the separation is the whole point:
 * rb_admins is one shared list that also carries publish rights on the live
 * public dynasty and rookie boards, so a tester must never be added there
 * just to hand them one product. A row here grants Deep Edge and nothing
 * else.
 *
 * Mirrors isRbAdmin()'s shape deliberately — service-role lookup, ilike for
 * case-insensitive email match, maybeSingle, false when Supabase isn't
 * configured. Callers gate on dev separately (localhost is trusted by every
 * Deep Edge gate, so this is never consulted there).
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB_CONFIGURED = Boolean(SB_URL && SB_ANON && SB_SERVICE);

/** Untyped client — like rb_* and fx_*, de_testers isn't in src/types/database.ts. */
function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Is this email on the Deep Edge tester allowlist? (Service-role; bypasses RLS.) */
export async function isDeepEdgeTester(email: string | null | undefined): Promise<boolean> {
  if (!SB_CONFIGURED) return false;
  if (!email) return false;
  const { data } = await serviceClient().from("de_testers").select("email").ilike("email", email).maybeSingle();
  return Boolean(data);
}
