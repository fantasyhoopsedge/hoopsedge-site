# NBA data pipeline

A free, automated NBA reference layer in Supabase: rosters, per-game box
scores, season averages (current + prior 3 seasons), contracts/salary, and
derived free-agent / trade-candidate views. The Next.js app reads it with the
anon key; the ingest scripts write with the service role.

Two data paths, deliberately separate:

| Domain | Source | Script |
| --- | --- | --- |
| Stats (players, game logs, season averages) | sportsdataverse **hoopR** player-box **parquet** on GitHub | `stats_backfill.ts`, `stats_refresh.ts` |
| Salary / contracts | a **human-committed CSV** (`data/nba-salaries/current.csv`) | `salary_ingest.ts` |

> **Hard rule:** the pipeline NEVER fetches, scrapes, or requests HoopsHype,
> Spotrac, Basketball-Reference, or any salary website — at runtime, build
> time, or in any workflow. Salary data enters the system **only** as the
> committed CSV. The only network the pipeline touches is sportsdataverse's
> GitHub release files, Supabase, and SendGrid.

## Environment

Local runs read `.env.local` (auto-loaded by `client.ts`). CI reads repo
secrets. Variables:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | all | service role (bypasses RLS) — **never** expose to the browser |
| `SENDGRID_API_KEY` | staleness | send the stale-data email |
| `SENDGRID_FROM_EMAIL` | staleness | a SendGrid-verified sender address |
| `STALENESS_ALERT_TO` | staleness | who gets the reminder |

If the three SendGrid vars are absent, the staleness check just no-ops — it
never breaks the stats job.

Add the same names as **GitHub → Settings → Secrets and variables → Actions**
for the workflows.

## Database

Schema lives in `supabase/migrations/`:

- `20260618000000_nba_pipeline.sql` — tables, the `nba_season_averages`
  materialized view, the `nba_free_agents` / `nba_trade_candidates` views, and
  RLS (public read, service-role write).
- `20260618010000_nba_refresh_fn.sql` — `refresh_nba_season_averages()` rpc
  (PostgREST can't issue `REFRESH MATERIALIZED VIEW`).

Apply both in the Supabase SQL editor (or `supabase db push`) before running
any ingest.

## One-time backfill

Seeds the current season + prior 3 (immutable past seasons are never re-pulled):

```bash
npm run nba:backfill            # writes
npm run nba:backfill -- --dry-run   # parse + report only, no writes
```

## Daily stats refresh (automated)

`.github/workflows/nba-stats-daily.yml` runs at **11:00 UTC** (after west-coast
games settle) and on manual dispatch:

1. `npm run nba:refresh` — current-season parquet → upsert players + game logs
   → refresh the season-averages matview. Idempotent upserts on
   `(game_id, player_id)`; retries with backoff on transient download failures.
2. `npm run nba:staleness` — emails a reminder if `nba_contracts` hasn't been
   updated in > 10 days (runs even if the refresh failed).

Run locally with `npm run nba:refresh` (add `-- --dry-run` to skip writes).

## Salary ingest (automated on push)

`.github/workflows/nba-salary-ingest.yml` runs whenever
`data/nba-salaries/current.csv` is pushed to `main` (and on manual dispatch).
It runs `npm run nba:salary`, which parses the CSV, derives the FA fields,
joins to players by normalized name, upserts `nba_contracts`, and uploads the
unmatched-rows report as a build artifact.

### CSV header contract

`data/nba-salaries/current.csv`:

```
player,team,salary_current,salary_y2,salary_y3,salary_y4,salary_y5,contract_note
```

Season mapping (authoritative — see `supabase/migrations/20260630000000_nba_roster.sql`,
do not relabel): `salary_current` = 2025-26, `salary_y2` = 2026-27 (current /
upcoming season), `salary_y3` = 2027-28, `salary_y4` = 2028-29, `salary_y5` =
2029-30.

- `salary_*` — dollars; `$` and commas are stripped; blank → null.
- `contract_note` — free text (e.g. `Player Option`, `Team Option`,
  `Qualifying Offer`, `Two-Way`).

Column mapping is **detected**, not positional, so a rougher paste (extra
columns, a ranking column, year-labelled salary headers) is tolerated. If the
player/salary columns can't be found, the script stops and prints the first 5
parsed rows so you can fix the file.

Derived fields (clearly heuristic, from the committed data only):

- `free_agent_year` = current season + (number of non-null future-year
  salaries) + 1.
- `free_agent_status` = `RFA` if the note matches `qualifying|QO`; else `UFA`
  if the contract expires within one season; else null.
- `is_two_way` = note matches `two-way|TW`.

## Human runbook — refreshing current.csv

1. Open the salary table you maintain in your browser.
2. **Optional convenience** — paste this into the browser DevTools console
   **on the page you already have open** to dump the visible table as CSV.
   This runs manually in *your* browser; it is **not** part of the pipeline and
   the pipeline never fetches any salary site. Adjust the column indices to the
   table you're looking at:

   ```js
   // Generic "visible HTML table -> CSV" helper. Edit COLS to map the table's
   // columns to: player, team, salary_current, salary_y2, salary_y3, salary_y4, contract_note
   const COLS = { player: 0, team: 1, salary_current: 2, salary_y2: 3, salary_y3: 4, salary_y4: 5, contract_note: 6 };
   const rows = [...document.querySelectorAll("table tr")].map((tr) =>
     [...tr.querySelectorAll("td,th")].map((c) => c.innerText.trim())
   ).filter((r) => r.length);
   const pick = (r) => Object.values(COLS).map((i) => `"${(r[i] ?? "").replace(/"/g, '""')}"`).join(",");
   const csv = ["player,team,salary_current,salary_y2,salary_y3,salary_y4,contract_note",
     ...rows.slice(1).map(pick)].join("\n");
   copy(csv); // now on your clipboard
   ```

3. Paste into `data/nba-salaries/current.csv` and **eyeball it** — confirm
   names, teams, and dollar amounts look right.
4. Commit and push to `main`. The salary-ingest workflow runs automatically.
5. Review unmatched rows: open the workflow run → download the
   `nba-salary-unmatched` artifact (or read `data/nba-salaries/_unmatched.json`
   after a local `npm run nba:salary`). Each entry is a salary row that didn't
   match a player by normalized name — usually a name spelling/abbreviation to
   fix in the CSV, or a player with no NBA game logs yet (rookie/two-way).

`_unmatched.json` and `current_raw.csv` are gitignored (regenerated / raw
staging).

## App read layer

Anon-key, read-only Route Handlers under `src/app/api/nba/`:

- `GET /api/nba/rosters` (optional `?team=ABV`) — active players + contract
- `GET /api/nba/free-agents`
- `GET /api/nba/trade-candidates` (surfaces the FHE disclaimer)
- `GET /api/nba/season-averages?player_id=<espn_athlete_id>`
