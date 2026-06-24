import type { SeasonPlayerValues } from "@/types/database";
import { LEAGUE_SIZES, CANONICAL_SIZE } from "@/lib/value/compute-values";
import { SEASON_DATASETS, datasetFromKey, datasetKey } from "@/lib/value/seasons";
import { getStats, getValuesForSize, indexValuesById } from "@/lib/value/seasonal-data";
import rankings from "@/lib/dynasty-rankings.json";
import { SeasonalRankingsTable } from "./_components/seasonal-rankings-table";

// Age comes from the dynasty consensus, keyed by consensus rank (which every
// stat row already carries) — so no extra join or DB column is needed.
const AGE_BY_RANK: Record<number, number> = {};
for (const p of rankings as Array<{ consensusRank: number; age?: number }>) {
  if (typeof p.age === "number") AGE_BY_RANK[p.consensusRank] = p.age;
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
  const [stats, canonicalValues] = await Promise.all([
    getStats(dataset.season, dataset.type),
    getValuesForSize(dataset.season, dataset.type, CANONICAL_SIZE),
  ]);

  const valuesBySize: Record<number, Record<string, SeasonPlayerValues>> = {
    [CANONICAL_SIZE]: indexValuesById(canonicalValues),
  };

  return (
    <SeasonalRankingsTable
      players={stats}
      valuesBySize={valuesBySize}
      leagueSizes={[...LEAGUE_SIZES]}
      canonicalSize={CANONICAL_SIZE}
      seasons={SEASON_DATASETS.map((d) => ({ key: datasetKey(d.season, d.type), label: d.label }))}
      activeSeason={datasetKey(dataset.season, dataset.type)}
      ageByRank={AGE_BY_RANK}
    />
  );
}
