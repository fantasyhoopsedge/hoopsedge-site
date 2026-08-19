/**
 * Merge dated Fantrax redraft-ADP snapshots into one per-player trend file.
 *
 *   npm run adp:build
 *
 * Reads every `data/fantrax-adp/redraft/YYYY-MM-DD.csv` (a raw, committed
 * Fantrax "Players" export — same static-download pattern as
 * `data/nba-salaries/current.csv`: a new dated file gets dropped in every
 * 5-6 days, and this script re-merges the whole history each time it runs).
 *
 * The snapshots so far were exported with different column sets (one carries
 * per-category projections, the other carries roster-%/+/- columns and even
 * repeats a "+/-" header twice) — Fantrax's own export varies by whatever
 * view was open when the CSV was downloaded, and the declared header's
 * column COUNT doesn't even match its own data rows (16 header cells, 18
 * value cells, on the "+/-"-repeating export). What stays identical across
 * every snapshot is the first 12 data columns by POSITION — verified against
 * a Wembanyama/Jokić row in each file: ID, Player, Team, Position, RkOv,
 * Status, Age, Opponent, Salary, Score, %D/Drafted, ADP. So the parser skips
 * the header row entirely and reads those fixed positions, with
 * `relax_column_count` so a longer/shorter tail never throws.
 *
 * The Fantrax "ID" column (`*06cch*`) is the same id space as
 * `data/player-ids/fantrax-players.csv` / `player_identity.fantrax_id` (just
 * without the asterisks), so it is both a stable cross-snapshot join key on
 * its own AND resolvable to `fhe_id` via the bundled identity registry for
 * players already in FHE's ecosystem. Rows with no ADP ("-" — never drafted
 * in enough Fantrax leagues to get one) are dropped entirely, per the ask:
 * "every player with a recorded adp value".
 *
 * Writes `output/adp-trends.json` (gitignored, rebuildable — mirrors
 * `output/season-projections-2026-27.json`).
 */
import { parse } from "csv-parse/sync";
import { promises as fs } from "fs";
import path from "path";
import { playerIdentity } from "../src/lib/player-identity/bundled";
import { normalizeTeamAbbr } from "../src/lib/nba-teams";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "fantrax-adp", "redraft");
const OUT = path.join(process.cwd(), "output", "adp-trends.json");

interface Snapshot {
  date: string;
  rows: Map<string, { name: string; team: string; position: string; adp: number; rkOv: number | null }>;
}

interface PlayerTrend {
  fantraxId: string;
  fheId: string | null;
  name: string;
  team: string;
  position: string;
  history: { date: string; adp: number; rank: number }[];
}

function stripAsterisks(id: string): string {
  return id.replace(/^\*|\*$/g, "").trim();
}

// Fixed positions, identical across every snapshot seen so far — see the
// header comment. NOT resolved from the declared header row, which disagrees
// with itself on column count.
const COL = { ID: 0, PLAYER: 1, TEAM: 2, POSITION: 3, RK_OV: 4, ADP: 11 } as const;

async function loadSnapshot(file: string): Promise<Snapshot> {
  const date = path.basename(file, ".csv");
  const text = await fs.readFile(path.join(SNAPSHOT_DIR, file), "utf8");
  const records: string[][] = parse(text, {
    columns: false, skip_empty_lines: true, relax_quotes: true, relax_column_count: true,
  });

  const rows = new Map<string, { name: string; team: string; position: string; adp: number; rkOv: number | null }>();
  for (const r of records.slice(1)) {
    const adpRaw = r[COL.ADP]?.trim();
    if (!adpRaw || adpRaw === "-") continue; // no recorded ADP
    const adp = Number(adpRaw);
    if (!Number.isFinite(adp)) continue;
    const fantraxId = stripAsterisks(r[COL.ID] ?? "");
    if (!fantraxId) continue;
    const rkOvRaw = r[COL.RK_OV]?.trim();
    const teamRaw = r[COL.TEAM]?.trim() ?? "";
    // "(N/A)" is Fantrax's placeholder for "no NBA team" — same handling as
    // snapshot-fantrax-ids.ts, so this file speaks the same dialect (see
    // nba-teams.ts) instead of leaking a fourth non-canonical placeholder.
    rows.set(fantraxId, {
      name: r[COL.PLAYER]?.trim() ?? "",
      team: teamRaw && teamRaw !== "(N/A)" ? (normalizeTeamAbbr(teamRaw) ?? "") : "",
      position: r[COL.POSITION]?.trim() ?? "",
      adp,
      rkOv: rkOvRaw ? Number(rkOvRaw) : null,
    });
  }
  return { date, rows };
}

async function main(): Promise<void> {
  const files = (await fs.readdir(SNAPSHOT_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No dated snapshots found in ${SNAPSHOT_DIR}`);
  console.log(`Loading ${files.length} snapshot(s): ${files.join(", ")}`);

  const snapshots = await Promise.all(files.map(loadSnapshot));
  const registry = playerIdentity();

  const byFantraxId = new Map<string, PlayerTrend>();
  for (const snap of snapshots) {
    // Rank within THIS snapshot's ADP-having pool, ascending ADP = rank 1.
    const ranked = [...snap.rows.entries()].sort((a, b) => a[1].adp - b[1].adp);
    ranked.forEach(([fantraxId, row], i) => {
      const rank = i + 1;
      let trend = byFantraxId.get(fantraxId);
      if (!trend) {
        const identity = registry.byProviderId("fantraxId", fantraxId);
        trend = {
          fantraxId,
          fheId: identity?.fheId ?? null,
          name: row.name,
          team: row.team,
          position: row.position,
          history: [],
        };
        byFantraxId.set(fantraxId, trend);
      }
      // Keep the most recent snapshot's name/team/position current.
      trend.name = row.name;
      trend.team = row.team;
      trend.position = row.position;
      trend.history.push({ date: snap.date, adp: row.adp, rank });
    });
  }

  const players = [...byFantraxId.values()].sort((a, b) => {
    const aLast = a.history[a.history.length - 1].adp;
    const bLast = b.history[b.history.length - 1].adp;
    return aLast - bLast;
  });

  const linked = players.filter((p) => p.fheId).length;
  console.log(`  ${players.length} players with a recorded ADP (${linked} linked to fhe_id, ${players.length - linked} unlinked)`);

  const out = {
    generatedAt: new Date().toISOString(),
    snapshots: snapshots.map((s) => s.date),
    players,
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`-> ${path.relative(process.cwd(), OUT)}`);

  await reportTop150Movers(players, snapshots.map((s) => s.date));
}

const TOP_N = 150;

/**
 * "Moved up/down from the top 150 ranked players as per the latest reported
 * ADP" — the top 150 as of the newest snapshot, with movement measured
 * against the OLDEST snapshot each player appears in (so a player captured
 * only in the last two snapshots still gets a real, if shorter, delta rather
 * than being silently excluded). Rank delta, not raw ADP delta, is what a
 * reader intuitively means by "moved up 12 spots" — ADP delta is kept
 * alongside it since rank compresses at the tail once ADP tiers cluster.
 */
async function reportTop150Movers(players: PlayerTrend[], dates: string[]): Promise<void> {
  const latestDate = dates[dates.length - 1];
  const latest = players
    .map((p) => ({ p, entry: p.history.find((h) => h.date === latestDate) }))
    .filter((x): x is { p: PlayerTrend; entry: { date: string; adp: number; rank: number } } => !!x.entry)
    .sort((a, b) => a.entry.rank - b.entry.rank)
    .slice(0, TOP_N);

  type Row = {
    name: string; team: string; position: string;
    latestRank: number; latestAdp: number;
    firstDate: string; firstRank: number; firstAdp: number;
    rankDelta: number; adpDelta: number; isNew: boolean;
  };

  const rows: Row[] = latest.map(({ p, entry }) => {
    const first = p.history[0];
    const isNew = first.date === latestDate; // only ever seen in the latest snapshot
    return {
      name: p.name, team: p.team, position: p.position,
      latestRank: entry.rank, latestAdp: entry.adp,
      firstDate: first.date, firstRank: first.rank, firstAdp: first.adp,
      rankDelta: isNew ? 0 : first.rank - entry.rank, // positive = moved up
      adpDelta: isNew ? 0 : first.adp - entry.adp, // positive = ADP dropped (moved up)
      isNew,
    };
  });

  const movers = rows.filter((r) => !r.isNew);
  const risers = [...movers].sort((a, b) => b.rankDelta - a.rankDelta).filter((r) => r.rankDelta > 0);
  const fallers = [...movers].sort((a, b) => a.rankDelta - b.rankDelta).filter((r) => r.rankDelta < 0);
  const newToBoard = rows.filter((r) => r.isNew).sort((a, b) => a.latestRank - b.latestRank);

  const fmt = (r: Row) =>
    `#${String(r.latestRank).padEnd(4)} ${r.name.padEnd(24)} ${r.team.padEnd(4)} ` +
    `${r.rankDelta > 0 ? "+" : ""}${r.rankDelta} rk  (ADP ${r.firstAdp.toFixed(1)} -> ${r.latestAdp.toFixed(1)}, since ${r.firstDate})`;

  console.log(`\nTop ${TOP_N} as of ${latestDate} — biggest risers (of ${movers.length} with prior data, ${newToBoard.length} new):`);
  for (const r of risers.slice(0, 20)) console.log("  " + fmt(r));

  console.log(`\nTop ${TOP_N} as of ${latestDate} — biggest fallers:`);
  for (const r of fallers.slice(0, 20)) console.log("  " + fmt(r));

  if (newToBoard.length > 0) {
    console.log(`\nNew to the top ${TOP_N} this snapshot (no prior ADP on record):`);
    for (const r of newToBoard) console.log(`  #${String(r.latestRank).padEnd(4)} ${r.name.padEnd(24)} ${r.team.padEnd(4)} ADP ${r.latestAdp.toFixed(1)}`);
  }

  const csvEsc = (v: string | number | boolean) => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v));
  const csvCols = ["latestRank", "name", "team", "position", "latestAdp", "firstDate", "firstRank", "firstAdp", "rankDelta", "adpDelta", "isNew"] as const;
  const csv = [csvCols.join(","), ...rows.map((r) => csvCols.map((c) => csvEsc(r[c])).join(","))].join("\n");
  const csvOut = path.join(process.cwd(), "output", "adp-top150-movers.csv");
  await fs.writeFile(csvOut, csv + "\n", "utf8");
  console.log(`\n-> ${path.relative(process.cwd(), csvOut)} (full top ${TOP_N}, all columns)`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
