/**
 * Snapshot the Fantrax NBA player-id feed to a committed CSV.
 *
 *   npm run fantrax:snapshot
 *
 * Writes data/player-ids/fantrax-players.csv, the identity source
 * scripts/build-player-identity.ts reads. Same shape as the Basketball Monster
 * CSV: a committed, diffable snapshot rather than a live fetch, so the registry
 * build stays deterministic, offline-capable, and unaffected by fantrax.com
 * being slow or down.
 *
 * Fantrax's getPlayerIds is the single richest id source FHE has — beyond its
 * own player id it relays Rotowire, SportRadar and StatsInc ids, which are the
 * keys most future data partners (injury feeds, odds, news) actually speak.
 * Measured 2026-08-03 over 1,816 players: rotowire 95%, sportradar 79%,
 * statsinc 47%.
 *
 * No credentials involved: getPlayerIds is key-less, like every Fantrax endpoint
 * except getLeagues. The Secret ID never enters a server-side script — see
 * src/lib/fantrax/api.ts and /privacy section 4.
 */
import { promises as fs } from "fs";
import path from "path";
import { fetchPlayerIds, toDisplayName } from "../src/lib/fantrax/api";
import { normalizeName } from "./nba-data/client";
import { normalizeTeamAbbr } from "../src/lib/nba-teams";

const OUT = path.join(process.cwd(), "data", "player-ids", "fantrax-players.csv");
const COLUMNS = [
  "fantrax_id", "name", "norm_name", "team", "position",
  "rotowire_id", "sportradar_id", "statsinc_id",
] as const;

const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main(): Promise<void> {
  console.log("Fetching Fantrax NBA player ids…");
  const feed = await fetchPlayerIds("NBA");
  const entries = Object.values(feed);
  console.log(`  ${entries.length} players`);

  const rows = entries
    .map((p) => {
      const name = toDisplayName(p.name);
      return {
        fantrax_id: p.fantraxId,
        name,
        norm_name: normalizeName(name),
        // "(N/A)" is Fantrax's placeholder for a player with no NBA team; keep
        // it blank rather than inventing one, and normalise the rest so this
        // file speaks the same dialect as everything else (see nba-teams.ts).
        team: p.team && p.team !== "(N/A)" ? (normalizeTeamAbbr(p.team) ?? "") : "",
        position: p.position ?? "",
        rotowire_id: p.rotowireId != null ? String(p.rotowireId) : "",
        sportradar_id: p.sportRadarId ?? "",
        statsinc_id: p.statsIncId != null ? String(p.statsIncId) : "",
      };
    })
    .filter((r) => r.norm_name)
    .sort((a, b) => a.name.localeCompare(b.name));

  const csv = [
    COLUMNS.join(","),
    ...rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(",")),
  ].join("\n");

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${csv}\n`, "utf8");

  const pct = (n: number) => `${n} (${((n / rows.length) * 100).toFixed(0)}%)`;
  console.log(`\n${rows.length} rows -> ${path.relative(process.cwd(), OUT)}`);
  console.log(`  rotowire_id   ${pct(rows.filter((r) => r.rotowire_id).length)}`);
  console.log(`  sportradar_id ${pct(rows.filter((r) => r.sportradar_id).length)}`);
  console.log(`  statsinc_id   ${pct(rows.filter((r) => r.statsinc_id).length)}`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
