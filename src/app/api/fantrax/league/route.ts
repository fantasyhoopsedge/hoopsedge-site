import { NextResponse } from "next/server";
import {
  FantraxError, fetchDraftResults, fetchLeagueInfo, fetchPlayerIds, fetchStandings,
  fetchTeamRosters, isLeagueId,
} from "@/lib/fantrax/api";
import { authorizeFantrax } from "@/lib/fantrax/guard";
import { buildLeague } from "@/lib/fantrax/league";
import { analyzeLeague, FANTRAX_DATASETS, type FantraxDatasetKey } from "@/lib/fantrax/resolve";

/**
 * Import a Fantrax league and analyse it against FHE category values.
 *
 *   GET /api/fantrax/league?leagueId=…&teamId=…&dataset=2027:projection
 *
 * Every Fantrax call made here is league-scoped and therefore key-less — no
 * Secret ID reaches this route, by design (see src/lib/fantrax/api.ts and
 * /privacy §4). The browser holds the secret and only ever sends us a league id.
 *
 * Fantrax payloads are cached briefly: settings and the sport-wide player-id map
 * barely move, while rosters change on every add/drop, so they get the shorter
 * TTL. A live draft is the one case where staleness is visible, hence 60s rather
 * than something longer.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SETTINGS_TTL = 300;
const ROSTER_TTL = 60;
const PLAYER_IDS_TTL = 3600;

export async function GET(request: Request) {
  const auth = await authorizeFantrax();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const leagueId = (searchParams.get("leagueId") ?? "").trim();
  const teamId = searchParams.get("teamId")?.trim() || null;
  const datasetParam = searchParams.get("dataset") ?? FANTRAX_DATASETS[0].key;

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
    const [info, rosters, standings, draft, playerIds] = await Promise.all([
      fetchLeagueInfo(leagueId, { next: { revalidate: SETTINGS_TTL } }),
      fetchTeamRosters(leagueId, { next: { revalidate: ROSTER_TTL } }),
      fetchStandings(leagueId, { next: { revalidate: ROSTER_TTL } }),
      // A league that hasn't drafted yet 404s here; that's informational, not fatal.
      fetchDraftResults(leagueId, { next: { revalidate: ROSTER_TTL } }).catch(() => null),
      fetchPlayerIds("NBA", { next: { revalidate: PLAYER_IDS_TTL } }),
    ]);

    if (!info?.leagueName) {
      return NextResponse.json(
        { error: "Fantrax returned no settings for that league ID. Check the code and try again." },
        { status: 404 },
      );
    }

    const league = buildLeague(leagueId, info, rosters, standings, draft, playerIds);
    const analysis = await analyzeLeague(league, teamId, dataset);
    return NextResponse.json(analysis);
  } catch (err) {
    if (err instanceof FantraxError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 404 ? 404 : 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
