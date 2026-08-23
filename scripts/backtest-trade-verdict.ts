/**
 * Full backtest: does trade-verdict.ts's star-concentration-aware adjustment
 * (players AND picks, now that picks carry real value) agree with real human
 * trade votes on all 85 Downtown Fantasy Sports trades — not just the 19
 * player-only ones scripts/backtest-surplus-model.ts covered?
 *
 * Not a permanent build script — run once via `npx tsx scripts/backtest-trade-verdict.ts`.
 */
import * as fs from "fs";
import { loadEnv } from "./nba-data/client";
loadEnv();
import { createAdminClient } from "../src/utils/supabase/admin";
import { playerIdentity } from "../src/lib/player-identity/bundled";
import { computeTradeVerdict } from "../src/lib/fantrax/trade-verdict";
import type { ResolvedPlayer } from "../src/lib/fantrax/analyze";
import type { TeamDraftPick } from "../src/lib/fantrax/league";

interface Row {
  date: string; ta: string; taGets: string; tb: string; tbGets: string;
  vaP: number; vbP: number; vfP: number; tot: number;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur);
  return out;
}

function loadRows(): Row[] {
  const lines = fs.readFileSync("data/downtown-fantasy-trade-analysis.csv", "utf8").trim().split("\n").slice(1);
  return lines.map((l) => {
    const f = parseCsvLine(l);
    const [date, , ta, taGets, , tb, tbGets, , vaP, , vbP, , vfP, , tot] = f;
    return { date, ta, taGets, tb, tbGets, vaP: Number(vaP), vbP: Number(vbP), vfP: Number(vfP), tot: Number(tot) };
  });
}

type Item = { kind: "player"; name: string } | { kind: "pick"; pick: TeamDraftPick } | { kind: "cash" };

function parseItems(gets: string): Item[] {
  if (gets === "(nothing)") return [];
  return gets.split("; ").map((raw): Item => {
    const pickMatch = raw.match(/^(\d{4}) Pick (\d+)$/);
    if (pickMatch) {
      const year = Number(pickMatch[1]);
      const overallPick = Number(pickMatch[2]);
      return { kind: "pick", pick: { year, round: Math.ceil(overallPick / 30), overallPick, originalOwnerLabel: null } };
    }
    const rdMatch = raw.match(/^(\d{4}) Rd (\d+)$/);
    if (rdMatch) {
      return { kind: "pick", pick: { year: Number(rdMatch[1]), round: Number(rdMatch[2]), originalOwnerLabel: null } };
    }
    if (/FAAB/.test(raw)) return { kind: "cash" };
    const name = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return { kind: "player", name };
  });
}

function realVerdict(r: Row): "A" | "B" | "Fair" {
  const max = Math.max(r.vaP, r.vbP, r.vfP);
  if (max === r.vfP) return "Fair";
  return max === r.vaP ? "A" : "B";
}

async function main() {
  const rows = loadRows();
  const idx = playerIdentity();
  const admin = createAdminClient();

  const allNames = new Set<string>();
  for (const r of rows) {
    for (const item of [...parseItems(r.taGets), ...parseItems(r.tbGets)]) {
      if (item.kind === "player") allNames.add(item.name);
    }
  }

  const espnIdByName = new Map<string, string>();
  const unresolved: string[] = [];
  for (const name of allNames) {
    const res = idx.resolve({ name });
    if (res.kind === "matched" && res.identity.espnId) espnIdByName.set(name, res.identity.espnId);
    else unresolved.push(`${name} (${res.kind})`);
  }
  if (unresolved.length) console.log("UNRESOLVED:", unresolved.join(", "));

  // Pull the REAL full 450-player pool (not just the ~125 names that happen
  // to appear in these trades) — the adjustment's pool-percentile term is a
  // ^8 power, very sensitive to being ranked against a tiny, skewed sample
  // instead of the real baseline pool every other FHE value already uses.
  const { data: svRows, error } = await admin
    .from("season_player_values")
    .select("player_id,minus1v")
    .eq("season", 2027)
    .eq("season_type", "projection")
    .eq("league_size", 450);
  if (error) throw error;
  const minus1vByEspn = new Map((svRows ?? []).map((r) => [r.player_id as string, r.minus1v as number | null]));
  console.log(`Full pool fetched: ${svRows?.length ?? 0} players (season 2027 projection, league_size 450).`);

  // Rank against the FULL pool, then look up each trade-relevant name's rank
  // within it — this is the rank fakePlayer()/catVRank below actually uses.
  const fullSorted = [...minus1vByEspn.entries()]
    .filter((e): e is [string, number] => e[1] != null)
    .sort((a, b) => b[1] - a[1]);
  const rankByEspn = new Map(fullSorted.map(([eid], i) => [eid, i + 1]));
  const poolSize = fullSorted.length;
  const rankByName = new Map(
    [...espnIdByName.entries()]
      .map(([name, eid]) => [name, rankByEspn.get(eid)] as const)
      .filter((e): e is [string, number] => e[1] != null),
  );

  function fakePlayer(name: string): ResolvedPlayer | null {
    const eid = espnIdByName.get(name);
    if (!eid) return null;
    const v = minus1vByEspn.get(eid);
    if (v == null) return null;
    return {
      // fantraxId must be the ESPN id, matching baseValueByFantraxId's keys
      // (built from the pool below, which is eid-keyed) — NOT the name, or
      // every trade-participant player silently misses the map lookup and
      // scores as null (skipped, contributing 0 to its side's total).
      fantraxId: eid, name, slot: "Bench", eligible: [], nbaTeam: "", status: "", salary: null, contract: null,
      playerId: null, fheId: null, source: "projection", cats: {}, catsTotals: {}, leagueV: null, pointsValue: null,
      nineCatV: null, consensusRank: null, gamesPlayed: null, minutesPerGame: null, usgPct: null, statLine: null,
      catV: { perGame: { nineCatV: null, minus1V: v, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      catVRank: { perGame: { nineCatV: null, minus1V: rankByName.get(name) ?? null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      trendTags: null, ambiguousName: false, smallSample: false, isRookie: false,
    } as unknown as ResolvedPlayer;
  }

  // The full pool computeTradeVerdict ranks against — every one of the real
  // 450 rows, not just the trade participants (id is the espnId; only the
  // handful that are also trade participants get a readable `name`/label
  // via the fakePlayer() lookup above, but every row's real minus1V/rank
  // still counts toward the pool distribution).
  function fakePoolPlayer(eid: string, v: number, rank: number): ResolvedPlayer {
    return {
      fantraxId: eid, name: eid, slot: "Bench", eligible: [], nbaTeam: "", status: "", salary: null, contract: null,
      playerId: null, fheId: null, source: "projection", cats: {}, catsTotals: {}, leagueV: null, pointsValue: null,
      nineCatV: null, consensusRank: null, gamesPlayed: null, minutesPerGame: null, usgPct: null, statLine: null,
      catV: { perGame: { nineCatV: null, minus1V: v, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      catVRank: { perGame: { nineCatV: null, minus1V: rank, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      trendTags: null, ambiguousName: false, smallSample: false, isRookie: false,
    } as unknown as ResolvedPlayer;
  }
  const leaguePlayers = fullSorted.map(([eid, v], i) => fakePoolPlayer(eid, v, i + 1));
  // computeTradeVerdict now takes a precomputed base-value map (trade-value.ts)
  // instead of a mode — this backtest's base value is each player's own
  // minus1V, same as the old "minus1V" mode it used to pass directly.
  const baseValueByFantraxId = new Map(fullSorted.map(([eid, v]) => [eid, v]));
  const resolvedNames = [...espnIdByName.keys()].filter((n) => rankByName.has(n));
  console.log(`\nFull pool: ${leaguePlayers.length} players. ${resolvedNames.length}/${allNames.size} trade-participant names resolved into it.\n`);

  let matches = 0, total = 0, skippedCash = 0;
  for (const r of rows) {
    const aItems = parseItems(r.taGets);
    const bItems = parseItems(r.tbGets);
    if (aItems.some((i) => i.kind === "cash") || bItems.some((i) => i.kind === "cash")) {
      // FAAB has no value in this model either — still score the trade off
      // whatever non-cash assets exist on each side (several trades in the
      // dataset are pick/player-for-FAAB, so skipping them entirely would
      // throw away real signal).
      skippedCash++;
    }
    function toAssets(items: Item[]) {
      return items.flatMap((it) => {
        if (it.kind === "player") {
          const p = fakePlayer(it.name);
          return p ? [{ label: it.name, player: p }] : [];
        }
        if (it.kind === "pick") return [{ label: `${it.pick.year} Rd${it.pick.round}`, pick: it.pick }];
        return [];
      });
    }
    const aAssets = toAssets(aItems);
    const bAssets = toAssets(bItems);
    if (aAssets.length === 0 && bAssets.length === 0) continue; // pure FAAB-for-FAAB, nothing to score

    const verdict = computeTradeVerdict(aAssets, bAssets, leaguePlayers, baseValueByFantraxId, "categories");
    const real = realVerdict(r);
    const predicted = verdict.winner;
    const match = predicted === real;
    total++;
    if (match) matches++;
    console.log(
      `${r.date} ${r.ta} <-> ${r.tb} | A_adj=${verdict.sideA.adjustedTotal.toFixed(3)} B_adj=${verdict.sideB.adjustedTotal.toFixed(3)} variance=${(verdict.variancePct * 100).toFixed(0)}% | predicted=${predicted} real=${real} (A${r.vaP}%/B${r.vbP}%/Fair${r.vfP}%) ${match ? "MATCH" : "miss"}`,
    );
  }

  console.log(`\n${matches}/${total} matched (${((matches / total) * 100).toFixed(0)}%). ${skippedCash} trade(s) involved FAAB (scored on remaining assets, FAAB itself valued at $0).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
