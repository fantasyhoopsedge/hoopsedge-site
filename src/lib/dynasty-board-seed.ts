import "server-only";
import { unstable_cache } from "next/cache";
import { createClient as createPublicClient } from "@supabase/supabase-js";
import type { Database, SeasonPlayerStats } from "@/types/database";
import { DYNASTY_RANKINGS, normalizePlayerName } from "@/lib/dynasty-rankings";
import { CANONICAL_SIZE } from "@/lib/value/compute-values";
import { getStats, getValuesForSize } from "@/lib/value/seasonal-data";
import { loadPublishedRows } from "@/lib/depth-chart-store";
import { formatContract, renumber, type DynastyBoardPlayer, type EcosystemPlayer } from "@/lib/dynasty-board";

/**
 * Builds a fresh Dynasty Board seed (every player in src/lib/dynasty-rankings.json,
 * ordered by the FBI-HE baseline rank) and the "ecosystem pool" of every other
 * rostered NBA player available to add. Both are enriched from the same
 * Supabase sources — contract (nba_roster), role tag (depth-chart tier), and
 * projected per-game production (season_player_stats/season_player_values) —
 * via loadEnrichmentContext() below, so a player looks identical whether they
 * came from the consensus or were added later. All joins key on
 * normalizePlayerName() — never a persisted rank number (CLAUDE.md).
 *
 * "FBI-HE" (expertRanks.fbihe) replaced "hashtag" 2026-08-02 when Hashtag
 * Basketball ended its FHE partnership — see the fbi-partnership memory and
 * docs/dynasty-rankings-refresh.md. This means the tool's own baseline is now
 * circular by design: each refresh's published board becomes next cycle's
 * fbihe seat in dynasty-rankings.json, which becomes the seed for the NEXT
 * time this tool is opened. That's intentional, not a bug.
 */

// 2026-27 is the season being drafted for; its only stats dataset is the
// projections model (models/, scripts/build-projection-values.ts) since the
// season hasn't been played yet — same dataset key /seasonal-rankings uses
// for its "2026-27 Projections" entry (src/lib/value/seasons.ts).
const STATS_SEASON = 2027;
const STATS_TYPE = "projection";
const ROSTER_SEASON = "2026-27";

function createReadClient() {
  return createPublicClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

interface RosterExtra {
  full_name: string;
  team: string;
  position: string | null;
  dob: string | null;
  contract_status: string | null;
  contract_years: number | null;
  contract_total: number | null;
  is_incoming_rookie: boolean;
  is_sophomore: boolean;
}

const DYNASTY_BOARD_TAG = "dynasty-board-seed";

const getRosterForBoard = unstable_cache(
  async () => {
    const PAGE = 1000;
    const supabase = createReadClient();
    const out: RosterExtra[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("nba_roster")
        .select("full_name,team,position,dob,contract_status,contract_years,contract_total,is_incoming_rookie,is_sophomore")
        .eq("season", ROSTER_SEASON)
        .range(from, from + PAGE - 1);
      if (error || !data?.length) break;
      out.push(...(data as RosterExtra[]));
      if (data.length < PAGE) break;
    }
    return out;
  },
  ["dynasty-board-roster"],
  { revalidate: 900, tags: [DYNASTY_BOARD_TAG] },
);

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  return Number.isNaN(d.getTime()) ? null : (Date.now() - d.getTime()) / MS_PER_YEAR;
}

interface EnrichmentContext {
  roster: RosterExtra[];
  rosterByName: Map<string, RosterExtra>;
  statsByName: Map<string, SeasonPlayerStats>;
  roleByName: Map<string, string>;
  /** 1-based rank by per-game Minus1V across the FULL stats universe (not just
   * the consensus) — a player added later keeps the same rank they'd have had
   * if they'd been on the board from the start, instead of a pool computed
   * over a different subset. */
  minus1vRankByName: Map<string, number>;
}

async function loadEnrichmentContext(): Promise<EnrichmentContext> {
  const [roster, stats, values, depthRows] = await Promise.all([
    getRosterForBoard(),
    getStats(STATS_SEASON, STATS_TYPE),
    getValuesForSize(STATS_SEASON, STATS_TYPE, CANONICAL_SIZE),
    loadPublishedRows().catch(() => []),
  ]);

  const rosterByName = new Map<string, RosterExtra>();
  for (const r of roster) {
    const key = normalizePlayerName(r.full_name);
    if (!rosterByName.has(key)) rosterByName.set(key, r);
  }

  const statsByName = new Map(stats.map((s) => [normalizePlayerName(s.name), s]));
  const valuesByPlayerId = new Map(values.map((v) => [v.player_id, v]));

  const roleByName = new Map<string, string>();
  for (const row of depthRows) {
    const key = normalizePlayerName(row.player);
    if (!roleByName.has(key)) roleByName.set(key, row.tier);
  }

  // Rank by per-game minus1V (desc, nulls last) across every stats row — there's
  // no persisted rank column for this score (only `value_rank`, which ranks by
  // `value`), so it's computed the same way /seasonal-rankings' Minus1V toggle
  // does: over the full pool, not per-consumer, so the number is stable
  // regardless of whether a player is in the consensus or the ecosystem pool.
  const withScore = stats.map((s) => ({
    key: normalizePlayerName(s.name),
    minus1v: valuesByPlayerId.get(s.player_id)?.minus1v ?? null,
  }));
  withScore.sort((a, b) => {
    if (a.minus1v == null) return b.minus1v == null ? 0 : 1;
    if (b.minus1v == null) return -1;
    return b.minus1v - a.minus1v;
  });
  const minus1vRankByName = new Map<string, number>();
  withScore.forEach((r, i) => {
    if (r.minus1v != null) minus1vRankByName.set(r.key, i + 1);
  });

  return { roster, rosterByName, statsByName, roleByName, minus1vRankByName };
}

function enrich(name: string, ctx: EnrichmentContext, fallback: { team: string; position: string; age: number | null }): EcosystemPlayer {
  const key = normalizePlayerName(name);
  const extra = ctx.rosterByName.get(key);
  const s = ctx.statsByName.get(key);

  return {
    name,
    team: extra?.team ?? fallback.team,
    position: extra?.position ?? fallback.position,
    age: extra ? ageFromDob(extra.dob) ?? fallback.age : fallback.age,
    isRookie: Boolean(extra?.is_incoming_rookie),
    isSophomore: Boolean(extra?.is_sophomore),
    contract: formatContract(
      extra?.contract_status ?? null,
      extra?.contract_years ?? null,
      extra?.contract_total ?? null,
    ),
    contractStatus: extra?.contract_status ?? null,
    minus1vRank: ctx.minus1vRankByName.get(key) ?? null,
    mpg: s?.mpg ?? null,
    gp: s?.g ?? null,
    usg: s?.usg_pct ?? null,
    roleTag: (ctx.roleByName.get(key) as EcosystemPlayer["roleTag"]) ?? null,
  };
}

export async function buildDynastyBoardSeed(): Promise<DynastyBoardPlayer[]> {
  const ctx = await loadEnrichmentContext();

  const seeded: DynastyBoardPlayer[] = DYNASTY_RANKINGS.map((p) => {
    const e = enrich(p.player, ctx, { team: p.team, position: p.position, age: p.age });
    return {
      ...e,
      // The consensus's own isRookie flag is the established source of truth
      // for the board's baseline rows (see dynasty-rankings-rookie-team-data
      // memory) — union with nba_roster's flag rather than overriding it.
      isRookie: p.isRookie || e.isRookie,
      customRank: 0, // set below, after sorting by the FHE/FBI Baseline rank
      // FHE/FBI Baseline = the fbihe expert's own rank (as of 2026-08-02, this
      // IS the FBI-HE co-branded rank, not a stand-in for it — see the
      // fbi-partnership memory), NOT the multi-expert consensus average. A
      // small slice of players aren't individually ranked by fbihe (other
      // experts cover them instead) — consensusRank is the sane fallback so
      // they still land somewhere sensible in the order.
      consensusRank: p.expertRanks.fbihe ?? p.consensusRank,
      // The CURRENT v1.1 multi-expert consensus AVERAGE rank (decimal, e.g. 5.4)
      // — dynasty-rankings.json's own `avgRank`, the exact figure shown as
      // "AVG RANK" on /dynasty-rankings — shown read-only alongside the baseline.
      consensusAvgRank: p.avgRank,
      note: "",
    };
  });

  // Order by the FHE/FBI Baseline rank (fbihe's own list), not
  // DYNASTY_RANKINGS' native (consensus-average) order.
  seeded.sort((a, b) => (a.consensusRank ?? 0) - (b.consensusRank ?? 0));
  return renumber(seeded);
}

/** Every ecosystem player NOT already in the consensus — the pool the
 * "+ Add player" picker searches. Sorted by Minus1V rank (best first, then
 * unprojected players alphabetically) so the most useful adds surface first. */
export async function buildAddablePool(): Promise<EcosystemPlayer[]> {
  const ctx = await loadEnrichmentContext();
  const consensusNames = new Set(DYNASTY_RANKINGS.map((p) => normalizePlayerName(p.player)));

  const pool = ctx.roster
    .filter((r) => !consensusNames.has(normalizePlayerName(r.full_name)))
    .map((r) => enrich(r.full_name, ctx, { team: r.team, position: r.position ?? "", age: null }));

  pool.sort((a, b) => {
    if (a.minus1vRank == null && b.minus1vRank == null) return a.name.localeCompare(b.name);
    if (a.minus1vRank == null) return 1;
    if (b.minus1vRank == null) return -1;
    return a.minus1vRank - b.minus1vRank;
  });
  return pool;
}
