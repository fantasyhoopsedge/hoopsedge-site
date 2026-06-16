#!/usr/bin/env node
/**
 * One-off migration: remove FA duplicate rows for players who also have a
 * real-team row, merging the FA row's expert rank(s) into the real-team row.
 *
 * Affected players (FA donor → real-team keeper):
 *   Alexandre Sarr (FA)     → Alex Sarr (WAS)
 *   Nicolas Claxton (FA)    → Nic Claxton (BKN)
 *   Carlton Carrington (FA) → Bub Carrington (WAS)
 *   Ron Holland II (FA)     → Ronald Holland (DET)
 *
 * After merging: recompute avgRank + rankedByCount for the keepers, then
 * recompute consensusRank for everyone (sort by avgRank asc, stable so existing
 * tie order is preserved). Tiers are left untouched.
 *
 * Run: node scripts/dedup-fa-players.js
 */

const fs = require("fs");
const path = require("path");

const RANKINGS_PATH = path.resolve(__dirname, "..", "src", "lib", "dynasty-rankings.json");

// FA duplicate player name → real-team keeper player name
const PAIRS = [
  ["Alexandre Sarr", "Alex Sarr"],
  ["Nicolas Claxton", "Nic Claxton"],
  ["Carlton Carrington", "Bub Carrington"],
  ["Ron Holland II", "Ronald Holland"],
];

function recompute(er) {
  const ranks = Object.values(er).filter((v) => typeof v === "number");
  const rankedByCount = ranks.length;
  const avgRank = Number((ranks.reduce((s, n) => s + n, 0) / rankedByCount).toFixed(4));
  return { avgRank, rankedByCount };
}

const players = JSON.parse(fs.readFileSync(RANKINGS_PATH, "utf8"));
const byName = new Map(players.map((p) => [p.player, p]));
const toRemove = new Set();

for (const [faName, keepName] of PAIRS) {
  const fa = byName.get(faName);
  const keep = byName.get(keepName);
  if (!fa) throw new Error(`FA duplicate not found: ${faName}`);
  if (!keep) throw new Error(`Keeper not found: ${keepName}`);
  if (fa.team !== "FA") throw new Error(`Expected ${faName} to be FA, got ${fa.team}`);

  for (const [expert, rank] of Object.entries(fa.expertRanks)) {
    if (keep.expertRanks[expert] !== undefined) {
      throw new Error(`${keepName} already has ${expert} rank; merge would clobber`);
    }
    keep.expertRanks[expert] = rank;
  }
  const { avgRank, rankedByCount } = recompute(keep.expertRanks);
  console.log(
    `Merged ${faName} → ${keepName}: avg ${keep.avgRank} → ${avgRank}, ranked ${keep.rankedByCount} → ${rankedByCount}`,
  );
  keep.avgRank = avgRank;
  keep.rankedByCount = rankedByCount;
  toRemove.add(faName);
}

const kept = players.filter((p) => !toRemove.has(p.player));

// Stable sort by avgRank ascending only — preserves existing relative order for ties.
kept.sort((a, b) => a.avgRank - b.avgRank);
kept.forEach((p, i) => {
  p.consensusRank = i + 1;
});

fs.writeFileSync(RANKINGS_PATH, JSON.stringify(kept, null, 2) + "\n", "utf8");
console.log(`\nWrote ${kept.length} players (removed ${toRemove.size} FA duplicates).`);
