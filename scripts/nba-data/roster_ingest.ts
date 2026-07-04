/**
 * Roster ingest — reads the HUMAN-COMMITTED roster file
 * (data/nba-rosters/<season>.csv, transcribed from the owner's gated cap sheet)
 * and upserts one enriched row per player into public.nba_roster.
 *
 * Salary resolution (per the owner's rule):
 *   - public.nba_contracts (fed from data/nba-salaries/current.csv) is the
 *     AUTHORITATIVE real-salary source and always wins.
 *       current.csv salary_y2 = 2026-27, salary_y3 = 2027-28, salary_y4 = 2028-29.
 *   - Where it has a GAP (player absent, or a year past y4 such as 2029-30), the
 *     value is an EVEN SPLIT of the contract total over its length, starting at
 *     yr1 = the roster season (2026-27). e.g. "2 yr / $20M" -> $10M, $10M.
 *   - yr1 also falls back to the sheet's explicit 26-27 SALARY column before
 *     resorting to an even split.
 *   Estimated years are flagged in salary_estimated / salary_estimated_years so
 *     they are never mistaken for real cap figures.
 *
 * No salary website is ever fetched. The only network touched is Supabase.
 *
 * Usage:
 *   npx tsx scripts/nba-data/roster_ingest.ts                 # all teams in the file
 *   npx tsx scripts/nba-data/roster_ingest.ts --dry-run       # no writes, report
 *   npx tsx scripts/nba-data/roster_ingest.ts --season 2026-27
 *   npx tsx scripts/nba-data/roster_ingest.ts --team BOS      # one team
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { getServiceClient, normalizeName } from "./client";
import type { SupabaseClient } from "@supabase/supabase-js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SALARY_CSV = resolve(REPO_ROOT, "data/nba-salaries/current.csv");
const UPSERT_CHUNK = 500;

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// Abbrev -> full name, for detecting an NBA-team change in prior_team. Colleges
// / overseas clubs won't be in this set, so rookies don't count as "new".
const TEAM_FULL: Record<string, string> = {
  ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets",
  CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons",
  GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "Los Angeles Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies",
  MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder",
  ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs",
  TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards",
};
const NBA_FULL_NAMES = new Set(Object.values(TEAM_FULL));

// ── parsers ───────────────────────────────────────────────────────────────────
function parseMoney(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/[$,\s]/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function parseInt0(v: string | undefined): number | null {
  const n = Number((v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** '2021-20' -> {year,pick}, '2026-ND' -> {year, undrafted} */
function parseDraft(v: string): { year: number | null; pick: number | null; undrafted: boolean } {
  const m = (v ?? "").trim().match(/^(\d{4})-(\d{1,2}|ND)$/i);
  if (!m) return { year: null, pick: null, undrafted: false };
  const year = Number(m[1]);
  if (/ND/i.test(m[2])) return { year, pick: null, undrafted: true };
  return { year, pick: Number(m[2]), undrafted: false };
}
/** '4 yr / $60.6M' -> {years:4, total:60600000}; specials -> {status} */
function parseContract(v: string): { years: number | null; total: number | null; status: string | null } {
  const s = (v ?? "").trim();
  if (!s) return { years: null, total: null, status: null };
  if (/two[- ]?way/i.test(s)) return { years: null, total: null, status: "Two-Way" };
  if (/exhibit\s*10/i.test(s)) return { years: null, total: null, status: "Exhibit 10" };
  if (/\bRFA\b/i.test(s)) return { years: null, total: null, status: "RFA" };
  if (/\bUFA\b/i.test(s)) return { years: null, total: null, status: "UFA" };
  const m = s.match(/(\d+)\s*yr\s*\/\s*\$([\d.]+)\s*M/i);
  if (m) return { years: Number(m[1]), total: Math.round(parseFloat(m[2]) * 1_000_000), status: null };
  return { years: null, total: null, status: null };
}
/** '2028 +2' -> {year:2028, options:2}; '2029' -> {year:2029, options:0} */
function parseFaYear(v: string): { year: number | null; options: number } {
  const s = (v ?? "").trim();
  if (!s) return { year: null, options: 0 };
  const m = s.match(/(\d{4})(?:\s*\+\s*(\d+))?/);
  if (!m) return { year: null, options: 0 };
  return { year: Number(m[1]), options: m[2] ? Number(m[2]) : 0 };
}
function parseDob(v: string): string | null {
  const m = (v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}
/** '2026-27' -> 2026 */
function seasonStart(season: string): number {
  return Number((season ?? "").slice(0, 4));
}
/** yr index (0-based) within a season -> label like '2027-28' */
function yearLabel(season: string, i: number): string {
  const y = seasonStart(season) + i;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

// ── real-salary index from current.csv (authoritative) ──────────────────────────
type RealSalary = { y2: number | null; y3: number | null; y4: number | null }; // 26-27, 27-28, 28-29
function loadRealSalaries(): Map<string, RealSalary> {
  const index = new Map<string, RealSalary>();
  if (!existsSync(SALARY_CSV)) return index;
  const rows: Record<string, string>[] = parse(readFileSync(SALARY_CSV, "utf8"), {
    columns: true, skip_empty_lines: true, relax_quotes: true, trim: true,
  });
  for (const r of rows) {
    const name = r.player ?? r.Player ?? r.name;
    if (!name) continue;
    index.set(normalizeName(name), {
      y2: parseMoney(r.salary_y2),
      y3: parseMoney(r.salary_y3),
      y4: parseMoney(r.salary_y4),
    });
  }
  return index;
}

// ── status derivation ──────────────────────────────────────────────────────────
function deriveStatus(
  special: string | null,
  draftYear: number | null,
  draftPick: number | null,
  yos: string,
  contractYears: number | null,
  undrafted: boolean,
): string {
  if (special) return special; // Two-Way | Exhibit 10 | RFA | UFA
  if (contractYears == null) {
    // No contract $: an incoming/just-drafted player is a Draftee; a veteran
    // with no listed deal is an unsigned free agent, not a draftee.
    const rookieEntry = yos.toUpperCase() === "R" || (draftYear != null && draftYear >= 2026);
    return rookieEntry ? "Draftee" : "UFA";
  }
  const yosNum = /^\d+$/.test(yos) ? Number(yos) : 0; // 'R' -> 0
  const firstRound = draftPick != null && draftPick <= 30;
  // Heuristic: a 1st-round pick still inside the 4-year rookie-scale window.
  if (firstRound && yosNum <= 3 && (contractYears ?? 0) >= 3) return "Rookie Scale";
  return "Standard";
}

type RosterRow = {
  season: string; team: string; player_id: string | null; norm_name: string; full_name: string;
  jersey: string | null; position: string | null; height: string | null; weight: number | null;
  dob: string | null; age_at_ingest: number | null; years_of_service: string | null;
  draft_raw: string | null; draft_year: number | null; draft_pick: number | null; is_undrafted: boolean;
  nationality: string | null; birthplace: string | null; pre_draft: string | null; prior_team: string | null;
  contract_raw: string | null; contract_years: number | null; contract_total: number | null;
  contract_status: string; fa_year: number | null; fa_option_years: number;
  salary_yr1: number | null; salary_yr2: number | null; salary_yr3: number | null; salary_yr4: number | null;
  salary_estimated: boolean; salary_estimated_years: string | null; salary_source: string | null;
  is_incoming_rookie: boolean; is_sophomore: boolean; new_to_team: boolean;
  source: string; updated_at: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadPlayerIndex(supabase: SupabaseClient) {
  const index = new Map<string, { id: string; team: string | null }[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("nba_players").select("id,norm_name,team").range(from, from + PAGE - 1);
    if (error) throw new Error(`load nba_players: ${error.message}`);
    if (!data?.length) break;
    for (const p of data) {
      const a = index.get(p.norm_name) ?? [];
      a.push({ id: p.id, team: p.team });
      index.set(p.norm_name, a);
    }
    if (data.length < PAGE) break;
  }
  return index;
}
// Cap-sheet uses friendly names; nba_players (ESPN) uses formal names. Map the
// friendly norm -> formal norm so they link without changing the display name.
// (normalizeName already strips Jr/Sr/II/III suffixes, so no suffix here.)
const NAME_ALIASES: Record<string, string> = {
  "cam johnson": "cameron johnson",
  "herb jones": "herbert jones",
  "ron holland": "ronald holland",
};

function matchPlayer(
  index: Map<string, { id: string; team: string | null }[]>, norm: string, team: string,
): string | null {
  const c = index.get(norm) ?? (NAME_ALIASES[norm] ? index.get(NAME_ALIASES[norm]) : undefined);
  if (!c?.length) return null;
  if (c.length === 1) return c[0].id;
  const byTeam = c.find((x) => x.team && x.team.toUpperCase() === team.toUpperCase());
  return byTeam ? byTeam.id : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const season = arg("--season") ?? "2026-27";
  const onlyTeam = arg("--team")?.toUpperCase();
  const ROSTER_CSV = resolve(REPO_ROOT, `data/nba-rosters/${season}.csv`);
  if (!existsSync(ROSTER_CSV)) {
    console.error(`No roster file at ${ROSTER_CSV}.`);
    process.exit(1);
  }

  const rows: Record<string, string>[] = parse(readFileSync(ROSTER_CSV, "utf8"), {
    columns: true, skip_empty_lines: true, relax_quotes: true, trim: true,
  });
  const real = loadRealSalaries();
  const now = new Date().toISOString();
  const supabase = getServiceClient();
  const playerIndex = await loadPlayerIndex(supabase);

  const out: RosterRow[] = [];
  for (const r of rows) {
    if (onlyTeam && (r.team ?? "").toUpperCase() !== onlyTeam) continue;
    const name = (r.player ?? "").trim();
    if (!name) continue;
    const norm = normalizeName(name);
    const team = (r.team ?? "").trim().toUpperCase();
    const yos = (r.yos ?? "").trim();
    const draft = parseDraft(r.draft ?? "");
    const contract = parseContract(r.contract ?? "");
    const fa = parseFaYear(r.fa_year ?? "");
    const screenshot2627 = parseMoney(r.salary_26_27);

    // ── resolve 4-year salary ──────────────────────────────────────────────────
    // The cap-sheet's explicit 2026-27 figure is the freshest truth (yr1). We only
    // trust current.csv's OUT-years when it genuinely tracks the deal (it has
    // 27-28/28-29 values) AND the sheet's 26-27 doesn't contradict current.csv's —
    // an unchanged mid-contract player. Otherwise the player signed a new deal
    // (sheet disagrees, or current.csv has no out-years for a 2+yr contract), so we
    // STEP the contract years (arithmetic series, up or down) to sum to the total
    // and flag it an estimate. A future current.csv drop confirms estimates to
    // actuals. Note: current.csv may list a player but leave 26-27 blank, so we key
    // off actual values (csvY2 / out-years), not mere row presence.
    const rs = real.get(norm);
    const realByYr: (number | null)[] = [rs?.y2 ?? null, rs?.y3 ?? null, rs?.y4 ?? null, null]; // yr1..yr4 (29-30 absent in csv)
    const csvY2 = realByYr[0]; // current.csv's 2026-27 figure (may be null even if the row exists)
    const csvHasOutYears = realByYr[1] != null || realByYr[2] != null; // current.csv tracks 27-28 / 28-29
    const yr1 = screenshot2627 ?? csvY2; // rule 1: the sheet's 26-27 wins; fall back to current.csv
    const yr: (number | null)[] = [null, null, null, null];
    const estimatedYears: string[] = [];
    let salary_source: string | null = null;

    // Trust current.csv's out-years ONLY for an unchanged mid-contract player:
    // current.csv actually HAS out-years AND the sheet's 26-27 doesn't contradict
    // current.csv's 26-27 (i.e. no new deal changed the money). Otherwise we step.
    const contradicts = screenshot2627 != null && csvY2 != null && screenshot2627 !== csvY2;
    const trustCsvOutYears = csvHasOutYears && !contradicts;

    if (trustCsvOutYears) {
      for (let i = 0; i < 4; i++) yr[i] = realByYr[i];
      if (yr[0] == null) yr[0] = yr1;
      salary_source = "current.csv";
    } else if (yr1 != null && (contract.years ?? 0) >= 2 && contract.total != null) {
      // New deal (or current.csv lacks out-years) → step from yr1 across the full
      // contract length. rule 2: arithmetic series summing to the contract total;
      // step = 2*(total - N*yr1) / (N*(N-1)); +ve steps up, -ve steps down. The
      // final year absorbs rounding so the years sum EXACTLY to the total.
      const N = Math.min(contract.years!, 4);
      yr[0] = yr1;
      const step = Math.round((contract.total - N * yr1) / ((N * (N - 1)) / 2));
      let acc = yr1;
      for (let i = 1; i < N; i++) {
        yr[i] = i < N - 1 ? yr1 + i * step : contract.total - acc;
        acc += yr[i]!;
        estimatedYears.push(yearLabel(season, i));
      }
      salary_source = "estimate_step";
    } else if (yr1 != null) {
      // 1-yr deal, missing total, or nothing to step → record yr1 only.
      yr[0] = yr1;
      salary_source = rs != null ? "current.csv" : "sheet";
    }
    const usedEst = estimatedYears.length > 0;

    const draftYearNum = draft.year;
    const yosNum = /^\d+$/.test(yos) ? Number(yos) : null;
    const priorTeam = (r.prior_team ?? "").trim() || null;

    out.push({
      season, team, player_id: matchPlayer(playerIndex, norm, team), norm_name: norm, full_name: name,
      jersey: (r.jersey ?? "").trim() || null,
      position: (r.pos ?? "").trim() || null,
      height: (r.height ?? "").trim() || null,
      weight: parseInt0(r.weight),
      dob: parseDob(r.dob ?? ""),
      age_at_ingest: r.age ? Number(r.age) : null,
      years_of_service: yos || null,
      draft_raw: (r.draft ?? "").trim() || null,
      draft_year: draftYearNum, draft_pick: draft.pick, is_undrafted: draft.undrafted,
      nationality: (r.nationality ?? "").trim() || null,
      birthplace: (r.birthplace ?? "").trim() || null,
      pre_draft: (r.pre_draft ?? "").trim() || null,
      prior_team: priorTeam,
      contract_raw: (r.contract ?? "").trim() || null,
      contract_years: contract.years, contract_total: contract.total,
      contract_status: deriveStatus(contract.status, draftYearNum, draft.pick, yos, contract.years, draft.undrafted),
      fa_year: fa.year, fa_option_years: fa.options,
      salary_yr1: yr[0], salary_yr2: yr[1], salary_yr3: yr[2], salary_yr4: yr[3],
      salary_estimated: usedEst, salary_estimated_years: estimatedYears.join(", ") || null, salary_source,
      is_incoming_rookie: draftYearNum === 2026 && yos.toUpperCase() === "R",
      is_sophomore: draftYearNum === 2025 && (yosNum === 1 || yos.toUpperCase() === "R"),
      new_to_team: priorTeam != null && NBA_FULL_NAMES.has(priorTeam) && priorTeam !== TEAM_FULL[team],
      source: "cap_sheet_screenshot", updated_at: now,
    });
  }

  const unmatched = out.filter((r) => !r.player_id);
  if (!dryRun) {
    for (const c of chunk(out, UPSERT_CHUNK)) {
      const { error } = await supabase.from("nba_roster").upsert(c, { onConflict: "season,norm_name" });
      if (error) throw new Error(`nba_roster upsert: ${error.message}`);
    }
  }

  const teams = [...new Set(out.map((r) => r.team))].sort();
  console.log(
    `Roster ingest${dryRun ? " (DRY RUN, no writes)" : ""} [${season}]: ` +
      `${out.length} players across ${teams.length} team(s) [${teams.join(", ")}] ` +
      `${dryRun ? "would be upserted" : "upserted"}, ${unmatched.length} unmatched to nba_players.`,
  );
  // Data-quality cross-check: the 2025-26 team should corroborate the draft/yos
  // tags. A returning sophomore played in the NBA last season (NBA prior_team);
  // an incoming rookie did not (college/overseas). Conflicts catch transcription
  // slips and genuine edge cases (a 2025 draft-and-stash now a de-facto rookie).
  const tagConflicts = out.filter((r) => {
    const playedNba = r.prior_team != null && NBA_FULL_NAMES.has(r.prior_team);
    return (r.is_sophomore && !playedNba) || (r.is_incoming_rookie && playedNba);
  });
  if (tagConflicts.length) {
    console.log(`\nTag vs 2025-26-team conflicts (review):`);
    for (const r of tagConflicts) {
      const which = r.is_sophomore ? "SOPHOMORE" : "INCOMING ROOKIE";
      console.log(`  - ${r.full_name} (${r.team}): tagged ${which} but 2025-26 team = ${r.prior_team ?? "?"}`);
    }
  }

  const est = out.filter((r) => r.salary_estimated);
  if (est.length) {
    console.log(`\n${est.length} players have estimated (even-split) salary years:`);
    for (const r of est) console.log(`  - ${r.full_name} (${r.team}): ${r.salary_estimated_years} from "${r.contract_raw}"`);
  }
  if (unmatched.length) {
    console.log(`\nUnmatched to nba_players (roster still stored, player_id null):`);
    for (const r of unmatched) console.log(`  - ${r.full_name} (${r.team})`);
  }
  if (dryRun) {
    console.log("\nSample resolved rows:");
    for (const r of out.slice(0, 3)) {
      console.log(`  ${r.full_name} [${r.contract_status}] ${r.salary_source ?? "no salary"}: ` +
        `${r.salary_yr1 ?? "-"} / ${r.salary_yr2 ?? "-"} / ${r.salary_yr3 ?? "-"} / ${r.salary_yr4 ?? "-"}`);
    }
  }
}

main().catch((err) => {
  console.error("roster_ingest failed:", err);
  process.exit(1);
});
