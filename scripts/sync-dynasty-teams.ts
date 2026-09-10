/**
 * Refresh `team` on the dynasty consensus board from the roster CSV.
 *
 * WHY THIS EXISTS
 * The board is published from a 5-expert consensus refresh (see
 * docs/dynasty-rankings-refresh.md), which folds in the roster as the
 * source of truth for name/position/DOB/team at the moment it runs. Between
 * refreshes the ranks stay valid but the TEAMS rot: every trade and signing
 * since the last publish leaves a player on the board attached to a team he
 * no longer plays for. Found 2026-09-10 with DeMar DeRozan (board "FA",
 * really DEN) and Nick Richards (board "FA", really MIA); a full audit
 * turned up 22 of 493.
 *
 * This is deliberately NOT a re-rank. It touches `team` and nothing else, so
 * it can run any time a roster refresh lands without waiting for — or
 * disturbing — the next consensus publish.
 *
 * SOURCE
 * data/nba-rosters/<season>.csv, the same file roster_ingest.ts loads into
 * nba_roster. The CSV rather than the table so this needs no credentials and
 * is deterministic in CI; they carry the same rows by construction.
 *
 * A PLAYER THE CSV DOESN'T NAME IS LEFT ALONE.
 * Absence is not a claim of free agency: the CSV carries explicit `FA` rows
 * (team = "FA") for genuinely unsigned players, so a name it never mentions
 * is a player it knows nothing about — waived, overseas, retired, or simply
 * missing from the file. Rewriting those to "FA" would launder a gap in the
 * data into a factual assertion on the public board. They are reported
 * instead, which is also how a real CSV gap gets noticed.
 *
 * Usage:
 *   npx tsx scripts/sync-dynasty-teams.ts            # report only
 *   npx tsx scripts/sync-dynasty-teams.ts --apply    # write the board
 */
import fs from "fs";
import path from "path";
import { normalizePlayerName } from "../src/lib/dynasty-rankings";
import { normalizeTeamAbbr } from "../src/lib/nba-teams";

const ROSTER_SEASON = "2026-27";
const BOARD_PATH = path.join(process.cwd(), "src", "lib", "dynasty-rankings.json");
const ROSTER_PATH = path.join(process.cwd(), "data", "nba-rosters", `${ROSTER_SEASON}.csv`);

interface BoardPlayer {
  consensusRank: number;
  player: string;
  team: string;
  [key: string]: unknown;
}

function loadRosterTeams(): Map<string, string> {
  const lines = fs.readFileSync(ROSTER_PATH, "utf8").split(/\r?\n/);
  const header = lines[0].split(",");
  const iName = header.indexOf("player");
  const iTeam = header.indexOf("team");
  if (iName < 0 || iTeam < 0) throw new Error(`${ROSTER_PATH}: expected 'player' and 'team' columns`);

  const byName = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const name = cells[iName];
    const team = cells[iTeam];
    if (!name || !team) continue;
    // normalizeTeamAbbr folds every dialect (PHX/NOP/UFA…) onto the canonical
    // code — see src/lib/nba-teams.ts. Never write a raw CSV value. It returns
    // null for an unreadable one, which is skipped rather than written: a
    // blank team on the public board is worse than a stale one.
    const canonical = normalizeTeamAbbr(team);
    if (canonical) byName.set(normalizePlayerName(name), canonical);
  }
  return byName;
}

function main() {
  const apply = process.argv.includes("--apply");
  const roster = loadRosterTeams();
  const board = JSON.parse(fs.readFileSync(BOARD_PATH, "utf8")) as BoardPlayer[];

  const changed: { rank: number; player: string; from: string; to: string }[] = [];
  const unmatched: { rank: number; player: string; team: string }[] = [];
  let agree = 0;

  for (const p of board) {
    const team = roster.get(normalizePlayerName(p.player));
    if (team == null) {
      unmatched.push({ rank: p.consensusRank, player: p.player, team: p.team });
      continue;
    }
    if (team === p.team) {
      agree += 1;
      continue;
    }
    changed.push({ rank: p.consensusRank, player: p.player, from: p.team, to: team });
    p.team = team;
  }

  console.log(`Board ${board.length} players · roster ${ROSTER_SEASON} (${roster.size} names)`);
  console.log(`  already correct : ${agree}`);
  console.log(`  updated         : ${changed.length}`);
  console.log(`  not on roster   : ${unmatched.length} (left untouched)`);

  if (changed.length > 0) {
    console.log("\nTeam changes:");
    for (const c of changed.sort((a, b) => a.rank - b.rank)) {
      console.log(`  #${String(c.rank).padEnd(4)} ${c.player.padEnd(28)} ${c.from.padStart(3)} -> ${c.to}`);
    }
  }
  if (unmatched.length > 0) {
    console.log("\nNot named by the roster CSV — verify these by hand rather than assuming FA:");
    for (const u of unmatched.sort((a, b) => a.rank - b.rank)) {
      console.log(`  #${String(u.rank).padEnd(4)} ${u.player.padEnd(28)} board says ${u.team}`);
    }
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to update the board.");
    return;
  }
  if (changed.length === 0) {
    console.log("\nNothing to write.");
    return;
  }
  // Trailing newline: the file is committed, and every other JSON in the repo
  // ends with one — without it every apply shows a spurious last-line diff.
  fs.writeFileSync(BOARD_PATH, `${JSON.stringify(board, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${changed.length} team changes to ${path.relative(process.cwd(), BOARD_PATH)}.`);
  console.log("Downstream tables still hold the old teams — run `npm run dynasty:sync` next.");
}

main();
