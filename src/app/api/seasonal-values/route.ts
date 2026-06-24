import { LEAGUE_SIZES } from "@/lib/value/compute-values";
import { SEASON_DATASETS } from "@/lib/value/seasons";
import { getValuesForSize } from "@/lib/value/seasonal-data";

// On-demand value rows for one league size of a dataset, used when the Player
// Pool dropdown changes (the page ships only the canonical size up front).
// Public, precomputed data → served from the same 15-minute cache as the page.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = Number(searchParams.get("season"));
  const type = searchParams.get("type") ?? "";
  const size = Number(searchParams.get("size"));

  // Validate against the known dataset/size menus so the endpoint can't be used
  // to probe arbitrary (season, type, size) combinations.
  const validDataset = SEASON_DATASETS.some((d) => d.season === season && d.type === type);
  const validSize = (LEAGUE_SIZES as readonly number[]).includes(size);
  if (!validDataset || !validSize) {
    return Response.json({ error: "invalid dataset or size" }, { status: 400 });
  }

  const rows = await getValuesForSize(season, type, size);
  return Response.json(rows);
}
