import { NextResponse } from "next/server";
import { FantraxError, isLeagueId } from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { getCachedLeagueAnalysis } from "@/lib/fantrax/league-cache";
import { FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";

/**
 * Import a Fantrax league and analyse it against FHE category values.
 *
 *   GET /api/fantrax/league?leagueId=…&teamId=…&dataset=2027:projection
 *
 * Every Fantrax call made here is league-scoped and therefore key-less — no
 * Secret ID reaches this route, by design (see src/lib/fantrax/api.ts and
 * /privacy §4). The browser holds the secret and only ever sends us a league id.
 *
 * The actual fetch+analyze work is cached 60s in league-cache.ts, shared with
 * /api/fantrax/roster-edge — see that file's own doc for why a plain
 * `next: {revalidate}` on each fetch() wasn't enough (force-dynamic silently
 * defeats it).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const leagueId = (searchParams.get("leagueId") ?? "").trim();
  const teamId = searchParams.get("teamId")?.trim() || null;
  const datasetParam = searchParams.get("dataset") ?? FANTRAX_DATASETS[0].key;
  const leagueTypeParam = searchParams.get("leagueType");
  const leagueType: "redraft" | "keeper" | "dynasty" =
    leagueTypeParam === "keeper" || leagueTypeParam === "dynasty" ? leagueTypeParam : "redraft";

  if (!isLeagueId(leagueId)) {
    return NextResponse.json(
      { error: "That doesn't look like a Fantrax league ID (16 letters/numbers)." },
      { status: 400 },
    );
  }
  const dataset = FANTRAX_DATASETS.find((d) => d.key === datasetParam)?.key as FantraxDatasetKey | undefined;
  if (!dataset) {
    return NextResponse.json({ error: "Unknown dataset." }, { status: 400 });
  }

  try {
    const analysis = await getCachedLeagueAnalysis(leagueId, teamId, dataset, leagueType);
    return NextResponse.json(analysis);
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
