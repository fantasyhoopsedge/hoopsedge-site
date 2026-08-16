# How roster_ingest.ts resolves a player's 6-year salary

`roster_ingest.ts` builds `nba_roster.salary_yr1..salary_yr6` (2026-27 through
2031-32 — extended from 4 to 6 years in the 2026-07-30 rebuild) for every
player from two sources that don't always agree: the owner's gated cap-sheet
CSV (`data/nba-rosters/<season>.csv`, which has its own `salary_26_27` column
plus a `contract` string like `"4 yr / $53.8M"`) and
`data/nba-salaries/current.csv` (the fresher, HoopsHype-refreshed source, read
via `loadRealSalaries()`, which itself carries `salary_y6` now too). This file
explains the resolution order and why it exists — read it before changing any
of this logic, since each rule here was added to fix a specific real bug, not
speculatively.

## 0. The column mapping is not a fixed offset — re-derive it every refresh

`current.csv`'s `salary_current` column represents whatever season was
selected on HoopsHype's own dropdown at the time of the pull — **not**
a permanently-fixed "one season behind" offset. `roster_ingest.ts` and
`prep_depth_chart.py` both assume `salary_current` matches the roster CSV's
own `season` value (i.e. current.csv was refreshed for the same season this
roster file is for): `salary_current` → `salary_yr1`, `salary_y2` →
`salary_yr2`, and so on, one-to-one.

This shipped backwards for a real stretch of time: both scripts hardcoded
`salary_current = 2025-26` (true of a stale prior refresh) and read
`salary_y2` as "this season" instead. Since the assumption was baked in as a
fixed offset rather than re-derived per refresh, it silently kept feeding
every player's *next* season's salary into the "current" slot across the
entire live team-rosters page and the depth-chart tool — for months,
unnoticed, because every number still *looked* like a plausible salary, just
the wrong year's. It was caught by a direct screenshot comparison (Donovan
Mitchell's live page showing $60.9M when HoopsHype's own page showed his
real current-season figure as $50.1M — the $60.9M was his real *next*
season's number, one column over).

**If you ever touch either script's salary-column mapping, first confirm
which season `current.csv` was actually pulled for** (check the HoopsHype
page's own season dropdown at refresh time, or ask whoever did the refresh)
and that it matches the roster CSV's `season` column — don't assume a fixed
offset holds just because it held during a past refresh cycle.

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

## 1a. Extension-not-started detection — when yr0 belongs to a DIFFERENT deal

Added in the 2026-07-30 rebuild after finding that `contract_raw` had been
silently *derived* by summing whatever 4 years happened to be populated in
`current.csv`, rather than transcribed from the real signed deal — invisible
for a normal player, but badly wrong for anyone whose current season is the
**last year of an already-expiring contract**, with a separately-signed
extension starting the following season (Wembanyama: 26-27 = last year of
rookie scale, 27-28 = year 1 of a real 5yr/$252M extension; Donovan Mitchell
and Shai Gilgeous-Alexander are the same pattern). Treating all 4-6 visible
years as one contract in that case doesn't just mislabel the total — it can
also make the resolver try to gap-fill years that belong to a contract that
hasn't even started yet.

`isLargeJump(a, b)` flags a jump between two consecutive *known* current.csv
years as "these two years are probably different contracts, not one deal":
either a **1.8x+ ratio** or a **flat $8M+ raise** trips it (calibrated against
the real distribution across the full league — normal supermax step-raises
for the highest earners cluster at 1.06-1.08x / $3.7-4.6M even in the best
case, so there's real separation at both thresholds, not an arbitrary line).
Two thresholds exist because one alone misses real cases: a young player
jumping off a cheap rookie-scale year clears the ratio threshold easily
(Wembanyama, 2.58x) but a veteran already making real money doesn't — Donovan
Mitchell's real boundary is only 1.22x by ratio, but a real $10.8M raise.

When the first such jump is found (`extensionBoundary`, the index *before*
the jump), the resolver **re-anchors** `contract.years`/`contract.total` to
start at the slot *after* the jump instead of slot 0, using the exact same
even-split/arithmetic-step math as the normal gap-fill below — just windowed
to `[start, end)` instead of `[0, N)`. This is the only path that ever writes
into `salary_yr5`/`salary_yr6`, since a boundary case is the only real reason
a deal would need to be tracked out that far. The window's own end boundary
uses the **standard** `fa_year + fa_option_years` formula unconditionally,
never the Rookie Scale variant (see the note under contract status below —
`deriveStatus()`'s heuristic can still fire on a boundary player, and using
its Rookie-Scale-specific boundary formula here would be wrong once the
contract is known to be a separate, already-signed extension).

**The monotonicity guard** (added after a real near-miss: Cade Cunningham and
Evan Mobley's real 5yr/$269M total, once anchored at the wrong slot, would
have even-split into a computed 5th year *24% below* their own known 4th
year — no real designated-rookie extension pays out that way): a filled year
in either the normal or the boundary-anchored gap-fill branch is only ever
committed if it's `>=` the real known year immediately preceding the gap.
If it isn't, that's a signal the contract total itself doesn't reconcile
with the known years — leave the gap `null` rather than fabricate a decline.

This detection is also surfaced separately as a **report-only signal**
(`jumpFlags`, printed by every `--dry-run`/real run) — a large jump doesn't
just drive resolution, it's also the fastest way to spot which players in a
brand-new team need the closest look when cross-referencing the next cap-sheet
screenshot. Two known limitations, found by testing this against the whole
league rather than assumed: (1) a first-round rookie's normal rookie-scale
guaranteed-years→team-option-years step *also* clears the ratio threshold —
not "often," but **almost exactly** (1.80-1.81x is the CBA formula's own step
ratio, confirmed against 15 real players 2026-08-16, distinct from real
extension boundaries in the same scan which land nowhere near it: Mitchell
1.22x, SGA 1.49x) — that's an expected false-positive for the *report*
specifically, still surfaced there on purpose since it's still useful context
for a human reviewing the row, and (2) the naive-sum bug this all exists to
catch has no internal signature at all when a contract total simply happens to
be *correct* for the visible window — it can only be caught by an external
source (the cap-sheet screenshot itself), never derived from `current.csv`
alone. See the SKILL.md rebuild section for that half of the fix.

**Fixed 2026-08-16: limitation (1) was worse than "report noise" — it was also
silently driving `extensionBoundary` itself**, re-anchoring resolution and
downgrading `contract_status` from `Rookie Scale` to `Standard` for any
first-rounder whose guaranteed→option-year transition happened to be visible
in `current.csv`'s populated years (Sergio de Larrea, Chris Cenac Jr., Joshua
Jefferson, Koa Peat, Alex Karaban, Tarris Reed Jr., and others — at least 15
found in one scan). **A player still on his original rookie-scale contract
cannot also have a separately-signed extension** — that requires years of NBA
service he doesn't have yet — so there was never anything real for the
detector to find here. Both the live resolver's `extensionBoundary` and the
standalone post-hoc consistency-check function (`consistencyIssues`, further
down `roster_ingest.ts`, which independently re-derives the same boundary on
the *final resolved* salary array for its own report) now skip boundary
detection when `contractStatusEarly`/`r.contract_status === "Rookie Scale"` —
computed *before* the jump-scan specifically so this guard is available.
`jumpFlags` itself is deliberately left unguarded (still reports the jump as
context, per the "expected false-positive for the report" framing above) —
only the two things that actually change written data or the "needs review"
verdict were gated.

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
year**, not the roster season — a 2024 draftee's year 1 is 2024-25, seasons
before current.csv's earliest column even exists (current.csv's own earliest
column represents whichever season it was most recently refreshed for — see
the note below on not hardcoding that assumption). When exactly one
contract year in the 4-year window is still missing after everything else,
it's solved algebraically: back-solve year 1 from the growth rate between
the two earliest *known* consecutive years, then solve the missing year as
`contract.total` minus every other (known or backsolved) year. This only
ever fires for `Rookie Scale` status, and only when there's a single
genuinely-missing year — with two or more gaps there isn't enough
information to solve uniquely, so nothing is filled (same conservative
default as everywhere else in this file). **Never runs when an
extension-boundary is detected (1a)** — draft-year-anchored backsolving
against a contract that's actually a separately-signed extension would
produce a meaningless slot.

**`deriveStatus()`'s Rookie Scale heuristic requires `contract.years <= 4`**
(added in the 2026-07-30 rebuild) — a real rookie-scale deal is *always*
exactly 4 years by CBA rule (2 guaranteed + 2 team options), never 5+. Without
this gate, a player who's already signed a 5th-year extension on top of their
rookie scale (Chet Holmgren: pick 2, yos 3 — still matches "1st-rounder,
≤3 yos" even after his real contract became `5yr/$239M`) would incorrectly
get the draft-year-anchored boundary/backsolve logic applied to what's
actually a separate, already-signed deal.

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

## 6. The cap sheet's own `fa_year` column — QO years shift it back one year

Section 3's FA-year boundary reads `fa_year` straight from the cap sheet's
own column — so when that column is hand-computed or hand-corrected (e.g.
reconciling `data/nba-rosters/<season>.csv` against a refreshed
`current.csv`), getting it wrong doesn't just mislabel a badge, it changes
where `roster_ingest.ts` is willing to invent an estimated year.

The naive formula — `fa_year = current season + count(populated current.csv
salary columns)` — is correct for a `Team Option` note on the last populated
year, but **wrong by one year too late** when that last year's note is a
`Qualifying Offer` instead. The reason: a QO year isn't one more locked
contract year followed by free agency the year after — the QO tender *is*
what makes the player a restricted free agent for that season (see section 5
above: it's a formulaic RFA cap hold, not a negotiated salary). Restricted
free agency begins the offseason *before* that tendered season starts, not
after it ends. So:

```
fa_year = current_season + populated_years        # Team Option (or no note)
fa_year = current_season + populated_years - 1     # Qualifying Offer on the last populated year
```

This was found and fixed across roughly 80 rookie-scale contracts in one
pass by checking `current.csv`'s `contract_note` for `Qualifying Offer` on
the final populated year specifically (not any QO mention anywhere in the
note — only when it's the *last* year), and was independently validated
against a third-party tracker afterward: every corrected `fa_year` matched
the tracker's figure, where the naive (uncorrected) formula had been one
year later in every case. If you're ever re-deriving `fa_year` by hand or in
a script, check the last populated year's note specifically before applying
the flat formula.

## 7. Contract status

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
changing. See the note under section 4 for the `contract.years <= 4` gate
that keeps this heuristic from misfiring on a signed extension. **On an
extension-boundary row (1a), `contract_status` is corrected from `Rookie
Scale` to `Standard` after the fact** if `deriveStatus()`'s heuristic still
matched — once the boundary is known, the contract is by definition an
already-signed extension, not the player's original in-progress rookie deal,
and labeling it otherwise is actively misleading on the frontend badge.

## 8. `contract_year_position` — which year of the deal `season` falls in

Added in the 2026-07-30 rebuild (`nba_roster.contract_year_position`,
migration `20260730010000_nba_roster_contract_year_position.sql`) — a text
field like `"2 of 5"`, computed as
`contract.years - (estimateBoundaryYear - seasonStart(season)) + 1` and
reusing `estimateBoundaryYear` (section 3) rather than re-deriving the FA
boundary a second time, so it's automatically correct for both Standard and
Rookie Scale deals without new logic. **Always `null` on an
extension-boundary row** — `season` predates that contract entirely (it
belongs to the expiring prior deal instead), so "year N of the new deal" has
no true answer for the current season and shouldn't pretend to. Surfaced in
the team-rosters "Salary & contract" card as "Year N of M" under the contract
terms line — see `contractFor()` in `roster-helpers.ts` (returns
`yearPosition`) and `roster-app.tsx` for the render.

## 9. Marking OUR OWN derived estimates so a future refresh doesn't trust them

When an extension-boundary gap-fill (1a) computes a missing year, that
number is a derived estimate, not a HoopsHype-sourced fact — but if it gets
written into `current.csv` (to keep the two files in sync, since `current.csv`
now has `salary_y5`/`salary_y6` columns matching `nba_roster`'s), it becomes
**indistinguishable from real sourced data** the next time someone reads that
file, including to `roster_ingest.ts` itself: `salary_estimated`/
`salary_estimated_years` would stop flagging that year, and the frontend's
"EST" badge would silently disappear even though nothing about the number's
provenance changed.

The fix: any estimate written back to `current.csv` gets tagged in that row's
`contract_note`, e.g. `"Estimated years: 2030-31"` (semicolon-separate
multiple: `"Estimated years: 2030-31; 2031-32"` — never a bare comma, see
SKILL.md's "column-count trap" section; a literal comma inside an unquoted
field silently shifts every column after it). `roster_ingest.ts` parses this back out
(`noteEstimatedByNorm`) and re-attaches the estimate flag for exactly those
seasons even though the raw number now lives in `current.csv` as a normal
column — so the round-trip through `current.csv` never loses the "this is a
guess" signal. If you ever write a derived figure into `current.csv` by hand
for a different reason, tag it the same way or a later refresh (or ingest
run) will treat it as ground truth.

## Where this surfaces in the frontend

`src/app/team-rosters/_components/roster-live-data.ts` maps
`nba_roster.contract_status` / `salary_estimated_years` / `salary_qo_years` /
`contract_year_position` onto the `Player` type (`roster-data.ts`);
`contractFor()` in `roster-helpers.ts` turns those into per-row
`estimated`/`qo` flags plus `yearPosition`; the "Salary & contract" card in
`roster-app.tsx` renders the status badge, the est/QO superscripts, and the
"Year N of M" line. If a new resolution rule needs a frontend badge, that's
the chain to follow — a DB column alone won't show up anywhere until it's
threaded through all four of those files.
