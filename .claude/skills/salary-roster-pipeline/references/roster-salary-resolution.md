# How roster_ingest.ts resolves a player's 4-year salary

`roster_ingest.ts` builds `nba_roster.salary_yr1..salary_yr4` (2026-27 through
2029-30) for every player from two sources that don't always agree: the
owner's gated cap-sheet CSV (`data/nba-rosters/<season>.csv`, which has its own
`salary_26_27` column plus a `contract` string like `"4 yr / $53.8M"`) and
`data/nba-salaries/current.csv` (the fresher, HoopsHype-refreshed source, read
via `loadRealSalaries()`). This file explains the resolution order and why it
exists — read it before changing any of this logic, since each rule here was
added to fix a specific real bug, not speculatively.

## 1. current.csv wins, year for year

If current.csv has a figure for a given season, that figure is used —
full stop, regardless of what the cap sheet's own columns say. A
disagreement between the two means the cap sheet is stale (it's a point-in-
time screenshot, refreshed less often than current.csv), not that
current.csv is wrong.

This used to be backwards: `yr1` preferred the cap sheet's own `salary_26_27`
column, and if it disagreed with current.csv, the code assumed "a new deal
must have happened" and *distrusted current.csv's out-years too*, falling
back to a cruder estimate instead of the real numbers it already had. That
made sense back when current.csv was the staler source; once current.csv
started getting refreshed from HoopsHype more often than the cap sheet, the
assumption inverted and the code needed to catch up. If you're ever tempted
to make the cap sheet's column win again, that assumption needs to be true
again first — check which source was refreshed more recently before
touching this.

The cap sheet's own `salary_26_27` is only used as a fallback for `yr1` when
current.csv has no row for the player at all.

## 2. Gaps get filled, never left as someone's guess dressed up as fact

Whatever current.csv doesn't cover gets filled from the cap sheet's
`contract` string (`"N yr / $X"` → `contract.years`, `contract.total`), by
one of two methods depending on how much is already known:

- **Some years known, some not** (current.csv covers part of the deal): the
  *remaining* contract total (total minus the known years) is split evenly
  across the unknown year(s).
- **Nothing known beyond `yr1`**: the whole deal is modeled as an arithmetic
  step from `yr1` across the contract length — a smooth rising/falling
  series that sums exactly to the total. This is the older, cruder method;
  it only runs when there's truly nothing else to anchor on.

Either way, **every filled year is flagged** — `salary_estimated_years`
(comma-separated season labels) and `salary_estimated` (boolean) — so the
frontend can badge it distinctly ("est" superscript) instead of presenting
it as a real cap figure.

**Negative/implausible-value guard:** the cap sheet's `contract_total` can
itself be stale — it can predate a raise current.csv already reflects. When
that happens, "remaining total minus known years" can come out zero,
negative, or below any real NBA salary (the two-way minimum, ~$678,882, is
the floor used). That's a signal the total isn't trustworthy for this
player, not a number to publish — the fix is to leave those year(s) `null`
(genuinely unresolved) rather than write a negative or near-zero salary.
This exact bug shipped once (Ryan Dunn's 2029-30 computed to **-$2,800,422**)
before the floor check was added — don't remove the guard without
understanding why Dunn was the reproduction case.

## 3. The FA-year boundary — don't estimate a year that isn't real

Even with the guard above, "gap-filling" can still model a season that never
belonged to the real contract at all — e.g. a 3-year deal already in its
final season getting 2 more phantom years invented because a naive algorithm
doesn't know the deal already ended. The fix: never fill a year at or past
the boundary where the contract's real money runs out.

- **Standard deals**: boundary = `fa_year + fa_option_years`. The sheet's own
  "+N" suffix on `fa_year` already accounts for any remaining option years.
- **Rookie Scale deals**: `fa_year` in the cap sheet marks the end of
  *guaranteed* money — the end of year 2 of the standard 4-year rookie-scale
  structure, with years 3-4 being team options. So the boundary is
  `fa_year + 2`, further capped at whichever is tighter between that and
  `draft_year + contract_years` (the deal's actual year-4 season) — this
  double bound means a rookie deal never gets estimated past its real 4th
  year, and the `+2` rule never overrides a case where the contract's true
  length says otherwise.

This boundary only ever *blocks* an estimate attempt — it never hides or
overrides a real current.csv figure, no matter what season that figure falls
in. If current.csv has a number for a year "past" the boundary, that number
is real and gets shown regardless (the boundary is about what to *invent*,
not what to *display*).

## 4. Rookie-scale contract-year backsolve

A rookie-scale deal's contract-year 1 is anchored to the player's **draft
year**, not the roster season — a 2024 draftee's year 1 is 2024-25, one
season before current.csv's earliest column even exists. When exactly one
contract year in the 4-year window is still missing after everything else,
it's solved algebraically: back-solve year 1 from the growth rate between
the two earliest *known* consecutive years, then solve the missing year as
`contract.total` minus every other (known or backsolved) year. This only
ever fires for `Rookie Scale` status, and only when there's a single
genuinely-missing year — with two or more gaps there isn't enough
information to solve uniquely, so nothing is filled (same conservative
default as everywhere else in this file).

## 5. Qualifying Offer (QO) tagging

A QO year has a *real* dollar figure in current.csv — it's just a formulaic
RFA cap hold (computed off a rookie-scale formula), not a negotiated salary,
and showing it as an ordinary confirmed number is misleading in a different
way than an estimate is. `roster_ingest.ts` parses current.csv's
`contract_note` text (e.g. `"Team Option 2027-28; Qualifying Offer 2028-29"`)
for `Qualifying Offer <season>` and records the matching season(s) in
`salary_qo_years` (same comma-separated format as `salary_estimated_years`).
The frontend renders it as its own superscript ("QO"), distinct from "est" —
it is real data, just a different *kind* of real.

## 6. Contract status

`deriveStatus()` classifies each player as `Standard | Rookie Scale |
Two-Way | Exhibit 10 | RFA | UFA | Draftee`, stored in `contract_status` and
surfaced on the frontend as a small badge. The `Rookie Scale` heuristic is
approximate — first-round pick, ≤3 years of service, ≥3-year deal — which
is usually right but can misfire on a bad `draft` field in the source CSV
(a known example: Collin Gillespie's cap-sheet row lists him as a 2025
first-rounder, which is wrong — he's an established veteran on a standard
deal — so he shows as `Rookie Scale` until that source row is corrected).
If you spot a status that looks wrong, check the player's `draft` field in
`data/nba-rosters/<season>.csv` before assuming the heuristic itself needs
changing.

## Where this surfaces in the frontend

`src/app/team-rosters/_components/roster-live-data.ts` maps
`nba_roster.contract_status` / `salary_estimated_years` / `salary_qo_years`
onto the `Player` type (`roster-data.ts`); `contractFor()` in
`roster-helpers.ts` turns those into per-row `estimated`/`qo` flags; the
"Salary & contract" card in `roster-app.tsx` renders the status badge and
the est/QO superscripts. If a new resolution rule needs a frontend badge,
that's the chain to follow — a DB column alone won't show up anywhere until
it's threaded through all four of those files.
