import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SEASON_DATASETS } from "@/lib/value/seasons";

// Serves ONE player's block-level value trend from the JSON build artifact
// written by `npm run trends:build` (output/player-trends/{season}-{type}.json).
// Reads the file server-side and returns only the requested player's object —
// the client never receives the full-league payload.
export const runtime = "nodejs"; // fs access requires Node, not edge
export const dynamic = "force-dynamic";

const REVALIDATE_MS = 900_000;

type TrendsFile = {
  season: number;
  seasonType: string;
  generatedAt: string;
  players: Array<{ playerId: string; [key: string]: unknown }>;
};

// Plain in-memory cache, not unstable_cache: the per-block cumRank fields push
// this file past Next's 2MB-per-entry data-cache limit (unstable_cache would
// throw "items over 2MB can not be cached" and break every request).
const fileCache = new Map<string, { data: TrendsFile | null; expiresAt: number }>();

async function readTrendsFile(season: number, type: string): Promise<TrendsFile | null> {
  const key = `${season}:${type}`;
  const cached = fileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const path = resolve(process.cwd(), "output/player-trends", `${season}-${type}.json`);
  let data: TrendsFile | null;
  try {
    const raw = await readFile(path, "utf8");
    data = JSON.parse(raw) as TrendsFile;
  } catch {
    data = null; // not built yet for this dataset
  }
  fileCache.set(key, { data, expiresAt: Date.now() + REVALIDATE_MS });
  return data;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get("player_id");
  const season = Number(searchParams.get("season"));
  const type = searchParams.get("type") ?? "";

  const validDataset = SEASON_DATASETS.some((d) => d.season === season && d.type === type);
  if (!playerId || !validDataset) {
    return Response.json({ error: "invalid player_id or dataset" }, { status: 400 });
  }

  const file = await readTrendsFile(season, type);
  if (!file) {
    return Response.json({ error: "trends not built for this dataset" }, { status: 404 });
  }

  const player = file.players.find((p) => p.playerId === playerId);
  if (!player) {
    return Response.json({ error: "player not found or not display-eligible" }, { status: 404 });
  }

  return Response.json(player);
}
