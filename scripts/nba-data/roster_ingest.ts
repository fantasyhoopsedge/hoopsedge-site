/**
 * Roster ingest — reads the HUMAN-COMMITTED roster file
 * (data/nba-rosters/<season>.csv, transcribed from the owner's gated cap sheet)
 * and upserts one enriched row per player into public.nba_roster.
 *
 * Salary resolution (per the owner's rule):
 *   - public.nba_contracts (fed from data/nba-salaries/current.csv, refreshed
 *     from HoopsHype) is the AUTHORITATIVE real-salary source and always wins,
 *     year-for-year, over the roster sheet's own (older, less frequently
 *     updated) 26-27 SALARY column — a disagreement between the two means the
 *     sheet is stale, not that current.csv is wrong.
 *       current.csv salary_y2 = 2026-27, salary_y3 = 2027-28, salary_y4 = 2028-29,
 *       salary_y5 = 2029-30.
 *   - Where current.csv has a GAP (player absent, or a year it has no figure
 *     for), the value is an EVEN SPLIT of the contract total over its length,
 *     starting at yr1 = the roster season (2026-27), spread across whichever
 *     years are still unknown after current.csv fills in what it has.
 *   - yr1 also falls back to the sheet's explicit 26-27 SALARY column only when
 *     current.csv has no entry for the player at all.
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
import { readFileSync, existsSync } from "node:fs";
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
// D1 (trend-tag audit): the sheet's DOB column is MM/DD/YY (2-digit year) for every
// row — the old 4-digit-only regex never matched, so `dob` silently landed NULL for
// all 579 players and every age on the site was driven off the much coarser
// `age_at_ingest` column instead (that's what produced Stephon Castle's wrong age:
// dob parsed to null, so his card fell back to age_at_ingest=25.67). Century pivot:
// every player in this file was born 1985-2010ish (YY 85-10), so YY>=50 -> 19YY,
// else -> 20YY; re-check this pivot if the file ever needs a birth year before 1950.
function parseDob(v: string): string | null {
  const m = (v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = yy.length === 4 ? yy : (Number(yy) >= 50 ? `19${yy}` : `20${yy}`);
  return `${year}-${mm}-${dd}`;
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
type RealSalary = { current: number | null; y2: number | null; y3: number | null; y4: number | null; y5: number | null; note: string | null }; // 25-26, 26-27, 27-28, 28-29, 29-30
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
      current: parseMoney(r.salary_current),
      y2: parseMoney(r.salary_y2),
      y3: parseMoney(r.salary_y3),
      y4: parseMoney(r.salary_y4),
      y5: parseMoney(r.salary_y5),
      note: (r.contract_note ?? "").trim() || null,
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
  // Which display years (by norm_name) current.csv flags "Qualifying Offer" —
  // a formulaic RFA cap-hold, not a real negotiated salary. Kept alongside
  // `out` rather than on it since nba_roster has no column for this yet;
  // surfaced today only through --audit-tsv.
  const qoByNorm = new Map<string, Set<string>>();
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
    // current.csv (fresh off a HoopsHype refresh) is the fresher of the two
    // sources and wins year-for-year over the roster sheet's own 26-27 SALARY
    // column; a disagreement between them means the sheet is stale, not that
    // current.csv is wrong. The sheet's column is only a fallback for yr1 when
    // current.csv has no entry for the player at all. Any year current.csv
    // doesn't cover gets filled in: if SOME years are already known, the
    // remaining contract total is split evenly across the unknown year(s); if
    // NOTHING beyond yr1 is known, the whole deal is modeled as an arithmetic
    // step from yr1 across the contract length (rising/falling to sum exactly
    // to the total). Either way the filled years are flagged as estimates so
    // they're never mistaken for real cap figures.
    const rs = real.get(norm);
    if (rs?.note) {
      // current.csv's contract_note is free text like "Team Option 2027-28;
      // Qualifying Offer 2028-29" — pull out just the QO-flagged season(s).
      const qoSeasons = new Set(
        [...rs.note.matchAll(/Qualifying Offer\s+(\d{4}-\d{2})/gi)].map((m) => m[1]),
      );
      if (qoSeasons.size) qoByNorm.set(norm, qoSeasons);
    }

    // ── rookie-scale contract-year backsolve (owner's method) ──────────────────
    // Runs BEFORE the general resolver below and only ever fills a slot the
    // general resolver would otherwise leave blank. A player's rookie-scale
    // years are indexed off their DRAFT year, not the roster season — a 2024
    // draftee's contract year 1 is 2024-25, one season before current.csv's
    // earliest column (salary_current = 2025-26). When that's the only unknown
    // blocking a total-based solve for some OTHER genuinely-missing in-window
    // year, backsolve it from the growth rate between the two earliest known
    // consecutive contract years, then solve the missing year as
    // contract.total minus the sum of the other (known/backsolved) years.
    // Only ever fires for "Rookie Scale" deals; standard veteran contracts are
    // untouched. If more than one contract year is still unresolved after the
    // backsolve, there isn't enough information to solve uniquely, so nothing
    // is filled (stays blank, same conservative default as everywhere else).
    const rookiePrefill: (number | null)[] = [null, null, null, null]; // yr0..yr3, only set where this resolves something
    const contractStatusEarly = deriveStatus(contract.status, draft.year, draft.pick, yos, contract.years);

    // ── estimate boundary (owner's rule) ────────────────────────────────────────
    // FA_YEAR marks when a contract's known money runs out — estimating past it
    // means guessing at a completely different, unsigned future deal, which is
    // exactly the bug this audit caught (Miles Bridges, Jamaree Bouyea getting
    // fabricated years after their real contract already ended). This bound
    // only ever BLOCKS an estimate attempt; a real current.csv figure is never
    // hidden by it, no matter what year it falls in.
    //   Standard deals: boundary = fa_year + fa_option_years (the sheet's own
    //     "+N" already accounts for any remaining option years).
    //   Rookie Scale deals: fa_year in the sheet marks the end of GUARANTEED
    //     money (after year 2 of the standard 4-year rookie scale structure);
    //     years 3-4 are then team options, so the boundary is fa_year + 2 —
    //     capped at the contract's actual year 4 (draft_year + contract_years),
    //     whichever is tighter, so we never estimate past a rookie deal's real
    //     4th year either.
    let estimateBoundaryYear: number | null = null;
    if (contractStatusEarly === "Rookie Scale") {
      const faBound = fa.year != null ? fa.year + 2 : null;
      const draftBound = draft.year != null && contract.years != null ? draft.year + contract.years : null;
      const bounds = [faBound, draftBound].filter((v): v is number => v != null);
      if (bounds.length) estimateBoundaryYear = Math.min(...bounds);
    } else if (fa.year != null) {
      estimateBoundaryYear = fa.year + (fa.options ?? 0);
    }
    const slotAllowed = (i: number) =>
      estimateBoundaryYear == null || seasonStart(season) + i < estimateBoundaryYear;

    if (contractStatusEarly === "Rookie Scale" && draft.year != null && contract.years != null && contract.total != null) {
      const N = contract.years;
      const calSalary = new Map<number, number>();
      if (rs?.current != null) calSalary.set(2025, rs.current);
      if (rs?.y2 != null) calSalary.set(2026, rs.y2);
      if (rs?.y3 != null) calSalary.set(2027, rs.y3);
      if (rs?.y4 != null) calSalary.set(2028, rs.y4);
      if (rs?.y5 != null) calSalary.set(2029, rs.y5);

      const val: (number | null)[] = [];
      for (let p = 1; p <= N; p++) val.push(calSalary.get(draft.year + p - 1) ?? null);
      // Backsolve contract-year 1 from years 2 and 3 (the case that actually
      // occurs: only a 2024 draftee's year 1 can predate current.csv's window).
      if (val[0] == null && val[1] != null && val[2] != null && val[1] > 0) {
        const g = val[2]! / val[1]! - 1;
        val[0] = Math.round(val[1]! / (1 + g));
      }
      const missingPositions = val.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
      if (missingPositions.length === 1) {
        const [missingIdx] = missingPositions;
        const knownSum = val.reduce((s: number, v, i) => (i === missingIdx ? s : s + (v ?? 0)), 0);
        const solved = contract.total - knownSum;
        if (solved >= 500_000) {
          const slot = draft.year + missingIdx - seasonStart(season); // contract-year position -> yr0..yr3
          if (slot >= 0 && slot <= 3 && slotAllowed(slot)) rookiePrefill[slot] = solved;
        }
      }
    }

    // ── resolve 4-year salary ──────────────────────────────────────────────────
    // current.csv (fresh off a HoopsHype refresh) is the fresher of the two
    // sources and wins year-for-year over the roster sheet's own 26-27 SALARY
    // column; a disagreement between them means the sheet is stale, not that
    // current.csv is wrong. The sheet's column is only a fallback for yr1 when
    // current.csv has no entry for the player at all. Any year current.csv
    // doesn't cover gets filled in: if SOME years are already known, the
    // remaining contract total is split evenly across the unknown year(s); if
    // NOTHING beyond yr1 is known, the whole deal is modeled as an arithmetic
    // step from yr1 across the contract length (rising/falling to sum exactly
    // to the total). Either way the filled years are flagged as estimates so
    // they're never mistaken for real cap figures.
    const realByYr: (number | null)[] = [rs?.y2 ?? null, rs?.y3 ?? null, rs?.y4 ?? null, rs?.y5 ?? null]; // yr1..yr4 = 26-27..29-30
    const csvY2 = realByYr[0]; // current.csv's 2026-27 figure (may be null even if the row exists)
    const yr1 = csvY2 ?? rookiePrefill[0] ?? screenshot2627; // current.csv wins, then the rookie backsolve, then the sheet
    const yr: (number | null)[] = [
      yr1,
      realByYr[1] ?? rookiePrefill[1],
      realByYr[2] ?? rookiePrefill[2],
      realByYr[3] ?? rookiePrefill[3],
    ];
    const estimatedYears: string[] = [];
    let salary_source: string | null = rs != null ? "current.csv" : screenshot2627 != null ? "sheet" : null;

    // Flag whichever slot(s) the rookie backsolve actually supplied (it only
    // ever fills a slot the lines above left null, so this can't double-count
    // a real current.csv figure).
    rookiePrefill.forEach((v, i) => {
      if (v == null) return;
      const wasBlank = i === 0 ? csvY2 == null : realByYr[i] == null;
      if (wasBlank) {
        estimatedYears.push(yearLabel(season, i));
        salary_source = salary_source ? `${salary_source}+rookie_backsolve` : "rookie_backsolve";
      }
    });

    if (yr1 != null && (contract.years ?? 0) >= 2 && contract.total != null) {
      // Never model/estimate a year at or past the FA-year boundary computed
      // above — that's the fix this audit called for. boundaryCap counts how
      // many of the 4 display slots (0 = 26-27) fall before the boundary.
      const boundaryCap = estimateBoundaryYear == null
        ? 4
        : Math.max(0, Math.min(4, estimateBoundaryYear - seasonStart(season)));
      const N = Math.min(contract.years!, 4, boundaryCap);
      const unknownIdx: number[] = [];
      for (let i = 0; i < N; i++) if (yr[i] == null) unknownIdx.push(i);
      const knownCount = N - unknownIdx.length;

      if (unknownIdx.length > 0 && knownCount > 1) {
        // Some years already known from current.csv — split what's left of the
        // contract total evenly across the still-unknown year(s). The sheet's
        // contract_total can be stale (predates a raise current.csv already
        // reflects), which would make "remaining" non-positive or push a filled
        // year below any real NBA salary (the two-way minimum, ~$678,882, is
        // the lowest real figure in the data) — that's a signal the total isn't
        // trustworthy here, so leave those year(s) unresolved (null) rather
        // than fabricate a bogus salary.
        const MIN_PLAUSIBLE_SALARY = 500_000;
        const knownSum = yr.slice(0, N).reduce((s: number, v) => s + (v ?? 0), 0);
        const remaining = contract.total - knownSum;
        const per = Math.round(remaining / unknownIdx.length);
        if (remaining > 0 && per >= MIN_PLAUSIBLE_SALARY) {
          let acc = 0;
          unknownIdx.forEach((i, idx) => {
            yr[i] = idx < unknownIdx.length - 1 ? per : remaining - acc;
            acc += yr[i]!;
            estimatedYears.push(yearLabel(season, i));
          });
          salary_source = "current.csv+estimate_fill_gap";
        }
      } else if (unknownIdx.length > 0) {
        // Nothing beyond yr1 known → step from yr1 across the full contract
        // length. Arithmetic series summing to the contract total;
        // step = 2*(total - N*yr1) / (N*(N-1)); +ve steps up, -ve steps down.
        // The final year absorbs rounding so the years sum EXACTLY to the total.
        // Same staleness risk as the gap-fill branch above: if yr1 alone (fresh
        // from current.csv) already eats most/all of the sheet's stale total,
        // the step goes non-positive — compute into a scratch array first and
        // only commit it if every year clears the plausibility floor.
        const MIN_PLAUSIBLE_SALARY = 500_000;
        const step = Math.round((contract.total - N * yr1) / ((N * (N - 1)) / 2));
        const stepped: number[] = [yr1];
        let acc = yr1;
        for (let i = 1; i < N; i++) {
          stepped.push(i < N - 1 ? yr1 + i * step : contract.total - acc);
          acc += stepped[i];
        }
        if (stepped.every((v) => v >= MIN_PLAUSIBLE_SALARY)) {
          for (let i = 1; i < N; i++) {
            yr[i] = stepped[i];
            estimatedYears.push(yearLabel(season, i));
          }
          salary_source = salary_source ?? "estimate_step";
        }
      }
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
      contract_status: contractStatusEarly,
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

  // Existing DB rows for this season, so we can remove players who were on an
  // ingested team's roster before but are no longer in the CSV (cut/replaced).
  // The upsert alone never deletes, so stale rows would otherwise accumulate.
  // SCOPED to the teams present in `out`: a `--team BOS` run only ever reconciles
  // BOS, never touching other teams' players. A truncated/partial CSV therefore
  // can't nuke the table — only the teams it actually contains.
  const currentNorms = new Set(out.map((r) => r.norm_name));
  const ingestedTeams = new Set(out.map((r) => r.team));
  const existing: { norm_name: string; team: string; full_name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("nba_roster").select("norm_name,team,full_name").eq("season", season).range(from, from + 999);
    if (error) throw new Error(`nba_roster read: ${error.message}`);
    if (!data?.length) break;
    existing.push(...(data as { norm_name: string; team: string; full_name: string }[]));
    if (data.length < 1000) break;
  }
  const orphanRows = existing.filter(
    (e) => ingestedTeams.has(e.team) && !currentNorms.has(e.norm_name),
  );

  if (!dryRun) {
    for (const c of chunk(out, UPSERT_CHUNK)) {
      const { error } = await supabase.from("nba_roster").upsert(c, { onConflict: "season,norm_name" });
      if (error) throw new Error(`nba_roster upsert: ${error.message}`);
    }
    for (const c of chunk(orphanRows.map((e) => e.norm_name), 200)) {
      const { error } = await supabase.from("nba_roster").delete().eq("season", season).in("norm_name", c);
      if (error) throw new Error(`nba_roster reconcile-delete: ${error.message}`);
    }
  }

  const teams = [...new Set(out.map((r) => r.team))].sort();
  console.log(
    `Roster ingest${dryRun ? " (DRY RUN, no writes)" : ""} [${season}]: ` +
      `${out.length} players across ${teams.length} team(s) [${teams.join(", ")}] ` +
      `${dryRun ? "would be upserted" : "upserted"}, ${unmatched.length} unmatched to nba_players.`,
  );
  if (orphanRows.length) {
    console.log(
      `\n${orphanRows.length} stale row(s) ${dryRun ? "would be removed" : "removed"} ` +
        `(were on an ingested team, no longer in the CSV):`,
    );
    for (const e of orphanRows) console.log(`  - ${e.full_name} (${e.team})`);
  }
  // Safety net: a resolved salary year should never be non-positive or below
  // any real figure in the data (the two-way minimum, ~$678,882, is the floor).
  // Catches a stale/bad contract_total slipping past the estimate guards above.
  const implausible = out.filter((r) =>
    [r.salary_yr1, r.salary_yr2, r.salary_yr3, r.salary_yr4].some((v) => v != null && v < 500_000),
  );
  if (implausible.length) {
    console.log(`\nIMPLAUSIBLE salary value(s) — review before writing (${implausible.length}):`);
    for (const r of implausible) {
      console.log(`  - ${r.full_name} (${r.team}) [${r.salary_source}]: ${r.salary_yr1 ?? "-"} / ${r.salary_yr2 ?? "-"} / ${r.salary_yr3 ?? "-"} / ${r.salary_yr4 ?? "-"}`);
    }
  }
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
  const rookieBacksolved = out.filter((r) => r.salary_source?.includes("rookie_backsolve"));
  if (rookieBacksolved.length) {
    console.log(`\n${rookieBacksolved.length} rookie-scale player(s) had a gap year filled via draft-year contract-position backsolve:`);
    for (const r of rookieBacksolved) {
      console.log(`  - ${r.full_name} (${r.team}) [draft ${r.draft_year}]: ${r.salary_estimated_years} from "${r.contract_raw}" -> ${r.salary_yr1 ?? "-"} / ${r.salary_yr2 ?? "-"} / ${r.salary_yr3 ?? "-"} / ${r.salary_yr4 ?? "-"}`);
    }
  }
  if (unmatched.length) {
    console.log(`\nUnmatched to nba_players (roster still stored, player_id null):`);
    for (const r of unmatched) console.log(`  - ${r.full_name} (${r.team})`);
  }
  if (dryRun) {
    console.log("\nSample resolved rows:");
    for (const r of onlyTeam ? out : out.slice(0, 3)) {
      console.log(`  ${r.full_name} [${r.contract_status}] ${r.salary_source ?? "no salary"}: ` +
        `${r.salary_yr1 ?? "-"} / ${r.salary_yr2 ?? "-"} / ${r.salary_yr3 ?? "-"} / ${r.salary_yr4 ?? "-"}`);
    }
  }
  if (process.argv.includes("--audit-tsv")) {
    const estLabels = (r: RosterRow) => new Set((r.salary_estimated_years ?? "").split(", ").filter(Boolean));
    const cell = (r: RosterRow, i: number, v: number | null) => {
      const label = yearLabel(season, i);
      const isQo = qoByNorm.get(r.norm_name)?.has(label) ?? false;
      const tag = isQo ? "QO" : estLabels(r).has(label) ? "EST" : v != null ? "real" : "";
      return `${v ?? ""}\t${tag}`;
    };
    console.log("\n--- AUDIT TSV ---");
    console.log(["player", "team", "contract_raw", "fa_year", "status",
      "2026-27", "tag1", "2027-28", "tag2", "2028-29", "tag3", "2029-30", "tag4"].join("\t"));
    for (const r of out) {
      console.log([
        r.full_name, r.team, r.contract_raw ?? "", r.fa_year ?? "", r.contract_status,
        cell(r, 0, r.salary_yr1), cell(r, 1, r.salary_yr2), cell(r, 2, r.salary_yr3), cell(r, 3, r.salary_yr4),
      ].join("\t"));
    }
    console.log("--- END AUDIT TSV ---");
  }
}

main().catch((err) => {
  console.error("roster_ingest failed:", err);
  process.exit(1);
});
