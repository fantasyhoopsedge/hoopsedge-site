import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";

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
}

/**
 * The offer as shown on the Launching soon screen. Exported so the screen and
 * the row it writes can never disagree about what was promised — but note the
 * stored `discount_pct` is a snapshot, not a live read of this constant: see
 * the migration's header for why a past promise must survive a price change.
 */
export const SEASON_PASS_USD = 35;
export const FOUNDING_DISCOUNT_PCT = 20;

/** Rounded to whole dollars — 35 × 0.8 is exactly 28, but keep this derived
 *  rather than hardcoded so changing either constant above stays consistent. */
export const FOUNDING_PRICE_USD = Math.round(SEASON_PASS_USD * (1 - FOUNDING_DISCOUNT_PCT / 100));

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
  });
  await writeLocal(rows);
}
