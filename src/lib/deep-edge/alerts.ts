import "server-only";

/**
 * Emails about Deep Edge payments that a person has to act on — a duplicate
 * payment to refund by hand, a payment that couldn't be attributed, a partial
 * refund to decide on.
 *
 * Same SendGrid setup as the data-pipeline alarms
 * (scripts/nba-data/staleness_check.ts): SENDGRID_API_KEY and
 * SENDGRID_FROM_EMAIL, plus PAYMENTS_ALERT_TO for where these go.
 *
 * Never throws: the webhook must not fail, and be retried, because an email
 * didn't go out. Every alert is also written to the log in full first, so the
 * deployment log still says what the email would have, even when SendGrid is
 * missing or down.
 */

export interface PaymentAlert {
  subject: string;
  body: string;
}

export async function sendPaymentAlert({ subject, body }: PaymentAlert): Promise<void> {
  console.warn(`[deep-edge/alert] ${subject}\n${body}`);

  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const to = process.env.PAYMENTS_ALERT_TO;
  if (!apiKey || !from || !to) {
    console.error(
      "[deep-edge/alert] SendGrid not configured (need SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, " +
        "PAYMENTS_ALERT_TO) — the alert above was NOT emailed.",
    );
    return;
  }

  try {
    // Imported lazily, as in the pipeline scripts, so a missing dependency can
    // only ever break the email and never the payment path.
    const sg = (await import("@sendgrid/mail")).default;
    sg.setApiKey(apiKey);
    await sg.send({ to, from, subject: `[FHE payments] ${subject}`, text: body });
  } catch (err) {
    console.error("[deep-edge/alert] email failed to send:", err);
  }
}
