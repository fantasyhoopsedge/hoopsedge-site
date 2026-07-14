# Dynasty Consensus Ingestion

**How five expert dynasty rankings become one consensus board** — sourcing, name matching, math, display, and the gaps standing between today's manual process and a fully automated periodic refresh.

- **Prepared:** 2026-07-14
- **Covers:** `src/lib/dynasty-rankings.{ts,json}`, `/dynasty-rankings`
- **Current dataset:** v1.0 · 446 players
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

## 1. Overview

The dynasty consensus board at `/dynasty-rankings` merges five independent dynasty-rankings panels into one ordered list of 446 players (v1.0, June 2026). Each player carries a rank from every expert who ranked them, an average rank across however many did, a derived consensus position, and a tier. It ships as bundled JSON — `src/lib/dynasty-rankings.json`, imported straight into the build — not a database table, so a "refresh" today means regenerating and committing that file — and, going forward, archiving the version it replaces first (§10, item 8): V1.0 (June 2026) → V1.1 (July 2026) → V1.2, and so on, every cycle.

Target cadence: a full refresh roughly every **5–6 weeks**, each source contributing whatever its latest release happens to be at that point (some update faster than others — see §4).

> Everything here is reconstructed from the current codebase, the raw source files still sitting in the repo, and the commit history of every past refresh — not from a written spec, because none existed before this document. That absence was the original main finding; §10 tracks what's left to close it.

## 2. Required inputs

A full refresh needs six things on hand before any merging can happen:

| Input | Current location | Format | Refresh cadence |
|---|---|---|---|
| Dizzle Dynasty rankings | `dynasty ranks/July 2026/Dizzle Dynasty…(July 2026).xlsx` | Multi-tab XLSX export — 9Cat ranks live on the leftmost tab, extracted to CSV | Irregular, confirmed manual (last: July 2026) |
| Angle Fantasy Basketball rankings | anglefantasybasketball.com — "Top N Dynasty Basketball Rankings" posts | Live scrape, permission granted by the site | Historically every 8–10 weeks (e.g. [May 2026, Top 300](https://anglefantasybasketball.com/2026/05/01/top-300-dynasty-basketball-rankings-may-2026/)) |
| Hashtag Basketball rankings | `dynasty ranks/ALL ACCESS…Categories.csv` *(archived)* | Live scrape of hashtagbasketball.com, free tier goes to Top 500 — pipeline caps ingestion at Top 450 | Most frequent of the five — re-pulled live each refresh |
| Moneyballers (mball) rankings | `moneyballers-impact-api.fly.dev/api/fantasy/dynasty` | JSON API, 350 players deep (with `?limit=350`) | Irregular pull cadence today (last: April 2026), but the source itself looks live/daily |
| Dynatyze rankings | `dynatyze.com/api/rankings?limit=75&ct=free` | JSON API, top 75 only (free tier) | Called "Daily" in the UI — freshest source |
| FHE rookie prospect board | Live Supabase-backed board via `/admin/rookie-board` (`data/fhe_2026_prospects_master.csv` was the 2026 one-off seed) | Manually ranked in-app, ~100 prospects | Annual: loaded and ranked each Feb–March, ahead of that year's draft |

A seventh input feeds the site around the rankings rather than the rankings themselves: `src/lib/nba-player-ids.json` supplies NBA.com player IDs for veteran headshots, and current NBA team is reconciled against the live `nba_roster` table (not baked into the JSON) for anyone whose team changed since the last refresh — see §9.

## 3. The five experts

The panel has changed composition twice. It launched with seven contributors; two unidentified ones (`matt`, `noah`) were dropped in favor of Dynatyze, and a contributor originally keyed `jason` was renamed to `mball` for clarity. The five below are current as of v1.0:

| Key | Display label | Full name | Notes |
|---|---|---|---|
| `dizzle` | Dizzle | Dizzle Dynasty | 9-cat/points hybrid rankings; confirmed to stay a manual XLSX/CSV input for now, no API |
| `angle` | Angle | Angle Fantasy Basketball | 9-cat specialist; confirmed live-scrape target, permission granted by the site owner |
| `mball` | MBall | Moneyballers | Renamed from `jason` in commit `f216bbf`; has a public JSON API, 350 players deep (with `?limit=350`) |
| `hashtag` | Hashtag | Hashtag Basketball | Largest, most-cited public dynasty list; scraped live; free tier reaches Top 500, capped at Top 450 for ingestion |
| `dynatyze` | Dynatyze | Dynatyze | API-driven, top 75 only (free tier, cut from 150 as of July 2026), updates most often |

These identities live in three places that must stay in sync by hand: `EXPERT_NAMES` and `EXPERT_ORDER` in the page/table components, the `expertRanks` keys in every JSON row, and the `expertDates` map in each `VERSIONS` entry. Adding or removing a panelist means touching all three.

## 4. How each is sourced

No two panelists are ingested the same way today:

- **Dynatyze** — the only fully programmatic source, of long standing. A one-off script, `scripts/swap-experts.js`, calls `GET https://dynatyze.com/api/rankings?limit=150` with a browser-like `User-Agent` and `Referer`, and reads `{ players: [{ fullName, rank }] }`. **As of July 2026, Dynatyze cut its free-tier cap from top 150 to top 75** — confirmed live: the endpoint now returns exactly 75 players (ranks 1–75, ending at Kawhi Leonard) no matter what `limit` value is requested, including the original `?limit=150` call. The live site itself calls `?limit=500&ct=free` and gets the same 75 back, so `ct=free` is likely the real gate, not `limit`. The response payload has also grown far richer than the script expects — nested `stats`/`epmData` blocks, `marketValue`, `tier`, `hypeGap` — but `fullName` and `rank` are still present at the top level, so the existing matching logic still works, just over a smaller pool. Any future refresh should request `limit=75` going forward and treat 151–446 (now 76–446) as never having a Dynatyze figure. Dynatyze's own model refreshes daily, but that's not this pipeline's cadence — each FHE refresh takes one dated **snapshot** of whatever Dynatyze shows that day and labels it accordingly (e.g. "Ranked by Dynatyze — July 2026"), the same dating convention already used for the other four panels, rather than trying to track Dynatyze in real time.

- **Moneyballers** — also fully programmatic, and previously undocumented as such. The site at `moneyballersimpact.com/fantasy/dynasty` is a client-rendered app, but it calls a public backend directly: `GET https://moneyballers-impact-api.fly.dev/api/fantasy/dynasty` returns `{ count, computed_at, players: [...] }`, no auth required. **The call defaults to 300 players but the published pool is 350** — pass `?limit=350` to get the full board (the API accepts up to `limit=500`, but still only returns 350, ending at Corey Kispert, confirming 350 is the actual depth of the source, not a pagination artifact). Deeper than Dynatyze's 75 either way. Each player record carries `rank`, `player_name`, `team`, `position`, plus Moneyballers' own `impact_score`/`gem_score`/`trajectory_score` metrics and a written `sleeper_take` — far more than the two numbers this pipeline currently extracts. Worth a proper client alongside `swap-experts.js` rather than treating it as a manual export.

- **Hashtag Basketball** — scraped from the live site rather than a static export ("Hashtag refreshed from live site (June 1 rankings)", commit `28f9dae`; a later pass in `63063ae` explicitly rebuilt it "from clean verified scrape" after rank-order and rookie-insertion bugs surfaced). The page's own "SHOW" toggle offers Top 300 / Top 400 / **Top 500** / All players free, no login wall — but the ingestion pipeline should stop at **Top 450**, matching the consensus board's target size rather than pulling the full free depth. This is the source an automated skill would need a scraping routine for — it's also the one referenced by the *hashtag-dynasty-scraper* skill already registered in this environment.

- **Dizzle** — confirmed to be staying manual for now. The July 2026 refresh arrived as a multi-tab spreadsheet, `dynasty ranks/July 2026/Dizzle Dynasty - 9Cat_Points_Rookie Dynasty Rankings (July 2026).xlsx`, with separate tabs per format/date (`July 2026 Dynasty Ranks, 9Cat` — the leftmost tab and the one this pipeline uses — plus Points, Rookie, Pick Values, and prior-period tabs going back to January 2026). The 9Cat tab runs 450 players deep, same schema as the old CSV exports (Rank, Player, Position, Team, DOB, Age, Previous Rank, +/- Change, Notes/Outlook), and was extracted to a matching CSV rather than read directly. No API or scrape target exists for Dizzle; a refresh depends on someone dropping in a fresh export.

- **Angle** — confirmed live-scrape target, with explicit permission from the site to do so. Angle publishes dated "Top N Dynasty Basketball Rankings" posts on `anglefantasybasketball.com` — historically every 8–10 weeks (the [May 2026 Top 300 post](https://anglefantasybasketball.com/2026/05/01/top-300-dynasty-basketball-rankings-may-2026/) is the current one) — plus separate, more frequent rookie big-board posts. The site's own nav conveniently surfaces the current live link with an "Updated M/D/YY" label, so an agent can find the latest post without guessing URLs. One caveat from a quick look at that page: the actual 300-player list isn't present as plain HTML/table content on the post itself — whatever renders it (an embedded image, iframe, or interactive widget) needs to be identified before a scraper can be built, so this is closer in effort to Hashtag's scrape than to a simple HTML table pull.

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

## 8. Value to dynasty managers

The pitch isn't "here's a ranking" — dynasty managers can get that from any single source. It's **disagreement made visible**:

- **Trade leverage.** A player five sources agree on is a fair trade; one where Hashtag has him at 40 and Dynatyze has him at 90 is exactly where buy-low/sell-high edges live. The VS CONS column and tinted cells surface that without manual cross-referencing five separate sites.
- **9-cat, 16+ team framing.** The board is explicitly built for category-format, deep-league dynasty — not points leagues or shallow redraft — so tier placement reflects category-balance value, not raw box-score totals.
- **Rookie integration.** FHE's own scouted rookie order sits inside the same consensus list as veterans, rather than a separate rookie-only board a manager has to mentally merge in.
- **Context on demand.** The quick-view/compare integration means a rank isn't a dead number — a manager can immediately check a player's actual current-season stat line and team situation before acting on the rank.
- **Movement over time** (once versioning has more than one snapshot) — seeing a player's consensus rank rise or fall release over release is a leading indicator a single static list can't offer.

## 9. Ecosystem ties

Dynasty rankings sits at a junction of four otherwise-separate FHE data surfaces:

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
```

Concretely: rookies enter the board from FHE's own scouted prospect data, not from the five external experts. Every player's team badge and quick-view stat line are reconciled live against `nba_roster` rather than baked into the JSON, so a trade mid-season doesn't require a full rankings refresh just to fix a team logo. And the same `normalizePlayerName()` key that joins the five expert lists together is the identical function joining salary data, game logs, and category-value trends elsewhere in the app — any change to it has to be made in both `src/lib/dynasty-rankings.ts` and `scripts/nba-data/client.ts` simultaneously, per the byte-identical requirement in `CLAUDE.md`.

The version archive is the newest of these ties, and the forward-looking one: today it powers the version picker already built into `/dynasty-rankings` (§7), but every version this skill archives is also raw material for a future conversational "AI Edge" agent — something a user could ask "how has this player trended over the last three versions?" or "who's risen the most since March?" and get an answer grounded in real historical snapshots rather than a single point-in-time list. That's the concrete reason archiving-before-overwrite (§10, item 8) is a required step of every refresh, not an optional nicety.

## 10. Automation gap list

What stands between today's manual, session-by-session process and a scheduled agent that can run this refresh unattended, roughly in the order it would need to be tackled:

> **Standing policy: auto-resolve when confident, flag when not.** This is the general rule for every judgment call the agent hits mid-refresh — duplicate/mismatched player names (§5) and placeholder-row detection during the pre-draft window (item 6 below) alike. Default to resolving automatically when the signals agree; only surface something for human confirmation when they don't.

1. **No unified ingest script** — `gap`. Only the Dynatyze leg (`swap-experts.js`) and a snapshot writer (`snapshot-rankings.js`) are scripted. The merge of all five sources into one JSON has never been more than a one-time hand edit.

2. **Sourcing method is now settled for all five panels** — `have`. Dizzle stays a confirmed manual XLSX/CSV hand-off — the skill should prompt for a fresh export each cycle rather than try to fetch one. Angle is a confirmed live-scrape target (permission granted), same bucket as Hashtag. Dynatyze and Moneyballers are confirmed APIs. Nothing left unclassified — what's left is building the actual scraper/client/prompt for each, not figuring out which kind each source is.

3. **Alias/matching pipeline needs building, but the policy is now decided** — `gap`. `ALIASES` in `swap-experts.js` is still empty, and nothing implements the fuller policy in §5 yet (nickname table, surname/middle-name fallback matching, non-decomposable-diacritic map). The decision itself is made — auto-resolve confident matches, flag uncertain ones — so this is now an implementation task, not an open design question.

4. **Tier cutoffs need codifying as a fixed table** — `gap`. No code currently maps `avgRank` → tier at all — v1.0's boundaries only exist as data (the tier value already baked into each row), not as a rule. Per §6, the boundaries themselves are decided and fixed (tier 8 open-ended down to rank 450) — the remaining work is writing that table into the ingest script so future refreshes apply it mechanically instead of a human re-deriving it from scratch.

5. **`trend` field is inert** — `manual`. UI is built (`TrendIcon`) but the data has never been computed. A refresh pipeline should diff the new snapshot against the previous version to populate it — this is one of the more self-contained wins available.

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

9. **No validation gate** — `gap`. Unlike `seasonal:build`, which is "validation-gated" against a reference export per `CLAUDE.md`, nothing checks a freshly merged dynasty file for null positions/ages, duplicate players, or wildly discontinuous ranks before it ships — those have all been real bugs in past refreshes (commits `28f9dae`, `63063ae`).

10. **Existing groundwork** — `have`. The normalizer, the tier/table/quick-view UI, the versioning display machinery, and the sophomore/live-roster reconciliation are all already built and stable — the gap is entirely on the ingest side, not the presentation side.

## 11. Decided so far, and what's still open

Answered and folded into the sections above: Angle is a confirmed, permissioned live-scrape (§4); tier cutoffs are fixed policy with tier 8 open-ended to rank 450 (§6); target cadence is every 5–6 weeks with Dynatyze taken as a dated snapshot rather than tracked live (§1/§4); name-matching defaults to auto-resolve-when-confident, flag-when-not (§5/§10); and archiving the outgoing version (V1.0 → V1.1 → …) is a required first step of every refresh, not optional versioning housekeeping (§9/§10 item 8).

Still open:

1. Angle's actual rankings didn't appear as plain HTML/table content on a quick look at the May 2026 post (see §4) — is the actual delivery mechanism (image, embedded sheet, something else) already known, or does that need investigating as a first step?
2. For the nickname/alias table in §5 — should confirmed resolutions get written back to a persisted, checked-in dictionary that grows over time, or re-derived fresh each refresh?
3. What should "confident enough to auto-resolve" mean concretely — e.g. is same-surname-plus-same-team always enough to auto-merge, or should same-team-different-position still get flagged?

---

*Sources: `src/lib/dynasty-rankings.{ts,json}` · `src/app/dynasty-rankings/**` · `scripts/swap-experts.js` · `scripts/snapshot-rankings.js` · `dynasty ranks/*.csv` · `data/fhe_2026_prospects_master.csv` · git log (commits `d19246d` through `74d0a88`)*
