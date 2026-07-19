import type { SeasonPlayerValues } from "@/types/database";
import { LEAGUE_SIZES, CANONICAL_SIZE } from "@/lib/value/compute-values";
import { SEASON_DATASETS, datasetFromKey, datasetKey } from "@/lib/value/seasons";
import { getStats, getValuesForSize, indexValuesById } from "@/lib/value/seasonal-data";
import { getDraftYears } from "@/app/team-rosters/_components/roster-live-data";
import rankings from "@/lib/dynasty-rankings.json";
import { normalizePlayerName } from "@/lib/dynasty-rankings";
import { SeasonalRankingsTable } from "./_components/seasonal-rankings-table";

// Age comes from the dynasty consensus, keyed by normalized player name.
// IMPORTANT: this must NOT be keyed by consensusRank. A stat row's persisted
// `consensus_rank` (written once, at seasonal:build time) goes stale the
// instant a dynasty refresh reshuffles ranks — until seasonal:build reruns,
// that rank number now belongs to a different player, and an age lookup by
// rank silently attaches a stranger's age to the row (e.g. a 36-year-old
// showing a rookie's age after a refresh moved him off his old rank). Name is
// the one identifier that survives a rank reshuffle untouched.
const AGE_BY_NAME: Record<string, number> = {};
for (const p of rankings as Array<{ player: string; age?: number }>) {
  if (typeof p.age === "number") AGE_BY_NAME[normalizePlayerName(p.player)] = p.age;
}

// Cached, cookieless reads (see @/lib/value/seasonal-data). Each request renders
// dynamically per dataset, but the data is served from a 15-minute cache.
export const dynamic = "force-dynamic";

export default async function SeasonalRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const dKey = typeof sp.d === "string" ? sp.d : undefined;
  const dataset = datasetFromKey(dKey);

  // Only the canonical league size is shipped on first render (~600 value rows
  // instead of ~6,000 across all 10 sizes). Other sizes load on demand via
  // /api/seasonal-values when the Player Pool changes. This keeps the initial
  // payload ~10× smaller, which dominated both render and transfer time.
  const canonicalSize = dataset.defaultSize ?? CANONICAL_SIZE;

  const [stats, canonicalValues, draftYears] = await Promise.all([
    getStats(dataset.season, dataset.type),
    getValuesForSize(dataset.season, dataset.type, canonicalSize),
    getDraftYears(),
  ]);

  const valuesBySize: Record<number, Record<string, SeasonPlayerValues>> = {
    [canonicalSize]: indexValuesById(canonicalValues),
  };

  return (
    <SeasonalRankingsTable
      players={stats}
      valuesBySize={valuesBySize}
      leagueSizes={[...LEAGUE_SIZES]}
      canonicalSize={canonicalSize}
      seasons={SEASON_DATASETS.map((d) => ({ key: datasetKey(d.season, d.type), label: d.label }))}
      activeSeason={datasetKey(dataset.season, dataset.type)}
      ageByName={AGE_BY_NAME}
      draftYearByName={draftYears}
    />
  );
}
