# Weekly Roster/Depth-Chart/Projections Refresh

**The recurring loop that keeps rosters, depth charts, and 2026-27 projections current** — what runs automatically, where a human checkpoint is required, and how salary fits in on its own slower cadence.

- **Prepared:** 2026-09-04
- **Covers:** `scripts/nba-data/sync-pocaro-roster.ts`, `scripts/nba-data/sync-depth-chart-pipeline.ts`, `models/` (the 6-stage projection pipeline), `npm run projections:build`
- **Cadence:** roster → depth-chart → projections runs **weekly**; salary (`current.csv`) refreshes **every 2–3 weeks**, independently

## The weekly loop

```
1. npm run pocaro:sync              (Claude runs this)
2. npm run depth-chart:pipeline     (Claude runs this)
3. STOP — hand off to Ash           (human checkpoint, see below)
4. npm run depth-chart:pipeline     (Claude runs this again, AFTER Ash confirms)
5. Run the projection stages        (Claude runs this)
6. npm run projections:build        (Claude runs this)
```

### Step 1 — Roster refresh

`npm run pocaro:sync` pulls Pocaro's cap sheet (Google Drive API), resolves every row through the `player-identity` registry, diffs against live `nba_roster`/`nba_contracts` by `fhe_id`, and writes `data/nba-rosters/2026-27.csv`. Catches trades, signings, departures — independent of whether `current.csv` (salary) is fresh; roster membership and salary are separate concerns.

Review the diff (team changes, contract-consistency flags, double-absences) before moving on — same checks documented in `.claude/skills/salary-roster-pipeline`.

### Step 2 — Depth-chart/role-context reconciliation

`npm run depth-chart:pipeline` pulls published tags from Supabase, reconciles depth-chart/role-context against the fresh roster (re-key on trade, clear a now-portable-nowhere override, add new signees at a seeded tier, drop departures), pushes the corrected keys back, then runs the advisory usage-change flagger.

This is also the point where a **team-changed worklist** falls out for free — every re-keyed player in the reconciliation output is someone whose depth-chart/role-context entry just moved and may need a fresh look.

### Step 3 — Human checkpoint: prompt Ash to tinker

**Before running projections, stop and hand Ash a concrete worklist**, pulled from step 2's output (`output/depth-chart-pipeline-review.md`):

- **New signees, seeded tier, no override** — no real MPG/Games projection exists yet for these players until either Ash sets one or the model runs; flag them by name.
- **Team-changed / re-keyed players** — their old override was cleared (minutes are a claim on one team's total, never portable across a trade); they need a fresh tier/override on their new team.
- **Usage-role conflicts** (`⚠ N conflict` badge in `/admin/depth-chart`) — a previously-set role-context tag now disagrees with the fresh flagger's read.
- **Any contract-consistency or identity flags** carried over from step 1.

Ash tinkers in `/admin/depth-chart` and `/admin/role-context` (localhost, dev mode — writes straight to the local CSV, **not** Supabase — see the note below) and says when he's done.

**Do not skip this step or assume "no response yet" means "proceed."** The whole point of running projections is that they reflect real basketball judgment on top of the mechanical reconciliation — running Stage 1 before Ash has had a chance to set overrides for new signees just bakes in placeholder minutes.

### Step 4 — Re-run the pipeline to push local edits

**Run `npm run depth-chart:pipeline` again** after Ash confirms he's done tinkering. This is not optional and not redundant — it's the fix for the exact incident found 2026-09-04: a local dev-mode "Publish" click never reaches Supabase on its own. The pipeline's `--push` step is the only bridge between the local CSV and what the projection model (and production) actually read. Skipping this step is how a DeRozan-shaped bug happens again — see `sync-depth-chart-pipeline.ts`'s header comment for the full incident.

### Step 5 — Run the projection stages

Run in this order (confirmed live 2026-09-04):

```bash
python models/projections-adjuster/project.py       # Stage 1: minutes
python models/rate-model/project_roster.py           # Stage 2: per-36 rates
python models/aggregation/assemble.py                 # Stage 5: assemble + confidence tiers
python models/projections-adjuster/prep_depth_chart.py           # refresh the bundled depth-chart JSON
python models/usage-redistribution/flag_role_changes.py --emit-json   # refresh role-flags badges
```

**Stages deliberately skipped on a LOCAL routine run** — rerun only when their own trigger condition is true, not every week:

| Stage | Script | Rerun when |
|---|---|---|
| 0 — Data Foundation | `models/data-foundation/build_foundation.py` | A new NBA season's games have completed and need folding into history (not weekly — historical box scores don't change) |
| 3 — Usage Anchors | `models/usage-redistribution/project_anchors.py` | Same — team-total anchors are built from **completed** seasons (2024-2026 as of 2026-09), unaffected by this week's roster moves. Rerun once real 2026-27 games start accumulating, or on a model change. |
| 4 — Rookie Translation | `models/rookie-translation/predict.py` | The draft class or rookie-translation model itself changes (a bias-correction fix, a board update) — not a routine trigger. `project.py` (Stage 1) reads its existing output automatically. |

**This table only applies on a machine that already has last run's `output/` files on disk.** The whole `output/` tree is gitignored on purpose ("regenerate at will" — Stage 0's own docstring) — it's never committed, so it carries no state between runs by design. That's fine on a local machine where the files just sit there between sessions, but a **CI runner starts from a fresh checkout every time and has nothing to skip** — Stages 0, 3, and 4's outputs won't exist yet, and Stage 1 will fail immediately without them. `.github/workflows/phase-b-projections.yml` runs all three unconditionally for exactly this reason; don't "optimize" that workflow by removing them without adding a cache step that actually persists `output/` between runs (not attempted yet — the always-rebuild cost is a few extra minutes per week, judged not worth the cache-invalidation complexity for now).

Check the console output at every stage for `!!` warnings (e.g. a non-rookie with no 3-year history — usually a name-join miss; add the alias pair to `src/lib/player-name-aliases.ts` and rerun `identity:build`) before moving on.

### Step 6 — Load into Supabase

```bash
npm run projections:build
```

Loads `output/season-projections-2026-27.json` into `season_player_stats`/`season_player_values` under `season=2027, season_type=projection`. Spot-check the top-15-by-value printout for sanity (stars near the top, no obviously broken lines) before considering the week done.

## Salary — separate, slower cadence

`data/nba-salaries/current.csv` refreshes **every 2–3 weeks**, independently of the weekly loop above — explicitly accepted as stale in between (Ash's call, 2026-09-04), since HoopsHype pulls are fully manual (attended screenshots, checksummed against the page's own Total row, dead-money exclusions cross-checked against the roster CSV — see `.claude/skills/salary-roster-pipeline`).

When a salary refresh does happen, run it **before** that week's roster refresh if the two land in the same session — `current.csv` feeds `nba:roster`'s own `salary_26_27` column and the depth-chart tool's salary display, so a fresher salary pull is wasted if the roster refresh (and therefore that week's projections) already ran off the stale figures. If they don't land together, don't hold up the weekly loop waiting for salary — the loop is designed to tolerate a stale `current.csv`.

## Why this order, not some other order

- **Roster before depth-chart**: depth-chart/role-context reconciliation needs to know the current team assignments to re-key/drop/add correctly.
- **Depth-chart before the human checkpoint, human checkpoint before projections**: the projection model's minutes stage (Stage 1) reads `data/nba-rosters/depth-chart-2026-27.csv` and `role-context-2026-27.csv` directly — whatever's on disk when Stage 1 runs is what gets projected. Running it before Ash's pass just means projecting placeholder/seeded minutes for anyone new.
- **Re-run the pipeline (push) before projections, not just pull-reconcile once**: closes the local-CSV-vs-Supabase gap from the 2026-09-04 incident — Stage 1 also needs Supabase's published state to be current, not just the local file, since production and any other session read Supabase.
- **Salary decoupled from the weekly loop**: current.csv's staleness doesn't block roster/depth-chart/projections — team membership, contract length, and tier/role calls all come from Pocaro's sheet and the admin tools, not from HoopsHype. Salary only feeds the dollar figures shown alongside those calls.
