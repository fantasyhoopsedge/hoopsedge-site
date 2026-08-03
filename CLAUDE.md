# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ **Next.js 16.** APIs and file conventions differ from older Next.js (see AGENTS.md).
> The middleware file is `src/proxy.ts` (renamed from `middleware.ts`). Read
> `node_modules/next/dist/docs/` before writing framework code.

## Commands

```bash
npm run dev          # Next dev server (localhost:3000)
npm run build        # production build
npm run lint         # eslint (flat config, eslint.config.mjs)
```

There is no unit-test runner. The one test-like command is a self-contained grader dry-run:

```bash
npm run test:grader   # compiles + runs the Draft Night grader against fixtures
```

Data-pipeline / build scripts (all run under `tsx`, **outside** Next — they load
`.env.local` themselves via `scripts/nba-data/client.ts:loadEnv`):

```bash
npm run nba:backfill    # one-time full season game-log backfill from hoopR parquet
npm run nba:refresh      # incremental game-log + season-average refresh
npm run nba:salary       # ingest data/nba-salaries/current.csv into nba_contracts
npm run nba:roster       # ingest data/nba-rosters/<season>.csv into nba_roster
npm run nba:staleness    # freshness alarm (emails via SendGrid if data is stale)
npm run seasonal:build   # recompute season_player_values for all league sizes (validation-gated)
npm run projections:build # 2026-27 projection dataset from output/season-projections-2026-27.json
npm run trends:build     # per-player 2-week-block value trends → nba_player_trends (--dry-run / --file)
npm run dynasty:sync     # seasonal → projections → trends → realsalary, in order — run after ANY dynasty-rankings.json edit
npm run identity:build   # rebuild the canonical player registry (--dry-run to report only)
npm run espn:resolve     # propose ESPN athlete ids for name-only players → data/player-ids/espn-ids.csv
npm run espn:resolve -- --emit   # approved rows → espn-ids.json (consumed by summerleague:build)
npm run rb:seed          # seed the rookie board into Supabase
npm run launch:snapshot  # print the Draft Night signup/play funnel
```

## Environment

Scripts and server code need a `.env.local` at the repo root:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(service role bypasses RLS — server/CI only, never shipped to the browser).
Missing Supabase env is handled gracefully: the proxy and rookie board fall back
rather than crashing, so preview deploys without secrets still boot.

## Architecture

Next.js 16 App Router + React 19, TypeScript (strict), Tailwind v4, Supabase
(Postgres + Auth + Storage). Deployed on Vercel. Path alias `@/*` → `src/*`.

### Two data-provenance patterns — know which one applies

1. **Bundled JSON (build-time, no DB).** Editorial/ranking content ships as JSON
   imported directly into the bundle: `src/lib/dynasty-rankings.json`,
   `src/lib/nba-player-ids.json`, `src/data/rookie-board*.json`,
   `data/fhe_2026_prospects_master.csv`. These render without any Supabase call.
2. **Supabase tables (runtime).** User/dynamic data: auth profiles, Prediction
   Arena, Draft Night, and the NBA stats pipeline. Read via the clients below.

### Supabase clients — pick the right one

- `src/utils/supabase/server.ts` — cookie-bound client for Server Components /
  Route Handlers / Server Actions. **Always create fresh per request**, never at
  module scope.
- `src/utils/supabase/client.ts` — browser client (used by `AuthContext`).
- `src/utils/supabase/admin.ts` — service-role, RLS-bypassing, server-only.
- `src/proxy.ts` (middleware) — refreshes the auth JWT on **every** matched
  request and guards `PROTECTED_PREFIXES` (`/admin`). **Only ever call
  `getUser()` here, never `getSession()`** — `getUser()` validates the token
  server-side; `getSession()` trusts a spoofable cookie. Don't insert code
  between `createServerClient` and `getUser()`.
- Cookieless read client inside `unstable_cache` (see `seasonal-data.ts`):
  `unstable_cache` forbids `cookies()`/`headers()`, so world-readable data is
  read with a plain anon client and cached by tag.

`src/types/database.ts` is the **hand-authored** single source of truth for the
schema — every client is typed `SupabaseClient<Database>`. When a migration
changes the schema, update this file (regenerate command is in its header).
Migrations live in `supabase/migrations/` (timestamped SQL). The Prediction
Arena and Draft Night (`dn_*`) schemas are intentionally separate.

### The 9-category value engine (the core domain logic)

`src/lib/value/compute-values.ts` computes fantasy-basketball category values as
z-scores. The invariant, restated at the top of that file: values are
standardized against a **baseline pool = the top-N players by Value**, where N is
the league roster capacity. **Values are computed once per league size** — a
different size is a different baseline and therefore different (correct) values.
The pool is found by iterative convergence. σ is the **sample** std (ddof=1);
FG%/FT% league averages are **volume-weighted**. Per-game/totals display and
min-games filters live in the UI and never enter this math.

`npm run seasonal:build` precomputes these into `season_player_values` for every
size in `LEAGUE_SIZES`, gated by a validation check against a reference export —
don't change the conventions without re-validating. `/seasonal-rankings` reads
the precomputed values on demand per size (`src/lib/value/seasonal-data.ts`),
cached 15 min per `(season, type, size)` under tag `SEASONAL_TAG`.

`npm run trends:build` builds on top of that: per player, 12 two-week blocks of
9CatV/Minus1V/8CatV scored against the FROZEN 400-player pool via the unmodified
engine (rolling windows re-sum raw game totals — never average z-scores — so
`seasonAvg` at the final block reconciles exactly with `season_player_values`).
Upserted into `nba_player_trends` (one jsonb payload per player), read by
`/api/player-trends` and the `/team-rosters` tone/BUY-SELL-HOLD system. It reads
`season_player_values`, so build order is: refresh → seasonal → projections →
trends → realsalary (`npm run dynasty:sync` runs the last four together, see
below).

`npm run projections:build` sits between seasonal and trends. It does NOT
re-run the 6-stage projection model — it loads the already-generated artifact
`output/season-projections-2026-27.json` and writes the 2027/`projection`
dataset (`season_player_stats` + `season_player_values`), so it's deterministic
and safe to rerun. It must come AFTER `seasonal:build` (it resolves this draft
class's ids against the Summer League 2026 rows that build writes) and BEFORE
`realsalary:build` (which reads 2027/`projection`/450 for its Minus1V input).

`npm run realsalary:build` (`scripts/build-real-salary-values.ts`) computes
`/real-salary-rankings`' cap-aware values (`src/lib/value/real-salary-model.ts`)
into `real_salary_values`. It reads `dynasty-rankings.json` via `loadConsensus()`
(`scripts/build-seasonal-values.ts`), keyed by normalized name — safe from the
rank-reuse corruption below — but `consensus_z`/rank/surplus are still a
**build-time snapshot**: `/real-salary-rankings`' own consensus-rank display
(`page.tsx`'s `CONSENSUS_RANK_BY_NAME`) reads the bundled JSON fresh on every
render, so a stale `real_salary_values` table will show a mismatched Consensus
column/Δ against a freshly-published dynasty-rankings.json until rebuilt.

**Rerun `dynasty:sync` after every `dynasty-rankings.json` edit — not optional.**
`season_player_stats.consensus_rank` is a snapshot written once, at build time,
by joining `dynasty-rankings.json` on normalized name. Every dataset carries its
own snapshot and only its OWN build script refreshes it — `projections:build`
joined the chain on 2026-08-02 for exactly this reason: `seasonal:build` skips
the 2027 projection dataset (no game logs to aggregate), so the chain silently
left `/seasonal-rankings`' projections view on a stale board — measured that day
at 384 of 438 ranks disagreeing with the published JSON. A rank refresh reassigns
rank numbers to different players; any code that re-joins consensus data by
*rank number* instead of *name* will silently attach a stale row's new owner's
data to the old player once the JSON changes and the DB hasn't caught up yet
(this shipped once: `/seasonal-rankings`'s age column showed James Harden as
19 because his rank moved 52→62 in the July 2026 refresh, rank 52 was reused,
and `season_player_stats` hadn't been rebuilt — fixed by keying the age join on
normalized name instead, page.tsx + seasonal-rankings-table.tsx). Any new
feature joining live DB rows against `dynasty-rankings.json` must key on
`normalizePlayerName()`, never on a persisted rank number.

### NBA team abbreviations — one standard, one module

`src/lib/nba-teams.ts` (`NBA_TEAM_ABBRS`, `normalizeTeamAbbr()`, `isNbaTeam()`)
is the single source of truth for the 30 canonical codes
(`docs/FHE_NBA_team_standard_abr.txt`; e.g. `NOR`/`PHO`, not `NOP`/`PHX`/`NO`/`PHX`).
Before this file existed, six different places each hand-rolled their own
alias map because three incompatible dialects had leaked into the ecosystem:
dynasty-consensus data (`PHO`/`NOR`), stats.nba.com/HoopsHype/older CSV exports
(`PHX`/`NOP`), and hoopR's raw parquet feed piped straight into Supabase
(`GS`/`NO`/`NY`/`SA`/`UTAH`/`WSH`, plus `PHX` again for Phoenix). **Any code that
reads or writes a team abbreviation must call `normalizeTeamAbbr()` — never
add another local alias map.** Every ingestion script (`scripts/nba-data/*`,
`scripts/build-seasonal-values.ts`, `scripts/sync-nba-players.js`) normalizes
at the point raw data enters the pipeline, so a fresh backfill/refresh never
reintroduces a non-canonical code; `scripts/backfill-team-codes.ts` is the
one-time script that already fixed the legacy rows in `nba_players` /
`nba_player_game_logs` (`nba_roster`/`nba_contracts` self-heal on their next
normal CSV ingest instead, since those upsert on a stable natural key).

**"FA" is the only non-team placeholder — never reintroduce "UFA" as a second
one.** Both used to coexist (`dynasty-rankings.json` had 17 "FA" rows and 15
"UFA" rows with no real distinction) and just fragmented one real-world status
— no current NBA roster spot — into two separate team-filter buckets across
the UI. `normalizeTeamAbbr()` folds `"UFA"` into `"FA"`; any new ingestion or
manual edit that sets a player's team/roster status to "no team" must write
`"FA"`, never `"UFA"`.

### Player identity registry (`npm run identity:build`)

FHE joins ~12 sources on normalized name, across **four disjoint id spaces**.
Know which one you're holding:

| Space | Lives in | Example |
|---|---|---|
| **ESPN athlete id** | `nba_players.id`, `season_player_stats.player_id`, trends, real-salary | `3112335` = Jokić |
| **NBA Stats id** | `src/lib/nba-player-ids.json`, BBM's "NBA ID", the digits in `sl-<nbaComId>` | `203999` = Jokić |
| **Basketball Monster id** | `data/player-ids/bbm-players.csv` | `3930` = Jokić |
| **Fantrax id** (+ Rotowire/SportRadar/StatsInc) | Fantrax `getPlayerIds` | — |

The first two had **zero overlap** (882 vs 587 rows) and were bridged only by
name. `scripts/build-player-identity.ts` merges all of them into
`player_identity` — one row per human, keyed by an opaque surrogate `fhe_id`.
Surrogate rather than a vendor id because no vendor covers everyone (ESPN misses
~4% of prospects, near-all international; BBM has no id for 332 of its own 1,005
players until they have NBA service) and vendors carry duplicate records for one
human (ESPN indexes two Cameron Boozers).

**`data/player-ids/player-identity.json` must stay committed — it is the id
ledger, not a cache.** The build re-adopts it to keep `fhe_id`s stable; delete it
and every player renumbers. Verified idempotent: consecutive runs are
byte-identical with zero id churn.

Merge order is strongest-evidence-first and **reordering it silently downgrades
exact joins to name joins**: the NBA Stats ids land before BBM specifically so
that BBM's 673 id-carrying players merge by id rather than by name.

Nothing guesses. A name matching two identities, a provider id that would move
between humans, or a DOB disagreement all go to `player_identity_unresolved` for
a person to settle — a confidently wrong id attaches a real stat line to the
wrong player, which is strictly worse than a missing one.

Phase 1 is additive: no existing table changed, nothing reads it yet. Migration
`20260803020000_player_identity.sql` is **not yet applied**, so the build writes
the JSON artifact and skips Supabase with a warning until it is. Full plan and
remaining phases: `docs/player-identity-layer.md`.
### Fantrax league connector (`src/lib/fantrax/`, `/admin/fantrax`)

Links a user's real Fantrax league and re-scores FHE's category values against
that league's actual rules. Admin-gated for now (`src/lib/fantrax/guard.ts`
documents how to graduate it); the migration is
`20260803010000_fantrax_leagues.sql`.

**The Secret ID must never touch a FantasyHoopsEdge server.** `/privacy` §4
publishes this as a commitment ("never transmitted to, stored on, or logged by
any FantasyHoopsEdge server at any point"), and the architecture is built to
honour it, not to approximate it. It works because Fantrax's external API
(`fantrax.com/fxea/general/*`) serves `access-control-allow-origin: *`, so the
BROWSER calls `getLeagues?userSecretId=…` itself and keeps the secret in
`sessionStorage`. Every other endpoint (`getLeagueInfo`, `getTeamRosters`,
`getStandings`, `getDraftResults`, `getPlayerIds`) is **key-less** — a league id
alone is sufficient, which is why "paste a league code" works with no account
link at all. So the server is only ever told a league id. Never add a
Secret-ID column to `fx_leagues`, and never proxy `getLeagues`.

**LeagueV** is the point of the feature: 9CatV is just the mean of nine
per-category z-scores, so a league scoring a subset gets those same z-scores
averaged over its own subset. A 9-cat league gets 9CatV back exactly; an 8-cat
(punt-TO) league gets a genuinely re-ordered board (Jokić passes Wembanyama).
Unmapped Fantrax categories (DD, TD, MIN…) are reported as unmodelled rather
than silently dropped.

Two identity hazards, both real and both already bitten:
- **Duplicate names.** The test league carries two Jalen Johnsons and two Jaylin
  Williamses (one rostered, one teamless free agent). A pure name join gave the
  namesakes the stars' z-scores and floated a consensus-rank-10 player to the
  top of the waiver board. `blockedAmbiguousIds()` breaks ties on NBA team, and
  withholds data entirely when it can't tell. Team is deliberately NOT a general
  match requirement — FHE rows carry the team a player produced for, Fantrax the
  team he's on now.
- **Small samples.** Per-game z-scores ignore sample size, so 3-game call-ups
  outranked every genuine free agent. `MIN_SAMPLE_GAMES` filters the waiver
  board and flags roster rows; consistent with FHE convention, it never enters
  the value math.

Coverage on the 30-team test league (2026-08-03): 419/422 rostered players
joined, via projections → 2025-26 actuals, with the dynasty board supplying
consensus rank only (never values). Joins key on `normalizePlayerName()` plus
`player-name-aliases.ts`; Fantrax ships names "Last, First" and uses legal first
names, which is where `cameron thomas`/`nicolas claxton` came from.

### NBA data pipeline

`scripts/nba-data/` ingests hoopR/ESPN box-score parquet (sportsdataverse GitHub
releases) into `nba_players` / `nba_player_game_logs`, plus salary CSV into
`nba_contracts`. Season numbering is hoopR-style: **2026 = the 2025-26 season**
(`CURRENT_SEASON` in `client.ts`). All writes go through service-role scripts, so
the NBA tables are `Insert: never` / `Update: never` in the types — the app only
reads them (via views like `nba_season_averages`, `nba_free_agents`, exposed
through `src/app/api/nba/*` routes).

**Name normalization is a load-bearing join key.** `normalizeName()` in
`scripts/nba-data/client.ts` MUST stay byte-identical to `normalizePlayerName()`
in `src/lib/dynasty-rankings.ts` (lowercase → strip diacritics → strip `.,'’` →
strip jr/sr/ii/iii/iv → collapse whitespace). It joins salary ↔ stats ↔ rankings.
Salary CSV note: `current.csv`'s `salary_current` column represents whatever
season was selected on HoopsHype's own dropdown at the time of the last refresh
— it is **not** permanently one season behind. As of the most recent full
refresh, `salary_current` = 2026-27 (this roster season), `salary_y2` =
2027-28, and so on. A real bug shipped from hardcoding "`salary_current` is
always last season" into `roster_ingest.ts`/`prep_depth_chart.py` instead of
re-deriving it per refresh — for months it fed every player's *next* season's
salary into the "current" column across the live team-rosters page and the
depth-chart tool, until a screenshot mismatch caught it (Donovan Mitchell
showing $60.9M instead of his real $50.1M). Before trusting either script's
salary-column mapping, confirm which season `current.csv` was actually
refreshed for and that it matches what the code assumes.

### Rookie board — dual storage

`src/lib/rookie-board-store.ts` is Supabase-backed in production (`rb_docs`,
`rb_versions`, `rb_admins`) and falls back to local JSON files for offline dev.
Editing happens at `/admin/rookie-board` (dev-only tool: 404s in prod, and the
proxy lets it through without auth on localhost). Publishing distinguishes a
**re-rank** (bumps version) from **detail-only** edits (`publishDetails` throws
`OrderChangedError` if the ranked order actually changed). The public
`/draft-board` page is ISR-cached and busted on publish via `revalidateLiveBoard`.

### Auth & feature surfaces

`src/context/AuthContext.tsx` provides `useAuth()` (user + profile) app-wide.
Feature areas under `src/app/`: `prediction-arena` (renders its own signed-out
landing — deliberately not in `PROTECTED_PREFIXES`), `draft-night` (standalone
prediction game with OG-image cards and a grader in `src/lib/draftNight/`),
`dynasty-rankings`, `seasonal-rankings`, `draft-board`, `prospects/[slug]`,
`team-rosters/[team]` (per-team roster analysis joining `nba_roster` + stats +
values + trends; sidebar layout via `src/components/app-sidebar.tsx`), and
the `admin` review panels. SEO metadata, JSON-LD, sitemap, and robots are
first-class (`src/app/layout.tsx`, `sitemap.ts`, `robots.ts`); canonical URLs are
the `www` host.
