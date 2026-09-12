import "server-only";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import type { Paddle, Transaction } from "@paddle/paddle-node-sdk";
import { getPaddle } from "./paddle";
import { findEligibleDiscount } from "./waitlist";
import {
  getSeasonPassConfig,
  hasActiveSeasonPass,
  isPaymentRecorded,
  paddleEnvironment,
  type PaddleEnvironment,
} from "./season-pass";

/**
 * Opening a Deep Edge season-pass checkout — layers 1 and 2 of "at most one
 * active pass per user per season". Layer 3 is the database; the migration
 * header (supabase/migrations/20260911000000_deep_edge_season_pass.sql)
 * explains why no single layer is enough.
 *
 *   1. Refuse while the user already holds an active pass for the season.
 *   2. Hand every attempt the SAME Paddle transaction for this user + season,
 *      stored in season_pass_checkouts. A transaction is paid at most once, so
 *      two tabs that both get past (1) before either payment lands still pay
 *      one transaction, not two.
 *
 * The transaction is created here, on the server, with the user id and season
 * in custom_data and any founding discount already attached. The browser only
 * receives its id, so it cannot choose the price or the discount.
 *
 * Nothing here moves money. The only Paddle writes are creating a transaction
 * and canceling an UNPAID transaction this code created and has since
 * replaced.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Untyped client — season_pass_checkouts is service-role only and isn't
// carried in src/types/database.ts, like the other Deep Edge tables.
function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface CheckoutAvailability {
  season: string;
  environment: PaddleEnvironment;
  /** Paddle.js client-side token — public by design. */
  clientToken: string;
}

/**
 * Whether the season pass is on sale on this deployment: the switch between
 * Launching soon and the buy screen in src/app/deep-edge/layout.tsx.
 *
 * On sale means everything checkout needs is present — a Paddle environment, a
 * server API key that matches it, a client token for Paddle.js, and a price id
 * for this season. Setting those IS the launch; no deploy is needed, and a
 * deployment missing any of them keeps showing Launching soon rather than a
 * buy button that can only fail.
 */
export async function getCheckoutAvailability(): Promise<CheckoutAvailability | null> {
  const environment = paddleEnvironment();
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  if (!environment || !clientToken || !getPaddle()) return null;

  const config = await getSeasonPassConfig(environment);
  return config?.priceId ? { season: config.season, environment, clientToken } : null;
}

export type OpenCheckoutResult =
  | { kind: "ready"; transactionId: string }
  /** Layer 1: an active pass for this season already exists. */
  | { kind: "already_owned"; season: string }
  /** This user's transaction has been paid, but the pass isn't recorded yet. */
  | { kind: "processing"; season: string }
  /** Misconfiguration. `reason` is for logs, never for the buyer. */
  | { kind: "unavailable"; reason: string };

/** What this user's checkout transaction must look like right now. */
interface ExpectedTransaction {
  userId: string;
  season: string;
  environment: PaddleEnvironment;
  priceId: string;
  discountId: string | null;
}

export async function openSeasonPassCheckout(user: { id: string; email: string | null }): Promise<OpenCheckoutResult> {
  const environment = paddleEnvironment();
  const paddle = getPaddle();
  if (!environment || !paddle) {
    return { kind: "unavailable", reason: "Paddle is not configured for this deployment." };
  }

  const config = await getSeasonPassConfig(environment);
  if (!config) return { kind: "unavailable", reason: "season_pass_config has no row." };
  if (!config.priceId) {
    return { kind: "unavailable", reason: `No ${environment} price id configured for ${config.season}.` };
  }

  // Layer 1. Deliberately the UNCACHED read: the page gate's cached answer can
  // be minutes stale, and a stale "no pass" here would open a second checkout.
  if (await hasActiveSeasonPass(user.id)) return { kind: "already_owned", season: config.season };

  const discount = await resolveFoundingDiscount(paddle, user, config.foundingDiscountId);
  if (!discount.ok) return { kind: "unavailable", reason: discount.reason };

  const expected: ExpectedTransaction = {
    userId: user.id,
    season: config.season,
    environment,
    priceId: config.priceId,
    discountId: discount.discountId,
  };

  // Layer 2.
  const storedId = await readStoredTransactionId(expected);

  if (!storedId) {
    const created = await createTransaction(paddle, expected);
    if (await insertStoredTransactionId(expected, created.id)) return { kind: "ready", transactionId: created.id };
    // A concurrent request stored its transaction first. Use that one; ours was
    // never handed to anyone, so cancel it before it can be.
    await cancelUnpaid(paddle, created.id);
    return { kind: "ready", transactionId: await readStoredTransactionIdOrThrow(expected) };
  }

  const stored = await paddle.transactions.get(storedId);
  switch (stored.status) {
    case "draft":
    case "ready":
      if (matchesExpected(stored, expected)) return { kind: "ready", transactionId: stored.id };
      break; // price or discount changed since it was created — replace it
    case "billed":
    case "paid":
    case "past_due":
      return { kind: "processing", season: config.season };
    case "completed":
      // Completed but not recorded: the webhook hasn't landed yet. Completed AND
      // recorded, with layer 1 having passed: that pass was refunded, so a new
      // purchase is legitimate.
      if (!(await isPaymentRecorded(stored.id))) return { kind: "processing", season: config.season };
      break;
    case "canceled":
      break;
  }

  const replacement = await createTransaction(paddle, expected);
  if (await replaceStoredTransactionId(expected, stored.id, replacement.id)) {
    // Only the still-payable one needs canceling; the others can't be paid again.
    if (stored.status === "draft" || stored.status === "ready") await cancelUnpaid(paddle, stored.id);
    return { kind: "ready", transactionId: replacement.id };
  }
  // A concurrent request replaced it first. Use theirs, cancel ours.
  await cancelUnpaid(paddle, replacement.id);
  return { kind: "ready", transactionId: await readStoredTransactionIdOrThrow(expected) };
}

/**
 * The Paddle discount to attach, or null for full price.
 *
 * A waitlist registrant was promised their discount_pct. If the Paddle side
 * can't honour exactly that — no discount configured, or one that isn't an
 * active percentage discount of the promised size — checkout is refused rather
 * than charging them something else.
 */
async function resolveFoundingDiscount(
  paddle: Paddle,
  user: { id: string; email: string | null },
  discountId: string | null,
): Promise<{ ok: true; discountId: string | null } | { ok: false; reason: string }> {
  const promise = await findEligibleDiscount(user.id, user.email);
  if (!promise) return { ok: true, discountId: null };

  if (!discountId) {
    return { ok: false, reason: "A waitlist registrant reached checkout, but no founding discount id is configured." };
  }

  const discount = await paddle.discounts.get(discountId);
  if (discount.status !== "active" || discount.type !== "percentage" || Number(discount.amount) !== promise.discountPct) {
    return {
      ok: false,
      reason:
        `Founding discount ${discountId} is ${discount.status} ${discount.type} ${discount.amount}, ` +
        `but the registrant was promised ${promise.discountPct}%.`,
    };
  }
  return { ok: true, discountId };
}

function createTransaction(paddle: Paddle, expected: ExpectedTransaction): Promise<Transaction> {
  return paddle.transactions.create({
    items: [{ priceId: expected.priceId, quantity: 1 }],
    discountId: expected.discountId,
    customData: { user_id: expected.userId, season: expected.season, environment: expected.environment },
  });
}

function matchesExpected(transaction: Transaction, expected: ExpectedTransaction): boolean {
  const [item, ...others] = transaction.items;
  return (
    others.length === 0 &&
    item?.price?.id === expected.priceId &&
    item.quantity === 1 &&
    (transaction.discountId ?? null) === expected.discountId &&
    transaction.customData?.user_id === expected.userId &&
    transaction.customData?.season === expected.season
  );
}

/**
 * Cancel a transaction this code created and no longer hands out. Only ever
 * called on a draft/ready (unpaid) transaction.
 *
 * A failure is logged, not thrown: the buyer already has a valid transaction.
 * It does leave a second payable transaction behind, and if that is ever paid,
 * layer 3 records it as a duplicate for a manual refund.
 */
async function cancelUnpaid(paddle: Paddle, transactionId: string): Promise<void> {
  try {
    await paddle.transactions.update(transactionId, { status: "canceled" });
  } catch (err) {
    console.error(`[deep-edge/checkout] could not cancel unpaid transaction ${transactionId}:`, err);
  }
}

// ── season_pass_checkouts ────────────────────────────────────────────────────

function keyOf(expected: ExpectedTransaction) {
  return { user_id: expected.userId, season: expected.season, environment: expected.environment };
}

async function readStoredTransactionId(expected: ExpectedTransaction): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from("season_pass_checkouts")
    .select("paddle_transaction_id")
    .match(keyOf(expected))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.paddle_transaction_id) : null;
}

async function readStoredTransactionIdOrThrow(expected: ExpectedTransaction): Promise<string> {
  const id = await readStoredTransactionId(expected);
  if (!id) throw new Error("season_pass_checkouts row vanished between a conflict and its re-read.");
  return id;
}

/** Store the first transaction for this user + season. False if one already exists. */
async function insertStoredTransactionId(expected: ExpectedTransaction, transactionId: string): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from("season_pass_checkouts")
    .upsert(
      { ...keyOf(expected), paddle_transaction_id: transactionId },
      { onConflict: "user_id,season,environment", ignoreDuplicates: true },
    )
    .select("paddle_transaction_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Swap the stored transaction, but only if it is still `previousId` — a
 * compare-and-set, so of two requests replacing the same stale transaction
 * exactly one wins. False means the other one did.
 */
async function replaceStoredTransactionId(
  expected: ExpectedTransaction,
  previousId: string,
  nextId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from("season_pass_checkouts")
    .update({ paddle_transaction_id: nextId, updated_at: new Date().toISOString() })
    .match({ ...keyOf(expected), paddle_transaction_id: previousId })
    .select("paddle_transaction_id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
