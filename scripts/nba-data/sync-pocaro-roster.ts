/**
 * Phase 1 of the roster-refresh automation: pull Pocaro's cap sheet (Google
 * Drive-hosted .xlsx, shared "anyone with the link can view") and turn it into
 * a reviewable diff against what's actually in the database today.
 *
 *   npm run pocaro:sync              # write the CSV + review file
 *   npm run pocaro:sync -- --dry-run # parse + diff + report only, no writes
 *
 * WHAT THIS SCRIPT DOES NOT DO. It never touches Supabase, and it is not a
 * replacement for `npm run nba:roster` — it only rewrites
 * data/nba-rosters/2026-27.csv, the same file a human would otherwise hand-edit
 * after reading the sheet. `npm run nba:roster` remains the one and only writer
 * of `nba_roster`, same single-writer-per-table discipline as the rest of this
 * pipeline. Run this, review the CSV diff + the review file, THEN run
 * `nba:roster --dry-run`, then the real ingest, same as any other roster CSV
 * change (see .claude/skills/salary-roster-pipeline).
 *
 * WHY THIS IS SAFE TO AUTOMATE WHEN HOOPSHYPE ISN'T. Pocaro's sheet is a
 * document the owner already has legitimate share access to (not a scraped
 * unwilling third party) — hoopshype.com's robots.txt explicitly disallows
 * Claude/AI crawlers by name, which is a real signal, not boilerplate, and
 * that pull stays a manual browser-console snippet. Pocaro's sheet has no such
 * signal and its "anyone with the link" sharing is exactly what makes
 * API-key-only (no OAuth, no service account) access work.
 *
 * THE DOCUMENT IS A REAL .xlsx, NOT A NATIVE GOOGLE SHEET. Confirmed 2026-09-01:
 * the Sheets API v4 refuses it ("must not be an Office file"); the Google
 * DRIVE API's raw `alt=media` download works instead, which is why this reads
 * with `exceljs` rather than parsing Sheets API JSON.
 *
 * IDENTITY, NOT NAME MATCHING. Pocaro's sheet carries no vendor id of its own
 * (pure name + bio), so every row is resolved through the same
 * `player-identity` registry roster_ingest.ts already uses
 * (`playerIdentity().resolve({ name, dob, draftYear, team })`), using the
 * sheet's own DOB/draft-year/team columns as disambiguators — never a bespoke
 * name matcher. `ambiguous`/`none` results go to the review file, never a
 * best-guess auto-match: see docs/player-identity-layer.md §3.4 for why a
 * confidently wrong id is worse than a visible gap. Diffing (team changes,
 * absences) is done against the live `nba_roster`/`nba_contracts` tables keyed
 * on `fhe_id`, not against the CSV file re-parsed from scratch or by name —
 * both tables already carry `fhe_id`, so this is a plain id comparison.
 *
 * Runs under tsx, outside Next; loads .env.local itself. Needs
 * GOOGLE_SHEETS_API_KEY (Drive API, restricted to Sheets + Drive) in addition
 * to the usual Supabase service-role vars — this script only READS Supabase
 * (nba_roster + nba_contracts, for the diff), it never writes to it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { loadEnv, getServiceClient } from "./client";
import { normalizeTeamAbbr, isNbaTeam } from "../../src/lib/nba-teams";
import { playerIdentity } from "../../src/lib/player-identity/bundled";
import type { IdentityRecord } from "../../src/lib/player-identity/registry";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEASON = "2026-27";
const CSV_PATH = resolve(REPO_ROOT, "data/nba-rosters/2026-27.csv");
const REVIEW_PATH = resolve(REPO_ROOT, "output/pocaro-roster-review.json");
const SHEET_NAME = "NBA";

// Pocaro's sheet doc id (from its share URL) — not a secret, same posture as
// the other hardcoded ids/urls in this pipeline (SEASON, boxScoreUrl, etc.).
const DOC_ID = "1r-rMo2XLsculCEntmZiT9RSJUctEmI2E";

const CSV_COLUMNS = [
  "season", "team", "player", "jersey", "pos", "height", "weight", "dob",
  "age", "yos", "draft", "nationality", "birthplace", "pre_draft",
  "prior_team", "contract", "fa_year", "salary_26_27",
];

const DRY_RUN = process.argv.includes("--dry-run");

// ── sheet parsing ────────────────────────────────────────────────────────────

interface SheetRow {
  team: string;
  player: string;
  jersey: string | null;
  pos: string | null;
  height: string | null;
  weight: string | null;
  dobIso: string | null;
  dobCsv: string | null;
  age: string | null;
  yos: string | null;
  draft: string | null;
  draftYear: number | null;
  nationality: string | null;
  birthplace: string | null;
  preDraft: string | null;
  priorTeam: string | null;
  contract: string | null;
  faYear: string | null;
  faYearBase: number | null;
  faYearOption: number;
  salary: string | null;
}

function cellText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("text" in obj) return String(obj.text).trim() || null;
    if ("result" in obj) return cellText(obj.result);
    // A formula cell with NO cached result at all — real, seen on players
    // traded/signed since the sheet's last recalculation (Bennedict Mathurin,
    // DeMar DeRozan). Blank, same as any other missing field — never
    // stringify the wrapper object into the CSV as "[object Object]".
    return null;
  }
  const s = String(v).trim();
  return s || null;
}

/** "6' 05\"" -> "6'5" — matches the CSV's existing height convention. */
function formatHeight(v: unknown): string | null {
  const s = cellText(v);
  if (!s) return null;
  const m = s.match(/^(\d+)'\s*0?(\d{1,2})"?$/);
  return m ? `${m[1]}'${m[2]}` : s;
}

/** "4 yr - $60.6M" -> "4 yr / $60.6M"; specials (Two-Way, Exhibit 10) pass through. */
function formatContract(v: unknown): string | null {
  const s = cellText(v);
  return s ? s.replace(/\s*-\s*(?=\$)/, " / ") : null;
}

/**
 * Excel serial date -> ISO (for identity resolution) and MM/DD/YY (for the
 * CSV). Every player row on this tab is a VLOOKUP formula, not a raw value —
 * ExcelJS gives back `{formula, result}`, and the DOB result is itself an ISO
 * datetime STRING ("1998-09-02T00:00:00.000Z"), never a `Date` instance.
 */
function formatDob(v: unknown): { iso: string | null; csv: string | null } {
  let inner: unknown = v;
  if (inner && typeof inner === "object" && "result" in (inner as Record<string, unknown>)) {
    inner = (inner as { result: unknown }).result;
  }
  let d: Date | null = null;
  if (inner instanceof Date) d = inner;
  else if (typeof inner === "string") {
    const parsed = new Date(inner);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return { iso: null, csv: null };
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return { iso: `${yyyy}-${mm}-${dd}`, csv: `${mm}/${dd}/${String(yyyy).slice(-2)}` };
}

/** Unwrap a formula cell's `{formula, result}` to its result, plain values passthrough. */
function cellValue(v: unknown): unknown {
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
    return (v as { result: unknown }).result;
  }
  return v;
}

/** "2028 +2" -> {base:2028, option:2}; "2029" -> {base:2029, option:0}; number passthrough. */
function parseFaYear(v: unknown): { text: string | null; base: number | null; option: number } {
  const s = cellText(v);
  if (!s) return { text: null, base: null, option: 0 };
  const m = s.match(/^(\d{4})(?:\s*\+\s*(\d+))?$/);
  if (!m) return { text: s, base: null, option: 0 };
  return { text: s, base: Number(m[1]), option: m[2] ? Number(m[2]) : 0 };
}

/** "2021-20" -> 2021; "2026-ND" -> 2026. */
function draftYearOf(v: unknown): number | null {
  const s = cellText(v);
  const m = s?.match(/^(\d{4})-/);
  return m ? Number(m[1]) : null;
}

function isBlankRow(row: ExcelJS.Row): boolean {
  for (let c = 1; c <= 16; c++) {
    if (cellText(row.getCell(c).value)) return false;
  }
  return true;
}

async function fetchWorkbook(): Promise<ExcelJS.Workbook> {
  const key = process.env.GOOGLE_SHEETS_API_KEY;
  if (!key) throw new Error("Missing env: set GOOGLE_SHEETS_API_KEY in .env.local.");
  const url = `https://www.googleapis.com/drive/v3/files/${DOC_ID}?alt=media&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Drive API fetch failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  // exceljs's bundled types predate @types/node's generic Buffer<TArrayBuffer> —
  // structurally identical at runtime, just a typings-version mismatch.
  // @ts-expect-error — see comment above
  await wb.xlsx.load(buf);
  return wb;
}

function parseSheet(wb: ExcelJS.Workbook): SheetRow[] {
  const ws = wb.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found in workbook (sheets: ${wb.worksheets.map((s) => s.name).join(", ")})`);

  const rows: SheetRow[] = [];
  let currentTeam: string | null = null;

  ws.eachRow((row) => {
    if (isBlankRow(row)) return;
    const colA = cellText(row.getCell(1).value);
    if (!colA) return;

    if (colA === "PLAYER") return; // repeated column-header row

    // Team-block header: a single MERGED cell spanning A:P, so ExcelJS reports
    // the same text in every column of the row (not "the rest is blank" — the
    // merge fills every cell, confirmed via a real-data probe 2026-09-01).
    const colB = cellText(row.getCell(2).value);
    if (colB === colA) {
      const abbr = normalizeTeamAbbr(colA);
      if (abbr && isNbaTeam(abbr)) {
        currentTeam = abbr;
        return;
      }
      // Merged row whose text isn't a recognized team — skip, don't guess.
      return;
    }

    if (!currentTeam) return; // stray row before any team header — skip defensively

    const dob = formatDob(row.getCell(6).value);
    const fa = parseFaYear(row.getCell(15).value);
    rows.push({
      team: currentTeam,
      player: colA,
      jersey: cellText(row.getCell(2).value),
      pos: cellText(row.getCell(3).value),
      height: formatHeight(row.getCell(4).value),
      weight: cellText(row.getCell(5).value),
      dobIso: dob.iso,
      dobCsv: dob.csv,
      age: (() => {
        const raw = cellValue(row.getCell(7).value);
        return typeof raw === "number" ? raw.toFixed(2) : cellText(raw);
      })(),
      yos: cellText(row.getCell(8).value),
      draft: cellText(row.getCell(9).value),
      draftYear: draftYearOf(row.getCell(9).value),
      nationality: cellText(row.getCell(10).value),
      birthplace: cellText(row.getCell(11).value),
      preDraft: cellText(row.getCell(12).value),
      priorTeam: cellText(row.getCell(13).value),
      contract: formatContract(row.getCell(14).value),
      faYear: fa.text,
      faYearBase: fa.base,
      faYearOption: fa.option,
      salary: cellText(row.getCell(16).value),
    });
  });

  return rows;
}

// ── identity resolution ──────────────────────────────────────────────────────

interface Resolved { row: SheetRow; identity: IdentityRecord; }
interface Unresolved { row: SheetRow; reason: "ambiguous" | "none"; candidates: { fheId: string; displayName: string }[]; }

function resolveSheetRows(rows: SheetRow[]): { resolved: Resolved[]; unresolved: Unresolved[] } {
  const identity = playerIdentity();
  const resolved: Resolved[] = [];
  const unresolved: Unresolved[] = [];
  for (const row of rows) {
    const res = identity.resolve({ name: row.player, dob: row.dobIso, draftYear: row.draftYear, team: row.team });
    if (res.kind === "matched") {
      resolved.push({ row, identity: res.identity });
    } else if (res.kind === "ambiguous") {
      unresolved.push({ row, reason: "ambiguous", candidates: res.candidates.map((c) => ({ fheId: c.fheId, displayName: c.displayName })) });
    } else {
      unresolved.push({ row, reason: "none", candidates: [] });
    }
  }
  return { resolved, unresolved };
}

// ── contract-consistency check (see salary-roster-pipeline skill) ──────────

function checkContractConsistency(row: SheetRow): { position: number | null; flagged: boolean } {
  const m = (row.contract ?? "").match(/^(\d+)\s*yr/i);
  if (!m || row.faYearBase == null) return { position: null, flagged: false };
  const totalYears = Number(m[1]);
  const boundaryOffsetYear = Number(SEASON.slice(0, 4)) + 1; // 2027 for the 2026-27 season
  const position = totalYears - (row.faYearBase + row.faYearOption - boundaryOffsetYear);
  return { position, flagged: position < 0 };
}

// ── diff against the live DB (fhe_id-keyed, never name-keyed) ──────────────

interface RosterSnapshotRow { fhe_id: string; team: string; contract_raw: string | null; fa_year: number | null; full_name: string; }

async function loadRosterSnapshot(): Promise<Map<string, RosterSnapshotRow>> {
  const { data, error } = await getServiceClient()
    .from("nba_roster")
    .select("fhe_id,team,contract_raw,fa_year,full_name")
    .eq("season", SEASON)
    .not("fhe_id", "is", null);
  if (error) throw error;
  const map = new Map<string, RosterSnapshotRow>();
  for (const r of (data ?? []) as RosterSnapshotRow[]) map.set(r.fhe_id, r);
  return map;
}

async function loadContractsFheIds(): Promise<Set<string>> {
  const { data, error } = await getServiceClient()
    .from("nba_contracts")
    .select("fhe_id")
    .not("fhe_id", "is", null);
  if (error) throw error;
  return new Set((data ?? []).map((r: { fhe_id: string }) => r.fhe_id));
}

interface TeamChange { fheId: string; name: string; oldTeam: string; newTeam: string; }
interface ContractFlag { fheId: string; name: string; contract: string | null; faYear: string | null; position: number | null; }
interface Absence { fheId: string; name: string; team: string; doubleAbsent: boolean; }

function diffAgainstDb(
  resolved: Resolved[],
  rosterSnapshot: Map<string, RosterSnapshotRow>,
  contractsFheIds: Set<string>,
): { teamChanges: TeamChange[]; contractFlags: ContractFlag[]; absences: Absence[]; newToSheet: { fheId: string; name: string; team: string }[] } {
  const resolvedByFhe = new Map(resolved.map((r) => [r.identity.fheId, r]));

  const teamChanges: TeamChange[] = [];
  const contractFlags: ContractFlag[] = [];
  const absences: Absence[] = [];
  const newToSheet: { fheId: string; name: string; team: string }[] = [];

  for (const [fheId, dbRow] of rosterSnapshot) {
    const sheetMatch = resolvedByFhe.get(fheId);
    if (!sheetMatch) {
      absences.push({ fheId, name: dbRow.full_name, team: dbRow.team, doubleAbsent: !contractsFheIds.has(fheId) });
      continue;
    }
    if (sheetMatch.row.team !== dbRow.team) {
      teamChanges.push({ fheId, name: sheetMatch.row.player, oldTeam: dbRow.team, newTeam: sheetMatch.row.team });
    }
  }

  for (const r of resolved) {
    if (!rosterSnapshot.has(r.identity.fheId)) {
      newToSheet.push({ fheId: r.identity.fheId, name: r.row.player, team: r.row.team });
    }
    const { position, flagged } = checkContractConsistency(r.row);
    if (flagged) {
      contractFlags.push({ fheId: r.identity.fheId, name: r.row.player, contract: r.row.contract, faYear: r.row.faYear, position });
    }
  }

  return { teamChanges, contractFlags, absences, newToSheet };
}

// ── CSV merge (writes only this file, never Supabase) ──────────────────────

type CsvRow = Record<string, string>;
const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function readExistingCsv(): CsvRow[] {
  return parse(readFileSync(CSV_PATH, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
}

function writeCsv(rows: CsvRow[]): void {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvField(r[c] ?? "")).join(","));
  writeFileSync(CSV_PATH, lines.join("\r\n") + "\r\n", "utf8");
}

/** MM/DD/YY -> ISO, same century pivot as roster_ingest.ts's parseDob. */
function csvDobToIso(v: string | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = Number(yy) >= 50 ? `19${yy}` : `20${yy}`;
  return `${year}-${mm}-${dd}`;
}

function sheetRowToCsvFields(row: SheetRow): Partial<CsvRow> {
  return {
    season: SEASON,
    team: row.team,
    player: row.player,
    jersey: row.jersey ?? "",
    pos: row.pos ?? "",
    height: row.height ?? "",
    weight: row.weight ?? "",
    dob: row.dobCsv ?? "",
    age: row.age ?? "",
    yos: row.yos ?? "",
    draft: row.draft ?? "",
    nationality: row.nationality ?? "",
    birthplace: row.birthplace ?? "",
    pre_draft: row.preDraft ?? "",
    prior_team: row.priorTeam ?? "",
    contract: row.contract ?? "",
    fa_year: row.faYear ?? "",
    salary_26_27: row.salary ?? "",
  };
}

function mergeIntoCsv(resolved: Resolved[]): { updated: number; appended: number; csvUnresolved: number } {
  const identity = playerIdentity();
  const existing = readExistingCsv();

  const existingByFhe = new Map<string, CsvRow>();
  let csvUnresolved = 0;
  for (const row of existing) {
    const res = identity.resolve({
      name: row.player,
      dob: csvDobToIso(row.dob),
      draftYear: draftYearOf(row.draft),
      team: row.team,
    });
    if (res.kind === "matched") existingByFhe.set(res.identity.fheId, row);
    else csvUnresolved += 1;
  }

  let updated = 0;
  let appended = 0;
  const out: CsvRow[] = [...existing];
  for (const r of resolved) {
    const fields = sheetRowToCsvFields(r.row);
    const existingRow = existingByFhe.get(r.identity.fheId);
    if (existingRow) {
      Object.assign(existingRow, fields);
      updated += 1;
    } else {
      out.push(fields as CsvRow);
      appended += 1;
    }
  }

  writeCsv(out);
  return { updated, appended, csvUnresolved };
}

// ── main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv();
  console.log(`Fetching Pocaro's sheet (doc ${DOC_ID})...`);
  const wb = await fetchWorkbook();
  const sheetRows = parseSheet(wb);
  console.log(`Parsed ${sheetRows.length} player rows across the NBA tab.`);

  const { resolved, unresolved } = resolveSheetRows(sheetRows);
  console.log(`Resolved ${resolved.length} via player_identity; ${unresolved.length} need review (ambiguous/none).`);

  const [rosterSnapshot, contractsFheIds] = await Promise.all([loadRosterSnapshot(), loadContractsFheIds()]);
  const { teamChanges, contractFlags, absences, newToSheet } = diffAgainstDb(resolved, rosterSnapshot, contractsFheIds);

  const doubleAbsences = absences.filter((a) => a.doubleAbsent);
  const singleAbsences = absences.filter((a) => !a.doubleAbsent);

  console.log(`\n— Team changes: ${teamChanges.length} (Stage-C depth-chart/role-context worklist)`);
  for (const t of teamChanges) console.log(`    ${t.name}: ${t.oldTeam} -> ${t.newTeam}`);
  console.log(`— Contract-consistency flags: ${contractFlags.length} (negative position_in_contract — needs a human check)`);
  for (const c of contractFlags) console.log(`    ${c.name}: contract="${c.contract}" faYear="${c.faYear}" position=${c.position}`);
  console.log(`— Double-absent (missing from sheet AND nba_contracts): ${doubleAbsences.length}`);
  for (const a of doubleAbsences) console.log(`    ${a.name} (${a.team})`);
  console.log(`— Single-source absent (missing from sheet only — likely a pull gap): ${singleAbsences.length}`);
  console.log(`— New to sheet, not yet in nba_roster: ${newToSheet.length}`);
  console.log(`— Unresolved sheet rows: ${unresolved.length}`);
  for (const u of unresolved) console.log(`    ${u.row.player} (${u.row.team}): ${u.reason}${u.candidates.length ? ` — ${u.candidates.length} candidates` : ""}`);

  const review = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    sheetRowCount: sheetRows.length,
    resolvedCount: resolved.length,
    teamChanges,
    contractFlags,
    doubleAbsences,
    singleAbsences,
    newToSheet,
    unresolved: unresolved.map((u) => ({
      player: u.row.player, team: u.row.team, reason: u.reason, candidates: u.candidates,
    })),
  };

  if (DRY_RUN) {
    console.log("\nDry run: no files written.");
    return;
  }

  const { updated, appended, csvUnresolved } = mergeIntoCsv(resolved);
  console.log(`\nCSV: ${updated} row(s) updated, ${appended} row(s) appended. (${csvUnresolved} existing CSV row(s) didn't resolve — pre-existing identity gap, not caused by this run.)`);

  if (!existsSync(dirname(REVIEW_PATH))) mkdirSync(dirname(REVIEW_PATH), { recursive: true });
  writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n", "utf8");
  console.log(`Review file: ${REVIEW_PATH}`);
  console.log(`\nNext: review the CSV diff + review file, then run "npm run nba:salary -- --dry-run" and "npm run nba:roster -- --dry-run".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
