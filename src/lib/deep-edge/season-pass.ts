import "server-only";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Deep Edge season pass — the read side (tables season_passes and
 * season_pass_config, supabase/migrations/20260911000000_deep_edge_season_pass.sql).
 *
 * A one-off payment, not a subscription: a pass grants access while its season
 * equals season_pass_config.season, and no billing state enters the check.
 * The founding discount is not here — it is the waitlist row in waitlist.ts.
 *
 * access-cache.ts caches this answer per user, so whatever writes a pass (the
 * Paddle webhook) must call revalidateTag(seasonPassTag(userId), { expire: 0 })
 * afterwards, or a buyer waits out the cache before they can get in.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && SB_SERVICE);

// Untyped client — like the other Deep Edge tables, season_passes is
// service-role territory and isn't carried in src/types/database.ts.
function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type PaddleEnvironment = "sandbox" | "production";

/**
 * Which Paddle environment this deployment takes payments in. Deliberately the
 * same NEXT_PUBLIC_PADDLE_ENV that Paddle.js and the Node SDK are initialised
 * with, so the checkout and the gate can never disagree.
 *
 * Unset or unrecognised is null, and null counts NO passes. Paddle's own
 * examples fall back to sandbox when it is unset; doing that here would let a
 * sandbox test purchase unlock a deployment nobody configured for payments —
 * there is one Supabase project behind every environment.
 */
export function paddleEnvironment(): PaddleEnvironment | null {
  const env = process.env.NEXT_PUBLIC_PADDLE_ENV;
  return env === "sandbox" || env === "production" ? env : null;
}

/** Cache tag for one user's pass lookup — see access-cache.ts. */
export function seasonPassTag(userId: string): string {
  return `deep-edge-season-pass:${userId}`;
}

/**
 * Does this user hold an active pass for the current season, in this
 * deployment's Paddle environment?
 *
 * Throws on a database error instead of returning false: the caller caches the
 * result, and a transient failure cached as "no pass" would lock a paying user
 * out for the whole cache window.
 */
export async function hasActiveSeasonPass(userId: string): Promise<boolean> {
  const environment = paddleEnvironment();
  if (!SB_CONFIGURED || !environment) return false;

  const { data, error } = await serviceClient().rpc("has_active_season_pass", {
    p_user_id: userId,
    p_environment: environment,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export interface SeasonPassConfig {
  /** The season currently on sale and honoured, e.g. "2026-27". */
  season: string;
  /** This environment's Paddle Price id, or null until the catalog exists. */
  priceId: string | null;
  /** This environment's founding-discount id, or null until it exists. */
  foundingDiscountId: string | null;
}

/** The season_pass_config row, resolved to one Paddle environment's ids. Null if the row is missing. */
export async function getSeasonPassConfig(environment: PaddleEnvironment): Promise<SeasonPassConfig | null> {
  if (!SB_CONFIGURED) throw new Error("Supabase is not configured.");

  const { data, error } = await serviceClient()
    .from("season_pass_config")
    .select(
      "season, sandbox_price_id, production_price_id, sandbox_founding_discount_id, production_founding_discount_id",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const live = environment === "production";
  return {
    season: String(data.season),
    priceId: (live ? data.production_price_id : data.sandbox_price_id) ?? null,
    foundingDiscountId: (live ? data.production_founding_discount_id : data.sandbox_founding_discount_id) ?? null,
  };
}

export interface SeasonPassPayment {
  userId: string;
  season: string;
  environment: PaddleEnvironment;
  paymentId: string;
  amountPaidCents: number | null;
  currency: string | null;
  discountPct: number | null;
  purchasedAt: string;
}

/**
 * Record a completed payment — the database function decides the outcome, so
 * two deliveries racing each other can't both grant a pass:
 *   "active"           — recorded; grants access.
 *   "duplicate"        — the user already held an active pass for the season.
 *                        Recorded for a MANUAL refund; nothing is refunded.
 *   "already_recorded" — a redelivery of a payment seen before. No change.
 */
export async function recordSeasonPassPayment(
  payment: SeasonPassPayment,
): Promise<"active" | "duplicate" | "already_recorded"> {
  if (!SB_CONFIGURED) throw new Error("Supabase is not configured.");

  const { data, error } = await serviceClient().rpc("record_season_pass_payment", {
    p_user_id: payment.userId,
    p_season: payment.season,
    p_environment: payment.environment,
    p_payment_provider: "paddle",
    p_payment_id: payment.paymentId,
    p_amount_paid_cents: payment.amountPaidCents,
    p_currency: payment.currency,
    p_discount_pct: payment.discountPct,
    p_purchased_at: payment.purchasedAt,
  });
  if (error) throw new Error(error.message);
  if (data !== "active" && data !== "duplicate" && data !== "already_recorded") {
    throw new Error(`record_season_pass_payment returned an unexpected value: ${String(data)}`);
  }
  return data;
}

/**
 * Record that a payment was refunded (or charged back). Records a refund, never
 * starts one:
 *   "refunded" | "already_refunded" | "not_found" (no such payment recorded yet).
 */
export async function refundSeasonPassPayment(
  paymentId: string,
  refundedAt: string,
): Promise<"refunded" | "already_refunded" | "not_found"> {
  if (!SB_CONFIGURED) throw new Error("Supabase is not configured.");

  const { data, error } = await serviceClient().rpc("refund_season_pass_payment", {
    p_payment_provider: "paddle",
    p_payment_id: paymentId,
    p_refunded_at: refundedAt,
  });
  if (error) throw new Error(error.message);
  if (data !== "refunded" && data !== "already_refunded" && data !== "not_found") {
    throw new Error(`refund_season_pass_payment returned an unexpected value: ${String(data)}`);
  }
  return data;
}

/** The user a recorded Paddle payment belongs to, or null if it isn't recorded. */
export async function findPassOwner(paymentId: string): Promise<string | null> {
  if (!SB_CONFIGURED) throw new Error("Supabase is not configured.");

  const { data, error } = await serviceClient()
    .from("season_passes")
    .select("user_id")
    .eq("payment_provider", "paddle")
    .eq("provider_payment_id", paymentId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.user_id) : null;
}

/** Has this Paddle payment been recorded as a pass, in any status? */
export async function isPaymentRecorded(paymentId: string): Promise<boolean> {
  if (!SB_CONFIGURED) throw new Error("Supabase is not configured.");

  const { data, error } = await serviceClient()
    .from("season_passes")
    .select("id")
    .eq("payment_provider", "paddle")
    .eq("provider_payment_id", paymentId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}
