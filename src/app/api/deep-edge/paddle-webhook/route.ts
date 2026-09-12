import { after, NextResponse } from "next/server";
import { sendPaymentAlert } from "@/lib/deep-edge/alerts";
import { getPaddle } from "@/lib/deep-edge/paddle";
import { processPaddleEvent } from "@/lib/deep-edge/paddle-webhook";

/**
 * POST — Paddle notification destination for The Deep Edge season pass.
 * Subscribe the destination to transaction.completed, adjustment.created and
 * adjustment.updated; everything else is acknowledged and ignored.
 *
 * Paddle counts only a 2xx within 5 seconds as delivered and retries anything
 * else, with the same event, for up to three days in live. So:
 *   • the signature is verified against the RAW body before anything is trusted;
 *   • every failure — bad signature, missing config, a database error — is a
 *     500, so the event is retried rather than lost;
 *   • alert emails are sent after the response, never inside the 5 seconds.
 *
 * Paddle does not follow redirects, so the destination URL must be the exact
 * canonical one this route answers on.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("paddle-signature") ?? "";
  const rawBody = await request.text();
  if (!signature || !rawBody) {
    return NextResponse.json({ error: "Missing signature or body." }, { status: 400 });
  }

  const paddle = getPaddle();
  const secret = process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET;
  if (!paddle || !secret) {
    // Retried, so events sent before configuration lands aren't lost.
    console.error("[deep-edge/paddle-webhook] Paddle is not configured on this deployment.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  try {
    const event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
    const alerts = await processPaddleEvent(event);
    if (alerts.length > 0) {
      after(() => Promise.all(alerts.map(sendPaymentAlert)));
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[deep-edge/paddle-webhook] failed:", err);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
