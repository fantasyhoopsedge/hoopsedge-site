import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import { FOUNDING_DISCOUNT_PCT } from "./offer";

/**
 * Storage for The Deep Edge founding-price waitlist.
 *
 * Same two-mode shape as fantrax/store.ts and rookie-board-store.ts:
 *   • Supabase (production, or dev with DEEP_EDGE_USE_SUPABASE=1) — table
 *     deep_edge_waitlist (supabase/migrations/20260906000000_deep_edge_waitlist.sql).
 *   • Local JSON (dev default) — src/data/deep-edge-waitlist.json, so the
 *     capture screen is testable before the migration is applied.
 *
 * The local file holds real email addresses, so it is gitignored alongside
 * fantrax-leagues.json for the same reason: personal data, never committed.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && SB_SERVICE);

export const DE_WAITLIST_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.DEEP_EDGE_USE_SUPABASE === "1");

// Untyped client — like fx_leagues and rb_*, deep_edge_waitlist is a
// service-role-only table and isn't carried in src/types/database.ts.
function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const LOCAL_PATH = path.join(process.cwd(), "src", "data", "deep-edge-waitlist.json");

interface WaitlistRow {
  email: string;
  userId: string | null;
  discountPct: number;
  source: string;
  createdAt: string;
  /** ISO timestamp, or null while the discount is still claimable. */
  redeemedAt?: string | null;
  redeemedRef?: string | null;
}

/** A discount that is on the list and has not been spent. */
export interface EligibleDiscount {
  email: string;
  discountPct: number;
}

/**
 * Deliberately permissive: this is a marketing capture, not an auth boundary,
 * and the cost of rejecting a real address is much higher than the cost of
 * storing one that later bounces. Anything with a local part, an @, and a
 * dotted domain passes.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

async function readLocal(): Promise<WaitlistRow[]> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_PATH, "utf8")) as WaitlistRow[];
  } catch {
    return [];
  }
}

async function writeLocal(rows: WaitlistRow[]): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await fs.writeFile(LOCAL_PATH, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

/**
 * Add an address to the waitlist. Idempotent — submitting the same address
 * twice keeps the ORIGINAL row (and therefore the original promised discount),
 * it does not overwrite it with today's offer.
 */
export async function joinWaitlist(email: string, userId: string | null): Promise<void> {
  const normalized = email.trim().toLowerCase();

  if (DE_WAITLIST_SUPABASE_ENABLED) {
    const { error } = await serviceClient()
      .from("deep_edge_waitlist")
      .upsert(
        {
          email: normalized,
          user_id: userId,
          discount_pct: FOUNDING_DISCOUNT_PCT,
          source: "launching-soon",
        },
        { onConflict: "email", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return;
  }

  const rows = await readLocal();
  if (rows.some((r) => r.email === normalized)) return;
  rows.push({
    email: normalized,
    userId,
    discountPct: FOUNDING_DISCOUNT_PCT,
    source: "launching-soon",
    createdAt: new Date().toISOString(),
    redeemedAt: null,
    redeemedRef: null,
  });
  await writeLocal(rows);
}

/**
 * Find a discount this person can still spend — for billing to call at
 * checkout, once billing exists. Nothing calls it today.
 *
 * Matches on user_id FIRST and email only as a fallback. Every row written so
 * far carries a real account id (the capture API requires sign-in, and the
 * backfill reads auth.users), so the account is the reliable key: someone who
 * registered with one address and later pays under another still gets what
 * they were promised. Email is kept as a fallback purely for a row that
 * somehow has no user_id.
 *
 * Returns null when there is no row, or when the row has already been spent —
 * the caller cannot tell those apart, and shouldn't need to.
 */
export async function findEligibleDiscount(
  userId: string | null,
  email: string | null,
): Promise<EligibleDiscount | null> {
  const normalized = email?.trim().toLowerCase() ?? null;

  if (DE_WAITLIST_SUPABASE_ENABLED) {
    const client = serviceClient();

    for (const [column, value] of [
      ["user_id", userId],
      ["email", normalized],
    ] as const) {
      if (!value) continue;
      const { data, error } = await client
        .from("deep_edge_waitlist")
        .select("email, discount_pct")
        .eq(column, value)
        .is("redeemed_at", null)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return { email: String(data.email), discountPct: Number(data.discount_pct) };
    }
    return null;
  }

  const rows = await readLocal();
  const hit = rows.find(
    (r) => !r.redeemedAt && ((userId && r.userId === userId) || (normalized && r.email === normalized)),
  );
  return hit ? { email: hit.email, discountPct: hit.discountPct } : null;
}

/**
 * Spend a discount. Returns false if it was already spent.
 *
 * The Supabase path is a compare-and-set — UPDATE ... WHERE redeemed_at IS
 * NULL, and a zero-row result means someone got there first. That is what
 * makes double redemption impossible without a transaction, so callers must
 * treat `false` as "do not apply the discount", never as a retryable error.
 */
export async function markDiscountRedeemed(email: string, ref: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const now = new Date().toISOString();

  if (DE_WAITLIST_SUPABASE_ENABLED) {
    const { data, error } = await serviceClient()
      .from("deep_edge_waitlist")
      .update({ redeemed_at: now, redeemed_ref: ref })
      .eq("email", normalized)
      .is("redeemed_at", null)
      .select("email");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  const rows = await readLocal();
  const row = rows.find((r) => r.email === normalized);
  if (!row || row.redeemedAt) return false;
  row.redeemedAt = now;
  row.redeemedRef = ref;
  await writeLocal(rows);
  return true;
}
