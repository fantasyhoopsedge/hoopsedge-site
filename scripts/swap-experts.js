#!/usr/bin/env node
/**
 * One-off migration:
 *   - Remove "matt" and "noah" from expertRanks for every player
 *   - Add "dynatyze" from dynatyze.com top-150 (matched by normalized name)
 *   - Recompute avgRank, rankedByCount, consensusRank
 *   - Drop players who end up with 0 expert ranks
 *
 * Source: https://dynatyze.com/api/rankings?limit=150
 * Run:    node scripts/swap-experts.js
 */

const fs = require("fs");
const path = require("path");

const RANKINGS_PATH = path.resolve(__dirname, "..", "src", "lib", "dynasty-rankings.json");
const DYNATYZE_URL = "https://dynatyze.com/api/rankings?limit=150";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://dynatyze.com/basketball/dynasty-rankings",
};

// Manual alias map for known name mismatches between FHE and Dynatyze.
// FHE name (normalized) → Dynatyze name (normalized)
const ALIASES = {
  // populate after first pass shows misses
};

function normalize(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[.,'’]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchDynatyze() {
  process.stdout.write("Fetching Dynatyze top 150… ");
  const r = await fetch(DYNATYZE_URL, { headers: HEADERS });
  if (!r.ok) throw new Error(`Dynatyze API: ${r.status} ${r.statusText}`);
  const d = await r.json();
  if (!d.players || !Array.isArray(d.players)) {
    throw new Error("Unexpected Dynatyze response shape");
  }
  console.log(`got ${d.players.length} players.`);
  return d.players;
}

function buildDynatyzeMap(players) {
  const map = new Map();
  for (const p of players) {
    if (!p.fullName || !p.rank) continue;
    map.set(normalize(p.fullName), { rank: p.rank, name: p.fullName });
  }
  return map;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RANKINGS_PATH, "utf8"));
  console.log(`Loaded ${raw.length} players from dynasty-rankings.json`);

  return fetchDynatyze().then((dynatyzePlayers) => {
    const dynatyzeMap = buildDynatyzeMap(dynatyzePlayers);
    const matched = new Set();
    const unmatchedDynatyze = new Set([...dynatyzeMap.keys()]);

    // 1) Drop matt + noah, add dynatyze where matched.
    let countWith0Ranks = 0;
    const transformed = raw.map((p) => {
      const er = { ...p.expertRanks };
      delete er.matt;
      delete er.noah;

      let key = normalize(p.player);
      if (ALIASES[key]) key = ALIASES[key];
      const dyn = dynatyzeMap.get(key);
      if (dyn) {
        er.dynatyze = dyn.rank;
        matched.add(key);
        unmatchedDynatyze.delete(key);
      }

      const ranks = Object.values(er).filter((v) => typeof v === "number");
      const rankedByCount = ranks.length;
      const avgRank =
        rankedByCount > 0
          ? Number((ranks.reduce((s, n) => s + n, 0) / rankedByCount).toFixed(2))
          : null;
      if (rankedByCount === 0) countWith0Ranks++;
      return { ...p, expertRanks: er, avgRank, rankedByCount };
    });

    // 2) Drop players with 0 ranks
    const kept = transformed.filter((p) => p.rankedByCount > 0);
    console.log(
      `Dropped ${countWith0Ranks} players with 0 remaining expert ranks (${kept.length} kept)`,
    );

    // 3) Recompute consensusRank: sort by avgRank asc, ties broken by player name asc
    kept.sort((a, b) => {
      if (a.avgRank !== b.avgRank) return a.avgRank - b.avgRank;
      return a.player.localeCompare(b.player);
    });
    kept.forEach((p, i) => {
      p.consensusRank = i + 1;
    });

    // 4) Reporting
    console.log(`\nDynatyze matched: ${matched.size}/${dynatyzeMap.size}`);
    if (unmatchedDynatyze.size > 0) {
      console.log("\nUnmatched Dynatyze players (no FHE row with same name):");
      for (const k of unmatchedDynatyze) {
        const orig = dynatyzeMap.get(k);
        console.log(`  - ${orig.name}  (rank ${orig.rank}, key=${k})`);
      }
    }

    // 5) Write
    fs.writeFileSync(RANKINGS_PATH, JSON.stringify(kept, null, 2) + "\n", "utf8");
    console.log(`\nWrote ${kept.length} players to ${path.relative(process.cwd(), RANKINGS_PATH)}`);

    // 6) Sanity
    const sample = [0, 9, 49, 99, kept.length - 1].map((i) => kept[i]);
    console.log("\nSample:");
    sample.forEach((p) =>
      console.log(
        `  #${p.consensusRank} ${p.player}  avg=${p.avgRank} ranked=${p.rankedByCount} dyn=${p.expertRanks.dynatyze ?? "—"}`,
      ),
    );
  });
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
