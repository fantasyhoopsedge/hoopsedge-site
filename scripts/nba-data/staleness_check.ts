/**
 * Salary-data staleness alarm. Runs at the END of the daily stats workflow.
 *
 * Reads max(updated_at) from nba_contracts. If the newest contract row is
 * older than STALE_AFTER_DAYS (10), it sends a SendGrid reminder to refresh
 * data/nba-salaries/current.csv. If fresh, it no-ops.
 *
 * This is a NOTIFIER, not a gate: it must NEVER crash the stats job. Any
 * failure (missing SendGrid config, send error, query error) is logged and
 * swallowed, and the process exits 0.
 *
 * Network: Supabase + SendGrid only. (No salary website, ever.)
 *
 * Required env to actually send: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL,
 * STALENESS_ALERT_TO. If any are absent the script logs and no-ops.
 *
 * Usage:
 *   npx tsx scripts/nba-data/staleness_check.ts
 *   npx tsx scripts/nba-data/staleness_check.ts --force   # send regardless of age (test)
 */
import { getServiceClient, loadEnv } from "./client";

const STALE_AFTER_DAYS = 10;

async function sendAlert(subject: string, body: string): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const to = process.env.STALENESS_ALERT_TO;
  if (!apiKey || !from || !to) {
    console.warn(
      "Staleness: SendGrid not configured (need SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, " +
        "STALENESS_ALERT_TO) — skipping email.",
    );
    return;
  }
  // Imported lazily so a missing dep never breaks the no-op path.
  const sg = (await import("@sendgrid/mail")).default;
  sg.setApiKey(apiKey);
  await sg.send({ to, from, subject, text: body });
  console.log(`Staleness: alert emailed to ${to}.`);
}

async function main() {
  loadEnv();
  const force = process.argv.includes("--force");
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("nba_contracts")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const newest = data?.updated_at ? new Date(data.updated_at) : null;
  const ageDays = newest ? (Date.now() - newest.getTime()) / 86_400_000 : Infinity;
  const ageLabel = newest ? `${ageDays.toFixed(1)} days old` : "no contract rows found";
  console.log(`Staleness: newest nba_contracts row is ${ageLabel} (threshold ${STALE_AFTER_DAYS}d).`);

  if (!force && ageDays <= STALE_AFTER_DAYS) {
    console.log("Staleness: fresh — no alert.");
    return;
  }

  const n = Number.isFinite(ageDays) ? Math.floor(ageDays) : "unknown";
  await sendAlert(
    `FHE: NBA salary data is ${n} days stale — refresh current.csv`,
    [
      `The newest row in nba_contracts is ${ageLabel}.`,
      ``,
      `Refresh the salary data:`,
      `  1. Open HoopsHype salaries and run the DevTools console snippet (see`,
      `     scripts/nba-data/README.md).`,
      `  2. Paste into data/nba-salaries/current.csv and eyeball it.`,
      `  3. Commit + push — the salary-ingest workflow re-runs automatically.`,
      ``,
      `(Automated message from staleness_check.ts.)`,
    ].join("\n"),
  );
}

// Notifier, not a gate: log any failure and still exit 0.
main().catch((err) => {
  console.error("staleness_check error (ignored, stats job continues):", err);
  process.exit(0);
});
