import "server-only";
import { revalidateTag } from "next/cache";
import {
  type AdjustmentCreatedEvent,
  type AdjustmentUpdatedEvent,
  type EventEntity,
  EventName,
  type TransactionCompletedEvent,
} from "@paddle/paddle-node-sdk";
import type { PaymentAlert } from "./alerts";
import { getPaddle } from "./paddle";
import {
  findPassOwner,
  getSeasonPassConfig,
  isPaymentRecorded,
  paddleEnvironment,
  recordSeasonPassPayment,
  refundSeasonPassPayment,
  seasonPassTag,
} from "./season-pass";
import { findEligibleDiscount, markDiscountRedeemed } from "./waitlist";

/**
 * Turns verified Paddle webhook events into season-pass rows.
 *
 * Paddle delivers at least once and in no guaranteed order, so every handler is
 * safe to run again: payments and refunds are recorded by database functions
 * keyed on the Paddle transaction id, and spending the founding discount is a
 * compare-and-set. A throw fails the delivery and Paddle retries it; returning
 * normally acknowledges it.
 *
 * Returns alerts for a person to act on. The caller sends them after the
 * response, so a slow email can't push the webhook past Paddle's 5-second
 * limit. Nothing here refunds anything — a duplicate payment is flagged, and a
 * human refunds it.
 */
export async function processPaddleEvent(event: EventEntity): Promise<PaymentAlert[]> {
  switch (event.eventType) {
    case EventName.TransactionCompleted:
      return handleTransactionCompleted(event);
    case EventName.AdjustmentCreated:
    case EventName.AdjustmentUpdated:
      return handleAdjustment(event);
    default:
      // Subscribed to something this doesn't handle: acknowledge and move on.
      return [];
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleTransactionCompleted(event: TransactionCompletedEvent): Promise<PaymentAlert[]> {
  const transaction = event.data;
  const environment = requireEnvironment();
  const config = await getSeasonPassConfig(environment);
  if (!config) throw new Error("season_pass_config has no row.");

  // custom_data is written by src/lib/deep-edge/season-pass-checkout.ts. A
  // season-pass transaction is recognised by it, or by the price — a checkout
  // opened for last season's price and paid after a rollover still has to be
  // recorded, and a checkout built in the browser carries the price but may not
  // carry our custom_data.
  const custom = transaction.customData ?? {};
  const customUserId = typeof custom.user_id === "string" ? custom.user_id : null;
  const customSeason = typeof custom.season === "string" ? custom.season : null;
  const hasSeasonPassPrice = transaction.items.some((item) => item.price?.id === config.priceId);
  if (!hasSeasonPassPrice && !customUserId) return []; // not a season pass

  const facts =
    `Transaction: ${transaction.id}\n` +
    `Environment: ${environment}\n` +
    `Amount: ${transaction.details?.totals?.grandTotal ?? "?"} ${transaction.currencyCode} (lowest unit)\n` +
    `Paddle customer: ${transaction.customerId ?? "?"}`;

  if (!customUserId || !UUID.test(customUserId)) {
    // Money was taken and there is no account to give the pass to. Retrying
    // won't produce one, so acknowledge — and make sure a person knows.
    return [
      {
        subject: "Season pass payment with no account attached",
        body:
          `A season-pass payment completed without a valid FHE user id in custom_data, so no pass ` +
          `was granted. Find the buyer in Paddle and either attach the pass by hand or refund.\n\n${facts}`,
      },
    ];
  }

  const alerts: PaymentAlert[] = [];
  const season = customSeason ?? config.season;
  if (season !== config.season) {
    alerts.push({
      subject: `Season pass paid for ${season}, but ${config.season} is on sale`,
      body:
        `The pass was recorded under ${season}, so it grants no access while season_pass_config is ` +
        `${config.season}. Probably a checkout opened before a rollover and paid after it.\n\n` +
        `User: ${customUserId}\n${facts}`,
    });
  }

  // Read the founding-discount promise BEFORE recording, while it is still
  // unspent, so the pass records what was actually honoured.
  const promise = transaction.discountId ? await findEligibleDiscount(customUserId, null) : null;
  const amount = Number.parseInt(transaction.details?.totals?.grandTotal ?? "", 10);

  const result = await recordSeasonPassPayment({
    userId: customUserId,
    season,
    environment,
    paymentId: transaction.id,
    amountPaidCents: Number.isFinite(amount) ? amount : null,
    currency: transaction.currencyCode,
    discountPct: promise?.discountPct ?? null,
    purchasedAt: event.occurredAt,
  });

  // Spend the discount even on a redelivery: if a previous attempt recorded the
  // pass and then failed here, this is where it gets finished. A second spend
  // is a no-op.
  if (promise) await markDiscountRedeemed(promise.email, transaction.id);

  if (result !== "already_recorded") {
    revalidateTag(seasonPassTag(customUserId), { expire: 0 });

    if (transaction.discountId && !promise) {
      alerts.push({
        subject: "Season pass paid with a discount nobody was promised",
        body:
          `Discount ${transaction.discountId} was applied, but this user has no unspent founding ` +
          `discount. Check the discount isn't usable at checkout by code.\n\nUser: ${customUserId}\n${facts}`,
      });
    }
  }

  if (result === "duplicate") {
    alerts.push({
      subject: "Duplicate season pass payment — refund by hand",
      body:
        `This user already holds an active ${season} pass, so this payment was recorded as ` +
        `'duplicate' and grants nothing. Nothing has been refunded automatically.\n\n` +
        `Refund it in Paddle (Transactions → ${transaction.id}). The refund webhook will then mark ` +
        `the row refunded.\n\nUser: ${customUserId}\n${facts}`,
    });
  }

  return alerts;
}

async function handleAdjustment(event: AdjustmentCreatedEvent | AdjustmentUpdatedEvent): Promise<PaymentAlert[]> {
  const adjustment = event.data;
  const facts =
    `Adjustment: ${adjustment.id} (${adjustment.action}, ${adjustment.type}, ${adjustment.status})\n` +
    `Transaction: ${adjustment.transactionId}\nReason: ${adjustment.reason}`;

  const revokes =
    (adjustment.action === "refund" && adjustment.type === "full" && adjustment.status === "approved") ||
    (adjustment.action === "chargeback" && adjustment.status !== "rejected");

  if (revokes) {
    const result = await refundSeasonPassPayment(adjustment.transactionId, event.occurredAt);

    if (result === "not_found") {
      // Either this transaction isn't a season pass, or its refund arrived
      // before its payment was recorded. Only the second deserves a retry.
      if (await isSeasonPassTransaction(adjustment.transactionId)) {
        throw new Error(`Refund for ${adjustment.transactionId} arrived before its payment was recorded.`);
      }
      return [];
    }

    const owner = await findPassOwner(adjustment.transactionId);
    if (owner) revalidateTag(seasonPassTag(owner), { expire: 0 });

    return adjustment.action === "chargeback" && result === "refunded"
      ? [{ subject: "Season pass charged back — access revoked", body: `User: ${owner ?? "?"}\n${facts}` }]
      : [];
  }

  // Money moved in a way that needs a person's judgement, not a rule.
  const needsDecision =
    adjustment.status === "approved" &&
    ((adjustment.action === "refund" && adjustment.type === "partial") || adjustment.action === "chargeback_reverse");

  if (needsDecision && (await isPaymentRecorded(adjustment.transactionId))) {
    return [
      {
        subject: `Season pass ${adjustment.action.replace("_", " ")} (${adjustment.type}) — decide on access`,
        body:
          `No access was changed. A partial refund keeps the pass; a reversed chargeback does not ` +
          `restore it. Adjust season_passes by hand if either should be different.\n\n${facts}`,
      },
    ];
  }

  return [];
}

/** Was this transaction a season-pass purchase? One Paddle read; only on the rare not-found refund path. */
async function isSeasonPassTransaction(transactionId: string): Promise<boolean> {
  const paddle = getPaddle();
  if (!paddle) throw new Error("Paddle is not configured; cannot inspect a refunded transaction.");

  const [transaction, config] = await Promise.all([
    paddle.transactions.get(transactionId),
    getSeasonPassConfig(requireEnvironment()),
  ]);
  return (
    typeof transaction.customData?.user_id === "string" ||
    transaction.items.some((item) => item.price?.id === config?.priceId)
  );
}

function requireEnvironment() {
  const environment = paddleEnvironment();
  if (!environment) throw new Error("NEXT_PUBLIC_PADDLE_ENV is not set; cannot process a Paddle webhook.");
  return environment;
}
