---
name: salary-roster-pipeline
description: How to refresh NBA salary/contract data and rosters for FantasyHoopsEdge, and how a player's team/name/DOB/position stays consistent across team-rosters, dynasty-rankings, and every other surface in the app. Use this whenever the task involves data/nba-salaries/current.csv, data/nba-rosters/<season>.csv, scripts/nba-data/salary_ingest.ts or roster_ingest.ts, the nba_contracts or nba_roster tables, refreshing salaries from HoopsHype or any other salary site, a player showing the wrong team/salary/contract type, "current.csv is stale", QO/qualifying-offer tags, rookie-scale vs standard contract classification, or reconciling a player's team between team-rosters and dynasty-rankings.json. Also consult this before editing scripts/nba-data/roster_ingest.ts or salary_ingest.ts, or before hand-editing either CSV, since both scripts have non-obvious precedence and estimation rules that are easy to break silently.
---

# FantasyHoopsEdge salary & roster pipeline

Two independent CSVs feed two independent Supabase tables, which two independent
parts of the app read. Nothing here auto-syncs — every refresh is a deliberate,
human-run step. This skill is the runbook for doing those refreshes correctly and
for keeping a player's identity (team, name, DOB, position) consistent everywhere
it appears.

## The two pipelines, at a glance

| | Salary source | Feeds | Ingest script | Read by |
|---|---|---|---|---|
| **Salary** | `data/nba-salaries/current.csv` (HoopsHype, hand-refreshed) | `nba_contracts` | `npm run nba:salary` (`salary_ingest.ts`) | `/api/nba/rosters`, `/api/nba/trade-candidates`, `/api/nba/free-agents` |
| **Roster** | `data/nba-rosters/<season>.csv` ("Pocaro's sheet" — a shared Google Sheets cap table; the owner shares the view-only link, read directly via the Browser MCP technique below) | `nba_roster` | `npm run nba:roster` (`roster_ingest.ts`) | `/team-rosters` (the live app people actually use) |

`roster_ingest.ts` **reads current.csv too** (via `loadRealSalaries()`) and treats
it as the authoritative salary source, falling back to the cap-sheet's own
numbers only where current.csv has nothing. So refreshing current.csv and then
running `npm run nba:roster` is how a HoopsHype refresh actually reaches the
live team-rosters page — running `nba:salary` alone only updates the
lesser-used `/api/nba/*` routes.

**Always refresh in this order:**
```bash
npm run nba:salary    # current.csv -> nba_contracts
npm run nba:roster     # data/nba-rosters/<season>.csv (+ current.csv) -> nba_roster
```
Both scripts support `--dry-run` — always dry-run first and read the summary
(unmatched count, estimated-years list, tag conflicts) before writing for real.

**Cache warning:** `/team-rosters` wraps its Supabase reads in
`unstable_cache({ revalidate: 900, tags: [ROSTER_TAG] })`. A real write to
`nba_roster` is immediately live in the database, but the app may keep serving
a cached response for up to 15 minutes — including in a local dev server,
where Next's data cache persists on disk (`.next/cache`) across restarts. If
a refresh doesn't seem to show up, that's almost always the cache, not the
data: `rm -rf .next/cache` and restart before assuming something's broken.

For the full step-by-step of refreshing current.csv from HoopsHype, see
[references/hoopshype-refresh.md](references/hoopshype-refresh.md). For the
exact salary-resolution rules inside `roster_ingest.ts` (precedence, FA-year
boundary, rookie-scale backsolve, QO tagging, contract status), see
[references/roster-salary-resolution.md](references/roster-salary-resolution.md).
For how to validate a completed refresh against an independent source (a
third-party roster/contract tracker, Spotrac, etc.) — what kinds of
disagreements are real bugs versus the third party being wrong — see
[references/third-party-cross-check.md](references/third-party-cross-check.md).

## The 2026-07-30 rebuild: contract_raw/fa_year were silently wrong league-wide

A multi-session initiative is rebuilding `data/nba-rosters/<season>.csv`'s
`contract` and `fa_year` columns for every team, because a real, systemic bug
was found: for a large share of players, `contract_raw` was never actually
transcribed from the player's real signed deal — it was silently **derived by
summing whatever 4 years happened to be populated in `current.csv`** and
mislabeling that sum as "N yr / $total". This is invisible until you check a
player whose contract doesn't fit neatly in a 4-year forward window (a long
extension, or a deal signed before the tracked window started) — e.g.
Wembanyama's row said `"4 yr / $157.8M"`, and $157.8M is *exactly* the sum of
his 4 known `current.csv` years, even though his real deal is a 5yr/$252M
extension. Confirmed as a repeating pattern across dozens of players once
looked for deliberately, not a one-off.

**The fix is a team-by-team audit**, cross-referencing each team's roster
rows against a fresh full-roster cap-sheet pull (the owner calls this
source "Pocaro's sheet" — a HoopsHype-derived per-team cap table with
CONTRACT / FA YEAR / 26-27 SALARY columns, plus full bio: jersey, position,
height, weight, DOB, age, years-of-service, draft, nationality). Progress is
tracked as one task per team; see the project memory for current status
(which teams are done, which are pending, and open flags).

**Pulling Pocaro's sheet directly (2026-08-08, supersedes screenshots as the
default method).** The sheet is a Google Sheets document (shared as a
view-only "anyone with the link" URL, currently reached via a t.co shortlink)
with one tab per competition — the NBA tab holds all 30 teams back to back,
each starting with a `TEAM NAME` header row. Its grid is canvas-rendered, so
the normal `read_page`/`get_page_text` tools see only chrome (menus, sheet
tab names) and not a single cell — and navigating straight to
`.../export?format=csv` triggers a file download, which is blocked (downloads
require explicit user permission, and shouldn't be routine here anyway).
What works:

```
https://docs.google.com/spreadsheets/d/<DOC_ID>/gviz/tq?gid=<GID>&tqx=out:html
```

This is Google's internal query endpoint; requesting `tqx=out:html` returns
the sheet as a plain HTML table, which the browser renders normally (not a
download) and `get_page_text` reads in full — every team, every column, in
one pull, exactly as typed (no OCR-by-eye transcription risk). `<DOC_ID>` is
the fixed id in the sheet's URL; `<GID>` is per-tab and not visible from the
tab bar's accessible name — get it by clicking the target tab (e.g. "NBA")
and reading `window.location.href` via the browser's JS-eval tool
immediately after, since Sheets updates the URL fragment client-side on tab
switch without a real navigation.

This is an attended, Claude-driven browser session reading a document the
owner already has share access to — the same posture as the manual
browser-console snippet in "The hard rule" below, just faster and exact
instead of eyeballed off a screenshot. It does not change any of the
precedence rules in this file (Pocaro's sheet still only wins for
`contract_raw`/`fa_year`, never for `salary_26_27`) — it only changes how the
sheet's text reaches you. Keep it attended and one-off per refresh, same as
every other manual input in this pipeline — never wire this into a script,
cron job, or unattended fetch.

**The rule for this specific rebuild — memorize the precedence, it's easy to
get backwards:**
- **`contract_raw` and `fa_year` → Pocaro's sheet wins.** It's the only source
  that reflects the player's *actual signed contract*, including years already
  elapsed before the tracked window.
- **`salary_26_27` → `current.csv` still wins**, unchanged from the pipeline's
  existing hard rule (see "current.csv wins, year for year" in
  `references/roster-salary-resolution.md`). Never let Pocaro's sheet's own
  salary column override it, even when they disagree — check `current.csv`
  directly before touching a salary figure.

**The gotcha that reversed a real correction mid-session: a Spotrac-style
forward-only per-year table is NOT a substitute for Pocaro's sheet, and using
one to "correct" a contract total is itself a bug.** Spotrac's table only
shows years from the *current* season forward — a player who signed a 3-year
deal last season and is now one year in will show only 2 remaining years on
that table, making the real 3-year/$27.7M deal look like a 2-year/$18.9M one.
This produced a full table of plausible-looking "corrections" for an entire
roster in one pass before being caught (Ty Jerome's real `3yr/$27.7M` deal,
signed 2025-26 at $8.8M/$9.2M/$9.7M, would have been wrongly cut down to
`2yr/$18.9M` using only the forward-visible two years). **Pocaro's sheet
already accounts for elapsed years; Spotrac's per-year table does not — when
they disagree on contract length/total, trust Pocaro's sheet, not Spotrac.**
Spotrac-style tables (and the Dead Money / Active Roster split some of them
show) *are* useful for a different question — confirming whether a player is
still actually on the roster at all (see below) — just not for contract
length or total value.

**Roster-membership resolution (is this player even still on the team?):** a
player missing from a screenshot is not automatically removed — screenshots
routinely get cropped/truncated mid-list, and that looks identical to a real
roster departure at first glance. Only remove a player when there's an
*affirmative* signal: the owner directly confirms it, a "WAIVED" tag or
Dead-Money-table appearance, or the screenshot ends at a clean team-header
boundary (not mid-list) with no trace of the player in either an active-roster
or dead-money view. Otherwise, flag it and wait for confirmation rather than
guessing — a real case this session (Kevon Looney) turned out to be a pure
sheet omission despite being gone from two separate screenshots in a row.

**Bio data**: the same screenshots carry jersey number, position, height,
weight, DOB, age, years-of-service, draft slot, and nationality — use those
columns as the source for filling any blank bio field on an already-processed
team. Don't fabricate bio facts from general knowledge unless the owner
explicitly says to (blank jersey numbers are frequently blank in the source
too — that's not a gap to fill, that's the sheet not having assigned one yet).

**When Pocaro's sheet disagrees with the CSV on which TEAM a player is on,
trust the sheet — don't require independent corroboration first.** A full
30-team sweep found six such mismatches in one pass; every one turned out to
be either a real trade/signing (confirmed against a transactions feed when
asked) or a stale CSV tag from a prior refresh. The one genuine exception —
Zaccharie Risacher briefly "corrected" from the sheet's DAL back to ATL based
on his bio fields matching Atlanta — was itself wrong: the sheet was right
both times, he really was traded, and the bio fields just hadn't caught up
yet. Bio-field agreement with the *old* CSV is not evidence the sheet is
wrong; the CSV is exactly the side more likely to be stale. If the sheet
shows a team change, apply it (updating `prior_team` to whatever the sheet's
"2025-26 TEAM" column already says, which usually needs no edit since it's
naturally the player's pre-move team) — reserve actual pushback for cases
where the sheet contradicts *itself* (see the extension-vs-current-deal note
below), not cases where it merely contradicts a source it's supposed to
supersede.

**A player currently tagged `FA`/`UFA`/`RFA` who appears in the sheet with a
real team and a real dollar figure has signed** — move them to that team and
apply the sheet's contract/salary data. This isn't a "maybe," it's the
direct signal the FA bucket exists to eventually resolve.

**Sense-checking a contract-LENGTH change (not just a number update) against
the sheet's own numbers, before trusting it:** a length change (e.g. the CSV
says "1 yr" and the sheet says "4 yr" for the same player) needs a different
check than a routine bio fill, because the CSV's *old* value is frequently
the unreliable side — a common real pattern is the CSV having recorded only
the *current* season's salary as if it were a fresh 1-year deal, when it's
actually the final year of a longer one Pocaro's sheet correctly shows in
full. Comparing the new length against the *old* CSV value (e.g. checking
whether $/year stays proportionally consistent) is the wrong test — it's
circular, since the old value is exactly the thing suspected of being wrong.
The right test is internal consistency of the **sheet's own** two fields —
`contract` (total years) and `fa_year` (when free agency hits, with a `+N`
suffix meaning N *additional* option years beyond the base year — add N to
the base, don't just note it as a flag):

```
position_in_contract = total_years − ((fa_year_base + fa_year_option_suffix) − 2027)
```

(2027 = the offseason immediately following the 2026-27 season; adjust the
constant for whatever season is current when re-deriving this.) A result
between 1 and `total_years` is self-consistent — apply the change. A result
of **exactly 0** isn't an error, it's a distinct real case: a **signed
extension that hasn't started yet**, kicking in next season, layered on top
of a *different*, currently-expiring contract the player is still finishing
this season (same shape as the extension-boundary case in
[references/roster-salary-resolution.md](references/roster-salary-resolution.md)
§1a, just on the roster-CSV side instead of current.csv's salary-year
columns) — apply the sheet's extension terms as `contract`/`fa_year` anyway,
Pocaro's sheet is intentionally capturing the extension, not the
soon-to-expire deal. A **negative** result means something doesn't reconcile
even on the sheet's own terms — that one needs a human check before applying,
not a guess (two such cases turned up in one 30-team sweep and both traced to
the sheet's own numbers being internally inconsistent, not to anything on the
CSV side).

For the deep technical detail on the resolver logic this rebuild depends on —
the naive-sum detector, the extension-boundary re-anchoring, the new
`contract_year_position` field, and the schema changes involved — see
[references/roster-salary-resolution.md](references/roster-salary-resolution.md).

## The column-count trap: current.csv's header has columns no source ever fills

`current.csv`'s header is `player,team,salary_current,salary_y2,salary_y3,
salary_y4,salary_y5,salary_y6,contract_note` — **9 columns** (extended from 8
to 9 in the 2026-07-30 rebuild to match `nba_roster`'s 6-year window; the
older "8 columns" figure in this doc's history is stale — verify with the awk
command below rather than trusting a remembered count). Every real HoopsHype
pull (team-by-team or bulk) only ever emits **4** year-columns plus a note —
`salary_y5`/`salary_y6` are never populated by any pull. If you ever rebuild
or bulk-merge rows into `current.csv` from raw pulled text without inserting
explicit blank placeholders for those two unused columns, every row silently
shifts left: the contract note lands in `salary_y5` or `salary_y6` and the
real `contract_note` column is empty for every single row.

This is not cosmetic. `salary_ingest.ts` reads `contract_note` by column
name to derive `is_two_way`, `free_agent_status` (RFA/UFA), and the stored
note text — an empty `contract_note` column means **every one of those
fields is silently wrong** for every player with a note, and a real
`npm run nba:salary` write will push that straight into `nba_contracts`. This
exact bug shipped once: an entire rebuild of `current.csv` ran for real
before anyone noticed, because the dry-run's *match count* looked fine (the
bug doesn't affect name-matching, only the note-derived fields) — the tell
was `is_two_way=false` and `contract_note=""` on a player who was obviously
two-way. If you ever rebuild `current.csv` programmatically, verify column
alignment **before** running the real ingest:

```bash
awk -F',' '{print NF}' data/nba-salaries/current.csv | sort | uniq -c
```

Every data row should show exactly **9** fields, with the 9th (last) one
being the note text — not blank 7th/8th fields followed by the note earlier.
If you rebuilt from raw pulled rows (which only ever have `name, team,
sal1..sal4, note` — 7 fields), the fix is to reconstruct each row as `name,
team, sal1, sal2, sal3, sal4, "", "", note` explicitly (two blanks now, not
one), never a straight `cells.join(",")` of whatever the raw pull handed you.

**A second, sneakier version of this same trap: CSV quoting, not just column
count.** Both `data/nba-rosters/<season>.csv` and `current.csv` have real
rows with an embedded comma inside a quoted field — dual-nationality players
carry `nationality` as `"USA, BIH"` (Luka Garza), `"LTU, USA"` (Matas
Buzelis), etc. A naive `line.split(",")` in a hand-rolled script (rather than
a real CSV parser) treats that embedded comma as a field separator, silently
shifting every column after it by one for that row only — `prior_team` gets
overwritten with garbage, `contract` ends up holding what should be
`prior_team`'s value, and so on. This shipped once, mid-session, in a 29-team
automated sweep: the tell was a `contract` field containing an obvious team
name ("Boston Celtics") instead of a dollar figure. **Any script that reads
or writes either CSV must use a real CSV parser (`csv-parse/sync`, already a
project dependency — see the import in `roster_ingest.ts`) for reading, and
must quote any output field containing a comma when writing** — never a bare
`split(",")` / `.join(",")` pair. Verify after any programmatic rewrite:

```bash
# every row should report the same field count, matching the header
npx tsx -e "import {parse} from 'csv-parse/sync'; import fs from 'node:fs'; \
const rows = parse(fs.readFileSync('data/nba-rosters/2026-27.csv','utf8'), {columns:false, skip_empty_lines:true, relax_quotes:true}); \
console.log([...new Set(rows.map(r=>r.length))]);"
```

## The hard rule: no salary website is ever fetched programmatically

`salary_ingest.ts` and `roster_ingest.ts` both open with the same line, and it's
not decoration — it's the reason this whole pipeline is CSV-shaped instead of
a scraper:

> No salary website is ever fetched, scraped, or requested — not here, not
> anywhere. The only network these scripts touch is Supabase.

Salary sites don't want to be scraped, terms of service vary, and a scraper
that silently breaks is worse than no scraper — you'd ship wrong salaries with
full confidence. The workaround that's actually in use: a browser-console
JS snippet the owner runs **manually, in their own logged-in browser**, on
whatever salary table they're looking at. It dumps the visible table to CSV
on the clipboard; the owner pastes it into `current.csv` and eyeballs it
before committing. This is not "the pipeline scrapes a site via a script
someone runs by hand" — it's a human copying data out of their own browser,
same as if they'd typed it in. Never turn this into an automated fetch, a
cron job, a headless-browser script, or anything that runs unattended against
a salary site. See the reference file for the actual snippet.

This rule is about salary *websites* (HoopsHype, Spotrac) — it does not cover
Pocaro's sheet, which is a Google Sheets document the owner already shares
access to, not a scraped third-party site. See "Pulling Pocaro's sheet
directly" above for that source's own attended-session method.

## Player identity: one source of truth, two consumers

A player's **team, full name, position, and DOB** are allowed to live in
exactly one authoritative place for each domain — `nba_roster` (cap-sheet
bio/contract identity, feeding team-rosters) and `nba_players` (stats-pipeline
identity, feeding game logs) — even though **two independent surfaces** need
that information:

- **team-rosters** reads `nba_roster` directly. Always current by construction.
- **dynasty-rankings** (`src/lib/dynasty-rankings.json`) is a separately
  maintained, bundled-JSON file of 5-expert consensus rankings. It carries
  its own `team`/`position`/`dob` fields because it's edited independently
  (see [dynasty-rankings-refresh.md](../../../docs/dynasty-rankings-refresh.md)
  for that process) — but where the two disagree, **`nba_roster`/`nba_players`
  wins**, never the expert CSVs. Any code joining live DB rows against
  dynasty-rankings.json data must resolve conflicts in that direction.

**The join key is always `normalizePlayerName()`, never a stored ID or rank
number.** Rank numbers get reassigned every refresh (a rank 52 today might be
a different player after the next dynasty update); a numeric player_id from
one dataset doesn't exist in the other. Name normalization is the only stable
key across sources, which is exactly why it has to be byte-identical
everywhere it's implemented:
- `normalizePlayerName()` in `src/lib/dynasty-rankings.ts`
- `normalizeName()` in `scripts/nba-data/client.ts`

If you ever need to touch either function, change both together and re-check
the join still works — a silent drift here doesn't error, it just quietly
starts attaching one player's data to a different player who happens to share
a rank number or an adjacent alphabetical position.

**Team abbreviations are the other place identity silently breaks.** The
whole app is supposed to funnel every team code through
`normalizeTeamAbbr()` in `src/lib/nba-teams.ts` — the single source of truth
for the 30 canonical codes (`NOR`/`PHO`, not `NOP`/`PHX`). **This is not
fully true today**: `data/nba-rosters/<season>.csv` (and therefore
`nba_roster`) uses `PHX`, while `data/nba-salaries/current.csv` (and
`nba_contracts`) uses `PHO` — a real, currently-open inconsistency between
the two pipelines this skill documents. It doesn't corrupt anything today
because nothing joins the two tables' `team` columns directly, but don't
assume they match if you ever write code that does. When touching either
ingest script, prefer normalizing through `normalizeTeamAbbr()` over adding
another local alias — the codebase has been burned by parallel alias maps
before (see `nba-team-abbreviation-standardization` history).

**"FA" is the only free-agent placeholder — never write "UFA".**
`normalizeTeamAbbr()` folds "UFA" into "FA" on read, but don't rely on that;
write "FA" directly at the source whenever a player has no current team.

## Other manual inputs that keep a player's record complete

Salary and roster aren't the only hand-maintained inputs. For a full picture
of a player, these also need periodic human attention:

- **`src/lib/dynasty-rankings.json`** — the 5-expert consensus refresh. Full
  process in `docs/dynasty-rankings-refresh.md`. **After any edit to this
  file, run `npm run dynasty:sync`** (`seasonal:build` + `trends:build` in
  order) — skipping this is exactly what caused the real incident in
  CLAUDE.md's history where a stale `consensus_rank` join showed James Harden
  at age 19 after a rank refresh reused his old rank number for someone else.
- **Rookie board** (`/admin/rookie-board`, Supabase-backed via
  `src/lib/rookie-board-store.ts`) — the incoming draft class's ranks,
  school/prior-team, and detail copy. Edited through the admin UI, not by
  hand-editing JSON.
- **DOB corrections** — ESPN's DOB feed (what `nba_players`/`nba_roster`
  ultimately draw from) has real, documented errors (e.g. Zach Edey). Treat a
  DOB disagreement between sources as worth flagging, never as grounds to
  bulk-overwrite the roster CSV — ESPN is a good default, not an authority.

## When something looks wrong, check in this order

1. **Is it actually the data, or the 15-minute cache?** See the cache warning
   above before debugging anything else.
2. **If you just rebuilt `current.csv`, is it actually a column-alignment
   problem?** Run the `awk -F',' '{print NF}'` check above before trusting
   anything else about the file — this bug produces confusing symptoms
   (empty notes, wrong two-way/RFA flags) that look like a dozen unrelated
   small bugs if you don't check alignment first.
3. **Which of the two pipelines does this field come from?** Salary figures →
   trace through `roster_ingest.ts`'s resolution rules (reference file) before
   assuming current.csv is wrong. Team/name/position/DOB → `nba_roster`
   should win; if dynasty-rankings.json disagrees, that's dynasty-rankings.json
   being stale, not a bug.
4. **Did `--dry-run` catch it already?** Both ingest scripts print unmatched
   players, tag conflicts, and estimated years on every run — read that output
   before writing.
5. **Does an independent source disagree?** See
   [references/third-party-cross-check.md](references/third-party-cross-check.md)
   for how to tell "our data is stale" apart from "the other source has an
   error" apart from "this is a genuine bug in the underlying HoopsHype page
   itself" — these three look identical at first glance and need different
   fixes.
