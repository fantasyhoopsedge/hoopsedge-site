#!/usr/bin/env tsx
/**
 * One-time migration: replace the "hashtag" expert panel with "fbihe"
 * (FBI-HE — Fantasy Basketball International / Hoops Edge) across
 * src/lib/dynasty-rankings.json, using the final published board from the
 * /admin/dynasty-board tool (dynasty_board_docs.published in Supabase) as
 * FBI-HE's per-player rank contribution. dizzle/angle/mball/dynatyze are left
 * completely untouched — only the hashtag seat changes.
 *
 * This intentionally keeps the live version at "1.1" (does NOT bump to 1.2)
 * per Ash's 2026-08-02 instruction: this replaces v1.1 in place as the
 * official 2nd release, not a 3rd. The OLD (hashtag-based) v1.1 snapshot is
 * archived to public/data/versions/v1.1(GHOST).json — preserved on disk but
 * deliberately never referenced from versions-index.json or the VERSIONS
 * array, so it never surfaces on the live site again.
 *
 * Run:
 *   npx tsx scripts/swap-hashtag-for-fbihe.ts --dry-run   (writes report only, no file changes)
 *   npx tsx scripts/swap-hashtag-for-fbihe.ts             (writes dynasty-rankings.json for real)
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getServiceClient } from "./nba-data/client";
import { nameKeyCandidates } from "../src/lib/player-name-aliases";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const RANKINGS_PATH = resolve(REPO_ROOT, "src", "lib", "dynasty-rankings.json");
const V10_PATH = resolve(REPO_ROOT, "public", "data", "versions", "v1.0.json");
const V11_PATH = resolve(REPO_ROOT, "public", "data", "versions", "v1.1.json");
const V11_GHOST_PATH = resolve(REPO_ROOT, "public", "data", "versions", "v1.1(GHOST).json");

const DRY_RUN = process.argv.includes("--dry-run");

// Byte-identical to src/lib/dynasty-rankings.ts's normalizePlayerName — see CLAUDE.md.
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'’]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ExpertRanks {
  dizzle?: number;
  angle?: number;
  mball?: number;
  hashtag?: number; // read, then deleted
  dynatyze?: number;
  fbihe?: number;
}

interface DynastyPlayer {
  consensusRank: number;
  player: string;
  team: string;
  isRookie: boolean;
  position: string;
  age: number | null;
  expertRanks: ExpertRanks;
  avgRank: number;
  rankedByCount: number;
  tier: number;
  trend: string;
  trendDelta: number | null;
}

// Published dynasty-board player shape (subset we need).
interface PublishedPlayer {
  customRank: number;
  name: string;
  team: string;
  position: string;
  age: number | null;
  isRookie: boolean;
}

// Fixed tier boundaries (docs/dynasty-rankings-refresh.md §6) — held policy,
// not a per-refresh judgment call. Tier 8 is uncapped on the bottom end.
const TIER_BOUNDARIES: { tier: number; maxAvgRank: number }[] = [
  { tier: 1, maxAvgRank: 14.2 },
  { tier: 2, maxAvgRank: 36.2 },
  { tier: 3, maxAvgRank: 81.8 },
  { tier: 4, maxAvgRank: 124.8 },
  { tier: 5, maxAvgRank: 179.75 },
  { tier: 6, maxAvgRank: 243.0 },
  { tier: 7, maxAvgRank: 316.3 },
];
function tierFor(avgRank: number): number {
  for (const b of TIER_BOUNDARIES) if (avgRank <= b.maxAvgRank) return b.tier;
  return 8;
}

async function fetchPublishedBoard(): Promise<PublishedPlayer[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("dynasty_board_docs")
    .select("published")
    .eq("id", "dynasty_board")
    .maybeSingle();
  if (error) throw new Error(`Supabase error: ${error.message}`);
  if (!data?.published) throw new Error("No published dynasty_board_docs row found.");
  return data.published.players as PublishedPlayer[];
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN (no files will be written) ===" : "=== LIVE RUN ===");

  const rankings = JSON.parse(readFileSync(RANKINGS_PATH, "utf8")) as DynastyPlayer[];
  console.log(`Loaded ${rankings.length} players from dynasty-rankings.json`);

  const published = await fetchPublishedBoard();
  console.log(`Loaded ${published.length} players from the published FBI-HE board`);

  const fbiheByName = new Map<string, PublishedPlayer>();
  for (const p of published) {
    const key = normalizePlayerName(p.name);
    if (!fbiheByName.has(key)) fbiheByName.set(key, p);
  }
  const consumedKeys = new Set<string>();

  function lookupFbihe(name: string): PublishedPlayer | undefined {
    for (const key of nameKeyCandidates(normalizePlayerName(name))) {
      const hit = fbiheByName.get(key);
      if (hit) {
        consumedKeys.add(key);
        return hit;
      }
    }
    return undefined;
  }

  // 1) Swap the seat on every existing row.
  let hadHashtag = 0;
  let gainedFbihe = 0;
  let lostFbihe = 0; // had hashtag, not on the published board -> loses the seat entirely
  const transformed: DynastyPlayer[] = rankings.map((p) => {
    const er = { ...p.expertRanks };
    if (er.hashtag != null) hadHashtag++;
    delete er.hashtag;

    const match = lookupFbihe(p.player);
    if (match) {
      er.fbihe = match.customRank;
      gainedFbihe++;
    } else if (p.expertRanks.hashtag != null) {
      lostFbihe++;
    }

    const ranks = Object.values(er).filter((v): v is number => typeof v === "number");
    const rankedByCount = ranks.length;
    const avgRank = rankedByCount > 0 ? Number((ranks.reduce((s, n) => s + n, 0) / rankedByCount).toFixed(2)) : 0;
    return { ...p, expertRanks: er, avgRank, rankedByCount };
  });

  // 2) Add new rows for published-board players who aren't in dynasty-rankings.json at all
  //    (the ecosystem additions made through the dynasty-board tool). Ecosystem-is-the-
  //    source-of-truth for name/team/position/age (already true of `published`, since the
  //    board tool itself sourced these from nba_roster at add-time).
  const added: DynastyPlayer[] = [];
  for (const p of published) {
    const key = normalizePlayerName(p.name);
    if (consumedKeys.has(key)) continue; // already matched above
    // also skip if any alias variant was consumed
    if (nameKeyCandidates(key).some((k) => consumedKeys.has(k))) continue;
    added.push({
      consensusRank: 0, // set after sort
      player: p.name,
      team: p.team,
      isRookie: p.isRookie,
      position: p.position as DynastyPlayer["position"],
      age: p.age,
      expertRanks: { fbihe: p.customRank },
      avgRank: p.customRank,
      rankedByCount: 1,
      tier: 0, // set after sort
      trend: "flat",
      trendDelta: null,
    });
  }
  console.log(`New ecosystem rows added (on published board, not previously in dynasty-rankings.json): ${added.length}`);

  let combined = [...transformed, ...added];

  // 3) Zero-rank drop: anyone left with 0 expert ranks after losing hashtag and not
  //    picking up fbihe (docs/dynasty-rankings-refresh.md §5's zero-rank drop rule).
  const beforeDrop = combined.length;
  const dropped = combined.filter((p) => p.rankedByCount === 0);
  combined = combined.filter((p) => p.rankedByCount > 0);
  console.log(`Dropped ${beforeDrop - combined.length} players with 0 remaining expert ranks:`);
  dropped.forEach((p) => console.log(`  - ${p.player}`));

  // 4) Recompute consensusRank + tier.
  combined.sort((a, b) => (a.avgRank !== b.avgRank ? a.avgRank - b.avgRank : a.player.localeCompare(b.player)));
  combined.forEach((p, i) => {
    p.consensusRank = i + 1;
    p.tier = tierFor(p.avgRank);
  });

  // 5) Recompute trend/trendDelta against v1.0 (the true prior distinct version —
  //    the old hashtag-based v1.1 is being ghosted, so v1.0 is the correct baseline,
  //    same as when v1.1 was originally built).
  const v10 = JSON.parse(readFileSync(V10_PATH, "utf8")) as { rankings: { player: string; consensusRank: number }[] };
  const v10RankByName = new Map<string, number>();
  for (const p of v10.rankings) v10RankByName.set(normalizePlayerName(p.player), p.consensusRank);
  for (const p of combined) {
    const key = normalizePlayerName(p.player);
    let prevRank: number | undefined;
    for (const k of nameKeyCandidates(key)) {
      if (v10RankByName.has(k)) {
        prevRank = v10RankByName.get(k);
        break;
      }
    }
    if (prevRank == null) {
      p.trend = "flat";
      p.trendDelta = null;
    } else {
      const delta = prevRank - p.consensusRank;
      p.trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      p.trendDelta = Math.abs(delta);
    }
  }

  // ── Report ──
  console.log("\n=== SUMMARY ===");
  console.log(`hashtag seat removed from: ${hadHashtag} players`);
  console.log(`fbihe seat gained by: ${gainedFbihe} players`);
  console.log(`Lost hashtag, no fbihe replacement: ${lostFbihe} players`);
  console.log(`Final player count: ${combined.length}`);
  console.log(`\nTop 10:`);
  combined.slice(0, 10).forEach((p) =>
    console.log(`  #${p.consensusRank} ${p.player} avg=${p.avgRank} tier=${p.tier} fbihe=${p.expertRanks.fbihe ?? "—"} trend=${p.trend}${p.trendDelta ? p.trendDelta : ""}`),
  );

  // ── Validation gate (docs/dynasty-rankings-refresh.md §10 item 9) ──
  const errors: string[] = [];
  const VALID_POSITIONS = new Set(["G", "F", "C", "G/F", "F/C"]);
  for (const p of combined) {
    if (!VALID_POSITIONS.has(p.position)) errors.push(`Bad position "${p.position}" for ${p.player}`);
    if (p.rankedByCount === 0) errors.push(`Zero-rank orphan slipped through: ${p.player}`);
    if (Object.values(p.expertRanks).some((v) => v != null && typeof v !== "number")) {
      errors.push(`Non-numeric expert rank for ${p.player}`);
    }
  }
  const seqOk = combined.every((p, i) => p.consensusRank === i + 1);
  if (!seqOk) errors.push("consensusRank is not sequential 1..N");
  const names = new Set(combined.map((p) => normalizePlayerName(p.player)));
  if (names.size !== combined.length) errors.push("Duplicate player name(s) detected after merge");
  if ("hashtag" in (combined[0]?.expertRanks ?? {})) errors.push("hashtag key still present on a row");

  if (errors.length) {
    console.log("\n=== VALIDATION FAILED ===");
    errors.forEach((e) => console.log(`  ✗ ${e}`));
    process.exitCode = 1;
    if (!DRY_RUN) return; // never write a bad file
  } else {
    console.log("\n=== VALIDATION PASSED ===");
  }

  if (DRY_RUN) {
    console.log("\nDry run — no files written.");
    return;
  }

  // ── Ghost the old v1.1 snapshot BEFORE overwriting anything ──
  if (existsSync(V11_PATH) && !existsSync(V11_GHOST_PATH)) {
    copyFileSync(V11_PATH, V11_GHOST_PATH);
    console.log(`\nGhosted old hashtag-based v1.1 -> ${V11_GHOST_PATH}`);
  } else if (existsSync(V11_GHOST_PATH)) {
    console.log(`\nGhost file already exists, not overwriting: ${V11_GHOST_PATH}`);
  }

  writeFileSync(RANKINGS_PATH, JSON.stringify(combined, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${combined.length} players to ${RANKINGS_PATH}`);
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
