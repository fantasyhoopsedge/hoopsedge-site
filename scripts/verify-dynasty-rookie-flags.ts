/**
 * Dynasty consensus board's rookie-flag self-check.
 *
 *   npm run dynasty:verify-rookies
 *
 * **READ-ONLY.** No database, no network, no writes — just the two files below.
 * Runs in under a second, meant to be cheap enough to run after every hand-edit
 * of `dynasty-rankings.json` (there is no unified ingest script for that file,
 * see docs/dynasty-rankings-refresh.md §10 item 9 — this closes one specific
 * slice of that gap).
 *
 * ── What it guards ──────────────────────────────────────────────────────────
 * `isRookie` on a dynasty-rankings.json row drives two independently-visible
 * things via `playerHeadshotUrl()`/tier-view/rankings-table in
 * src/lib/dynasty-rankings.ts:
 *   - which headshot branch renders (local /images/prospects/*.jpg vs a
 *     cdn.nba.com lookup)
 *   - whether the rookie badge shows at all
 *
 * Found 2026-09-05: Emanuel Sharp (2026 2nd-rounder, SAC) shipped with
 * `isRookie: false` — wrong headshot branch, no rookie badge — and turned out
 * not to be an isolated typo: 10 more 2026 draftees carried the same wrong
 * flag (Tyler Bilodeau, Bogoljub Markovic, Izaiyah Nelson, Tobi Lawal,
 * Vsevolod Ishchenko, Michael Ajayi, Felix Okpara, Tarik Biberovic, Tyler
 * Nickel, Aaron Nkrumah) — 11 total, all silently introduced by the "direct
 * entry" ingestion phase (docs §10 item 6) that folds real draftees in by
 * name with no field carried over to say they're rookies. Per the
 * ecosystem-is-source-of-truth policy (docs §5), `nba_roster`'s `yos` column
 * ("R" = rookie season) is ground truth, not the expert CSVs.
 *
 * `isRookie` means "2026 Rookie" (the badge's own tooltip text) — a
 * draft-and-stash player from an EARLIER draft making their NBA debut only
 * now (Markovic: drafted 2025, played in Serbia all of 2025-26, `yos: "R"`)
 * is still a true rookie by that definition, and this check treats `yos`, not
 * draft year, as ground truth for exactly that reason (`roster_ingest.ts`
 * carries the same rationale on `is_incoming_rookie`).
 *
 * **Thomas Sorber was a false positive in the original 12, caught 2026-09-05
 * by the owner.** Drafted 2025 (pick 15, OKC), he tore his labrum/foot before
 * his rookie season and has yet to debut — but he spent all of 2025-26 ON the
 * Thunder's roster, not stashed elsewhere, so 2026-27 is his SOPHOMORE season
 * of service even though it will also be his NBA debut. His `isRookie: false`
 * in dynasty-rankings.json was correct all along; the bug was upstream, in
 * `data/nba-rosters/2026-27.csv`, which still had his `yos` at "R" instead of
 * rolling it to "1" for the new season — so this check's own ground truth was
 * wrong for exactly one row. Fixed at the source (yos "R" → "1", re-ingested
 * via `roster_ingest.ts --team OKC`), which also flipped his live
 * `nba_roster.is_sophomore` true / `is_incoming_rookie` false — so
 * `/dynasty-rankings` now shows him with the S (sophomore) badge, not R.
 * `roster_ingest.ts`'s own conflict-detector (the `tagConflicts` check, built
 * for exactly the Markovic case) didn't catch this one: it treats
 * `prior_team === current team` as inconclusive (could be a real "stayed put"
 * signal or just an unpopulated default), so a player who never changed teams
 * while sitting out hurt slips through both checks. Cross-checking
 * `yos: "R"` rows against an ACTUAL NBA franchise name in `prior_team` (not
 * just "any prior_team present") found exactly this one row leaguewide —
 * worth re-running that specific query after each roster refresh until it's
 * folded into the ingest script's own conflict check.
 *
 * (A rookie's contract being tagged "Standard" rather than "Rookie Scale" is
 * SEPARATE and NOT a bug: roster_ingest.ts's deriveStatus() reserves "Rookie
 * Scale" for first-round picks only, matching actual CBA rules — a 2nd-round
 * rookie deal is a real "Standard" contract signed via a cap exception, e.g.
 * Sharp's own "second-round-exception". This check does not touch that field.)
 */
import { promises as fs } from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { DYNASTY_RANKINGS } from "../src/lib/dynasty-rankings";
import { normalizePlayerName } from "../src/lib/player-identity/normalize";

const ROSTER_CSV = path.join(process.cwd(), "data", "nba-rosters", "2026-27.csv");

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
    failures.push(label);
  }
}

async function main() {
  console.log("Dynasty rookie-flag check\n");

  const rosterRaw = await fs.readFile(ROSTER_CSV, "utf8");
  const rosterRows: Record<string, string>[] = parse(rosterRaw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });

  // Ground truth: nba_roster's own `yos` column, "R" = rookie season. Last
  // row wins on a duplicate name (current.csv/roster CSV convention elsewhere).
  const rosterIsRookieByName = new Map<string, boolean>();
  for (const row of rosterRows) {
    const name = row.player;
    if (!name) continue;
    rosterIsRookieByName.set(normalizePlayerName(name), (row.yos ?? "").toUpperCase() === "R");
  }

  const mismatches: string[] = [];
  for (const p of DYNASTY_RANKINGS) {
    const rosterIsRookie = rosterIsRookieByName.get(normalizePlayerName(p.player));
    if (rosterIsRookie === undefined) continue; // not on the current roster sheet — no ground truth to check against
    if (rosterIsRookie !== p.isRookie) {
      mismatches.push(
        `${p.player} (${p.team}, consensusRank ${p.consensusRank}): dynasty-rankings.json says isRookie=${p.isRookie}, ` +
          `nba_roster yos=${rosterIsRookie ? '"R"' : "not R"}`,
      );
    }
  }

  check(
    `every dynasty-rankings.json row matches nba_roster's rookie status (${DYNASTY_RANKINGS.length} rows checked)`,
    mismatches.length === 0,
    mismatches.length
      ? `${mismatches.length} mismatch(es):\n      ${mismatches.join("\n      ")}\n      Fix: correct isRookie in src/lib/dynasty-rankings.json to match nba_roster.`
      : "",
  );

  console.log("");
  if (failures.length) {
    console.error(`✗ ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("✓ dynasty rookie flags consistent with nba_roster.");
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
