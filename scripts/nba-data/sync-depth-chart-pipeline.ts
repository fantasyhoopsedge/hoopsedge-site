/**
 * Phase 2 of the roster-refresh automation: after Phase 1 refreshes the
 * roster CSV, bring depth-chart / role-context / team-category back in step
 * with it and surface what a human needs to review. Pure mechanical
 * bridging of already-built tooling — never writes to Supabase, and never
 * sets a tier, GP/MPG override, or role tag itself.
 *
 *   npm run depth-chart:pipeline
 *
 * WHAT THIS AUTOMATES — no new judgment introduced, all six steps already
 * existed as standalone tools this just runs in the right order:
 *   1. Pull the latest published depth-chart/role-context/team-category tags
 *      from Supabase into their CSVs (each *:sync --pull).
 *   2. Run prep_role_context.py and prep_depth_chart.py, which reconcile
 *      those CSVs against the just-refreshed roster CSV — re-key a traded
 *      player, clear his now-stale minutes override (a GP/MPG override is a
 *      claim on ONE team's total, never portable across a trade), add a new
 *      rostered player at a seeded tier, drop someone off the roster
 *      entirely. Both already fixed real incidents (Spencer Jones's minutes
 *      ghost-riding into Denver's allocation, Koloko/Bufkin blocking NOR's
 *      whole publish) — this script's only job is to actually run them after
 *      every roster refresh instead of relying on someone remembering to.
 *   3. Push the reconciled CSVs back to Supabase (each *:sync --push), so the
 *      admin-owned doc tables carry the CORRECTED team keys too — otherwise
 *      every future pull re-introduces the pre-correction key and the same
 *      re-key dance repeats forever. Confirmed for real 2026-09-03: a
 *      "PJ Washington" (Supabase's stale key) vs "P.J. Washington" (roster's
 *      canonical spelling) mismatch briefly created a duplicate key, tripped
 *      the reconciler's strict-uniqueness refusal, and dropped a real
 *      admin-set override instead of guessing which row it belonged to —
 *      the safe failure, but still a loss. Push closes that loop. It's a
 *      real Supabase write, but only to depth_chart_docs/role_context_docs/
 *      team_category_docs (admin-UI-owned publish state) — never
 *      nba_roster/nba_contracts.
 *   4. Run flag_role_changes.py --emit-json, the vacancy-scaled usage-change
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
 * Reads/writes local CSVs, one bundled JSON, and Supabase's depth-chart/
 * role-context/team-category PUBLISHED docs (pull AND push) — never
 * nba_roster/nba_contracts. Runs under tsx, outside Next; the Python steps
 * use the repo's `python` (models/requirements.txt — pandas/numpy already
 * required).
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REVIEW_PATH = resolve(REPO_ROOT, "output/depth-chart-pipeline-review.md");

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

function main(): void {
  console.log("Phase 2: depth-chart / role-context / team-category bridging (no Supabase writes)\n");

  const steps: StepResult[] = [
    runTsx("Pull published depth-chart tags", "scripts/sync-depth-chart.ts", ["--pull"]),
    runTsx("Pull published role-context tags", "scripts/sync-role-context.ts", ["--pull"]),
    runTsx("Pull published team-category tags", "scripts/sync-team-category.ts", ["--pull"]),
    runPython("Reconcile role-context against roster", "models/projections-adjuster/prep_role_context.py"),
    runPython("Reconcile depth-chart against roster", "models/projections-adjuster/prep_depth_chart.py"),
    runTsx("Push corrected depth-chart keys to Supabase", "scripts/sync-depth-chart.ts", ["--push"]),
    runTsx("Push corrected role-context keys to Supabase", "scripts/sync-role-context.ts", ["--push"]),
    runTsx("Push corrected team-category keys to Supabase", "scripts/sync-team-category.ts", ["--push"]),
    runPython("Flag role-context usage candidates (advisory)", "models/usage-redistribution/flag_role_changes.py", ["--emit-json"]),
  ];

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
