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
| **Roster** | `data/nba-rosters/<season>.csv` (owner's gated cap-sheet screenshot) | `nba_roster` | `npm run nba:roster` (`roster_ingest.ts`) | `/team-rosters` (the live app people actually use) |

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

## The column-count trap: current.csv's header has a column no source ever fills

`current.csv`'s header is `player,team,salary_current,salary_y2,salary_y3,
salary_y4,salary_y5,contract_note` — **8 columns** — but every real HoopsHype
pull (team-by-team or bulk) only ever emits **4** year-columns plus a note.
Nothing ever populates `salary_y5`. If you ever rebuild or bulk-merge rows
into `current.csv` from raw pulled text without inserting an explicit blank
placeholder for that unused 5th column, every row silently shifts one column
left: the contract note lands in `salary_y5` and the real `contract_note`
column is empty for every single row.

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

Every data row should show exactly 8 fields, with the 8th (last) one being
the note text — not a blank 7th field followed by the note in position 6 or
7. If you rebuilt from raw pulled rows (which only ever have `name, team,
sal1..sal4, note` — 7 fields), the fix is to reconstruct each row as `name,
team, sal1, sal2, sal3, sal4, "", note` explicitly, never a straight
`cells.join(",")` of whatever the raw pull handed you.

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
