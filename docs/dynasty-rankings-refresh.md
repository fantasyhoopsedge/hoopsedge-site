# Dynasty Consensus Ingestion

**How five expert dynasty rankings become one consensus board** — sourcing, name matching, math, display, and the gaps standing between today's manual process and a fully automated periodic refresh.

- **Prepared:** 2026-07-14 · **Last updated:** 2026-08-02
- **Covers:** `src/lib/dynasty-rankings.{ts,json}`, `/dynasty-rankings`
- **Current dataset:** v1.1 (July 2026) · 493 players — **complete.** Five experts: Dizzle, Dynatyze, MBall, Angle, and **FBI-HE** (Fantasy Basketball International / Hoops Edge — replaced Hashtag Basketball 2026-08-02, see §12's final entry). `trend`/`trendDelta` reflect the final state, diffed against v1.0. See §12 for the full log of this refresh, including the FBI-HE swap.
- **Purpose:** source-of-truth spec for the eventual automated-refresh skill

This is a living document, not a one-time report — update it as sourcing methods, policies, or gaps change.

## Contents

1. [Overview](#1-overview)
2. [Required inputs](#2-required-inputs)
3. [The five experts](#3-the-five-experts)
4. [How each is sourced](#4-how-each-is-sourced)
5. [Player name matching](#5-player-name-matching)
6. [Consensus math](#6-consensus-math)
7. [Where it lives on the site](#7-where-it-lives-on-the-site)
8. [Value to dynasty managers](#8-value-to-dynasty-managers)
9. [Ecosystem ties](#9-ecosystem-ties)
10. [Automation gap list](#10-automation-gap-list)
11. [Decided so far, and what's still open](#11-decided-so-far-and-whats-still-open)
12. [July 2026 refresh log](#12-july-2026-refresh-log)

## 1. Overview

The dynasty consensus board at `/dynasty-rankings` merges five independent dynasty-rankings panels into one ordered list of 446 players (v1.0, June 2026). Each player carries a rank from every expert who ranked them, an average rank across however many did, a derived consensus position, and a tier. It ships as bundled JSON — `src/lib/dynasty-rankings.json`, imported straight into the build — not a database table, so a "refresh" today means regenerating and committing that file — and, going forward, archiving the version it replaces first (§10, item 8): V1.0 (June 2026) → V1.1 (July 2026) → V1.2, and so on, every cycle.

Target cadence: a full refresh roughly every **5–6 weeks**, each source contributing whatever its latest release happens to be at that point (some update faster than others — see §4).

> Everything here is reconstructed from the current codebase, the raw source files still sitting in the repo, and the commit history of every past refresh — not from a written spec, because none existed before this document. That absence was the original main finding; §10 tracks what's left to close it.

## 2. Required inputs

A full refresh needs six things on hand before any merging can happen:

| Input | Current location | Format | Refresh cadence |
|---|---|---|---|
| Dizzle Dynasty rankings | `dynasty ranks/July 2026/Dizzle Dynasty…(July 2026).xlsx` | Multi-tab XLSX export — 9Cat ranks live on the leftmost tab, extracted to CSV | Irregular, confirmed manual (last: July 2026) |
| Angle Fantasy Basketball rankings | Published Google Sheet embedded in `anglefantasybasketball.com`'s "Top N Dynasty Basketball Rankings" posts — CSV export URL found in the iframe `src`, `?output=csv` | Direct CSV export (no scraping needed — see §4) | Historically every 8–10 weeks (e.g. [July 2026, Top 300](https://anglefantasybasketball.com/2026/07/23/top-300-dynasty-basketball-rankings-july-2026/)) |
| FBI-HE rankings | The published order from `/admin/dynasty-board` (`dynasty_board_docs` in Supabase) | Ash's own hand-curated custom order, seeded from the prior refresh's own `fbihe` values and adjusted from there | Manual: rebuilt whenever Ash finishes a curation pass in the dynasty-board tool |
| Moneyballers (mball) rankings | `moneyballers-impact-api.fly.dev/api/fantasy/dynasty` | JSON API, 350 players deep (with `?limit=350`) | Irregular pull cadence today (last: April 2026), but the source itself looks live/daily |
| Dynatyze rankings | `dynatyze.com/api/rankings?limit=75&ct=free` | JSON API, top 75 only (free tier) | Called "Daily" in the UI — freshest source |
| FHE rookie prospect board | Live Supabase-backed board via `/admin/rookie-board` (`data/fhe_2026_prospects_master.csv` was the 2026 one-off seed) | Manually ranked in-app, ~100 prospects | Annual: loaded and ranked each Feb–March, ahead of that year's draft |

A seventh input feeds the site around the rankings rather than the rankings themselves: `src/lib/nba-player-ids.json` supplies NBA.com player IDs for veteran headshots, and current NBA team is reconciled against the live `nba_roster` table (not baked into the JSON) for anyone whose team changed since the last refresh — see §9.

## 3. The five experts

The panel has changed composition three times. It launched with seven contributors; two unidentified ones (`matt`, `noah`) were dropped in favor of Dynatyze, and a contributor originally keyed `jason` was renamed to `mball` for clarity. **Hashtag Basketball was replaced by FBI-HE on 2026-08-02** (Hashtag ended its FHE partnership — see §12's final entry). The five below are current as of v1.1 (FBI-HE edition):

| Key | Display label | Full name | Notes |
|---|---|---|---|
| `dizzle` | Dizzle | Dizzle Dynasty | 9-cat/points hybrid rankings; confirmed to stay a manual XLSX/CSV input for now, no API |
| `angle` | Angle | Angle Fantasy Basketball | 9-cat specialist; confirmed live-scrape target, permission granted by the site owner |
| `mball` | MBall | Moneyballers | Renamed from `jason` in commit `f216bbf`; has a public JSON API, 350 players deep (with `?limit=350`) |
| `fbihe` | FBI-HE | Fantasy Basketball International / Hoops Edge | Replaced `hashtag` 2026-08-02. Not an external source at all — sourced from the owner's own hand-curated order in `/admin/dynasty-board`, published to Supabase, not scraped from any 3rd-party site |
| `dynatyze` | Dynatyze | Dynatyze | API-driven, top 75 only (free tier, cut from 150 as of July 2026), updates most often |

These identities live in three places that must stay in sync by hand: `EXPERT_NAMES` and `EXPERT_ORDER` in the page/table components, the `expertRanks` keys in every JSON row, and the `expertDates` map in each `VERSIONS` entry. Adding or removing a panelist means touching all three.

> **The old `hashtag`-keyed identity is retired, not archived-and-kept-live.** The pre-2026-08-02 v1.1 snapshot (built on Hashtag Basketball data) was moved to `public/data/versions/v1.1(GHOST).json` — preserved on disk, but deliberately never referenced from `versions-index.json`, the `VERSIONS` array, or anywhere else. Don't wire it back in; treat it as if it never existed, per the owner's explicit instruction.

## 4. How each is sourced

No two panelists are ingested the same way today:

- **Dynatyze** — the only fully programmatic source, of long standing. A one-off script, `scripts/swap-experts.js`, calls `GET https://dynatyze.com/api/rankings?limit=150` with a browser-like `User-Agent` and `Referer`, and reads `{ players: [{ fullName, rank }] }`. **As of July 2026, Dynatyze cut its free-tier cap from top 150 to top 75** — confirmed live: the endpoint now returns exactly 75 players (ranks 1–75, ending at Kawhi Leonard) no matter what `limit` value is requested, including the original `?limit=150` call. The live site itself calls `?limit=500&ct=free` and gets the same 75 back, so `ct=free` is likely the real gate, not `limit`. The response payload has also grown far richer than the script expects — nested `stats`/`epmData` blocks, `marketValue`, `tier`, `hypeGap` — but `fullName` and `rank` are still present at the top level, so the existing matching logic still works, just over a smaller pool. Any future refresh should request `limit=75` going forward and treat 151–446 (now 76–446) as never having a Dynatyze figure. Dynatyze's own model refreshes daily, but that's not this pipeline's cadence — each FHE refresh takes one dated **snapshot** of whatever Dynatyze shows that day and labels it accordingly (e.g. "Ranked by Dynatyze — July 2026"), the same dating convention already used for the other four panels, rather than trying to track Dynatyze in real time.

- **Moneyballers** — also fully programmatic, and previously undocumented as such. The site at `moneyballersimpact.com/fantasy/dynasty` is a client-rendered app, but it calls a public backend directly: `GET https://moneyballers-impact-api.fly.dev/api/fantasy/dynasty` returns `{ count, computed_at, players: [...] }`, no auth required. **The call defaults to 300 players but the published pool is 350** — pass `?limit=350` to get the full board (the API accepts up to `limit=500`, but still only returns 350, ending at Corey Kispert, confirming 350 is the actual depth of the source, not a pagination artifact). Deeper than Dynatyze's 75 either way. Each player record carries `rank`, `player_name`, `team`, `position`, plus Moneyballers' own `impact_score`/`gem_score`/`trajectory_score` metrics and a written `sleeper_take` — far more than the two numbers this pipeline currently extracts. Worth a proper client alongside `swap-experts.js` rather than treating it as a manual export.

- **FBI-HE** (replaced Hashtag Basketball, 2026-08-02) — not an external scrape at all, unlike everything Hashtag required. FBI-HE's contribution is the owner's own published order from `/admin/dynasty-board` (`dynasty_board_docs.published` in Supabase): the tool seeds a starting board from the CURRENT `fbihe` values already in `dynasty-rankings.json` (so each cycle's baseline is last cycle's published output), the owner hand-curates from there — reordering, adding ecosystem players not on the prior board, removing players — and publishes when done. A refresh reads that published board directly (`scripts/swap-hashtag-for-fbihe.ts` is the one-time migration that first made this swap; a future recurring refresh would follow the same read-published-board-and-merge shape without needing a scraper). The old `hashtag`-sourcing paragraph (live HTML scrape of hashtagbasketball.com, the *hashtag-dynasty-scraper* skill, the Top 450 cap) no longer applies to this panel — kept only as history in §12's final log entry, not as current guidance. **The `hashtag-dynasty-scraper` skill is retired for this pipeline** — don't invoke it for a future refresh; there is nothing to scrape for FBI-HE.

- **Dizzle** — confirmed to be staying manual for now. The July 2026 refresh arrived as a multi-tab spreadsheet, `dynasty ranks/July 2026/Dizzle Dynasty - 9Cat_Points_Rookie Dynasty Rankings (July 2026).xlsx`, with separate tabs per format/date (`July 2026 Dynasty Ranks, 9Cat` — the leftmost tab and the one this pipeline uses — plus Points, Rookie, Pick Values, and prior-period tabs going back to January 2026). The 9Cat tab runs 450 players deep, same schema as the old CSV exports (Rank, Player, Position, Team, DOB, Age, Previous Rank, +/- Change, Notes/Outlook), and was extracted to a matching CSV rather than read directly. No API or scrape target exists for Dizzle; a refresh depends on someone dropping in a fresh export.

- **Angle** — turned out to be the *easiest* of the five sources to automate, not the hardest as originally guessed here. Angle publishes dated "Top N Dynasty Basketball Rankings" posts on `anglefantasybasketball.com` — historically every 8–10 weeks (the [July 2026 Top 300 post](https://anglefantasybasketball.com/2026/07/23/top-300-dynasty-basketball-rankings-july-2026/) is the current one), plus separate, more frequent rookie big-board posts — and the site's own nav conveniently surfaces the current live link with an "Updated M/D/YY" label, so an agent can find the latest post without guessing URLs. The player table itself isn't in the page's HTML at all (confirmed absent from the accessibility tree on inspection) — it's a **published Google Sheet embedded via iframe**. Reading the iframe's `src` reveals a `docs.google.com/spreadsheets/d/e/<key>/pub?gid=0&single=true` URL; appending `&output=csv` (following the redirect it 307s to) returns the entire ranking as a plain CSV, no scraping/OCR/headless-rendering required at all — simpler than Hashtag's live HTML scrape, not harder. The sheet also reveals Angle is internally a 3-person panel (`Andrew`/`Braxton`/`Mitchell`) blended into an `Average Rank` column, with a separate `Rank` column that's just that value's sort position — `Rank` is the one to extract (§5/§12 has the full reasoning for why).

- **FHE rookies** — not an external "expert" at all, and going forward not a static CSV either. The recurring source is the live, Supabase-backed rookie board at `/admin/rookie-board`: each year around **February–March**, ahead of that year's draft, a fresh pre-draft list of roughly 100 prospects gets loaded into the editor and manually ranked by hand. That ranked board is what the ingest step reaches for a few weeks later, once expert lists start showing draft-pick placeholders — see the pre-draft/post-draft split in §10. `data/fhe_2026_prospects_master.csv` was the one-off seed file for the 2026 class specifically, not a template for how future classes get loaded.

> **No unified ingest script exists.** Every historical refresh (commits `28f9dae`, `63063ae`, `776e0ce`, `81e9f05`, `61860c0`) was a bespoke Claude Code session that read raw files and hand-edited `dynasty-rankings.json` directly. `swap-experts.js` is the one reusable artifact from that history, and it only covers the Dynatyze leg.

## 5. Player name matching

Every source names players differently, so a single normalizer is the join key across the whole app — not just for this board. It's defined in `src/lib/dynasty-rankings.ts` and must stay byte-identical to `normalizeName()` in `scripts/nba-data/client.ts`, since it also joins salary, stats, and roster data:

```js
function normalizePlayerName(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")        // strip diacritics
    .replace(/[.,'’]/g, "")                 // strip punctuation
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, "") // strip suffixes
    .replace(/\s+/g, " ")
    .trim();
}
```

That handles case, accents, punctuation, and generational suffixes — but not nicknames, which is the failure mode that's actually bitten this pipeline. A June 2026 merge (commit `61860c0`) produced four duplicate rows because one source used a player's legal/formal name and another used their common name:

| Source A said | Source B said | Result before fix |
|---|---|---|
| Alexandre Sarr | Alex Sarr | Two rows — one real (WAS), one stray "FA" row carrying only the mismatched expert's rank |
| Nicolas Claxton | Nic Claxton | Same failure mode |
| Carlton Carrington | Bub Carrington | Same failure mode |
| Ron Holland II | Ronald Holland | Same failure mode — also shows the suffix-strip rule didn't save it |

These were fixed by hand, once, after the fact. There is currently no alias table — `swap-experts.js` ships an empty `ALIASES` map with a comment to "populate after first pass shows misses," i.e. the process is reactive: run the merge, eyeball the unmatched list, patch names, re-run.

### Matching & resolution policy for the automated skill

The agent should actively cleanse and resolve duplicate/mismatched names rather than just flag everything, escalating to a human only when it isn't confident. Concretely, that means layering on top of `normalizePlayerName()`:

- **Nickname equivalence.** A maintained common-name ↔ legal-name table (Cam ↔ Cameron, Alex ↔ Alexandre, Nic ↔ Nicolas, Bub ↔ Carlton, etc.) checked before the exact-match normalizer runs, not after.
- **Surname/middle-name scanning.** When an exact normalized match fails, fall back to comparing surname plus first-initial (or nickname-table match) rather than giving up immediately — this is what would have caught Ron Holland II / Ronald Holland without a suffix rule doing all the work.
- **Wider diacritic coverage.** `normalizePlayerName()`'s NFD-decompose-and-strip approach handles composable accents fine (é, ë, č, ž — anything that's really "base letter + combining mark" under Unicode). It silently does *nothing* for non-decomposable letters that have no such decomposition — Polish `ł`, Scandinavian `ø`, Serbian/Croatian `đ` — since those are standalone code points, not base+mark pairs. Those need an explicit substitution map (`ł→l`, `ø→o`, `đ→d`) alongside the existing NFD step, not instead of it.
- **Auto-resolve when confident, flag when not.** If two rows collapse to the same player under the rules above — same resolved name, same team, compatible position — merge them automatically the way the Sarr/Claxton/Carrington/Holland cleanup eventually did, rather than surfacing every near-match for manual review. Only surface a name for human confirmation when the signals disagree (e.g. same surname, different team, no nickname-table entry) — see the general "flag if unsure" policy in §10.

### Non-rank fields: the ecosystem is the source of truth, not the expert's own CSV

Confirmed as owner policy during the July 2026 Dizzle merge (§12): once a player is matched (by the rules above), their **name spelling, position, team, and DOB** should be taken from the FHE ecosystem — `nba_roster` (current season, preferred) or `nba_players` (fallback when the player isn't on the current roster sheet yet) — not re-derived from the expert's own CSV. In practice almost every name on an expert's list already exists in one of those two tables. Only fall back to the expert's own CSV fields for a player with **no** ecosystem record at all (a true gap — see the Biberovic/Nunez cases in §12).

**Exception — real transactions.** Don't treat "ecosystem disagrees with the expert" as automatically meaning the expert is wrong. An expert's dated CSV can legitimately be ahead of `nba_roster` on a recent free-agency signing the roster sheet hasn't caught up on yet. When a matched player's team conflicts between the expert CSV and the ecosystem, flag it for the owner rather than silently defaulting either way — in July 2026, 6 of 7 such conflicts turned out to be real signings the expert had right and the roster sheet was simply stale on (§12).

**Zero-rank drop rule.** After removing an expert's rank from a player who no longer appears in their new list, check whether that player now has `rankedByCount === 0` (no other of the 5 experts ranks them either). If so, drop the player from the board entirely rather than leaving a row with `avgRank: NaN`/`null` — this is `scripts/swap-experts.js`'s existing "drop players with 0 remaining expert ranks" behavior (§10 item 1), just not yet applied as a general post-merge check across all five sources.

## 6. Consensus math

Per player, across whichever of the five experts ranked them:

- `rankedByCount` — how many of the five ranked the player at all (Dynatyze now caps at 75, down from 150 — see §4 — so this is frequently 4 or fewer past rank ~75).
- `avgRank` — mean of the available ranks, to two decimals. Missing experts are excluded from the average, not treated as a bad rank.
- `consensusRank` — the 1..N sort position by `avgRank` ascending, ties broken alphabetically by player name.
- `tier` — 1 through 8, assigned at natural breaks in `avgRank` rather than by a formula. **These boundaries are now a held policy, not a per-refresh judgment call** — they stay as they are below unless explicitly revised, with one standing adjustment: Tier 8 is uncapped on the bottom end and extends to catch everyone through rank 450 (the board's target size), rather than stopping wherever v1.0 happened to end (446 players, tier 8 topping out at avgRank 389.5).

The v1.0 boundaries:

| Tier | Name | avgRank range | Players |
|---|---|---|---|
| 1 | Fantasy-Altering Juggernauts | 1.0 – 14.2 | 15 |
| 2 | Dynasty Cornerstones | 16.6 – 36.2 | 24 |
| 3 | Proven Contributors | 38.6 – 81.8 | 44 |
| 4 | Depth Tilters | 82.4 – 124.8 | 45 |
| 5 | Developmental Assets | 125.6 – 179.75 | 69 |
| 6 | Speculative Holds | 181.5 – 243.0 | 79 |
| 7 | Deep League Filler | 244.5 – 316.3 | 80 |
| 8 | Lottery Tickets | 317.0 – *end of list (450)* | 90 in v1.0, grows as the board deepens toward 450 |

Bucket sizes range from 15 to 90+ players — there's no fixed width or fixed count across tiers 1–7, but that's fine: they're a fixed table now, re-used as-is every refresh rather than recomputed. The only rule the agent needs to apply is tier 8's open lower bound: everyone ranked 317.0 or worse by `avgRank` falls in tier 8, all the way down to rank 450, until the user decides to revise the boundaries.

One field is defined but not yet live: `trend` ("up" / "down" / "flat") has UI support (`TrendIcon`) but every row in v1.0 is hardcoded `"flat"` — it was never wired to compare against a prior version. A real refresh pipeline is the natural place to compute it, by diffing the new `consensusRank` against the previous version's snapshot.

## 7. Where it lives on the site

`/dynasty-rankings` is the single surface. It offers two views over the same 446 rows:

- **Table view** — sortable by consensus, any individual expert, age, or tier; a **VS CONS** column shows how far an expert's rank sits above/below consensus (↑/↓ with a spot count); expert cells that diverge from consensus by 5+ or 10+ spots get a subtle tint so agreement/disagreement is visible at a glance without sorting.
- **Tier view** — the same players grouped into the 8 named tiers as collapsible card grids, each showing rank, headshot, team, position, and age.

Shared filtering across both: rank range (Top 100 / 101–200 / 201–300 / 301–450), position, team, rookie/sophomore/veteran class, tier, free-text search, and a per-expert "view as this expert's list" mode that re-sorts and re-labels the whole page. A version picker (currently just v1.0) can overlay a historical snapshot's ranks onto today's player metadata. Clicking any player opens a quick-view modal pulling their live stat line from `/team-rosters`, with a path into the shared 4-player compare tool used elsewhere on the site.

Headshots: rookies use local files in `public/images/prospects/` keyed by slugified name; everyone else resolves through `nba-player-ids.json` to a `cdn.nba.com` URL. The page also carries a server-rendered "About" block (visible after the table finishes loading) aimed at AI-crawler indexing, describing the methodology in prose.

**Two team-code buckets for "not on an active roster," don't conflate them:** `"UFA"` is for real veteran unrestricted free agents and matches `nba_roster`'s own `UFA` pseudo-team convention (Cole Anthony, Bruce Brown, etc. — same players appear both places). `"FA"` is a looser, older bucket originally meant for rookies/draft-and-stash players with no confirmed active team (e.g. Juan Nunez — Spurs hold his draft rights, but he's not on their active roster this season). Some veteran free agents ended up in `"FA"` historically too (pre-existing data drift, not a rule) — going forward prefer `"UFA"` for real free agents and reserve `"FA"` for the stash/no-team case.

## 8. Value to dynasty managers

The pitch isn't "here's a ranking" — dynasty managers can get that from any single source. It's **disagreement made visible**:

- **Trade leverage.** A player five sources agree on is a fair trade; one where Hashtag has him at 40 and Dynatyze has him at 90 is exactly where buy-low/sell-high edges live. The VS CONS column and tinted cells surface that without manual cross-referencing five separate sites.
- **9-cat, 16+ team framing.** The board is explicitly built for category-format, deep-league dynasty — not points leagues or shallow redraft — so tier placement reflects category-balance value, not raw box-score totals.
- **Rookie integration.** FHE's own scouted rookie order sits inside the same consensus list as veterans, rather than a separate rookie-only board a manager has to mentally merge in.
- **Context on demand.** The quick-view/compare integration means a rank isn't a dead number — a manager can immediately check a player's actual current-season stat line and team situation before acting on the rank.
- **Movement over time** (once versioning has more than one snapshot) — seeing a player's consensus rank rise or fall release over release is a leading indicator a single static list can't offer.

## 9. Ecosystem ties

Dynasty rankings sits at a junction of five otherwise-separate FHE data surfaces:

```
Rookie board ──────────► Dynasty consensus ◄────────── Team rosters
/admin/rookie-board       src/lib/                        nba_roster,
~100 prospects,           dynasty-rankings.json            live per-team pages
ranked live each
Feb–March

NBA data pipeline ─────────────────────────► Seasonal rankings / trends
nba-player-ids.json,                          season_player_values,
headshots, team logos                         nba_player_trends —
                                               same normalizePlayerName()
                                               join key

Version archive ───────────► Historic trends & a future AI advisor
public/data/versions/v*.json   on-site version picker (live) +
one snapshot per refresh,      a planned "AI Edge" agent users can
growing every cycle            ask for dynasty advice

Dynasty consensus ─────────────────────────► Real Salary Rankings
src/lib/dynasty-rankings.json                 real_salary_values —
(read via loadConsensus(), name-keyed)        build-time snapshot, goes
                                               stale in VALUE (not
                                               corrupted) if not rebuilt
```

Concretely: rookies enter the board from FHE's own scouted prospect data, not from the five external experts. Every player's team badge and quick-view stat line are reconciled live against `nba_roster` rather than baked into the JSON, so a trade mid-season doesn't require a full rankings refresh just to fix a team logo. And the same `normalizePlayerName()` key that joins the five expert lists together is the identical function joining salary data, game logs, and category-value trends elsewhere in the app — any change to it has to be made in both `src/lib/dynasty-rankings.ts` and `scripts/nba-data/client.ts` simultaneously, per the byte-identical requirement in `CLAUDE.md`.

The newest tie is `/real-salary-rankings` (built 2026-07-30, iterated through 2026-08-01): `npm run realsalary:build` reads `dynasty-rankings.json` via the same `loadConsensus()` helper `seasonal:build` uses, keyed by normalized name, so it's immune to the rank-reuse corruption pattern described in `CLAUDE.md`. But it still writes a **build-time snapshot** of `consensus_z`/rank/surplus into `real_salary_values` — meanwhile `/real-salary-rankings`' own Consensus column reads the bundled JSON fresh on every render — so a refresh that updates `dynasty-rankings.json` without rerunning the build leaves the page showing a fresh consensus rank next to a stale salary-model verdict. `dynasty:sync` now runs `realsalary:build` as its third step precisely so this can't happen silently; see `CLAUDE.md`.

The version archive is the newest of these ties, and the forward-looking one: today it powers the version picker already built into `/dynasty-rankings` (§7), but every version this skill archives is also raw material for a future conversational "AI Edge" agent — something a user could ask "how has this player trended over the last three versions?" or "who's risen the most since March?" and get an answer grounded in real historical snapshots rather than a single point-in-time list. That's the concrete reason archiving-before-overwrite (§10, item 8) is a required step of every refresh, not an optional nicety.

## 10. Automation gap list

What stands between today's manual, session-by-session process and a scheduled agent that can run this refresh unattended, roughly in the order it would need to be tackled:

> **Standing policy: auto-resolve when confident, flag when not.** This is the general rule for every judgment call the agent hits mid-refresh — duplicate/mismatched player names (§5) and placeholder-row detection during the pre-draft window (item 6 below) alike. Default to resolving automatically when the signals agree; only surface something for human confirmation when they don't.

1. **No unified ingest script** — `gap`. Only the Dynatyze leg (`swap-experts.js`) and a snapshot writer (`snapshot-rankings.js`) are scripted. The merge of all five sources into one JSON has never been more than a one-time hand edit.

2. **Sourcing method is now settled for all five panels** — `have`. Dizzle stays a confirmed manual XLSX/CSV hand-off — the skill should prompt for a fresh export each cycle rather than try to fetch one. Angle is a confirmed live-scrape target (permission granted), same bucket as Hashtag. Dynatyze and Moneyballers are confirmed APIs. Nothing left unclassified — what's left is building the actual scraper/client/prompt for each, not figuring out which kind each source is.

3. **Alias/matching pipeline needs building, but the policy is now decided** — `gap`. `ALIASES` in `swap-experts.js` is still empty, and nothing implements the fuller policy in §5 yet (nickname table, surname/middle-name fallback matching, non-decomposable-diacritic map). The decision itself is made — auto-resolve confident matches, flag uncertain ones — so this is now an implementation task, not an open design question. **Concrete seed data exists now:** the July 2026 Dizzle merge (§12) surfaced 10 real Dizzle-CSV-vs-live-JSON aliases by cross-referencing "no match" rows against "lost their rank" rows and checking surnames — a working example of the fallback-matching rule in §5, not yet codified into a persisted table anywhere in code.

4. **Tier cutoffs need codifying as a fixed table** — `gap`. No code currently maps `avgRank` → tier at all — v1.0's boundaries only exist as data (the tier value already baked into each row), not as a rule. Per §6, the boundaries themselves are decided and fixed (tier 8 open-ended down to rank 450) — the remaining work is writing that table into the ingest script so future refreshes apply it mechanically instead of a human re-deriving it from scratch.

5. **`trend` field — done, wired up in the July 2026 refresh** (§12). Diffed against `v1.0.json`, rendered on the consensus page and throughout team-rosters/compare. Needs recomputing once more when Angle's update folds into this same v1.1 (§12) — not a new gap, just a standing follow-up.

6. **Rookie hand-off logic is seasonal — the skill needs all three phases** — `manual`. This is an annual cycle with three phases in sequence, and the ingest logic has to know which one it's in:
   - **Board population (roughly February–March).** Ahead of that year's draft, a fresh pre-draft list of roughly 100 prospects gets loaded into the live rookie board editor (`/admin/rookie-board`) and manually ranked by hand. This step is inherently manual — it's FHE's own scouting judgment, not something an agent should do unattended — but it has to complete before phase 2 has anything to draw on.
   - **Placeholder replacement (roughly April–June).** This is dynasty-expert "silly season": draft chatter is ramping up and each panel scrambles to publish a pre-draft update before the real draft happens, so most sources fall back to placeholder rows instead of named prospects — things like *"2026 Draft Pick 1.01," "2026 Pick 1.02,"* etc., one per expected first-round-plus slot. The ingest step here is to detect those placeholder rows per source (the exact text format differs by expert, so this needs a per-source pattern) and replace them, in order, with the ranked order sitting in the live rookie board from phase 1 — the "push-down" logic already built once in commits `28f9dae`/`776e0ce`, just not as a reusable rule yet, and pointed at a static CSV rather than the live board.
   - **Direct entry (roughly July onward).** Once the actual draft has happened, placeholders disappear — experts fold the real draftees into their lists directly, by name, like any other player. The ingest step here is just normal name-matching against `normalizePlayerName()`; there's no placeholder to detect or push-down to perform, and the rookie board becomes a supplementary join (school, scouting verdict) rather than the source of the rank itself.

   Concretely: this July 2026 refresh is squarely phase 3 — Dizzle's new export names 2026 draftees directly rather than using pick placeholders (see §4). Phases 1 and 2 will recur heading into the 2027 draft class, roughly February–June 2027, and the skill should pick the phase by checking whether a given source's pull actually contains placeholder-style rows, rather than by hardcoding a date.

7. **Config drift across three files** — `manual`. `EXPERT_NAMES`/`EXPERT_ORDER` (component code), `expertRanks` keys (every JSON row), and `VERSIONS[].expertDates` (page.tsx) all encode the same five-expert roster independently. Adding/removing a panelist — which has happened twice — means editing all three by hand.

8. **Archiving the outgoing version is now a required first step of every refresh, not an optional chore** — `manual`. Locked in: every refresh must archive the current live version *before* overwriting it, then bump the version number — V1.0 (June 2026) → V1.1 (July 2026) → V1.2, and so on. This isn't just record-keeping; the growing archive is what lets the site show historic rank movement, and it's what a future "AI Edge" advisory agent would query when a user asks for dynasty advice that depends on trend, not just a single point-in-time rank (see §9).

   The order matters:
   1. Snapshot the current `dynasty-rankings.json` to `public/data/versions/v{current}.json` — `snapshot-rankings.js` already does this, just not automatically.
   2. Merge the new source pulls into a fresh working copy.
   3. Write that as the new live `dynasty-rankings.json`.
   4. Add the new version to `public/data/versions-index.json` and the hardcoded `VERSIONS` array in `page.tsx` (both still need hand edits today, per the comment block already in the script) with the new version's per-expert dates.
   5. Mark the previous version `isCurrent: false`.

   Steps 1 and 3 must never be swapped — archiving after overwriting archives the wrong (already-new) data. This also finally makes the inert `trend` field (item 5) computable: with two or more archived snapshots on disk, a refresh can diff each player's `consensusRank` between the new version and the one just archived to populate up/down/flat properly, instead of leaving it hardcoded.

9. **No validation gate** — `gap`. Unlike `seasonal:build`, which is "validation-gated" against a reference export per `CLAUDE.md`, nothing checks a freshly merged dynasty file for null positions/ages, duplicate players, or wildly discontinuous ranks before it ships — those have all been real bugs in past refreshes (commits `28f9dae`, `63063ae`). The July 2026 Dizzle merge (§12) did this by hand each time (typecheck, position-enum check, zero-rank-orphan check, sequential-consensusRank check) — worth codifying into a real script-level gate rather than repeating manually per source.

10. **Existing groundwork** — `have`. The normalizer, the tier/table/quick-view UI, the versioning display machinery, and the sophomore/live-roster reconciliation are all already built and stable — the gap is entirely on the ingest side, not the presentation side.

## 11. Decided so far, and what's still open

Answered and folded into the sections above: Angle is a confirmed, permissioned source, and turned out to be a direct CSV export via an embedded published Google Sheet — easier than expected, not harder (§4); tier cutoffs are fixed policy with tier 8 open-ended to rank 450 (§6); target cadence is every 5–6 weeks with Dynatyze taken as a dated snapshot rather than tracked live (§1/§4); name-matching defaults to auto-resolve-when-confident, flag-when-not (§5/§10); archiving the outgoing version (V1.0 → V1.1 → …) is a required first step of every refresh, not optional versioning housekeeping (§9/§10 item 8); and confirmed resolutions in the nickname/alias table **do** get written back to the persisted, checked-in `src/lib/player-name-aliases.ts` — 5 new entries added during the Angle merge alone (§12).

Still open:

1. What should "confident enough to auto-resolve" mean concretely — e.g. is same-surname-plus-same-team always enough to auto-merge, or should same-team-different-position still get flagged? The Angle merge (§12) resolved 12 team conflicts without a single owner check-in, but only by directly reading `data/nba-rosters/2026-27.csv` and `transactions-2026-27.md` for each one — that's a real answer in practice ("check the ecosystem's own source files before flagging, not just the two disagreeing fields"), but it's not yet written down as a rule the skill follows automatically.
2. Landry Shamet's team is still an open flag from the Angle merge (§12) — Angle claims `NYK`, nothing in the ecosystem corroborates it. Worth a manual check before the next refresh rather than leaving it presumed `FA` indefinitely.

## 12. July 2026 refresh log

The first refresh actually run against this spec, started 2026-07-15 (same day the spec above was written), completed 2026-07-24 when Angle finally published. Four of five experts updated first — **Angle had not published since May 2026** and was intentionally carried forward unchanged for the first nine days of this cycle, not dropped or re-derived — until its July update arrived and got folded into this same v1.1 (see the entry near the end of this log).

**Dizzle — done.** Merged from `dynasty ranks/July 2026/Dizzle Dynasty - 9Cat Dynasty Rankings (July 2026).csv` (450 rows):

- **421 matched** (410 direct by `normalizePlayerName()`, 11 via name aliases discovered this cycle — see the new subsection in §5). All 11 aliases were confirmed as Dizzle-side spelling variants of names already correct in the live JSON, **except one**: "Liam McNeely" in the live JSON (and in `data/nba-rosters/2026-27.csv` / `nba_roster`) was itself a typo — Dizzle's "Liam McNeeley" was correct, confirmed by the owner via an official bio card. Renamed at the source (`dynasty-rankings.json`; the roster CSV/table were left as a known follow-up, not re-ingested this session).
- **7 dropped** — Dizzle no longer ranks them: Patrick Ngongba, Guerschon Yabusele, Brandon Clarke, Tyus Jones, Haywood Highsmith, Kelly Olynyk, Sidy Cissoko. Two of these (**Ngongba, Clarke**) hit `rankedByCount: 0` as a result (no other expert ranks them either) and were removed from the board entirely per the zero-rank drop rule (new subsection in §5).
- **30 new players added**, sourced per the new "ecosystem is the source of truth" rule in §5: 28 already existed in `nba_roster` (current season) or `nba_players` (fallback), used as-is. **2 true ecosystem gaps** — Tarik Biberovic (fresh int'l signing, added to `nba_roster` under DAL/F) and Juan Nunez (Spurs hold his draft rights but he's not on an active roster — added to `dynasty-rankings.json` only, `team: "FA"`, position/age from Dizzle's CSV since no ecosystem record exists to defer to).
- **6 real transactions surfaced and confirmed** via the owner's own cap-sheet screenshots, where Dizzle's CSV was ahead of `nba_roster`: Josh Okogie → UTA, Larry Nance Jr. → IND, Charles Bassey → GSW (all corrected in `data/nba-rosters/2026-27.csv` + re-ingested via `npx tsx scripts/nba-data/roster_ingest.ts --team <X>`), plus Gary Payton II / Jett Howard / Jalen Wilson → `UFA` (real free agents, not `FA` — see the UFA-vs-FA note in §7).
- avgRank/rankedByCount/consensusRank/tier recomputed once after the merge, blending Dizzle's new numbers with each other expert's still-current rank. Manually validated (typecheck, position-enum, zero-rank-orphan, sequential-consensusRank checks — see §10 item 9) and eyeballed live in a dev preview before calling it done.
- Live working file: 474 players. **Not yet versioned** — no archive snapshot, `versions-index.json`, or `VERSIONS` entry for this state yet; that happens once Hashtag/MBall/Dynatyze are also merged, so v1.1 represents the complete July cycle rather than a partial one.

**Dynatyze — done.** Pulled live from `GET https://dynatyze.com/api/rankings?limit=75&ct=free` (75 entries returned, matching the July cap-cut already documented in §4):

- **2 entries excluded as non-players** — `"2027 Early 1st"` and `"2027 Mid 1st"`, Dynatyze's own draft-pick trade-chip valuations (`isDraftPick: true`, `teamName: "DRAFT"`, `position: "PICK"`). The consensus board models real players only, so these were dropped rather than added as fake rows.
- **Gotcha for next time: don't filter on `nbaPlayerId != null`.** First pass used that as a "is this a real player" check alongside `isDraftPick`, which wrongly excluded **7 real 2026 rookies** who simply don't have an NBA Stats ID mapped yet (new to the league): Cameron Boozer, Darryn Peterson, AJ Dybantsa, Caleb Wilson, Keaton Wagler, Mikel Brown Jr., Darius Acuff Jr. This briefly stripped their existing `dynatyze` ranks in the live file before being caught and patched. **Only `isDraftPick: true` is a valid "not a real player" signal** from this API.
- **73 real players, all 73 matched** to existing rows by `normalizePlayerName()` — zero new-player additions needed (Dynatyze's top-75 pool is entirely inside the existing 474-player board).
- **Team-field conflicts checked, none acted on.** 10 of the 73 matched players had a `teamName` that differed from the live JSON's `team` (Giannis, LaMelo Ball, Jaylen Brown, Kel'el Ware, Walker Kessler, Brandon Ingram, Tyler Herro, plus 3 that were just abbreviation-scheme differences — `PHO`/`PHX`, `NOR`/`NOP`, see §7). Cross-checked all 7 real conflicts against `nba_roster` — the ecosystem unanimously agreed with the *live JSON*, confirming Dynatyze was simply stale on these (its own payload shows some records with June `lastUpdated` timestamps mixed in with July-fresh ones). No team changes made — this is the mirror image of the Dizzle case in §5's "real transactions" exception: sometimes the ecosystem really is more current than the expert, and checking against `nba_roster` is what tells them apart.
- **79 players dropped their `dynatyze` rank** — anyone who was in Dynatyze's old top-150 pull but falls outside the new top-75 cap. Expected, not a bug (§4).
- avgRank/rankedByCount/consensusRank/tier recomputed; 0 zero-rank orphans this time. Verified in a dev preview.

**MBall — done.** Pulled live from `GET https://moneyballers-impact-api.fly.dev/api/fantasy/dynasty?limit=350` (350 players returned, `computed_at: 2026-07-13`, no auth needed, matching §4's documented behavior exactly):

- All 350 rows were real players — no placeholder/non-player rows like Dynatyze's draft-pick chips, no null names/ranks.
- **346 matched directly, 4 more via aliases** — and the 4 were exactly the recurring nickname pattern already known from the Dizzle cycle: `Cameron Johnson`→`Cam Johnson` (same alias reused). Two *new* aliases surfaced and were added to the working alias table: `Cam Boozer`→`Cameron Boozer` (MBall uses the nickname where Dizzle used the full name — same pair, opposite direction) and `Ronald Holland II`→`Ron Holland II` (this is literally the exact mismatch already documented as a known historical bug in §5's table, recurring in a live source). **All 350 accounted for, zero new-player additions needed.**
- **5 team conflicts surfaced and explicitly left unresolved per the owner's call:** MBall's July 13 pull claimed Brandon Williams→DAL, Russell Westbrook→SAC, Bruce Brown Jr.→DEN, Jeremy Sochan→NYK, and Joshua Jefferson→MIN, all contradicting both the live board and `nba_roster` (which agreed with each other). Owner confirmed: leave all 5 as their current status (4 as UFA, Jefferson as BKN) — MBall was not treated as more current here, unlike the Dizzle case in §12's prior entry. This is the concrete answer to §11's open question 4 in at least one direction: a disagreement doesn't default to "expert wins" just because the pull is more recent than the roster sheet.
- **Found and fixed a real pre-existing bug, unrelated to this cycle's own work:** a duplicate "Quinten Post" row already existed in the live JSON before this refresh even started (one row with only `dizzle`+`mball`, a second with all four `dizzle`/`angle`/`mball`/`hashtag` — both agreeing on the shared expert ranks, confirming same person, not a name collision). Caught because merging MBall produced 351 `mball`-tagged rows against 350 source keys — a mismatch that wouldn't have surfaced without the count check in §10 item 9. Merged into a single row (kept the more complete row's `C` position, unioned `expertRanks`). **This kind of duplicate-detection check (count matched-tags against source row count) is worth adding to the informal validation gate** alongside the checks already listed.
- Pete Nance hit `rankedByCount: 0` (was mball-only, MBall's new pull doesn't include him) and was dropped per the zero-rank rule.
- avgRank/rankedByCount/consensusRank/tier recomputed; verified live in a dev preview (confirmed the Quinten Post fix shows as a single row).
- Live file: 472 players (474 − Pete Nance − 1 deduped Quinten Post row).

**Hashtag — done.** Scraped live from `hashtagbasketball.com/fantasy-basketball-dynasty-rankings` via the `hashtag-dynasty-scraper` skill, Chrome-based extraction (the skill's documented `web_fetch`-first approach wasn't viable — see below):

- **Site markup has changed since the skill was written.** The skill's extraction script targets `document.querySelectorAll('table')[1]` expecting one big rankings table; the live site now renders one `.dyn-card` div per player (rank in `.dyn-rank`, name in `.dyn-name`, position/team/age as `.badge` spans in `.dyn-meta`), with per-player 2-season stat tables nested inside as small 3-row `<table>` elements — hundreds of them, none of which are the rankings table itself. Extraction was rewritten against the actual DOM; the skill's script needs updating for future runs.
- **All 500 rows (Top 500 view) were pulled in one pass — no virtualization/lazy-load to fight**, unlike the skill's "may require scroll" gotcha.
- **Zero draft-pick placeholders** (`is_pick` count: 0, not the skill's assumed 8) — confirms this is squarely phase 3 (direct entry, §10 item 6): the real 2026 draft already happened and Hashtag names draftees directly, same as every other source this cycle. **The skill's Step 2 (placeholder → FHE rookie replacement) did not apply and was skipped entirely.** The skill should be updated to detect zero-placeholder runs and skip Step 2 automatically rather than assuming 8 every time.
- **Real scrape-glitch data quality issues found and fixed**, distinct from the skill's documented gotchas: rank 469 was missing entirely from the 500-row pull (a genuine gap, harmless since it fell outside the Top-450 cap used for ingestion), rank 485 was rendered twice for the same player (exact duplicate, per the skill's existing "keep first occurrence" rule), and — a new gotcha not covered by the skill — **the same player rendered at two different rank numbers** (Chaz Lanier at both #402 and #411, identical data). Kept the first occurrence (#402), dropped #411.
- **385 matched-changed, 21 unchanged, 11 newly ranked** via aliases — 4 recurring from earlier this cycle (Herb Jones, Cam Johnson, Cameron Boozer, Ron Holland II) plus **2 more historical aliases from §5's original known-bug table surfacing live for the first time this refresh**: Alexandre Sarr→Alex Sarr, Nicolas Claxton→Nic Claxton (both were fixed by hand once, in commit `61860c0`, per §5 — now recurring from a live source exactly as documented).
- **11 dropped**, all sanity-checked against the raw scrape for near-miss aliases first (none found — genuine drops, deep bench players Hashtag's new pull no longer covers).
- **32 new players added.** 30 resolved via the ecosystem-source-of-truth rule (28 from `nba_roster`, `players`-table fallback for the rest); found and fixed a real bug in that fallback path: `nba_players.position` isn't always normalized to the site's 5-bucket scheme (two rows returned raw `PG` instead of `G`) — added a position-simplification pass over ecosystem data too, not just expert-CSV data, since the assumption that ecosystem fields are always pre-normalized turned out to be false.
- **7 of those 32 had real team disagreements between Hashtag and the `nba_players` fallback** (Georges Niang, Dante Exum, Spencer Dinwiddie, Jared Butler, Duop Reath, Malaki Branham, Ben Simmons). Owner's call: **neither side was right** — these are real free agents unlikely to sign, so both guesses were wrong and all 7 got `team: "FA"` instead. This is a new outcome for §11's open question 4: the answer isn't always "pick a side," sometimes it's "the correct team is neither guess."
- **2 true ecosystem gaps** (Izaiyah Nelson, Nikola Djurisic) — no `nba_roster` or `nba_players` record at all, so team/position came from Hashtag's own badges (one, Izaiyah Nelson, had no position badge either — defaulted to `F`, lowest-confidence field in this whole refresh).
- **8 zero-rank orphans dropped** (obscure two-way/G-League names Hashtag no longer covers and nothing else ever did).
- avgRank/rankedByCount/consensusRank/tier recomputed; verified live in a dev preview.
- Live file: 496 players.

**All four updating experts (Dizzle, Dynatyze, MBall, Hashtag) are now merged. Angle carries forward unchanged from May 2026, per plan.**

**Angle — done, 2026-07-24, completing v1.1.** Angle's July update turned out to be a genuinely new source-access finding, not just a data pull: the rankings on `anglefantasybasketball.com`'s "Top 300 Dynasty Basketball Rankings | July 2026" post aren't in the page's HTML/text at all (confirmed absent from the accessibility tree) — the site embeds a **published Google Sheet via iframe**. That sheet's export endpoint (`https://docs.google.com/spreadsheets/d/e/<key>/pub?gid=0&single=true&output=csv`, following the redirect it 307s to) returns a plain CSV directly — no scraping, no OCR, no headless-browser rendering required. This is *easier* than Hashtag, not harder as originally guessed in §4/§11 — that guess is now superseded.

- **Schema surprise:** Angle's sheet reveals it's internally a 3-person panel (`Andrew`, `Braxton`, `Mitchell`), each with their own rank column, blended into an `Average Rank` column; a separate `Rank` column is just `Average Rank`'s sort position (ties broken alphabetically — same tie-break rule this board itself uses). **`Rank` is what this pipeline extracts as `expertRanks.angle`** — it's Angle's own equivalent of every other source's single "#" column — not `Average Rank`, which is an internal intermediate value with no direct counterpart from any other expert.
- **320 rows, all 320 matched** (313 direct, 7 via alias) — zero new-player additions needed this time. **5 of the 7 aliases were newly discovered and are now permanently in `src/lib/player-name-aliases.ts`**, cross-checked against `data/nba-rosters/2026-27.csv` for canonical spelling: Derrick→Dereck Lively (spelling), Carlton→Bub Carrington (Angle's CSV used the legal name — this is literally the exact historical bug already documented in §5's original table, recurring live and now finally alias-tabled instead of just documented), Robert→Rob Dillingham (nickname), Hansen Yang→Yang Hansen (Angle listed the family name first), Pelle Larrson→Pelle Larsson (Angle-side typo, extra "r").
- **33 players dropped their `angle` rank** (no longer on Angle's July list). **1 zero-rank-drop:** Sidy Cissoko — already lost his `dizzle` rank in the July Dizzle merge (§12, above) and was surviving on `angle` alone; losing that too drops him to `rankedByCount: 0`, removed from the board entirely.
- **12 team conflicts surfaced, all resolved by checking `data/nba-rosters/2026-27.csv` and `transactions-2026-27.md` directly** rather than guessing either side — the fullest test yet of the "flag, don't silently pick a side" policy (§5), and it split three ways:
  - **6 where Angle was simply stale** on a confirmed trade (Brandon Ingram/Gradey Dick → LAC, Kawhi Leonard → TOR, 2026-07-04 swap already in the ecosystem) or an unconfirmed rumor (Santi Aldama, Zaccharie Risacher, Luguentz Dort, Jonathan Kuminga's team weren't what Angle claimed and the roster CSV disagreed) — kept the live board's existing (ecosystem-backed) team, Angle's guess ignored.
  - **2 where Angle was actually right and the *live JSON itself* was stale** relative to the roster CSV, unrelated to anything Angle-specific catching them: Santi Aldama (`MEM`→`DAL`) and Quinten Post (`GSW`→`MEM`, the same player whose duplicate-row bug was found during the MBall merge above) — corrected directly against `data/nba-rosters/2026-27.csv`, not against Angle's own field.
  - **2 confirmed via `transactions-2026-27.md`'s own change log**, not just the roster snapshot: Jonathan Kuminga (ATL declined his option 2026-06-29, removed from all rosters 2026-07-04 — matches Angle's `FA` claim) and Ziaire Williams (off the BKN sheet, destination explicitly logged as "TBD" — so neither the live board's stale `BKN` nor Angle's guessed `LAL` was right; set to `FA`, the same "both sides wrong, real free agent" outcome already precedented in the Hashtag merge above).
  - **1 left unresolved:** Landry Shamet, Angle's `NYK` claim has no ecosystem corroboration either way — left at the board's existing `FA` rather than accepting a single uncorroborated source.
- **`trend`/`trendDelta` recomputed for all 495 survivors** against the same `public/data/versions/v1.0.json` baseline used for the four other experts, exactly as flagged as a follow-up two entries above — 391 players' trend/delta changed now that `avgRank` reflects Angle's real July numbers instead of May's carried-forward ones.
- **Found and fixed a real bug in that same recompute, sitewide, not Angle-specific:** `trendDelta` was written as a *signed* delta (negative for "down" movers) instead of a positive magnitude with direction carried separately by `trend` — the convention every other part of the codebase (`TrendIcon`, confirmed by checking the pre-Angle-merge file) already expected. This rendered as a literal "↓-1" badge on every falling player sitewide since `trend` was first wired up. Fixed by taking `Math.abs()` on all 195 affected rows; confirmed live in a dev preview that "↓-1" became "↓1".
- Version re-snapshotted: `node scripts/snapshot-rankings.js --version 1.1 --date "July 2026" --dizzle "July 2026" --dynatyze "July 2026" --mball "July 2026" --hashtag "July 2026" --angle "July 2026"`, run twice (once before the `trendDelta` sign fix, once after) so `v1.1.json` reflects the corrected data. `versions-index.json` and the `VERSIONS` array in `page.tsx` both updated: `angle` date `"May 2026"` → `"July 2026"`.
- Verified live in a dev preview: version picker reads "v1.1 (current) · July 2026", the Angle column is populated for all matched rows, trend badges render correctly, clean typecheck, no console errors.
- Live file: 495 players (496 − 1 zero-rank-drop).

**v1.1 is now complete — all five experts on July 2026 data, nothing carried forward.**

**Version bump to v1.1 — done.** `node scripts/snapshot-rankings.js --version 1.1 --date "July 2026" --dizzle "July 2026" --dynatyze "July 2026" --mball "July 2026" --hashtag "July 2026" --angle "May 2026"` wrote `public/data/versions/v1.1.json` (496 players). `public/data/versions-index.json` and the `VERSIONS` array in `page.tsx` both updated: v1.1 `isCurrent: true`, v1.0 `isCurrent: false`. Verified live — the version picker shows both, defaults to v1.1.

**Standing exception to the "every refresh bumps the version" rule (§10 item 8, §1) — now resolved, kept here as the precedent for next time.** Angle hadn't published since May 2026 and was carried forward unchanged for the first nine days of this v1.1 cycle. When Angle's July list arrived (2026-07-24), it was merged into **this same v1.1** — re-running the snapshot script with `--version 1.1` again, overwriting `v1.1.json` and updating `expertDates.angle` — rather than triggering a v1.2. v1.2 is reserved for the *next* full periodic refresh cycle, not for a straggling expert catching up within this one. See the Angle entry below for exactly how that played out, including the trend-field recompute this note predicted.

**`trend` field — wired up for the first time, done.** Previously inert (§6, §10 item 5) — every row was hardcoded `"flat"`. This refresh:
- Added a `trendDelta: number | null` field alongside `trend` (spots moved since the prior version; `null` when the player has no prior-version baseline — i.e. new to the board this cycle).
- Computed both by diffing each player's new `consensusRank` against `public/data/versions/v1.0.json`'s `consensusRank` (matched by `normalizePlayerName()`, with the one mid-cycle rename — McNeely→McNeeley — mapped explicitly so it doesn't look like a brand-new player).
- Fixed `TrendIcon` (`src/app/dynasty-rankings/_components/trend-icon.tsx`) to take the delta and render `↑N`/`↓N`; **returns `null` (nothing at all) for flat**, per owner instruction — this is specific to the main consensus page, not the rest of the ecosystem (see below). Wired into both `rankings-table.tsx` and `tier-view.tsx`, gated to `!activeExpertKey` (trend is a consensus-level property, hidden when viewing an individual expert's own ranking).
- Fixed the CSS itself, which was wrong on both counts: `.dr-trend-up` used `--rt-primary` (brand orange) instead of green, and `.dr-trend-down` was visually identical to `.dr-trend-flat` (both muted gray) — neither up nor down had ever been distinguishable. Now `--green-elite` / `--red-severe`, matching the same variables already used for the page's own VS CONS column.
- **Turbopack cache gotcha:** after editing `globals.css`, the dev server kept serving the old CSS chunk verbatim (confirmed by fetching the served bundle directly) — a plain reload and even a full server restart didn't help; only `rm -rf .next/cache` (with the server stopped first) picked up the change. Worth knowing before assuming a CSS edit "didn't work."
- **Also wired the same `trend`/`trendDelta` data through the rest of the ecosystem** (team-rosters + the shared compare tool), which turned out to be *already partially plumbed* — `roster-live-data.ts` already read `dyn?.trend` into `Player.dir`, and `player-trend-chart.tsx`'s `TrendHero` already had a `consensusDir` prop with a doc comment literally reading "currently near-always flat until consensus rank v1.1 is published with real period-over-period deltas." That day had arrived. Added the missing pieces: a `Player.dirDelta` field, a `consensusDelta` prop on `TrendHero` (rendering the number next to the existing caret, mirroring the pattern already used for the separate Minus1V value-trend arrow on the same card), and fixed `Player.change` in `roster-live-data.ts` (previously hardcoded to always show "—" regardless of actual direction). Also found and fixed a **third, previously-untouched render site** — a compact card-grid "key stat" tile (`roster-app.tsx`, `c.keyVal`/`c.keyLabel`) that shows the dynasty rank with no trend indicator at all when sorted by dynasty value; added the same caret+delta there, gated to `sort === "dynasty"`.
- **Team-rosters keeps its own pre-existing convention for flat** (a muted dash "–", via `roster-helpers.ts`'s `caret()`/`changeColor()`) rather than adopting the dynasty-rankings page's "print nothing" rule — the owner's instruction scoped that specifically to "the actual consensus rank page," and dash-for-flat was already the established pattern everywhere else on team-rosters (mirroring how the Minus1V value-trend arrow already behaves).
- **Follow-up fix, same day:** the first pass rendered the arrow+delta inline right after the rank number, which (a) wrapped unpredictably onto a second line depending on digit count in the tight mobile columns, and (b) as plain colored text, visually competed with the already-tier-colored rank number next to it. Fixed by (1) always stacking the badge on its own line below the rank number instead of inline — deterministic layout regardless of digit count — and (2) restyling it as a small rounded pill (`.dr-trend-badge`, tinted background) instead of bare colored text, so it reads as a distinct annotation rather than competing with the rank color. On the table view specifically, the badge is hidden entirely at the same room-constrained breakpoints that already hide the tier column (`!isMobile && !isLandscape` — mobile portrait's 30px rank column and mobile landscape's 24px one have no room for it without breaking the fixed row height); the tier-view's card grid has no such constraint (cards reflow to full width, no fixed height) so it keeps the badge on all screen sizes.

**Hashtag Basketball → FBI-HE swap — done, 2026-08-02.** Hashtag Basketball indicated they wanted to end their partnership with FHE. Fantasy Basketball International (FBI) stepped in as FHE's new co-branded partner (see the fbi-partnership memory) — the `hashtag` panel seat was replaced with `fbihe` (FBI-HE), **still shipped as v1.1** (not a v1.2 bump — per the owner's explicit instruction this replaces v1.1 in place as the official 2nd release, same "still the same version" precedent the Angle-carries-forward case above established, just applied to a full panelist swap instead of a late data pull):

- **Source for FBI-HE's first release:** the owner built it by hand in the new `/admin/dynasty-board` tool (`/admin/dynasty-board`, added 2026-08-01 — see the dynasty-board-editor memory), starting from a copy of the outgoing `hashtag` rank order (so the first FBI-HE release reads "very similar to Hashtag's," by design) and adjusting from there: reordering, adding ecosystem players not on the prior board, removing players who no longer belonged. Published final state: **488 players**.
- **Migration script:** `scripts/swap-hashtag-for-fbihe.ts` (one-time; `npx tsx scripts/swap-hashtag-for-fbihe.ts --dry-run` to preview, no flag to write for real). For every existing row: deleted `expertRanks.hashtag`, added `expertRanks.fbihe` from the published board's `customRank` (matched by `normalizePlayerName()` + the nickname/alias table). `dizzle`/`angle`/`mball`/`dynatyze` were **not touched**.
- **18 zero-rank drops** — players who only ever had a `hashtag` rank and aren't on the new published board (deep bench/inactive vets: Jaron Pierre Jr., Malique Lewis, Killian Hayes, Nick Boyd, Tyrese Martin, Ben Simmons, Wendell Moore Jr., Jared Butler, Bol Bol, Richaun Holmes, Dalano Banton, James Wiseman, Duop Reath, Georges Niang, Spencer Dinwiddie, Malaki Branham, Dante Exum, Eric Gordon).
- **16 new rows added** — ecosystem players (via the dynasty-board tool's "+ Add player" picker) not previously in `dynasty-rankings.json` at all: Jalen Slawson, Sidy Cissoko, Kobe Bufkin, Bryce Hopkins, Zyon Pullin, Jaylin Sellers, Quadir Copeland, Maliq Brown, Chaney Johnson, Trey Lyles, Jamison Battle, Tre White, David Jones Garcia, Rafael Castro, Duke Miles, Jamarion Sharp. Name/team/position/age sourced from the ecosystem (`nba_roster`), per the standard "ecosystem is the source of truth" rule (§5) — the dynasty-board tool already resolves these at add-time.
- **avgRank/rankedByCount/consensusRank/tier recomputed** across the resulting 5-panel blend (same math, §6's fixed tier table). **trend/trendDelta recomputed against `v1.0.json`** (the true prior distinct version — not the now-ghosted old v1.1) — same as the original v1.1 build.
- **Final count: 493 players** (495 − 18 dropped + 16 added).
- **Old v1.1 (hashtag-based) snapshot ghosted, not deleted:** copied to `public/data/versions/v1.1(GHOST).json` before anything was overwritten. This file is intentionally **never referenced** from `versions-index.json`, the `VERSIONS` array in `page.tsx`, or anywhere else — per the owner's explicit instruction, it's preserved on disk as a raw backup only, functionally erased from the site's history as if it never existed. Do not wire it back in.
- **`scripts/snapshot-rankings.js` updated**: its `--hashtag` flag is now `--fbihe`. Re-run to regenerate `v1.1.json`: `node scripts/snapshot-rankings.js --version 1.1 --date "July 2026" --dizzle "July 2026" --mball "July 2026" --angle "July 2026" --dynatyze "July 2026" --fbihe "July Update"` — note **"July Update"**, not a numeric month like the other four, since this isn't a dated external pull.
- **Every "current state" reference to `hashtag` was swept and replaced with `fbihe`** across `dynasty-rankings.ts` (the `expertRanks` type), `page.tsx` (`VERSIONS`, `EXPERT_NAMES`), `rankings-table.tsx` (`EXPERT_ORDER`, `SortKey`, the About-section prose), `controls-bar.tsx` (`EXPERT_OPTIONS`), `globals.css` (`.dr-col-w-hashtag` → `.dr-col-w-fbihe`), `schemas.ts` (SEO JSON-LD — the `Hashtag Basketball` `WebSite` citation was removed outright rather than replaced, since FBI-HE isn't an external cited source), and `/terms` + `/privacy`'s data-source disclosure paragraphs. **v1.0's own historical `expertDates.hashtag: "June 2026"` was deliberately left alone** — that's genuine history from before the partnership ended, not a live reference to scrub.
- **The `hashtag-dynasty-scraper` skill is retired for this pipeline** (see §4) — it's a global/plugin skill, not project-local, so it wasn't edited directly; a future refresh should simply stop invoking it for this panel.
- Verified live in a dev preview: version picker shows only `v1.0 · June 2026` and `v1.1 (current) · July 2026` (no ghost entry visible anywhere), the FBI-HE column renders in the expert table/filter/version-info, no `hashtag` string appears anywhere on the rendered page, clean typecheck, no console errors.
- **Downstream ecosystem refresh explicitly paused mid-sequence, per owner instruction:** `seasonal:build` and `trends:build` were run to pick up the new consensus, but **`realsalary:build` (and therefore the full `dynasty:sync`) was deliberately skipped** — the owner has further adjustments to make before Real Salary Rankings gets rebuilt against this new consensus. Whoever picks this up next: run `npm run realsalary:build` (or `npm run dynasty:sync`, which re-runs all three in order) once those adjustments land — until then, `/real-salary-rankings`' own Consensus column will already reflect the new FBI-HE ranks (it reads `dynasty-rankings.json` fresh on every render) while its stored `real_salary_values` verdict is stale, the exact mismatch pattern CLAUDE.md already warns about.

---

*Sources: `src/lib/dynasty-rankings.{ts,json}` · `src/lib/player-name-aliases.ts` · `src/app/dynasty-rankings/**` · `scripts/swap-experts.js` · `scripts/snapshot-rankings.js` · `scripts/swap-hashtag-for-fbihe.ts` · `scripts/nba-data/roster_ingest.ts` · `dynasty ranks/*.csv` · `dynasty ranks/July 2026/*.csv` · `data/nba-rosters/2026-27.csv` · `data/nba-rosters/transactions-2026-27.md` · `data/fhe_2026_prospects_master.csv` · `/admin/dynasty-board` (`dynasty_board_docs` in Supabase) · git log (commits `d19246d` through `74d0a88`, plus the 2026-08-02 FBI-HE swap)*
