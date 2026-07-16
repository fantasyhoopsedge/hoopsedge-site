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
npm run trends:build     # per-player 2-week-block value trends → nba_player_trends (--dry-run / --file)
npm run dynasty:sync     # seasonal:build + trends:build in order — run after ANY dynasty-rankings.json edit
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
`season_player_values`, so build order is: refresh → seasonal → trends
(`npm run dynasty:sync` runs the last two together).

**Rerun `dynasty:sync` after every `dynasty-rankings.json` edit — not optional.**
`season_player_stats.consensus_rank` is a snapshot written once, at build time,
by joining `dynasty-rankings.json` on normalized name. A rank refresh reassigns
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
Salary CSV note: `current.csv` is one season stale — `salary_current` is 2025-26,
so read `salary_y2` for the upcoming season.

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
