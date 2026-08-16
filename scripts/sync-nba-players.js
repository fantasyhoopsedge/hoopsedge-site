#!/usr/bin/env node
/**
 * Sync NBA player IDs from stats.nba.com → src/lib/nba-player-ids.json
 *
 * Output shape: { "<normalized name>": { id, name, team, position } }
 *
 * Run: npx tsx scripts/sync-nba-players.js
 *
 * (tsx rather than node, because the normalizer below is a TypeScript module.
 * This script's output is the headshot id map the registry merges, so it must
 * key on exactly the same normalized names as everything else — worth one
 * loader for.)
 *
 * The NBA Stats API requires browser-like headers or it returns 403/hangs.
 */

const fs = require("fs");
const path = require("path");
const { normalizePlayerName: normalizeName } = require("../src/lib/player-identity/normalize");

const URL =
  "https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2026-27&IsOnlyCurrentSeason=1";

const HEADERS = {
  Host: "stats.nba.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  Connection: "keep-alive",
};

// stats.nba.com uses NOP/PHX for New Orleans/Phoenix — the FHE standard
// (docs/FHE_NBA_team_standard_abr.txt / src/lib/nba-teams.ts) is NOR/PHO.
// This is a plain .js file run via `node`, not `tsx`, so it can't import the
// TS module directly — keep this table in sync with nba-teams.ts by hand.
const TEAM_ALIASES = { NOP: "NOR", PHX: "PHO" };
function normalizeTeamAbbr(raw) {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  return TEAM_ALIASES[t] || t || null;
}

// normalizeName is imported at the top — see the header note on running under tsx.

async function main() {
  process.stdout.write("Fetching NBA player list... ");

  const res = await fetch(URL, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`NBA Stats API returned ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const set = data.resultSets && data.resultSets[0];
  if (!set || !Array.isArray(set.rowSet)) {
    throw new Error("Unexpected response shape from NBA Stats API");
  }

  const cols = set.headers.reduce((acc, h, i) => {
    acc[h] = i;
    return acc;
  }, {});

  // Required column indices
  const idIdx = cols.PERSON_ID;
  const nameIdx = cols.DISPLAY_FIRST_LAST;
  const teamIdx = cols.TEAM_ABBREVIATION;
  // CommonAllPlayers doesn't return position — leave blank; downstream code only needs id.
  const posIdx = cols.POSITION;

  const out = {};
  let count = 0;
  for (const row of set.rowSet) {
    const id = row[idIdx];
    const name = row[nameIdx];
    if (!id || !name) continue;
    const key = normalizeName(name);
    out[key] = {
      id: String(id),
      name,
      team: teamIdx != null ? normalizeTeamAbbr(row[teamIdx]) : null,
      position: posIdx != null ? row[posIdx] || null : null,
    };
    count++;
  }

  const outPath = path.resolve(__dirname, "..", "src", "lib", "nba-player-ids.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  process.stdout.write(`done.\n`);
  console.log(`Wrote ${count} players to ${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
