# Validating a refresh against an independent source

After a salary/roster refresh, the owner will often cross-check the result
team-by-team against an independent public tracker (a third-party contract
spreadsheet, Spotrac, etc.). This is genuinely useful — it caught a real
HoopsHype bug and confirmed a real fa_year calculation bug in this pipeline's
history — but every disagreement needs to be triaged correctly, because the
three possible causes look identical at first glance and need completely
different fixes:

1. **Our data is stale** — the third party is right, we need to update.
2. **The third party has an error** — ours is right, don't touch anything.
3. **There's a genuine bug in the underlying source** (HoopsHype itself, or
   our own derivation logic) — both need fixing, and a third source is
   usually needed to confirm which side is actually wrong.

## The tiebreaker: current.csv is authoritative, until it isn't

Default assumption: when our roster/salary data disagrees with a third-party
tracker, **check `current.csv` first**. If it agrees with our number, treat
the third party as the error and move on — don't spend time speculating
about why they differ. This resolved the overwhelming majority of
disagreements found this way in practice (dozens of cases, one team at a
time), and in every single one of those cases `current.csv` backed up our
number.

This default flips only when there's independent corroboration that
`current.csv` itself is wrong — not just "the third party disagrees," but a
*second, different* source confirms the third party's number. See the
HoopsHype dead-money bug below for the one case this happened.

## A same-year-count, different-total mismatch is not "original vs.
remaining" — check it

The most common *false alarm* in this kind of cross-check is a contract
whose total dollar value and year count don't match between sources. Most of
these have an innocent explanation: the third-party tracker shows the
contract's original terms at signing, while `current.csv` (and therefore our
data) only shows years still remaining on the books — so a player who's one
year into a 4-year deal will show "4yr/$60M" on the tracker and "3yr/$45M"
in our data, and that's expected, not a bug.

**But when the *year count also matches* and only the dollar total differs,
that's not explained by "original vs. remaining" — it's a real error on one
side**, and in every confirmed case in this pipeline's history, it was the
third-party tracker that was wrong, not `current.csv`. This pattern showed up
dozens of times across a full 30-team review — e.g. both sources agreeing a
player was on a "4yr" deal while the totals differed by $5-40M. Always
verify these specifically against `current.csv`'s actual populated columns
before concluding either way.

## Known recurring error patterns in third-party trackers

Cross-checking against one particular tracker across all 30 teams surfaced
the same handful of error *types* repeating, which is useful to recognize
quickly rather than investigate from scratch each time:

- **Copy-paste duplication across adjacent rows**: two different players —
  sometimes on completely different teams — showing the exact same salary
  figure, where one of the two figures is simply wrong. Confirmed multiple
  times in one review pass (e.g. two players on the same team sharing an
  identical salary, one of them correct and one an evident copy error from
  the row above). If two players' numbers are suspiciously identical and
  one of them doesn't match `current.csv`, that's the tell.
- **A player's college pasted into the "prior team" column** instead of
  their actual previous NBA team — a spreadsheet copy-paste artifact, seen
  more than once, always affecting the "prior team" field specifically, never
  the current-team assignment.
- **A veteran mislabeled with a rookie's years-of-service** (e.g. shown as
  "R" / draft class current-year for someone who's played 5+ real seasons).
- **Single-digit/leading-digit typos** on a dollar figure, sometimes
  producing a value that's off by an order of magnitude while the trailing
  digits stay identical to the real number — a strong tell that it's a typo
  rather than a different accounting convention.
- **A stray leftover row** for a player who's since moved on, still showing
  under their old team with blank or malformed contract fields.

None of these are reasons to trust our own data blindly — they're reasons to
check `current.csv` specifically before assuming the third party is right,
since these are exactly the kind of errors that look plausible at a glance.

## When the third party is actually right: the HoopsHype dead-money-stacking bug

One confirmed real bug in HoopsHype's own page/scrape: for a player who was
**waived by one team (leaving a dead-money cap hit)** and then **signed a
new, real contract with a different team in the same offseason**, HoopsHype
sometimes displays the new team's salary figure as the *sum* of the real new
contract plus the leftover dead-money hit from the old team — inflating the
"current year salary" by exactly the dead-money amount. A concrete case: a
player's real deal was 1yr/$3,524,115 with his new team; `current.csv`
showed $11,524,115 for him — exactly $3,524,115 + $8,000,000 of dead money
still sitting on his previous team's books. A third-party tracker had the
real $3.5M figure right the whole time; the mistake here was assuming
`current.csv` must be correct by default without checking why the number
looked unusually large for the apparent deal.

The tell: a salary figure with no plausible contract structure behind it
(too large for a clear minimum/mid-level deal, no matching multi-year
pattern), especially for a player known to have been recently waived. Verify
by finding the player's specific contract page on a source that separates
"cap hit" from "dead money" explicitly (Spotrac's contract and dead-money
breakdown pages are reliable for this) — if the real new-team salary plus a
separate dead-money entry for the old team sums to `current.csv`'s figure,
that confirms the stacking bug rather than a legitimate large contract.
Fix both `current.csv` and the roster CSV, and re-run `npm run nba:salary`
for real to correct `nba_contracts` too — a bug like this, once found,
means the DB already has the wrong number in it from an earlier ingest run.

## Practical workflow for a full-league cross-check

1. Pull the roster/contract data for two teams at a time from whatever
   third-party source is being used.
2. For every player, compare team assignment, `salary_26_27`/salary_current,
   and (if shown) total contract value and FA year against our data.
3. For same-team-assignment matches: if only years-remaining/total-contract
   descriptors differ, check whether it's the expected original-vs-remaining
   gap (skip) or a same-year-count mismatch (investigate against
   `current.csv`).
4. For any team/salary/status disagreement, pull that player's exact row
   from `current.csv` directly before concluding anything.
5. Flag genuinely new information (a departed player who should be marked
   UFA, a real trade the pull missed, a player entirely absent from our data)
   for the owner's confirmation rather than acting unilaterally — see
   `hoopshype-refresh.md`'s dead-money and orphaned-row sections for how
   those specific cases get resolved.
6. Log confirmed error patterns as you find them (see the taxonomy above) so
   later re-checks can recognize them faster instead of re-investigating
   from scratch.
