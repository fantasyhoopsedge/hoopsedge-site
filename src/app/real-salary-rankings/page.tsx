import { getStats } from "@/lib/value/seasonal-data";
import { getRealSalaryValues, getRosterExtras, type RosterExtra } from "@/lib/value/real-salary-data";
import rankings from "@/lib/dynasty-rankings.json";
import { normalizePlayerName } from "@/lib/dynasty-rankings";
import { playerIdentity } from "@/lib/player-identity/bundled";
import { contractClassOf } from "@/lib/value/real-salary-model";
import { RealSalaryTable, type RealSalaryRow } from "./_components/real-salary-table";

// FILTER bucket only — deliberately coarser than the model's own ContractClass
// (real-salary-model.ts), which has to separate Two-Way/Exhibit 10 from the
// rest of "Other" to gate the cheapness credit. "Rookie Scale" | "Standard"
// pass through as-is; everything else (Two-Way, Exhibit 10, RFA, UFA, Draftee
// — see roster_ingest.ts's deriveStatus()) buckets into "Other", per Ash's
// filter spec (2026-07-30).
function contractBucketOf(status: string | null): "Rookie Scale" | "Standard" | "Other" {
  if (status === "Rookie Scale" || status === "Standard") return status;
  return "Other";
}
function classOf(extra: RosterExtra | undefined): "rook" | "soph" | "vet" {
  if (extra?.is_incoming_rookie) return "rook";
  if (extra?.is_sophomore) return "soph";
  return "vet";
}

// Fractional age (matches dynasty-rankings.json's "22.4"-style precision),
// computed fresh from dob on every request rather than read from
// nba_roster.age_at_ingest — that column is a snapshot written once at
// ingest and drifts stale between refreshes (see roster-live-data.ts's own
// ageFromDob, which this mirrors but keeps the decimal instead of rounding
// to a whole year).
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / MS_PER_YEAR;
}

const SEASON = 2027;
const SEASON_TYPE = "projection";
// Identity fallback for players the projection dataset has no row for — unsigned
// free agents, who never enter the projection model because its Stage 1 universe
// is the roster of record. build-real-salary-values.ts admits them on last
// season's actual production (see its loadCarryForward), but their name/team/
// position still have to come from somewhere: the last COMPLETED season.
// hoopR numbering, 2026 = the 2025-26 season.
const FALLBACK_SEASON = 2026;
const FALLBACK_SEASON_TYPE = "regular";

// Consensus rank for the comparison column. Read fresh from the bundled board on
// every render and keyed by IDENTITY — NEVER by rank number, which a refresh
// reassigns to a different player (see CLAUDE.md's James Harden incident).
//
// The board itself has no id column, so its names are resolved through the
// player identity registry once at module load. This runs server-side only
// (`page.tsx` is a server component), so the ~230 KB registry never reaches the
// browser — see @/lib/player-identity/bundled.
type BoardPlayer = { player: string; consensusRank: number; team?: string | null; position?: string | null };
const CONSENSUS_RANK_BY_FHE_ID = new Map<string, number>();
// Display identity of last resort, still keyed by NAME on purpose. A
// `cons-<normalized name>` row exists precisely because the player has no
// resolvable id and therefore no season_player_stats row in ANY season — its own
// id encodes a board name, so the board is both where he came from and the only
// place a name/team/position can be read. See build-real-salary-values.ts's
// third admission pass.
const BOARD_BY_NAME = new Map<string, BoardPlayer>();
const CONSENSUS_RANK_BY_NAME = new Map<string, number>();
for (const p of rankings as BoardPlayer[]) {
  const key = normalizePlayerName(p.player);
  if (!BOARD_BY_NAME.has(key)) BOARD_BY_NAME.set(key, p);
  if (!CONSENSUS_RANK_BY_NAME.has(key)) CONSENSUS_RANK_BY_NAME.set(key, p.consensusRank);
  const res = playerIdentity().resolve({ name: p.player });
  if (res.kind === "matched" && !CONSENSUS_RANK_BY_FHE_ID.has(res.identity.fheId)) {
    CONSENSUS_RANK_BY_FHE_ID.set(res.identity.fheId, p.consensusRank);
  }
}

/** `cons-thomas-sorber` -> `thomas sorber`, the normalized board key. */
const SYNTHETIC_ID_PREFIX = "cons-";
function boardKeyFromSyntheticId(playerId: string): string | null {
  if (!playerId.startsWith(SYNTHETIC_ID_PREFIX)) return null;
  return playerId.slice(SYNTHETIC_ID_PREFIX.length).replace(/-/g, " ");
}

// Cached, cookieless reads (see @/lib/value/real-salary-data). Served from a
// 15-minute cache, same as /seasonal-rankings.
export const dynamic = "force-dynamic";

export default async function RealSalaryRankingsPage() {
  const [stats, fallbackStats, values, rosterExtras] = await Promise.all([
    getStats(SEASON, SEASON_TYPE),
    getStats(FALLBACK_SEASON, FALLBACK_SEASON_TYPE),
    getRealSalaryValues(SEASON),
    getRosterExtras(),
  ]);

  const statsById = new Map(stats.map((s) => [s.player_id, s]));
  const fallbackStatsById = new Map(fallbackStats.map((s) => [s.player_id, s]));

  // Joined on fhe_id — one key that covers brand-new incoming rookies (whose
  // nba_roster row has no player_id) as well as everyone else, replacing the
  // player_id-then-name pair this used to need.
  const extrasByFheId = new Map<string, RosterExtra>();
  for (const e of rosterExtras) {
    if (e.fhe_id && !extrasByFheId.has(e.fhe_id)) extrasByFheId.set(e.fhe_id, e);
  }

  // The stored row already carries the "Balanced" preset's precomputed
  // expectedCapHit/surplusValue/surplusRank (server-rendered default) AND
  // the three raw z-components (consensusZ/productionZ/salaryZ) the client
  // needs to instantly recompute all of that for the other manager-archetype
  // presets — see src/lib/value/real-salary-model.ts.
  // A synthetic row is a placeholder for a player with no id; if that same human
  // ALSO appears under a real id (he earned one between builds and the sweep in
  // build-real-salary-values.ts hasn't run yet), the real row wins and the
  // placeholder is dropped — otherwise he'd be listed twice.
  //
  // Keyed by identity where the row has one, with the normalized name kept as a
  // second key: a synthetic row's whole reason for existing is that its player
  // had no id, so name is sometimes the only thing the two rows share.
  const realFheIds = new Set<string>();
  const realNameKeys = new Set<string>();
  for (const v of values) {
    if (v.player_id.startsWith(SYNTHETIC_ID_PREFIX)) continue;
    if (v.fhe_id) realFheIds.add(v.fhe_id);
    const s = statsById.get(v.player_id) ?? fallbackStatsById.get(v.player_id);
    if (s) realNameKeys.add(normalizePlayerName(s.name));
  }

  const rows: RealSalaryRow[] = [];
  for (const v of values) {
    // Projection identity first; last completed season fills in for the
    // unsigned free agents the projection dataset doesn't cover; the bundled
    // board is the last resort for forced-in players with no stats row at all.
    const boardKey = boardKeyFromSyntheticId(v.player_id);
    const board = boardKey != null ? BOARD_BY_NAME.get(boardKey) : undefined;
    const supersededByRealRow = boardKey != null
      && (realNameKeys.has(boardKey) || (v.fhe_id != null && realFheIds.has(v.fhe_id)));
    if (boardKey != null && (!board || supersededByRealRow)) continue;
    const s = statsById.get(v.player_id) ?? fallbackStatsById.get(v.player_id)
      ?? (board
        ? { name: board.player, team: board.team ?? null, position: board.position ?? null, headshot_id: null }
        : null);
    if (!s) continue; // no display identity (name/team/position) to show
    const extra = v.fhe_id ? extrasByFheId.get(v.fhe_id) : undefined;
    // A null salary IS the unsigned marker (see real-salary-model.ts). "FA" is
    // the one non-team placeholder ecosystem-wide — never "UFA" — and a
    // fallback row's team is last season's team, which would read as a roster
    // spot he no longer holds.
    const unsigned = v.salary == null;
    rows.push({
      playerId: v.player_id,
      fheId: v.fhe_id ?? null,
      name: s.name,
      team: unsigned ? "FA" : s.team,
      position: s.position,
      headshotId: s.headshot_id,
      consensusZ: v.consensus_z,
      productionZ: v.production_z,
      salaryZ: v.salary_z,
      salary: v.salary,
      salarySource: v.salary_source,
      confidenceTier: v.confidence_tier,
      // Identity first; the board name is the fallback for a `cons-` row, which
      // by definition has no identity to key on.
      consensusRank: (v.fhe_id ? CONSENSUS_RANK_BY_FHE_ID.get(v.fhe_id) : undefined)
        ?? CONSENSUS_RANK_BY_NAME.get(normalizePlayerName(s.name)) ?? null,
      classId: classOf(extra),
      contractBucket: unsigned ? "Other" : contractBucketOf(extra?.contract_status ?? null),
      contractClass: unsigned ? "unsigned" : contractClassOf(extra?.contract_status ?? null),
      age: ageFromDob(extra?.dob),
      salaryYr2: extra?.salary_yr2 ?? null,
      salaryYr3: extra?.salary_yr3 ?? null,
      salaryYr4: extra?.salary_yr4 ?? null,
    });
  }

  return <RealSalaryTable rows={rows} />;
}
