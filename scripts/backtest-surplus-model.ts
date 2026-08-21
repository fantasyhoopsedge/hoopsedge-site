/**
 * One-off backtest: does FHE's real-salary surplus model (real_salary_values,
 * the site-wide sibling of Trade Edge's new per-league Surplus $ mode) agree
 * with real human trade votes on a real dynasty league (Angle Dynasty League,
 * Downtown Fantasy Sports #23)?
 *
 * Scope: the 19 trades from data/downtown-fantasy-trade-analysis.csv that
 * involve ONLY players (no draft picks, no FAAB) — the subset the current
 * value engine can actually score, since picks carry no value anywhere yet.
 *
 * Not a permanent build script — run once via `npx tsx scripts/backtest-surplus-model.ts`.
 */
import { loadEnv } from "./nba-data/client";
loadEnv();
import { createAdminClient } from "../src/utils/supabase/admin";
import { playerIdentity } from "../src/lib/player-identity/bundled";

interface TradeRow {
  date: string; ta: string; taGets: string; tb: string; tbGets: string;
  vaP: number; vaC: number; vbP: number; vbC: number; vfP: number; vfC: number; tot: number;
}

const trades: TradeRow[] = [
  { date: "2026-06-16", ta: "Taiwan Beer Hero Bears", taGets: "Bogdan Bogdanovic (SG/SF, $2449421)", tb: "Oakland Oaks", tbGets: "(nothing)", vaP: 0, vaC: 0, vbP: 0, vbC: 0, vfP: 100, vfC: 1, tot: 1 },
  { date: "2026-06-26", ta: "Singapore Slingers", taGets: "Nolan Traore (PG, $4002000); Dejounte Murray (PG/SG, $32785071)", tb: "Toronto Raptors", tbGets: "Coby White (PG, $26811593)", vaP: 25, vaC: 3, vbP: 33, vbC: 4, vfP: 42, vfC: 5, tot: 12 },
  { date: "2026-06-28", ta: "Houston Comets", taGets: "Darius Garland (PG, $42166510)", tb: "Oakland Oaks", tbGets: "Domantas Sabonis (C, $45472000)", vaP: 55, vaC: 6, vbP: 27, vbC: 3, vfP: 18, vfC: 2, tot: 11 },
  { date: "2026-06-29", ta: "Brisbane Bullets", taGets: "Dereck Lively II (C, $7239131)", tb: "Singapore Slingers", tbGets: "Andrew Nembhard (G/F, $19550160)", vaP: 45, vaC: 5, vbP: 45, vbC: 5, vfP: 9, vfC: 1, tot: 11 },
  { date: "2026-07-03", ta: "Boston Celtics", taGets: "VJ Edgecombe (SG, $11663880); Ajay Mitchell (PG, $2850000); Hugo Gonzalez (SF/SG, $2923560)", tb: "San Miguel Beermen", tbGets: "Cooper Flagg (SG/SF/PF, $14517480)", vaP: 0, vaC: 0, vbP: 100, vbC: 8, vfP: 0, vfC: 0, tot: 8 },
  { date: "2026-07-03", ta: "Charlotte Sting", taGets: "Dejounte Murray (PG/SG, $32785071); Joan Beringer (C, $4411200)", tb: "Singapore Slingers", tbGets: "Dylan Cardwell (C, $2150917); Kyshawn George (SG/SF, $3108000)", vaP: 78, vaC: 7, vbP: 0, vbC: 0, vfP: 22, vfC: 2, tot: 9 },
  { date: "2026-07-03", ta: "Taiwan Beer Hero Bears", taGets: "Keldon Johnson (PF/SF, $18000000)", tb: "Charlotte Sting", tbGets: "Bones Hyland (PG, $2845883)", vaP: 57, vaC: 4, vbP: 14, vbC: 1, vfP: 29, vfC: 2, tot: 7 },
  { date: "2026-07-05", ta: "Toronto Raptors", taGets: "Tim Hardaway Jr. (SG/SF, $6065000); T.J. McConnell (PG, $11000000)", tb: "Velez Sarsfield", tbGets: "Dennis Schroder (PG, $14809200)", vaP: 71, vaC: 5, vbP: 0, vbC: 0, vfP: 29, vfC: 2, tot: 7 },
  { date: "2026-07-09", ta: "Singapore Slingers", taGets: "Immanuel Quickley (PG, $32500000)", tb: "Providence Steamrollers", tbGets: "De'Aaron Fox (PG, $49488300); Nolan Traore (PG, $4002000)", vaP: 67, vaC: 6, vbP: 22, vbC: 2, vfP: 11, vfC: 1, tot: 9 },
  { date: "2026-07-27", ta: "Charlotte Sting", taGets: "Jordan Walsh (SF, $2406205); Nikola Jokic (C, $59033114)", tb: "Beijing Ducks", tbGets: "Luka Doncic (F/G, $49488300)", vaP: 0, vaC: 0, vbP: 38, vbC: 3, vfP: 63, vfC: 5, tot: 8 },
  { date: "2026-07-31", ta: "Singapore Slingers", taGets: "Alexandre Sarr (C, $12370680); Miles McBride (SG/PG, $3956523)", tb: "Victoria Titans", tbGets: "Luke Kornet (F/C, $10450000); Brandon Miller (SF, $15104626); Brandin Podziemski (PG/SG, $5679459)", vaP: 0, vaC: 0, vbP: 89, vbC: 8, vfP: 11, vfC: 1, tot: 9 },
  { date: "2026-08-01", ta: "Brisbane Bullets", taGets: "Josh Giddey (PG/SG, $25000000); Deni Avdija (PF/SF, $13125000)", tb: "Dubai Basketball", tbGets: "Khris Middleton (PF/SF, $5591122); Kentavious Caldwell-Pope (SG, $0); Jalen Johnson (PF, $30000000)", vaP: 80, vaC: 8, vbP: 0, vbC: 0, vfP: 20, vfC: 2, tot: 10 },
  { date: "2026-08-02", ta: "Charlotte Sting", taGets: "Justin Champagnie (PF/SF, $2667944)", tb: "Dubai Basketball", tbGets: "Bones Hyland (PG, $2845883)", vaP: 14, vaC: 1, vbP: 29, vbC: 2, vfP: 57, vfC: 4, tot: 7 },
  { date: "2026-08-03", ta: "Charlotte Sting", taGets: "Jake LaRavia (SF/PF, $6000000); Jordan Goodwin (SG/PG, $5864198)", tb: "Chicago Bulls", tbGets: "Justin Champagnie (PF/SF, $2667944); Malik Monk (SG, $20190035)", vaP: 14, vaC: 1, vbP: 14, vbC: 1, vfP: 71, vfC: 5, tot: 7 },
  { date: "2026-08-05", ta: "PSV Red Lions", taGets: "Draymond Green (PF, $27678571)", tb: "Las Vegas Aces", tbGets: "Kevin Huerter (SG, $9507042)", vaP: 80, vaC: 8, vbP: 0, vbC: 0, vfP: 20, vfC: 2, tot: 10 },
  { date: "2026-08-06", ta: "Charlotte Sting", taGets: "Rui Hachimura (PF, $14000000)", tb: "Houston Comets", tbGets: "Jordan Walsh (SF, $2406205); Luke Kennard (SG, $6064000)", vaP: 56, vaC: 5, vbP: 0, vbC: 0, vfP: 44, vfC: 4, tot: 9 },
  { date: "2026-08-08", ta: "Chicago Bulls", taGets: "Isaiah Stewart (F/C, $15000000)", tb: "Sacramento Monarchs", tbGets: "Daniel Gafford (C, $17263584)", vaP: 22, vaC: 2, vbP: 11, vbC: 1, vfP: 67, vfC: 6, tot: 9 },
  { date: "2026-08-10", ta: "Las Vegas Aces", taGets: "Maxime Raynaud (C, $2150918)", tb: "Charlotte Sting", tbGets: "Christian Anderson (G, $4257480)", vaP: 91, vaC: 10, vbP: 9, vbC: 1, vfP: 0, vfC: 0, tot: 11 },
  { date: "2026-08-15", ta: "Singapore Slingers", taGets: "Jaden McDaniels (SF, $26200000)", tb: "Velez Sarsfield", tbGets: "Kyshawn George (SG/SF, $3108000); Dylan Cardwell (C, $2150917)", vaP: 36, vaC: 4, vbP: 45, vbC: 5, vfP: 18, vfC: 2, tot: 11 },
];

function parseNames(gets: string): string[] {
  if (gets === "(nothing)") return [];
  return gets.split("; ").map((s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim());
}

function realVerdict(t: TradeRow): "A" | "B" | "Fair" {
  const max = Math.max(t.vaP, t.vbP, t.vfP);
  if (max === t.vfP) return "Fair";
  return max === t.vaP ? "A" : "B";
}

async function main() {
  const idx = playerIdentity();
  const admin = createAdminClient();

  const allNames = new Set<string>();
  for (const t of trades) {
    parseNames(t.taGets).forEach((n) => allNames.add(n));
    parseNames(t.tbGets).forEach((n) => allNames.add(n));
  }

  const fheIdByName = new Map<string, string>();
  const unresolved: string[] = [];
  for (const name of allNames) {
    const r = idx.resolve({ name });
    if (r.kind === "matched") fheIdByName.set(name, r.identity.fheId);
    else unresolved.push(`${name} (${r.kind})`);
  }

  if (unresolved.length) {
    console.log("UNRESOLVED NAMES:", unresolved.join(", "));
  }

  const ids = [...new Set(fheIdByName.values())];
  const { data, error } = await admin
    .from("real_salary_values")
    .select("fhe_id,surplus_value,consensus_z,production_z,salary")
    .eq("season", 2027)
    .in("fhe_id", ids);
  if (error) throw error;

  const surplusByFheId = new Map((data ?? []).map((r) => [r.fhe_id as string, r]));

  console.log(`\nResolved ${fheIdByName.size}/${allNames.size} names; ${surplusByFheId.size}/${ids.length} fhe_ids found in real_salary_values (season 2027).\n`);

  let matches = 0, total = 0, missingData = 0;
  for (const t of trades) {
    const aNames = parseNames(t.taGets);
    const bNames = parseNames(t.tbGets);
    let aVal = 0, bVal = 0, aMissing = 0, bMissing = 0;
    for (const n of aNames) {
      const fid = fheIdByName.get(n);
      const row = fid ? surplusByFheId.get(fid) : undefined;
      if (row?.surplus_value != null) aVal += row.surplus_value; else aMissing++;
    }
    for (const n of bNames) {
      const fid = fheIdByName.get(n);
      const row = fid ? surplusByFheId.get(fid) : undefined;
      if (row?.surplus_value != null) bVal += row.surplus_value; else bMissing++;
    }
    const real = realVerdict(t);
    const EPS = 2_000_000; // ~$2M surplus gap treated as "close enough to call fair"
    const diff = aVal - bVal; // positive => team_a_gets side is worth more => Team A won
    const predicted: "A" | "B" | "Fair" = Math.abs(diff) < EPS ? "Fair" : diff > 0 ? "A" : "B";
    const match = predicted === real;
    total++;
    if (match) matches++;
    if (aMissing + bMissing > 0) missingData++;
    console.log(
      `${t.date} ${t.ta} <-> ${t.tb} | A_val=$${(aVal / 1e6).toFixed(1)}M B_val=$${(bVal / 1e6).toFixed(1)}M diff=$${(diff / 1e6).toFixed(1)}M | predicted=${predicted} real=${real} (A${t.vaP}%/B${t.vbP}%/Fair${t.vfP}%, n=${t.tot}) ${match ? "MATCH" : "miss"}${aMissing + bMissing ? ` [${aMissing + bMissing} player(s) missing surplus data]` : ""}`,
    );
  }

  console.log(`\n${matches}/${total} matched the real plurality vote (${((matches / total) * 100).toFixed(0)}%). ${missingData} trade(s) had at least one player missing surplus data.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
