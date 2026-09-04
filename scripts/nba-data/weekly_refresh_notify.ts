/**
 * Weekly refresh worklist alarm. Runs at the end of the Phase A GitHub Actions
 * job (roster sync + depth-chart pipeline), AFTER both have already written
 * their own review artifacts. This script does not compute anything itself —
 * it reads output/pocaro-roster-review.json and
 * output/depth-chart-pipeline-review.md and forwards the worklist-relevant
 * lines as one email, so Ash has a single "what needs my attention" digest
 * instead of two log files to dig through.
 *
 * This is a NOTIFIER, not a gate: it must NEVER fail the job. Any problem
 * (missing SendGrid config, missing review file, send error) is logged and
 * swallowed, and the process exits 0 — same contract as staleness_check.ts.
 *
 * Required env to actually send: SENDGRID_API_KEY, SENDGRID_FROM_EMAIL,
 * STALENESS_ALERT_TO (reused from the existing staleness alarm — same
 * recipient, no need for a second secret).
 *
 * Usage: npx tsx scripts/nba-data/weekly_refresh_notify.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const ROSTER_REVIEW = resolve(REPO_ROOT, "output/pocaro-roster-review.json");
const DEPTH_REVIEW = resolve(REPO_ROOT, "output/depth-chart-pipeline-review.md");

interface RosterReview {
  teamChanges: { name: string; oldTeam: string; newTeam: string }[];
  contractFlags: { name: string; contract: string | null; faYear: string | null; position: number | null }[];
  doubleAbsences: { name: string; team: string }[];
  newToSheet: { name: string; team: string }[];
  unresolved: { player: string; team: string; reason: string }[];
}

function section(title: string, lines: string[]): string {
  if (!lines.length) return `${title}: none\n`;
  return `${title} (${lines.length}):\n` + lines.map((l) => `  - ${l}`).join("\n") + "\n";
}

function buildBody(): string {
  const parts: string[] = [];

  if (existsSync(ROSTER_REVIEW)) {
    const r: RosterReview = JSON.parse(readFileSync(ROSTER_REVIEW, "utf8"));
    parts.push("=== Roster refresh (Pocaro sync) ===\n");
    parts.push(section("Team changes", r.teamChanges.map((t) => `${t.name}: ${t.oldTeam} -> ${t.newTeam}`)));
    parts.push(section("Contract-consistency flags (needs a human check)", r.contractFlags.map((c) => `${c.name}: ${c.contract} / ${c.faYear}`)));
    parts.push(section("Double-absent (likely departures)", r.doubleAbsences.map((d) => `${d.name} (${d.team})`)));
    parts.push(section("New to sheet, not yet on nba_roster", r.newToSheet.map((n) => `${n.name} (${n.team})`)));
    parts.push(section("Unresolved names (need identity review)", r.unresolved.map((u) => `${u.player} (${u.team}): ${u.reason}`)));
  } else {
    parts.push("Roster refresh review file not found — check the job log.\n");
  }

  if (existsSync(DEPTH_REVIEW)) {
    const md = readFileSync(DEPTH_REVIEW, "utf8");
    const worklistLines = md
      .split("\n")
      .filter((l) => /^\s+(re-keyed|added|dropped)\s/i.test(l) || /^\d+ row\(s\):/.test(l.trim()))
      .map((l) => l.trim());
    parts.push("\n=== Depth-chart / role-context reconciliation ===\n");
    parts.push(worklistLines.length ? worklistLines.join("\n") + "\n" : "No re-keys, additions, or drops this run.\n");
  } else {
    parts.push("\nDepth-chart pipeline review file not found — check the job log.\n");
  }

  parts.push(
    "\n---\n" +
      "Next: review the above, then go tinker in /admin/depth-chart and /admin/role-context " +
      "for anyone flagged (new signees at a seeded tier, re-keyed trades that lost their " +
      "override, any usage-role conflict badges). When you're done, trigger the " +
      "\"Phase B: projections\" workflow in GitHub Actions to push your edits and rebuild " +
      "the 2026-27 projections.\n\n(Automated message from weekly_refresh_notify.ts.)",
  );

  return parts.join("\n");
}

async function sendAlert(subject: string, body: string): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  const to = process.env.STALENESS_ALERT_TO;
  if (!apiKey || !from || !to) {
    console.warn(
      "Weekly refresh notify: SendGrid not configured (need SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, " +
        "STALENESS_ALERT_TO) — skipping email.",
    );
    return;
  }
  const sg = (await import("@sendgrid/mail")).default;
  sg.setApiKey(apiKey);
  await sg.send({ to, from, subject, text: body });
  console.log(`Weekly refresh notify: worklist emailed to ${to}.`);
}

async function main() {
  const body = buildBody();
  console.log(body); // always visible in the job log too
  await sendAlert("FHE: weekly roster refresh — worklist ready for review", body);
}

main().catch((err) => {
  console.error("weekly_refresh_notify error (ignored, job continues):", err);
  process.exit(0);
});
