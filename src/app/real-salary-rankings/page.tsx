import { getStats } from "@/lib/value/seasonal-data";
import { getRealSalaryValues, getRosterExtras, type RosterExtra } from "@/lib/value/real-salary-data";
import rankings from "@/lib/dynasty-rankings.json";
import { normalizePlayerName } from "@/lib/dynasty-rankings";
import { RealSalaryTable, type RealSalaryRow } from "./_components/real-salary-table";

// "Rookie Scale" | "Standard" pass through as-is; everything else (Two-Way,
// Exhibit 10, RFA, UFA, Draftee — see roster_ingest.ts's deriveStatus())
// buckets into "Other", per Ash's filter spec (2026-07-30).
function contractBucketOf(status: string | null): "Rookie Scale" | "Standard" | "Other" {
  if (status === "Rookie Scale" || status === "Standard") return status;
  return "Other";
}
function classOf(extra: RosterExtra | undefined): "rook" | "soph" | "vet" {
  if (extra?.is_incoming_rookie) return "rook";
  if (extra?.is_sophomore) return "soph";
  return "vet";
}

const SEASON = 2027;
const SEASON_TYPE = "projection";

// Consensus rank for the comparison column, keyed by normalized name — NEVER
// by rank number (a refresh reassigns rank numbers to different players; see
// CLAUDE.md's James Harden incident).
const CONSENSUS_RANK_BY_NAME: Record<string, number> = {};
for (const p of rankings as Array<{ player: string; consensusRank: number }>) {
  CONSENSUS_RANK_BY_NAME[normalizePlayerName(p.player)] = p.consensusRank;
}

// Cached, cookieless reads (see @/lib/value/real-salary-data). Served from a
// 15-minute cache, same as /seasonal-rankings.
export const dynamic = "force-dynamic";

export default async function RealSalaryRankingsPage() {
  const [stats, values, rosterExtras] = await Promise.all([
    getStats(SEASON, SEASON_TYPE),
    getRealSalaryValues(SEASON),
    getRosterExtras(),
  ]);

  const statsById = new Map(stats.map((s) => [s.player_id, s]));

  // player_id first (precise); normalized-name fallback catches brand-new
  // rookies whose nba_roster row has no player_id yet — same identity gap
  // build-real-salary-values.ts's loadSalaries() already documents.
  const extrasByPlayerId = new Map<string, RosterExtra>();
  const extrasByName = new Map<string, RosterExtra>();
  for (const e of rosterExtras) {
    if (e.player_id) extrasByPlayerId.set(e.player_id, e);
    const nameKey = normalizePlayerName(e.full_name);
    if (!extrasByName.has(nameKey)) extrasByName.set(nameKey, e);
  }

  // The stored row already carries the "Balanced" preset's precomputed
  // expectedCapHit/surplusValue/surplusRank (server-rendered default) AND
  // the three raw z-components (consensusZ/productionZ/salaryZ) the client
  // needs to instantly recompute all of that for the other manager-archetype
  // presets — see src/lib/value/real-salary-model.ts.
  const rows: RealSalaryRow[] = [];
  for (const v of values) {
    const s = statsById.get(v.player_id);
    if (!s) continue; // no display identity (name/team/position) to show
    const extra = extrasByPlayerId.get(v.player_id) ?? extrasByName.get(normalizePlayerName(s.name));
    rows.push({
      playerId: v.player_id,
      name: s.name,
      team: s.team,
      position: s.position,
      headshotId: s.headshot_id,
      consensusZ: v.consensus_z,
      productionZ: v.production_z,
      salaryZ: v.salary_z,
      salary: v.salary,
      salarySource: v.salary_source,
      confidenceTier: v.confidence_tier,
      consensusRank: CONSENSUS_RANK_BY_NAME[normalizePlayerName(s.name)] ?? null,
      classId: classOf(extra),
      contractBucket: contractBucketOf(extra?.contract_status ?? null),
      salaryYr2: extra?.salary_yr2 ?? null,
      salaryYr3: extra?.salary_yr3 ?? null,
      salaryYr4: extra?.salary_yr4 ?? null,
    });
  }

  return <RealSalaryTable rows={rows} />;
}
