/**
 * Phase 2 of the roster-refresh automation: after Phase 1 refreshes the
 * roster CSV, bring depth-chart / role-context / team-category back in step
 * with it and surface what a human needs to review. Pure mechanical
 * bridging of already-built tooling — writes only to Supabase's admin-owned
 * doc tables (never nba_roster/nba_contracts), and never sets a tier,
 * GP/MPG override, or role tag itself.
 *
 *   npm run depth-chart:pipeline
 *
 * WHY PULL COMES BEFORE PUSH (reverted 2026-09-03 after trying it the other
 * way — see the incident below). Pulling first is the direction that can
 * only ADD to the local CSV or leave it alone (pull's own "a null in
 * Supabase does not blank a number the CSV has" rule), never silently drop a
 * key that only exists in Supabase. Pushing first does the opposite: a push
 * REPLACES Supabase's whole map with the local CSV's, so anything published
 * straight to Supabase (a different session, e.g. production) and never
 * pulled into this local CSV is gone the moment push runs. Tried "push
 * first" for real on 2026-09-03 to fix a different bug (below) and it
 * immediately dropped 5 real role-context tags that existed only in
 * Supabase (SAC Zach LaVine, NOR Derik Queen, NOR Jeremiah Fears, PHO Oso
 * Ighodaro, CLE Peyton Watson) — recovered by hand from the push step's own
 * "!! drops N key(s)" warning, but it proved push-first isn't actually
 * safer, just differently lossy.
 *
 * WHAT THIS AUTOMATES — no new judgment introduced, all steps already
 * existed as standalone tools this just runs in the right order:
 *   1. Pull the latest published depth-chart/role-context/team-category tags
 *      from Supabase into their CSVs (each *:sync --pull).
 *   2. SAFETY CHECK (depth-chart only, added 2026-09-03): compare the
 *      depth-chart CSV before/after the pull. If a row's TIER changed AND
 *      that row still carries a real GP/MPG override, warn loudly rather
 *      than silently continue. Confirmed for real 2026-09-03: Ash set DeMar
 *      DeRozan's DEN tier + minutes locally; the tool's local-CSV dev mode
 *      (DC_SUPABASE_ENABLED off) saved it straight to disk without ever
 *      touching Supabase, so the NEXT pipeline run's pull found Supabase
 *      still holding the old "fringe, no override" row and flipped the tier
 *      back — the override numbers survived (pull's conservative
 *      null-doesn't-blank-a-number rule), but a fringe-tier row with real
 *      starter-level minutes is exactly the inconsistent state this check
 *      exists to catch. It does NOT block the rest of the pipeline — the
 *      numbers are safe either way — it just makes the flip visible instead
 *      of silent, so a real one gets manually re-pushed (`*:sync --push`)
 *      rather than sitting wrong until someone happens to notice.
 *   3. Run prep_role_context.py and prep_depth_chart.py, which reconcile
 *      those CSVs against the just-refreshed roster CSV — re-key a traded
 *      player, clear his now-stale minutes override (a GP/MPG override is a
 *      claim on ONE team's total, never portable across a trade), add a new
 *      rostered player at a seeded tier, drop someone off the roster
 *      entirely. Both already fixed real incidents (Spencer Jones's minutes
 *      ghost-riding into Denver's allocation, Koloko/Bufkin blocking NOR's
 *      whole publish) — this script's only job is to actually run them after
 *      every roster refresh instead of relying on someone remembering to.
 *   4. Push the reconciled CSVs back to Supabase, so the admin-owned doc
 *      tables carry the CORRECTED team keys too — otherwise every future
 *      pull re-introduces the pre-correction key and the same re-key dance
 *      repeats forever. Confirmed for real 2026-09-03: a "PJ Washington"
 *      (Supabase's stale key) vs "P.J. Washington" (roster's canonical
 *      spelling) mismatch briefly created a duplicate key, tripped the
 *      reconciler's strict-uniqueness refusal, and dropped a real admin-set
 *      override instead of guessing which row it belonged to — the safe
 *      failure, but still a loss. Push closes that loop.
 *   5. Run flag_role_changes.py --emit-json, the vacancy-scaled usage-change
 *      DETECTOR — writes src/data/role-flags-2026-27.json, which
 *      /admin/depth-chart already reads and overlays as badges. Advisory
 *      only: it proposes a direction/magnitude, it never writes a tag.
 *
 * WHAT STAYS MANUAL. Every tier, GP/MPG override, and role-context tag is
 * set by hand in /admin/depth-chart and /admin/role-context — real
 * basketball judgment (camp reports, coaching comments, depth-chart
 * battles) no stage here claims to replace. This script's output is a
 * worklist, not a decision.
 *
 * THE REAL FIX IS PROCESS, NOT CODE: a dev-mode local edit needs a
 * `*:sync --push` (or this whole pipeline) run before it reaches Supabase —
 * the local CSV and Supabase's published doc are two independent stores
 * with no automatic sync between them, and no reordering of pull/push makes
 * that stop being true. Run this pipeline (or at least a manual push) right
 * after any local admin-tool session, before doing anything else — waiting
 * until "the next roster refresh" is exactly what let the DeRozan edit go
 * unpushed for as long as it did.
 *
 * Reads/writes local CSVs, one bundled JSON, and Supabase's depth-chart/
 * role-context/team-category PUBLISHED docs (pull AND push) — never
 * nba_roster/nba_contracts. Runs under tsx, outside Next; the Python steps
 * use the repo's `python` (models/requirements.txt — pandas/numpy already
 * required).
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "csv-parse/sync";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW_PATH = resolve(REPO_ROOT, "output/depth-chart-pipeline-review.md");
const DEPTH_CSV = resolve(REPO_ROOT, "data/nba-rosters/depth-chart-2026-27.csv");

interface StepResult { label: string; command: string; ok: boolean; output: string; }

// Every argument here is a hardcoded literal this file wrote — never
// user/network input — so a single shell string is safe. execFileSync with
// shell:true + an args array is exactly the combination Node deprecated
// (DEP0190): args stop being escaped and are just concatenated.
function run(label: string, command: string, args: string[]): StepResult {
  const full = [command, ...args].join(" ");
  try {
    const output = execSync(full, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { label, command: full, ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message;
    return { label, command: full, ok: false, output };
  }
}

function runTsx(label: string, scriptRelPath: string, args: string[] = []): StepResult {
  return run(label, "npx", ["tsx", scriptRelPath, ...args]);
}

function runPython(label: string, scriptRelPath: string, args: string[] = []): StepResult {
  return run(label, "python", [scriptRelPath, ...args]);
}

interface DepthRow { team: string; player: string; tier: string; injury: string; override_games: string; override_mpg: string; }

function readDepthRows(): DepthRow[] {
  return parse(readFileSync(DEPTH_CSV, "utf8"), { columns: true, skip_empty_lines: true, trim: true }) as DepthRow[];
}

// Catches the DeRozan-shaped failure (see header) WITHOUT reordering pull
// before push — a pull that changes a row's tier is normal and often
// correct (Supabase really did move), but a pull that changes the tier on a
// row STILL carrying a real GP/MPG override is exactly the shape of "a local
// edit that was never pushed, now silently reverted." Doesn't block the rest
// of the pipeline — the override numbers themselves are already safe via
// pull's own conservative rule — it only makes the flip visible.
function checkTierReversions(before: DepthRow[], after: DepthRow[]): string[] {
  const beforeByKey = new Map(before.map((r) => [`${r.team}||${r.player}`, r]));
  const warnings: string[] = [];
  for (const a of after) {
    const b = beforeByKey.get(`${a.team}||${a.player}`);
    if (!b || b.tier === a.tier) continue;
    if (a.override_games || a.override_mpg || b.override_games || b.override_mpg) {
      warnings.push(
        `${a.team} ${a.player}: tier ${b.tier} -> ${a.tier} by this pull, but still carries ` +
        `override_games=${a.override_games || "-"} override_mpg=${a.override_mpg || "-"} — looks like ` +
        `a local edit that was never pushed to Supabase. Verify in /admin/depth-chart, then ` +
        `"npm run depth-chart:sync -- --push" if the OLD tier (${b.tier}) was actually correct.`,
      );
    }
  }
  return warnings;
}

function main(): void {
  console.log("Phase 2: depth-chart / role-context / team-category bridging\n");

  const steps: StepResult[] = [];
  const depthBeforePull = readDepthRows();

  steps.push(runTsx("Pull published depth-chart tags", "scripts/sync-depth-chart.ts", ["--pull"]));
  steps.push(runTsx("Pull published role-context tags", "scripts/sync-role-context.ts", ["--pull"]));
  steps.push(runTsx("Pull published team-category tags", "scripts/sync-team-category.ts", ["--pull"]));

  const tierWarnings = checkTierReversions(depthBeforePull, readDepthRows());
  steps.push({
    label: "Safety check: pull reverted a tier with a surviving override",
    command: "(in-process CSV comparison, no external command)",
    ok: tierWarnings.length === 0,
    output: tierWarnings.length
      ? `${tierWarnings.length} row(s):\n${tierWarnings.map((w) => `  - ${w}`).join("\n")}`
      : "None — every tier change this pull made had no surviving override attached.",
  });

  steps.push(runPython("Reconcile role-context against roster", "models/projections-adjuster/prep_role_context.py"));
  steps.push(runPython("Reconcile depth-chart against roster", "models/projections-adjuster/prep_depth_chart.py"));
  steps.push(runTsx("Push corrected depth-chart keys to Supabase", "scripts/sync-depth-chart.ts", ["--push"]));
  steps.push(runTsx("Push corrected role-context keys to Supabase", "scripts/sync-role-context.ts", ["--push"]));
  steps.push(runTsx("Push corrected team-category keys to Supabase", "scripts/sync-team-category.ts", ["--push"]));
  steps.push(runPython("Flag role-context usage candidates (advisory)", "models/usage-redistribution/flag_role_changes.py", ["--emit-json"]));

  let anyFailed = false;
  for (const s of steps) {
    console.log(`\n— ${s.label} ${s.ok ? "" : "FAILED"} —`);
    console.log(s.output.trim());
    if (!s.ok) anyFailed = true;
  }

  const md = [
    "# Depth-chart pipeline review",
    "",
    `Generated ${new Date().toISOString()}`,
    "",
    ...steps.flatMap((s) => [
      `## ${s.label}${s.ok ? "" : " (FAILED)"}`,
      "",
      `\`${s.command}\``,
      "",
      "```",
      s.output.trim(),
      "```",
      "",
    ]),
  ].join("\n");

  if (!existsSync(dirname(REVIEW_PATH))) mkdirSync(dirname(REVIEW_PATH), { recursive: true });
  writeFileSync(REVIEW_PATH, md, "utf8");
  console.log(`\nReview file: ${REVIEW_PATH}`);

  if (anyFailed) {
    console.error("\nOne or more steps failed — review before trusting depth-chart/role-context/team-category state.");
    process.exit(1);
  }

  console.log(
    "\nNext: review the reconciliation report above (re-keyed / added / dropped) and the " +
    "role-flags candidates (src/data/role-flags-2026-27.json, already surfaced in " +
    "/admin/depth-chart), then set tiers/overrides by hand.",
  );
}

main();
