# Real Salary Dynasty Rankings — Feature Brief

**A cap-aware companion to the dynasty consensus board** — how to rank/tier players
by projected production *relative to their real NBA salary*, for leagues that play
under a hard cap (tax line, $200,428,000).

- **Prepared:** 2026-07-29
- **Status:** design brief, no code yet — branch `real-salary-rankings` created empty
- **Author's framing (verbatim ask):** dynasty consensus ranks players regardless of
  salary; in real-salary hard-cap formats, a low-salary high-producer (Ajay Mitchell,
  vet-minimum LeBron) is worth *more* than the same production on a max deal, and a
  declining/injury-prone max player (Joel Embiid) is worth *less* than his consensus
  rank implies.

## Contents

1. [Overview](#1-overview)
2. [What's already in the FHE ecosystem](#2-whats-already-in-the-fhe-ecosystem)
3. [Recommended methodology](#3-recommended-methodology)
4. [Worked example (with real current data)](#4-worked-example-with-real-current-data)
5. [Data risks and gaps](#5-data-risks-and-gaps)
6. [Where it lives on the site](#6-where-it-lives-on-the-site)
7. [Phased build plan](#7-phased-build-plan)
8. [Open questions for Ash](#8-open-questions-for-ash)

## 1. Overview

Dynasty consensus (`/dynasty-rankings`) answers "who is the better long-term asset,
full stop." Real-salary hard-cap leagues ask a different question: "who returns the
most production *per dollar of my $200.428M budget*, this year and for however long
I control their contract." Those two answers diverge hardest at the extremes the
user named:

- **LeBron James** — elite per-minute production, min-salary-adjacent cap hit →
  huge surplus value in a cap format, even though dynasty consensus already
  discounts him hard for age/longevity.
- **Ajay Mitchell** — good-not-great dynasty rank, but a $2.85M rookie-scale deal →
  outsized surplus value that a name-brand consensus board doesn't surface.
- **Joel Embiid** — top-tier dynasty consensus rank, but a supermax cap hit
  ($57.7M this year) *and* a chronic-availability problem the durability signal
  should already be flagging (Stage 5's `confidenceTier`, see §2) → real-salary
  value should sit well below his consensus rank.

The right feature is **not a replacement for dynasty consensus** — it's a second,
orthogonal lens: "Surplus Value" = projected production expressed in cap dollars,
minus actual cap hit. Consensus rank tells you asset quality; Real Salary Rank
tells you asset *efficiency* under a budget constraint. A good UI shows both,
side by side, and lets the delta between them do the storytelling (exactly the
LeBron/Embiid framing above — "consensus #47, Real Salary #3" is the headline).

## 2. What's already in the FHE ecosystem

This feature is almost entirely a **join**, not a new data pipeline. Every input
already exists:

| Need | Source | Notes |
|---|---|---|
| Projected per-game production | `season_player_values` @ `season=2027, season_type='projection'` | The 6-stage projections model, already wired into the 9-cat V-score engine (`src/lib/value/compute-values.ts`). Gives `value` / `minus1v` / per-cat V-scores at any of the 10 `LEAGUE_SIZES`. This is the right "production" number — forward-looking, not last season's box score. |
| Durability / injury risk | `nba_player_trends.payload.confidenceTier` (Low/Medium/High) | Built in Stage 5 from **availability**, not a diagnosed-injury feed (deliberately — DNP-injury data misses IL stints and can't distinguish rest from injury). This is exactly the signal that should push Embiid-type players down: chronic availability → Low tier → discount. No new data source needed. |
| Current & multi-year salary | `nba_roster.salary_yr1..yr4` (preferred) or `nba_contracts.salary_current..y5` | `nba_roster` is the richer table — also carries `contract_years`, `contract_total`, `contract_status`, `fa_year`, `fa_option_years`, `is_two_way`. Use it as primary; `nba_contracts` as fallback for anyone missing from the roster CSV. |
| Contract security / years of team control | `nba_roster.contract_years`, `fa_year` | Needed for the dynasty dimension of this tool — a $12M player locked 4 more years is worth more than the same $12M expiring this June. |
| Age / long-term trajectory | `dynasty-rankings.json[].age`, or `nba_roster.dob`/`age_at_ingest` | Already used to shape the existing dynasty tiers; useful as a tiebreaker or a "long-term" toggle. |
| Consensus rank for comparison | `dynasty-rankings.json[].consensusRank` | Show alongside Real Salary Rank so the delta is visible. **Join by `normalizePlayerName()`, never by rank number** — this is a hard ecosystem rule (see `src/lib/dynasty-rankings-refresh-spec` and the July-2026 Harden rank-drift incident). |
| Cap constant | Currently `TAX_LINE = 200_400_000` in `src/app/team-rosters/_components/roster-app.tsx` (real-team payroll card) | The user's stated hard cap is **$200,428,000** — 28,000 off the existing constant. Worth reconciling into one shared source (see §5). |

There is **no existing salary-cap-optimizer or auction-value logic anywhere in the
repo** — `TAX_LINE` today only powers a display card showing an NBA team's real
payroll vs. the tax line on `/team-rosters/[team]`. Nothing computes value-per-dollar
today.

## 3. Recommended methodology

### 3.1 The core formula — auction-value-style surplus, not raw value/$

Naive "Value ÷ salary" over-rewards min-salary bench players with tiny-but-positive
projections (a 3rd-string center at $2M with a barely-positive Value looks like a
monster "per dollar" return). The standard fix — used by real auction-fantasy tools
and by real-NBA analytics translating wins into cap dollars — is to **convert
projected Value into an expected cap-dollar price first, using the league's own
budget as the calibration anchor**, then take the difference:

```
1. Pick a baseline pool exactly like the V-score engine already does:
   top-N players by projected Value, N = rostered spots across the league
   (this mirrors compute-values.ts's own baseline-pool convention — reuse it,
   don't invent a second one).

2. Total budget = teams × $200,428,000.
   Total pool Value = Σ (each pooled player's projected `value`, floored at 0
   or shifted so the replacement-level player prices near $0 — same idea as
   "value over replacement" in auction-value theory).

3. $-per-Value-point = Total budget ÷ Total pool Value.

4. ExpectedCapHit(player) = player's projected Value × $-per-Value-point.

5. SurplusValue(player) = ExpectedCapHit(player) − ActualCapHit(player).
```

This is exactly the LeBron/Ajay Mitchell story: both project as *expensive* by
their production (`ExpectedCapHit` is high because their Value is high) but
their *actual* cap hit is tiny, so `SurplusValue` is huge. Embiid's
`ExpectedCapHit` is also high, but his `ActualCapHit` nearly matches or exceeds
it — and the durability discount (3.2) pulls his projected Value down before
this step even runs, so his surplus shrinks or goes negative.

**Correction from Phase 1's actual build (2026-07-30): `SurplusValue` must NOT
be the page's headline "Rank."** First implementation sorted by it directly,
and Ash caught the failure mode immediately: Giannis, Curry, Tatum, and every
other real supermax star landed at the very bottom (443rd-450th of 450),
despite being 400-pool top-25 Minus1V producers — "they simply cannot be
ranked at the bottom... Curry still carries value if you can navigate and
build around him." The math wasn't wrong, but the framing was: a
properly-calibrated zero-sum auction (Total Budget == Total Priced Value by
construction) *always* puts roughly half the pool below $0 surplus, and real
NBA supermax contracts are frequently priced at/above pure objective
production (Bird rights/leverage/marketability — a real market effect, not a
model error), so elite fairly-priced stars cluster there predictably. Sorting
by that number alone reads as "avoid," which is wrong — it should read "not a
bargain, still elite." **Fix: two separate signals, not one.** A `ValueRank`
(pure discounted Minus1V production quality, independent of salary) is the
default sort/headline Rank; `SurplusValue`/`SurplusRank` stays a distinct,
still-sortable column for "is his price a bargain," never the thing that
buries a good player. Any future rebuild of this page must keep that
separation — it's not a v1 shortcut to clean up later, it's the correct shape
of the tool.

### 3.2 Durability discount (solves Embiid without new data)

Before step 4, multiply projected Value by a discount keyed to
`confidenceTier`:

- `High` → 1.0 (no discount — 3 consistent 30+GP seasons, stable role/team)
- `Medium` → ~0.9 (role change / limited track record)
- `Low` → ~0.75 (chronic/catastrophic durability history, or rookie/no-rate dart
  throw)

Exact multipliers are a tuning knob, not a fixed spec — pick them so a handful of
known cases (Embiid, a clean 82-game guy) land where intuition says they should,
then leave them alone. This reuses a field that already exists and was explicitly
designed for this kind of read (see `season-projections-model` memory, Stage 5).

### 3.3 Contract-security weighting (the dynasty dimension)

Single-year surplus answers "who's the best value *this season*" — a real-salary
**redraft** question. The user asked for **dynasty**, which means years of
below-market team control matter too. Recommended v2 addition once v1 ships:

```
DynastySurplusScore = Σ_{t=1..horizon} SurplusValue_t × discount^(t−1)
```

Where `SurplusValue_t` reuses the same formula per year, `discount` is a standard
time-decay (e.g. 0.9/yr — the same instinct dynasty rankings already apply via
tiers), and `horizon` is a fixed multi-year window (e.g. 3-4 years) rather than
simply `contract_years` — see 3.3.1, added 2026-07-29 after further discussion
with Ash: capping the sum at `contract_years` was too blunt, because it silently
either drops a player's post-contract seasons entirely or (worse) implicitly
values them at $0 salary. What actually needs to happen instead is: **use known
salary where the contract covers it, estimate salary where it doesn't**, and keep
summing across the full horizon either way.

#### 3.3.1 Salary certainty horizon (the harder half of Phase 2)

Ash's refinement (2026-07-29), with real examples pulled from the current CSVs:

> Phase 2 needs to weight against dynasty consensus rank/tier *and* trend (v1.0 vs
> v1.1), and account for known-vs-unknown salary in future years. Deni Avdija's
> value should be higher in 2026-27/2027-28 (cheap, expected-productive years) but
> we should expect his salary to jump significantly once he signs his next deal in
> 2028-29. Same shape for expiring rookie deals like Brandon Miller. Wembanyama,
> by contrast, should stay #1 in Real Salary Rank even once his 5yr/$252M rookie-max
> extension kicks in 2027-28, because his production still swamps even a max cap hit.

Each player has a **known-salary horizon** — the number of years `nba_roster`
actually has a contracted figure for (`contract_years`, and *not* flagged via
`salary_estimated_years`) — beyond which the real number is genuinely unknown
until he signs his next deal:

| Player | Known salary years | Known figures | What happens after |
|---|---|---|---|
| Deni Avdija | 2 (`contract_years=2`, `fa_year=2028`) | 2026-27 $13.125M, 2027-28 $11.875M | 2028-29 unknown — new deal expected, almost certainly a big raise off a $13M base (per Ash's framing) |
| Brandon Miller | 2 (`contract_years=2`, note "Qualifying Offer 2027-28") | 2026-27 $15.1M, 2027-28 $21.2M | 2028-29 unknown — restricted free agency, second-contract raise expected |
| Victor Wembanyama | His rookie-scale deal covers 2026-27 only ($16.868M); the real **5 yr / $252M extension runs 2027-28 → 2031-32**, per Ash (2026-07-30) and the roster snapshot's own "FA year 2031 +1" | HoopsHype's numeric grid captures 2027-28 $43.5M, 2028-29 $46.98M, 2029-30 $50.46M — **only 3 of the extension's 5 years** | 2030-31 and 2031-32 are missing entirely — not just from `current.csv`'s blank `salary_y5`, but from the repo's own `data/nba-rosters/2026-27.csv`, whose `contract` text field *itself* says "4 yr / $157.8M" and `fa_year` says "2030" (both wrong, both self-consistent with the truncated grid) |

**Corrected understanding (2026-07-30, per Ash):** this isn't a case where the
numeric grid is missing one year that the contract description otherwise gets
right — the source CSV's *own descriptive fields* (`contract_raw`, `fa_year`) are
also wrong, because `roster_ingest.ts` takes them verbatim from the roster CSV
(`r.contract`, `r.fa_year` — confirmed in code, not derived from the salary grid),
and **the roster CSV itself was hand/scrape-entered with the truncated numbers**.
That matters for how fixable this class of error is: it's not a pure pipeline bug
(§3.3.2 below has the "wouldn't a check have caught this" analysis) — the error
originated at the source-data-entry step, before any ingest logic ran.

Setting the missing-years issue aside, Wembanyama is still the intended **sanity
check**, not just an example: his 2027-28 cap hit alone is already a >2.5x jump to
a supermax-adjacent number, fully known today even with 2 extension years still
missing. If `DynastySurplusScore` doesn't keep him at or near #1 once 2027-28+ is
included, that's a signal the $-per-Value-point calibration (§3.1) or baseline
pool is miscalibrated — his case tests whether the model rewards genuine surplus
at *any* price point, not just cheapness. Avdija and Miller test the opposite
failure mode: if the model naively assumed their *current* cheap salary persists
forever, it would overrate them in the out-years exactly when a real-salary
manager should be bracing for a market-rate reset.

#### 3.3.2 Making truncated-contract detection reliable (Ash's question, 2026-07-30)

Ash's framing: *"having the AI interpret the years for the contract displayed" is
the actual challenge — Wemby's case is obvious because of the huge 2026-27→2027-28
jump, but that won't be true in every case. What makes this foolproof?*

Honest answer: **no purely internal consistency check would have caught this
specific case**, because the source CSV's declared year-count ("4 yr"), its
`fa_year` (2030), and its numeric salary grid all agree with each other — they're
just consistently wrong together, upstream of any ingest-time validation. A
reconciliation check that compares `contract_years` against "how many salary_yr
columns are populated" is still worth adding (§5 item 5) because it catches a
*different*, more common failure mode — the ingest script silently dropping a
populated year the source *does* have (confirmed separately in
`roster_ingest.ts`, which parses 5 years from `current.csv` but only writes 4 into
`nba_roster`) — but it's a floor, not a guarantee, against a wrong source entry.

What would actually reduce misses, roughly in order of effort:

1. **A cheap structural check, still worth building**: flag any row where the
   parsed year-count from `contract_raw` ("X yr") exceeds the count of non-null
   tracked `salary_yr*` values, or where `contract_total` doesn't reconcile
   (within a tolerance) with the sum of tracked years. Catches internal drift
   between the two fields — doesn't catch a source entry that's wrong in both
   places at once, but it's close to free and catches real cases.
2. **A targeted watchlist, not a full-roster brute force**: the failure mode that
   actually bit here — a max/near-max rookie-scale extension undercounted — only
   happens to a small, well-publicized set of players each year (rookie-scale
   extension-eligible players in their 4th season, roughly a few dozen
   league-wide, and only the ones who actually sign are relevant). Cross-check
   *that specific list* by hand against a second source (Spotrac/RealGM/ESPN)
   each offseason, rather than trying to algorithmically detect an error that, by
   construction, looks internally consistent. High value-per-effort because the
   list is short and the players on it are exactly the ones a real-salary/dynasty
   tool most needs to get right.
3. **A soft heuristic worth adding as a secondary flag, not a hard gate**: a
   player already near the top of dynasty consensus, entering his rookie-scale
   extension-eligible year, whose tracked contract comes out short/modest relative
   to what a max extension would look like — worth a "verify before trusting"
   flag. This reuses dynasty tier as a plausibility check on salary data, which is
   a different (and useful) role for that field than the estimator role it plays
   in §3.3.1.

None of this is a Phase 1 blocker — it's groundwork for Phase 2 trusting its
known-salary-horizon inputs, and probably belongs alongside whatever picks up the
background task for the 4-year schema cap (see §5 item 5), since both are about
the same underlying question: how much to trust the tracked salary years as
"known."

**For years inside the known horizon:** use the actual `salary_yr*` figure,
same as Phase 1.

**For years beyond it:** the salary itself must be *estimated*, and this is where
dynasty consensus and trend become real inputs (not just comparison columns):
a first-pass estimator, to refine once Phase 2 is actually being built rather than
locked here —

```
EstimatedNextDealSalary(player) ≈ f(dynasty consensus tier/rank, trendDelta direction, age)
```

e.g. a top-tier, rising-trend player nearing free agency should be assumed to
command a near-max next deal (Avdija's case skews this way if his trend keeps
climbing); a lower-tier or declining-trend player nearing free agency should be
assumed a modest "prove-it" deal instead. `trendDelta` (spots moved between the
v1.0 and v1.1 consensus refreshes) is a genuinely useful signal here specifically
*because* it's a rank-over-time series already computed and stored — no new data
needed, just a new use for an existing field.

This sub-problem (turning tier + trend + age into a believable dollar estimate)
is the part of Phase 2 that actually needs design work before building — the
known-salary-year math (3.3's formula) is straightforward once §8's team-control
question is answered, but the estimator is a small model of its own and deserves
a few worked cases (Ash spot-checking Avdija/Miller/a few more against intuition)
before it's trusted to drive rankings.

### 3.4 What NOT to do

- Don't build a from-scratch projection model for this — the 6-stage projections
  model already exists and is validated (`season-projections-2026-27` dataset).
  Reuse `season_player_values`, don't fork it.
- Don't invent a second injury/durability signal — `confidenceTier` already exists
  and was deliberately built as availability-based rather than diagnosis-based to
  avoid exactly the traps (DNP-injury misses IL stints) a naive injury scraper
  would hit.
- Don't join on anything but `normalizePlayerName()` across contracts/roster/
  rankings — this is a standing ecosystem rule with a real production incident
  behind it (rank-number join drift, see CLAUDE.md's James Harden example).

## 4. Worked example (with real current data)

Pulled directly from `data/nba-salaries/current.csv` / `data/nba-rosters/2026-27.csv`
to sanity-check the shape of the formula (not final numbers — projections need a
DB read this brief didn't do):

| Player | Cap hit (2026-27) | Contract length | Dynasty-consensus story |
|---|---|---|---|
| Ajay Mitchell | $2,850,000 | 2 yr / $5.7M, team option 2027-28 | Cheap, controlled — should score very high on Real Salary Rank even at a modest projected Value. |
| Joel Embiid | $57,736,350 | 3 yr / $187.1M through 2029 | Needs elite Value *and* a High confidence tier to avoid a negative surplus — durability history says otherwise. |
| LeBron James | $3,876,529 | 2 yr / $7.9M, player option 2027-28 | Near-minimum cap hit for (presumably still) well-above-replacement production → should be a Real Salary Rank outlier vs. his (age-discounted) consensus rank. |

(LeBron James's `team=PHI` in both CSVs initially looked like an ingestion
mismatch — confirmed with Ash it's a real trade, not a bug. Still worth noting as
a general risk for §5: **this feature makes salary-data quality bugs directly
user-visible in a new way** — a wrong team is a mild cosmetic issue on
`/team-rosters`, but a wrong *salary* would directly corrupt the marquee "surplus
value" number for a marquee player, so the usual verification discipline matters
more here than elsewhere.)

## 5. Data risks and gaps

1. **Salary-column mapping has broken in production before, silently.** The
   `salary_current` → year mapping in `current.csv` is not a fixed offset — it
   tracks whatever season HoopsHype's dropdown happened to be on at pull time.
   This exact class of bug shipped once (Donovan Mitchell showing his *2027-28*
   salary as his "current" figure across `/team-rosters` and `/admin/depth-chart`
   for months). A cap-dollar ranking tool is *more* sensitive to this than a
   display card — an off-by-one-year salary doesn't just look wrong, it silently
   reorders the whole ranking. **Before building, re-verify which season
   `current.csv`/`2026-27.csv` are currently aligned to** (per the
   `salary-roster-pipeline` skill), and prefer `nba_roster.salary_yr1` (already
   fixed to map correctly) over raw `current.csv` columns.
2. **Two cap-number sources** exist today: `TAX_LINE = 200_400_000` in
   `roster-app.tsx` vs. Ash's stated $200,428,000 — close enough that Ash is fine
   treating them as the same number (confirmed 2026-07-29), so this isn't a
   blocker. Still cleanest to source both from one shared constant (e.g.
   `src/lib/nba-cap.ts`) rather than two hardcoded literals, next time either is
   touched.
3. **Contract-length data has known estimation/QO gotchas.** `nba_roster` already
   tracks `salary_estimated`/`salary_estimated_years`/`salary_qo_years` for exactly
   this reason (some out-year salaries are even-split estimates, not confirmed
   figures). A surplus-value tool built on 3 years out should visibly flag
   estimated years rather than presenting them with the same confidence as year 1.
4. **Free-agency/team-control rules are league-format-specific and undefined
   here** — see §8. The single-year model (§3.1–3.2) is safe to ship without an
   answer; the multi-year dynasty model (§3.3) is not.
5. **Long extensions can be truncated at two independent layers** (§3.3.1/3.3.2)
   — confirmed on Victor Wembanyama's real 5yr/$252M rookie-max extension
   (2027-28 → 2031-32), which shows as "4 yrs · $157.8M" on `/team-rosters`.
   Two separate bugs, not one: (a) `nba_roster`'s schema caps at `salary_yr1..yr4`
   and `roster_ingest.ts` drops any 5th year `current.csv` provides — a fixable
   pipeline bug; (b) for this specific player, the *source* roster CSV's own
   `contract`/`fa_year` text fields are also wrong (self-consistent with the
   truncated grid, not derived from it) — a source-data-entry error no internal
   reconciliation check can catch. §3.3.2 has the fuller "how do we catch this
   systematically" analysis; short version: a cheap internal consistency check is
   worth adding but isn't sufficient, a small manually-verified watchlist of each
   year's rookie-scale-extension signings is the higher-value fix.
6. **`confidenceTier` coverage isn't universal** — ~185 players in the projection
   dataset fall back to league-median rates (rookies / no qualifying history), and
   69 players don't resolve into the projections dataset at all (no `athlete_id`
   match, mostly very recent draftees). Real Salary Rank needs an explicit
   "unranked / insufficient data" bucket rather than silently dropping these
   players or defaulting them to a misleading discount.

## 6. Where it lives on the site

Recommend a **new standalone page**, `/real-salary-rankings`, following the exact
pattern `/seasonal-rankings` already established (server-fetched precomputed table,
15-min cache, on-demand size/toggle switches) rather than bolting cap math onto
`/dynasty-rankings` or `/team-rosters`:

- It needs its own sortable table (Real Salary Rank, Surplus $, Consensus Rank,
  Δ vs. consensus, cap hit, contract years left, confidence tier) — visually
  distinct from both existing rank pages.
- The **Δ vs. consensus column is the headline feature** — sortable both
  directions surfaces "biggest real-salary risers" (Ajay Mitchell-types) and
  "biggest real-salary fallers" (Embiid-types) as its own view, which is likely
  the single most shareable/sticky part of this tool.
- A precomputed build step (`npm run realsalary:build`, mirroring
  `seasonal:build`/`trends:build`) fits the existing pattern better than computing
  surplus values live in the route handler — the projections + salary data don't
  change more than daily, and this reuses the same cache-tag/`unstable_cache`
  approach `seasonal-data.ts` already has.

## 7. Phased build plan

**Phase 1 — single-year Surplus Value (ships fastest, needs no new data):**
`season_player_values` (projection dataset) × `nba_roster` salary_yr1 ×
`confidenceTier` discount → Surplus $ → new page with Real Salary Rank vs.
Consensus Rank side by side. This alone directly answers the LeBron/Ajay
Mitchell/Embiid framing from the ask.

**Phase 2 — multi-year DynastySurplusScore:** needs more design than Phase 1
before it's buildable — two separate things have to be nailed down first:
(a) §8's free-agency/team-control question, and (b) the post-horizon salary
estimator (§3.3.1), which needs its own short design pass (a formula sketched
against tier + trend + age, then sanity-checked against real cases like Avdija,
Miller, and Wembanyama) rather than being derived mechanically like Phase 1 was.
Treat Phase 2 as its own planning session, not a direct follow-on build.

**Phase 3 — cap-budget tools:** given Phase 1/2 data, a "my roster" cap tracker
(sum a user's rostered players' cap hits against $200,428,000, flag cap space) and
a trade/draft "what's the best surplus play left in my budget" finder become
natural extensions — but these need user-roster state (auth + a new table) that
doesn't exist yet, so they're explicitly out of scope for a v1.

## 8. Open questions for Ash

These change the formula, not just the UI — worth deciding before Phase 2 (Phase 1
doesn't depend on them):

1. **Does a fantasy team retain any "rights" to a player once his real contract
   expires** (like real-NBA Bird rights), or does he become a fresh redraft/FA
   target for everyone once his tracked salary years run out? Determines whether
   `DynastySurplusScore` should decay to zero at `contract_years` or keep
   projecting past it at an assumed market rate.
2. **Is the $200,428,000 figure the tax line for one specific league, or the
   number to standardize on ecosystem-wide** (replacing/aligning with the existing
   `TAX_LINE` constant)? If multiple real-salary league formats exist with
   different caps, the tool may need a configurable budget rather than one
   hardcoded constant.
3. **Team roster size** (how many spots the $200.428M has to cover) — needed to
   calibrate the baseline pool size in §3.1 the same way `LEAGUE_SIZES` calibrates
   the existing V-score engine.
4. **Confidence-tier discount weights** (§3.2's 1.0/0.9/0.75) are a first guess —
   worth eyeballing against 4-5 known cases (Embiid, a clean iron-man, a rookie)
   before committing.
5. **Post-horizon salary estimator (§3.3.1)** — how aggressively should an
   approaching-free-agency player's next deal be estimated from dynasty
   tier/rank + trend direction + age? Worth spot-checking a strawman formula
   against Avdija, Miller, and a handful of other soon-to-be-FA players before
   it drives any ranking. This is the main open design work for Phase 2 —
   everything else in §3.3 is mechanical once §8.1 is answered.
