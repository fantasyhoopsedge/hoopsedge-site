import type { SeasonPlayerValues } from "@/types/database";
import { LEAGUE_SIZES, CANONICAL_SIZE } from "@/lib/value/compute-values";
import { SEASON_DATASETS, datasetFromKey, datasetKey } from "@/lib/value/seasons";
import {
  getStats, getValuesForSize, getPointsLeagueValues, indexValuesById, indexPointsById,
} from "@/lib/value/seasonal-data";
import { getDraftYears } from "@/app/team-rosters/_components/roster-live-data";
import rankings from "@/lib/dynasty-rankings.json";
import { playerIdentity } from "@/lib/player-identity/bundled";
import { SeasonalRankingsTable } from "./_components/seasonal-rankings-table";

/**
 * Age comes from the dynasty consensus, keyed by `fhe_id`.
 *
 * IMPORTANT: this must NEVER be keyed by consensusRank. A stat row's persisted
 * `consensus_rank` (written once, at seasonal:build time) goes stale the instant
 * a dynasty refresh reshuffles ranks — until seasonal:build reruns, that rank
 * number belongs to a different player, and an age lookup by rank silently
 * attaches a stranger's age to the row. That shipped: James Harden displayed as
 * 19 because his rank moved 52→62 and rank 52 was reused.
 *
 * The fix at the time was to key on normalized name instead. Identity is the
 * same fix done properly, and measurably better: across all 12 datasets the id
 * join loses nobody and gains three per season — Herbert Jones, Cameron Johnson
 * and Ronald Holland II, whose stat rows use their legal names while the board
 * uses the nicknames, so this page has been showing them a blank age and a blank
 * rookie/sophomore badge.
 *
 * There is deliberately NO name fallback. This page's whole scar is a join that
 * confidently returned the wrong human's age; a fallback would reintroduce
 * exactly that risk for namesakes, and the measurement says it would buy nothing.
 *
 * Resolved here, in the SERVER component, so the ~230 KB registry never reaches
 * the browser — the table receives a plain id→age map.
 */
const AGE_BY_FHE_ID: Record<string, number> = {};
for (const p of rankings as Array<{ player: string; age?: number }>) {
  if (typeof p.age !== "number") continue;
  const res = playerIdentity().resolve({ name: p.player });
  if (res.kind === "matched" && AGE_BY_FHE_ID[res.identity.fheId] == null) {
    AGE_BY_FHE_ID[res.identity.fheId] = p.age;
  }
}

// Cached, cookieless reads (see @/lib/value/seasonal-data). Each request renders
// dynamically per dataset, but the data is served from a 15-minute cache.
export const dynamic = "force-dynamic";

// The Value-mode dropdown's options — a real query param (?v=) rather than
// pure client state, so a Points League or 9CatV view is a crawlable,
// shareable URL instead of only reachable by a dropdown click. See
// sitemap.ts, which links directly to `?v=points` and the projections
// dataset now that both are real, indexable states.
const VALUE_MODES = ["9cat", "8cat", "minus1v", "points"] as const;
type ValueMode = (typeof VALUE_MODES)[number];

export default async function SeasonalRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const dKey = typeof sp.d === "string" ? sp.d : undefined;
  const dataset = datasetFromKey(dKey);
  const vParam = typeof sp.v === "string" ? sp.v : undefined;
  const initialValueMode: ValueMode = (VALUE_MODES as readonly string[]).includes(vParam ?? "")
    ? (vParam as ValueMode)
    : "9cat";

  // Only the canonical league size is shipped on first render (~600 value rows
  // instead of ~6,000 across all 10 sizes). Other sizes load on demand via
  // /api/seasonal-values when the Player Pool changes. This keeps the initial
  // payload ~10× smaller, which dominated both render and transfer time.
  const canonicalSize = dataset.defaultSize ?? CANONICAL_SIZE;

  const [stats, canonicalValues, draftYears, pointsRows] = await Promise.all([
    getStats(dataset.season, dataset.type),
    getValuesForSize(dataset.season, dataset.type, canonicalSize),
    getDraftYears(),
    getPointsLeagueValues(dataset.season, dataset.type),
  ]);

  const valuesBySize: Record<number, Record<string, SeasonPlayerValues>> = {
    [canonicalSize]: indexValuesById(canonicalValues),
  };

  return (
    <SeasonalRankingsTable
      players={stats}
      valuesBySize={valuesBySize}
      pointsValues={indexPointsById(pointsRows)}
      leagueSizes={[...LEAGUE_SIZES]}
      canonicalSize={canonicalSize}
      seasons={SEASON_DATASETS.map((d) => ({ key: datasetKey(d.season, d.type), label: d.label }))}
      activeSeason={datasetKey(dataset.season, dataset.type)}
      initialValueMode={initialValueMode}
      ageByFheId={AGE_BY_FHE_ID}
      draftYearByFheId={draftYears}
    />
  );
}
