/**
 * The identity layer's self-check.
 *
 *   npm run identity:verify
 *
 * **READ-ONLY.** No database, no network, no writes. It runs in a second and is
 * meant to be cheap enough to run on every change that touches a name.
 *
 * ── What it guards ──────────────────────────────────────────────────────────
 * The layer's whole claim is "one normalizer, one alias list, one resolver".
 * That claim is only worth anything if something checks it, because the previous
 * arrangement — four normalizer copies and three alias maps held in parity by
 * comments saying "keep these in lockstep" — had already silently drifted in two
 * places by the time it was measured:
 *
 *   • src/lib/rookie-board.ts used `\b(jr|sr|ii|iii|iv)\b` where every other
 *     copy used `\s+(...)\b`.
 *   • models/rookie-translation/common.py's ROSTER_NAME_TO_HOOPR, documented in
 *     its own comment as a MIRROR that "must not drift", held 3 of the TS map's
 *     10 pairs.
 *
 * Neither was caught by a type, a test or a review. Both would be caught here.
 *
 * ── The five checks ─────────────────────────────────────────────────────────
 *   1. SNAPSHOT FRESH  — registry.json's alias map matches the authored one in
 *                        player-name-aliases.ts. Catches "edited the aliases,
 *                        forgot to re-run identity:build", which would leave
 *                        Python on the old list.
 *   2. PY/TS NORMALIZER PARITY — both implementations agree on every display
 *                        name in the registry, plus a set of adversarial cases.
 *                        Skipped with a warning if Python isn't on PATH; never
 *                        silently passed.
 *   3. NO ALIAS COLLISION — no alias pair has BOTH forms present as separate
 *                        identities. Such a pair would make a real name
 *                        ambiguous and start refusing joins that work today.
 *   4. PROVIDER ID UNIQUENESS — no provider id appears on two identities. That
 *                        is the "same human indexed twice" failure, and it is
 *                        how a stat line ends up split across two rows.
 *   5. INTERNAL CONSISTENCY — every record's norm_name is what the normalizer
 *                        actually returns for its display name. Catches a
 *                        hand-edited snapshot, which docs §5 forbids.
 */
import { execFileSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { playerIdentity, REGISTRY_GENERATED_AT } from "../src/lib/player-identity/bundled";
import { normalizePlayerName } from "../src/lib/player-identity/normalize";
import { NICKNAME_TO_LEGAL_NAME } from "../src/lib/player-name-aliases";

const REGISTRY_JSON = path.join(process.cwd(), "src", "lib", "player-identity", "registry.json");

const failures: string[] = [];
const warnings: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
    failures.push(label);
  }
}

/** Names chosen to exercise every branch of the rule, not to be representative. */
const ADVERSARIAL_NAMES = [
  "Nikola Jokić",
  "Luka Dončić",
  "Jaime Jaquez Jr.",
  "Ronald Holland II",
  "Gary Trent Jr.",
  "Kevin Porter Jr.",
  "P.J. Washington",
  "R.J. Barrett",
  "De'Aaron Fox",
  "D'Angelo Russell",
  "Karl-Anthony Towns",
  "Alperen Şengün",
  "Bogdan Bogdanović",
  "Nicolas Claxton",
  "  Trailing  Spaces  ",
  "Ivica Zubac IV",
  // The suffix rule must NOT fire on these: no preceding whitespace boundary in
  // the first two, and the third is a real surname that starts with a suffix
  // token once punctuation is gone.
  "Jrue Holiday",
  "Iverson Molinar",
  "Sr Nobody",
];

/** The two files allowed to contain the rule: the TS implementation and the
 *  Python one it is checked against. Plus this file, which names the pattern. */
const CANONICAL_NORMALIZERS = [
  path.join("src", "lib", "player-identity", "normalize.ts"),
  path.join("models", "player_identity.py"),
  path.join("scripts", "verify-player-identity.ts"),
];

const SEARCH_ROOTS = ["src", "scripts", "models"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__pycache__", "parquet", ".git"]);
const SUFFIX_STRIP = /\((?:jr\|sr\|ii\|iii\|iv)\)/;

async function findSuffixStripOutsideCanonical(): Promise<string[]> {
  const hits: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|py)$/.test(entry.name)) continue;
      const rel = path.relative(process.cwd(), full);
      if (CANONICAL_NORMALIZERS.includes(rel)) continue;
      const text = await fs.readFile(full, "utf8");
      if (SUFFIX_STRIP.test(text)) hits.push(rel);
    }
  }
  for (const root of SEARCH_ROOTS) await walk(path.join(process.cwd(), root));
  return hits;
}

/** Read one column out of a CSV. Returns null when the file isn't there. */
async function csvColumn(relPath: string, column: string | number): Promise<string[] | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(process.cwd(), relPath), "utf8");
  } catch {
    return null;
  }
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  // Deliberately naive: these columns are player names in the FIRST fields, none
  // of which are quoted in any of these files. A real CSV parser here would be
  // more machinery than the check is worth.
  const header = lines[0].split(",");
  const idx = typeof column === "number" ? column : header.indexOf(column);
  if (idx < 0) return [];
  return lines.slice(1).map((l) => l.split(",")[idx]?.trim()).filter(Boolean);
}

/**
 * Current-season name sources. A name here that doesn't resolve is a real gap —
 * some join downstream is about to return nothing for that player.
 */
const LIVE_NAME_SOURCES: { label: string; load: () => Promise<string[] | null> }[] = [
  { label: "nba-rosters/2026-27.csv", load: () => csvColumn("data/nba-rosters/2026-27.csv", "player") },
  { label: "nba-rosters/depth-chart-2026-27.csv", load: () => csvColumn("data/nba-rosters/depth-chart-2026-27.csv", "player") },
  { label: "nba-rosters/role-context-2026-27.csv", load: () => csvColumn("data/nba-rosters/role-context-2026-27.csv", "player") },
  { label: "nba-salaries/current.csv", load: () => csvColumn("data/nba-salaries/current.csv", 0) },
  {
    label: "dynasty-rankings.json",
    load: async () => {
      const raw = await fs.readFile(path.join(process.cwd(), "src", "lib", "dynasty-rankings.json"), "utf8");
      return (JSON.parse(raw) as { player: string }[]).map((p) => p.player);
    },
  },
];

async function main(): Promise<void> {
  const index = playerIdentity();
  console.log(`Registry snapshot: ${index.size} identities, generated ${REGISTRY_GENERATED_AT}\n`);

  // ── 1. snapshot freshness ─────────────────────────────────────────────────
  const raw = JSON.parse(await fs.readFile(REGISTRY_JSON, "utf8")) as {
    aliases: Record<string, string>;
  };
  const authored = JSON.stringify(NICKNAME_TO_LEGAL_NAME, Object.keys(NICKNAME_TO_LEGAL_NAME).sort());
  const snapshotted = JSON.stringify(raw.aliases, Object.keys(raw.aliases).sort());
  check(
    "snapshot carries the authored alias list",
    authored === snapshotted,
    "player-name-aliases.ts and registry.json disagree — run `npm run identity:build`.",
  );

  // ── 2. Python/TypeScript normalizer parity ────────────────────────────────
  const sample = [...ADVERSARIAL_NAMES, ...index.all().map((r) => r.displayName)];
  const tsResults = sample.map(normalizePlayerName);
  let pyResults: string[] | null = null;
  for (const exe of ["python", "python3", "py"]) {
    try {
      // Everything below goes through explicit UTF-8. The names being compared
      // are mostly diacritics (Jokić, Dončić, Şengün) and Python on Windows
      // defaults its stdio to the console codepage, so the naive version of this
      // reports every accented name as a mismatch — a check that cries wolf is a
      // check nobody runs. `ensure_ascii` puts the result back on the wire as
      // pure ASCII escapes so the return trip cannot mangle it either.
      const out = execFileSync(
        exe,
        [
          "-c",
          [
            "import json,sys",
            `sys.path.insert(0, ${JSON.stringify(path.join(process.cwd(), "models"))})`,
            "from player_identity import normalize_name",
            'names = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
            "out = json.dumps([normalize_name(n) for n in names], ensure_ascii=True)",
            'sys.stdout.buffer.write(out.encode("ascii"))',
          ].join("\n"),
        ],
        {
          input: Buffer.from(JSON.stringify(sample), "utf8"),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        },
      );
      pyResults = JSON.parse(out) as string[];
      break;
    } catch {
      // try the next interpreter name
    }
  }

  if (!pyResults) {
    warnings.push("Python not runnable — normalizer parity NOT checked. Install Python and re-run.");
    console.log("  ! normalizer parity SKIPPED (no python on PATH)");
  } else {
    const mismatches = sample
      .map((name, i) => ({ name, ts: tsResults[i], py: pyResults![i] }))
      .filter((m) => m.ts !== m.py);
    check(
      `normalizer parity across ${sample.length} names (TS vs Python)`,
      mismatches.length === 0,
      mismatches.slice(0, 5).map((m) => `"${m.name}" → ts "${m.ts}" / py "${m.py}"`).join("\n      "),
    );
  }

  // ── 3. alias collisions ───────────────────────────────────────────────────
  const normNames = new Set(index.all().map((r) => r.normName));
  const collisions = Object.entries(NICKNAME_TO_LEGAL_NAME)
    .filter(([nickname, legal]) => normNames.has(nickname) && normNames.has(legal))
    .map(([nickname, legal]) => `${nickname} ⇄ ${legal}`);
  check(
    "no alias pair has both forms in the registry",
    collisions.length === 0,
    `${collisions.join(", ")} — aliasing these makes a real name ambiguous.`,
  );

  // ── 4. provider id uniqueness ─────────────────────────────────────────────
  for (const field of ["espnId", "nbaStatsId", "bbmId", "fantraxId"] as const) {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const r of index.all()) {
      const v = r[field];
      if (!v) continue;
      const prev = seen.get(v);
      if (prev) dupes.push(`${field}=${v} on ${prev} and ${r.fheId}`);
      else seen.set(v, r.fheId);
    }
    check(`${field} is unique across identities (${seen.size} in use)`, dupes.length === 0, dupes.slice(0, 5).join("; "));
  }

  // ── 5. internal consistency ───────────────────────────────────────────────
  const badNorm = index.all()
    .filter((r) => r.normName !== normalizePlayerName(r.displayName))
    .map((r) => `${r.fheId} "${r.displayName}" stored as "${r.normName}"`);
  check(
    "every norm_name matches the normalizer's output",
    badNorm.length === 0,
    `${badNorm.slice(0, 5).join("; ")}${badNorm.length > 5 ? ` …and ${badNorm.length - 5} more` : ""}`,
  );

  // ── 6. no re-implemented normalizer ───────────────────────────────────────
  // The suffix-strip regex is the fingerprint of a hand-rolled copy: it is the
  // one line nothing else in the codebase has a reason to contain. Six copies
  // existed before this layer (four documented in the proposal, plus
  // dynasty-board.ts which already delegated, plus a verbatim duplicate inside
  // the rookie-board admin editor). Grepping for it is crude, and crude is the
  // point — it is the check most likely to still be working in a year.
  const reimplementations = await findSuffixStripOutsideCanonical();
  check(
    "the suffix-strip rule appears only in the two canonical implementations",
    reimplementations.length === 0,
    `${reimplementations.join("; ")} — import normalizePlayerName instead of re-declaring it.`,
  );

  // ── 7. every LIVE name source still resolves ──────────────────────────────
  // The recurring failure this layer exists for is not a bad id — it is a
  // refresh quietly introducing a new spelling. The July 2026 Angle merge found
  // four at once (Dereck Lively, Bub Carrington, Yang Hansen, Pelle Larsson); the
  // salary CSV had two more as recently as today (EJ Harkless, Jaden Quaintance).
  // Nothing catches those until a join silently returns nothing, so check the
  // sources directly: every name in a CURRENT-season file must resolve.
  //
  // Historical sources are deliberately NOT checked. models/'s
  // draft_model_data.csv spans the 2010-2025 draft classes and 282 of its 774
  // names are retired players the registry has no reason to carry — that is
  // scope, not drift.
  for (const src of LIVE_NAME_SOURCES) {
    const names = await src.load();
    if (names === null) {
      warnings.push(`${src.label} not found — skipped`);
      console.log(`  ! ${src.label} SKIPPED (file missing)`);
      continue;
    }
    const unresolved: string[] = [];
    const ambiguous: string[] = [];
    for (const raw of new Set(names.filter(Boolean))) {
      const candidates = index.candidatesByName(raw);
      if (candidates.length === 0) unresolved.push(raw);
      else if (candidates.length > 1) ambiguous.push(`${raw} (${candidates.length})`);
    }
    check(
      `${src.label}: every name resolves (${new Set(names.filter(Boolean)).size} distinct)`,
      unresolved.length === 0 && ambiguous.length === 0,
      [
        unresolved.length ? `unresolved: ${unresolved.slice(0, 8).join(", ")}` : "",
        ambiguous.length ? `AMBIGUOUS: ${ambiguous.slice(0, 8).join(", ")}` : "",
        "add the pair to src/lib/player-name-aliases.ts, then re-run `npm run identity:build`",
      ].filter(Boolean).join("\n      "),
    );
  }

  console.log("");
  for (const w of warnings) console.log(`!  ${w}`);
  if (failures.length) {
    console.error(`\n✗ ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("✓ identity layer consistent.");
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
