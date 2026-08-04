# Player Identity Layer

**Status:** **Phases 1–3 built, Phase 4 substantially built** (last updated
2026-08-04).
**Started:** 2026-08-03
**Prompted by:** the Fantrax connector build, which paid the identity tax for the
eighth time and made the pattern impossible to ignore.

> ### What now exists
>
> **Phase 1 — the registry** (2026-08-03)
> - `supabase/migrations/20260803020000_player_identity.sql` — `player_identity`,
>   `player_name_alias`, `player_identity_unresolved`. Applied.
> - `scripts/build-player-identity.ts` (`npm run identity:build`) — merges every
>   source into the registry and writes `data/player-ids/player-identity.json`.
> - `scripts/bbm/extract_bbm_ids.py` + `data/player-ids/bbm-players.csv` —
>   Basketball Monster ids, extracted from BBM's `.xls` exports.
> - `npm run identity:reconcile` — read-only validation gate.
>
> **Phase 2 — dual-key** (2026-08-03) — `fhe_id` on all five consumer tables via
> `20260803030000_player_identity_dual_key.sql` + `npm run identity:backfill`.
> Coverage as of 2026-08-04 is 100% on every dataset the app actually reads
> (2024/2025/2026 regular + postseason, 2027/projection, `nba_player_trends`,
> `nba_roster`); the only gaps are dead historical Summer-League rows and 11
> `cons-` placeholders in `real_salary_values`.
>
> **Phase 3 — consumer migration** — Fantrax connector (2026-08-03),
> real-salary (2026-08-04). Remaining: team-rosters → seasonal → dynasty →
> models.
>
> **Phase 4 — the shared layer** (2026-08-04) — see §3.3 below, now built:
> - `src/lib/player-identity/` — `normalize.ts` (THE normalizer), `registry.ts`
>   (THE resolver), `bundled.ts` (the snapshot), `registry.json` (generated).
> - `models/player_identity.py` — the Python side, reading the same snapshot.
> - `npm run identity:verify` — nine read-only checks, ~1s, no DB.
>
> **Registry: 1,206 identities.** 1,150 ESPN ids, 692 NBA Stats ids, 1,005 BBM
> ids, 972 Fantrax ids; **691 rows carry both an ESPN and an NBA Stats id** — two
> spaces that previously had zero overlap — and 959 carry both a BBM and an ESPN
> id. Idempotent: consecutive runs are byte-identical, zero id churn.
>
> Section 3 below is the design as proposed; it was implemented essentially as
> written, with `bbm_id` promoted to a first-class column (§2.2).

---

## 1. What's actually true today

Findings below are measured, not assumed.

### There are already two disjoint NBA id spaces

| Space | Where | Example |
|---|---|---|
| **ESPN / hoopR ids** | `nba_players.id`, `nba_player_game_logs`, `season_player_stats`, `season_player_values`, `nba_player_trends`, `real_salary_values` | `3934719` = OG Anunoby |
| **NBA Stats ids** | `src/lib/nba-player-ids.json` (headshots only) | `1630173` = Precious Achiuwa |

`SELECT` intersection of the two id sets: **0 of 882 vs 587**. They are bridged
*only* by normalized name. Every headshot on the site resolves through a name
lookup, not an id.

### Name is the universal join key, across ~12 sources

| Source | Native key | Joins by |
|---|---|---|
| hoopR/ESPN parquet | ESPN id | id |
| `nba_contracts` (HoopsHype CSV) | — | `norm_name` (86/696 rows have null `player_id`) |
| `nba_roster` (roster CSV) | — | `norm_name` (129/619 null `player_id`) |
| `nba-player-ids.json` | NBA Stats id | `norm_name` |
| `dynasty-rankings.json` | — | name |
| `rookie-board.json` | — | name |
| `fhe_2026_prospects_master.csv` | — | name |
| `depth-chart-*.json`, `role-context-*.json` | — | (team, name) |
| `draft_model_data.csv` (models/) | — | name |
| Fantrax FXEA | Fantrax id | name |
| Basketball Monster | — | name |

To be fair to the current design: **the roster join is not broken.** Of those
129 null `player_id` rows, 126 are incoming rookies who genuinely have no NBA
game log yet, and 3 are veterans absent from `nba_players` (Mario Hezonja, Didi
Louzada, Tamar Bates). The name join, where a name exists on both sides, works.

The problem isn't a broken join. It's four structural costs:

### Cost 1 — pre-NBA players carry a throwaway id ⚠️ *revised 2026-08-03, see §2.1*

126 of 619 roster rows and **50 of 493 dynasty-board players** are prospects.
They exist on the draft board, the prospects CSV, the dynasty board, the
projection dataset and the rookie board, and today they get a *synthetic*
`sl-<nbaComId>` id from `build-summer-league-values.ts`
(`espnId ?? \`sl-${r.playerId}\``) — a namespace nothing else in the ecosystem
uses. On the player's first NBA game he acquires a real ESPN id, and nothing
carries the before-identity to the after-identity except a string match.

**This cost is smaller than it first appeared** — ESPN issues ids to prospects
years before they play, and keeps them. See §2.1.

### Cost 2 — the normalizer is copy-pasted four times, in two languages

`normalizePlayerName()` (`src/lib/dynasty-rankings.ts`), `normalizeName()`
(`scripts/nba-data/client.ts`), `normalize_name()`
(`models/rookie-translation/common.py`), and `normalizeName()`
(`src/lib/rookie-board.ts` — which is *not* byte-identical: it uses
`\b(jr|sr|ii|iii|iv)\b` where the others use `\s+(...)\b`, and also strips `‘`).
CLAUDE.md enforces parity by written instruction. Nothing enforces it mechanically.

### Cost 3 — alias maps are duplicated across the TS/Python boundary

Three of them: `NICKNAME_TO_LEGAL_NAME` (TS, 10 entries), `DRAFT_NAME_TO_HOOPR`
and `ROSTER_NAME_TO_HOOPR` (Python). The Python file says so in its own comment:

> *"Same class of bug as src/lib/player-name-aliases.ts (which maps nickname ->
> legal and is TypeScript-side only, so it cannot be imported here)."*

An alias discovered on one side does not reach the other.

### Cost 4 — every new source re-derives the same work

The Fantrax build needed: a "Last, First" reorder, two new aliases (`cameron
thomas`, `nicolas claxton`), a duplicate-name blocker, and a small-sample filter.
None of it is reusable by the next source. This is the eighth time.

### The shipped-bug record

Identity has caused at least six production defects: James Harden showing age 19
(rank reuse); `consensus_rank` null for Cam Johnson / Herb Jones / Ron Holland;
four more found in the July Angle merge (Dereck Lively, Bub Carrington, Yang
Hansen, Pelle Larsson); role-context tiers mis-keyed when a player changed team
(`97cf869`); 384 of 438 projection ranks stale because the snapshot chain skipped
a dataset; and, this week, two Jalen Johnsons on the Fantrax waiver board.

---

## 2.1 ESPN ids are continuous from college to the NBA — verified

Tested 2026-08-03, and it changes the design:

- **Ajay Mitchell, ESPN id `4900671`** — an NBA player in `season_player_stats`
  — resolves on ESPN's **mens-college-basketball** athlete endpoint under that
  same id. ESPN operates one global athlete id across college and the NBA.
- **A prospect's ESPN id today is his NBA id later.** There is no re-key at
  debut, which was the premise of Cost 1.
- **Coverage is near-total: 49 of the 50 dynasty-board rookies (98%)** resolve
  to an ESPN athlete id by name search (only Christian Anderson Jr. missed).
- The endpoint also returns **date of birth** for free — the strongest
  disambiguator in §3.4, and independently useful given ESPN's known DOB errors
  are at least then *visible* rather than absent.

Consequence: the registry should treat **ESPN id as the primary resolution key**,
and minting a surrogate for a prospect becomes an exception path (a player with
no ESPN record at all), not the standard flow for every incoming rookie. The
`fhe_id` surrogate is still recommended — for vendor independence, for the
handful ESPN misses, and because ESPN itself carries duplicate records (a search
for Cameron Boozer returns *two* athletes: `5041935` and `4700867`) — but it is
now a thin wrapper over a mostly-solved problem rather than the load-bearing
idea.

**Caution learned the hard way:** of 13 hand-collected rookie ESPN ids reviewed
on 2026-08-03, **6 were wrong** — four pointed at entirely different athletes
(Jaxon Pollard, Joshua Ola-Joseph, Keeshawn Kellman) and two didn't resolve.
Hand-entered ids must be verified against the athlete endpoint before they are
written. Prefer scripted resolution with a human review gate.

## 2. The unlock nobody has cashed in

Fantrax's `getPlayerIds` hands us external ids **for free**, for 1,816 players:

| Field | Coverage |
|---|---|
| `rotowireId` | 1,721 / 1,816 (95%) |
| `sportRadarId` | 1,436 / 1,816 (79%) |
| `statsIncId` | 851 / 1,816 (47%) |

And it covers **581 of the 587** names in `nba-player-ids.json`. So Fantrax is
simultaneously a new source *and* the Rosetta Stone that bridges the id spaces we
already have — plus SportRadar/Rotowire ids, which are the join keys most future
data partners (injury feeds, odds, news) will speak.

---

## 2.2 Basketball Monster — a third id space, and a verified bridge

Added 2026-08-03 from three BBM "Export to Excel" files (2024-25, 2025-26, and
2026 Summer League). BBM's export carries two id columns:

- `ID` — Basketball Monster's own player id, stable across seasons.
- `NBA ID` — **the NBA Stats id**, verified: Nikola Jokić = `203999`. It shares
  **97%** of the ids in `nba-player-ids.json`, which independently confirms both
  sources are describing the same namespace.

Coverage: **1,005 distinct BBM players**, 673 with an NBA Stats id. The 332
without are players with no NBA service yet — BBM issues its own id immediately
but cannot supply an NBA Stats id until the league does, the same shape of gap
ESPN has for international prospects.

BBM is therefore both a new id and a corroborating bridge: because 673 of its
players carry an NBA Stats id, they merge into the registry by **exact id**
rather than by name. That is why the build merges `nba-player-ids.json` before
BBM — doing it the other way round turns 673 exact joins into name guesses.

One caution the data surfaced: BBM export **filenames carry no season**
(`BBM_PlayerRankings (3).xls`), so `extract_bbm_ids.py` fingerprints the season
from the roster instead — Summer League by game counts, then Cooper Flagg
(debuted 2025-26) vs Damian Lillard / Kyrie Irving (both missed it injured).
Pass `--season` explicitly if a future export defeats that heuristic.

## 3. Proposal

### 3.1 A canonical FHE player id, minted by us

Not ESPN's, not Fantrax's. A surrogate we own, because **only a surrogate can
exist before a player has any provider id** — which is the rookie problem, and
the single biggest reason to do this at all.

```
fhe_id  text primary key      -- e.g. "fhe_cameron_boozer_2007" or "fhe_004821"
```

Recommend an opaque zero-padded serial (`fhe_004821`) with the readable slug in a
separate column. Readable ids invite hand-editing and break when a name changes.

### 3.2 Two tables

```sql
-- The registry: one row per human being.
create table player_identity (
  fhe_id          text primary key,
  display_name    text not null,
  norm_name       text not null,
  slug            text not null,
  status          text not null,       -- 'prospect' | 'nba' | 'former'
  dob             date,
  draft_year      int,
  draft_pick      int,
  current_team    text,                -- normalizeTeamAbbr()'d
  -- provider ids, all nullable: a prospect has none, a retiree may lack new ones
  espn_id         text unique,         -- = nba_players.id / season_player_stats.player_id
  nba_stats_id    text unique,         -- = nba-player-ids.json (headshots)
  fantrax_id      text unique,
  rotowire_id     text unique,
  sportradar_id   text unique,
  statsinc_id     text unique,
  bbm_id          text unique,
  confidence      text not null,       -- 'exact_id' | 'name_alias' | 'manual'
  updated_at      timestamptz not null default now()
);

-- Every name form that has ever referred to that human.
create table player_name_alias (
  norm_name   text primary key,        -- normalized, so lookups are O(1)
  fhe_id      text not null references player_identity(fhe_id),
  raw_name    text not null,           -- the form as the source writes it
  source      text not null,           -- 'hoopr' | 'fantrax' | 'hoopshype' | 'dynasty' | …
  kind        text not null,           -- 'legal' | 'nickname' | 'ordering' | 'typo' | 'diacritic'
  note        text,
  added_at    timestamptz not null default now()
);
```

`player_name_alias` **replaces all three** existing alias maps. It is additive
by nature: every new source contributes its dialect instead of forking a map.

### 3.3 One generated artifact, three consumers — **BUILT 2026-08-04**

The TS/Python split is the reason the alias maps diverged, so solve it directly:
the build emits **one JSON snapshot** that every runtime reads.

```
scripts/build-player-identity.ts   →  data/player-ids/player-identity.json    (the id LEDGER, full)
                                   →  src/lib/player-identity/registry.json   (the resolution INDEX, slim)
```

Two files, not three. The proposal called for a copy under `models/`; that was
dropped, because a second copy of the same data is a second thing to drift and
Python can read the generated index where it lies. Reading a file out of `src/`
from Python looks odd and is the point: one producer, two consumers, no mirror.

- **TS app/scripts** — `@/lib/player-identity` for the resolver and normalizer
  (data-free, safe in a client component); `@/lib/player-identity/bundled` when
  you actually want the ~230 KB snapshot. Two entry points so the bundle cost is
  a decision rather than an accident.
- **Python models** — `models/player_identity.py` reads the same index and
  mirrors the same resolution ladder. `models/rookie-translation/common.py`
  re-exports from it, so model scripts needed no change.
- **SQL** — joins against `player_identity` directly (service-role only: RLS is
  on with no policies, and an anon read returns zero rows *silently*).

The ledger and the index have different jobs and should not be merged. The
ledger exists to keep `fhe_id`s stable across rebuilds and carries provenance
(`sources`, `confidence`, rotowire/sportradar/statsinc ids); the index carries
only what a resolver needs, so it can be imported without shipping the trail.

**The normalizer ships in that module and is called, not copied.** All six
copies are gone — the four in the proposal plus `src/lib/dynasty-board.ts`
(which already delegated) and a verbatim duplicate inside
`src/app/admin/rookie-board/_editor.tsx`. `src/lib/rookie-board.ts`'s was the one
that had genuinely drifted, and converging it was **measured before it was done**:
across all 1,238 distinct names in the board, the prospect pool, the dynasty
board and the registry, the two rules agree on every one.

`npm run identity:verify` is the drift check, and it is READ-ONLY — no DB, no
network, ~1 second, so it is cheap enough to run on any change touching a name:

1. the generated snapshot carries the authored alias list (catches "edited the
   aliases, forgot to rebuild", which would strand Python on the old list);
2. TS and Python normalizers agree on all 1,225 registry names plus adversarial
   cases (diacritics, suffixes, initials, whitespace);
3. no alias pair has both forms present as separate identities;
4. every provider id is unique across identities;
5. every stored `norm_name` is what the normalizer actually returns;
6. the suffix-strip rule appears in no file but the two canonical ones.

Check 6 is a grep, and crude on purpose: it is the one most likely to still be
working in a year, and it found four copies that hand enumeration had missed
(`scripts/sync-nba-players.js`, `scripts/swap-experts.js`,
`scripts/swap-hashtag-for-fbihe.ts`, `scripts/bbm/extract_bbm_ids.py`).

One wrinkle worth keeping: check 2 shells out to Python, and Python on Windows
defaults its stdio to the console codepage. The naive version reported every
accented name as a mismatch. It now forces UTF-8 both ways and returns
ASCII-escaped JSON — a check that cries wolf is a check nobody runs.

### 3.4 How each source attaches

Resolution order is strictly strongest-evidence-first:

1. **Provider id match** — if the source carries an id we already hold, done. Zero ambiguity.
2. **Exact `norm_name`** in `player_name_alias`, when it resolves to exactly one `fhe_id`.
3. **Disambiguate** a multi-candidate name using, in order: DOB → draft year → NBA team → position. This is the generalization of the Fantrax duplicate-name fix.
4. **No confident answer → do not guess.** Write a row to `player_identity_unresolved` and return null. The Fantrax build proved this is the right default: a blank beats a confidently wrong star's stat line.

Per-source attachment plan:

| Source | Attach via | Notes |
|---|---|---|
| hoopR/ESPN | `espn_id` | The spine. Seeds the registry (882 rows). |
| `nba-player-ids.json` | name → sets `nba_stats_id` | Bridges the two NBA id spaces once, permanently. |
| Fantrax | `fantrax_id` + fills `rotowire_id`/`sportradar_id`/`statsinc_id` | The Rosetta Stone; run first after the spine. |
| `nba_roster` | name + DOB + draft year | Roster CSV *has* DOB — the strongest disambiguator we own. |
| `nba_contracts` | name (+ team) | Closes the 86 null `player_id` rows where the player is real. |
| dynasty board, rookie board, prospects CSV | name → **mints `fhe_id` for prospects** | This is where pre-NBA identity is born. |
| depth chart, role context | name + team | Removes the (team, name) re-keying hazard from `97cf869`. |
| draft model (`models/`) | shared JSON artifact | Kills `DRAFT_NAME_TO_HOOPR` / `ROSTER_NAME_TO_HOOPR`. |

**The rookie hand-off is the key flow:** a prospect gets an `fhe_id` when he
first appears on the draft board. On his first NBA game log, the build matches
him (name + draft year + team) and writes his new `espn_id` onto the *existing*
row. No new identity, no re-key, and every historical board reference still
resolves.

### 3.5 Rollout — additive, never a big bang

**Phase 1 — build the registry, change nothing.** Write the tables, the build
script, and the JSON artifact. Ship a `/admin/player-identity` review panel
listing unresolved names and conflicts. Nothing in the app reads it yet. This is
already useful on day one: it's a standing report of every identity hole.

**Phase 2 — dual-key.** Add a nullable `fhe_id` column beside the existing key on
`nba_roster`, `nba_contracts`, `season_player_stats`, `nba_player_trends`,
`real_salary_values`. Backfill. Existing joins untouched.

**Phase 3 — migrate consumers one at a time,** newest first (Fantrax connector →
real-salary → team-rosters → seasonal → dynasty → models), verifying row counts
match the name join before switching. Any regression is one file to revert.

> **Verification pattern, established on real-salary (2026-08-04) — reuse it.**
> "Row counts match" turned out to be too weak a gate: this model has 562 rows
> and the console readouts show 15, so a reshuffle in the middle is invisible.
> What actually earns confidence is a full, deterministic dump captured BEFORE
> any edit and diffed after — `npm run realsalary:build -- --dry-run --dump
> out.csv` exists for exactly this and should be the template for the next
> consumer.
>
> Two gotchas that will recur:
> - Diff the SERVER-RENDERED page too, not just the build. Parse the row payload
>   and compare field by field rather than comparing bytes: `/real-salary-
>   rankings` computes `age` from `Date.now()` on every render by design, so a
>   byte diff shows 535 of 562 rows "changed" and buries a real regression.
> - Have the build write `fhe_id` itself rather than leaving it to
>   `identity:backfill`. The build already resolved the human in order to score
>   him; re-deriving that afterwards from the stored `player_id` is redundant and
>   can silently fall behind between runs.

**Phase 4 — delete** the three alias maps and the four normalizer copies, and
make `player_name_alias` the only place a name variant can be recorded.

Phases 1–2 are safe to do now. Phase 3 should wait until the Fantrax connector
graduates from admin-only, so the two changes don't land on top of each other.

> **Phase 4 status (2026-08-04).** Normalizer copies: all six deleted, one
> implementation per language, drift-checked. Alias maps: the two Python maps are
> gone; `src/lib/player-name-aliases.ts` is now the ONE authored list and the
> build carries it into the snapshot both languages read. The merge added
> `gregory jackson ⇄ gg jackson` (previously Python-only) to the shared list —
> verified collision-free first, so `name_candidates()` on the Python side now
> returns a superset of what it used to.
>
> Still outstanding: `player_name_alias` (the TABLE) is written by the build but
> nothing reads it yet — the authored TS map is still the source. Promoting the
> table to source-of-truth means giving the admin panel a way to add a pair, and
> is the last piece of Phase 4.

---

## 4. What this buys

- **Rookies stop being identity discontinuities.** One id from draft board to NBA career.
- **Headshots resolve by id**, not by name — and the 70 dynasty players with no NBA-id mapping become a visible, fixable list instead of silent nulls.
- **A new data source costs a mapping row, not a bespoke resolver.** The next Fantrax-shaped integration is hours, not a day.
- **The TS/Python alias split disappears** — one artifact, one truth.
- **Duplicate-name and stale-rank bugs become structurally impossible**, rather than caught by review. The whole class of bug in §1's record traces to name-as-key.
- **SportRadar/Rotowire ids are banked now**, at zero cost, ready for the first partner who speaks them.

## 5. Risks, and what not to do

- **Don't make `fhe_id` a foreign key with `on delete cascade`** anywhere until Phase 3 is complete. A bad merge would take real data with it.
- **Don't auto-merge on fuzzy similarity.** Every alias is either id-derived or human-approved. Fuzzy matching belongs in the *suggestion* UI, never in the build.
- **Don't let the registry become hand-maintained.** It must be rebuildable from sources; the only hand-authored input is the approved-alias list.
- **Splits and merges need a plan** — two players wrongly merged is worse than two unresolved. Keep `player_identity_unresolved` and make the admin panel the only merge path.
- **`normalizeTeamAbbr()` still applies** to every team field written here.

## 6. Effort

| Phase | Scope | Estimate |
|---|---|---|
| 1 | tables, build script, JSON artifact, admin review panel | ~1 day |
| 2 | dual-key columns + backfill across 5 tables | ~half day |
| 3 | migrate 7 consumers, verify each | ~1–2 days, spread out |
| 4 | delete the old maps/normalizers, add the CI drift check | ~half day |

Phase 1 alone is worth doing even if 2–4 never happen: it turns identity from an
invisible risk into a monitored one.

---

## Open questions for review

1. **Opaque serial or readable slug** for `fhe_id`? Recommendation: opaque, slug in its own column.
2. **Does Basketball Monster expose a player id** on the subscriber API? If so it belongs in the registry from day one.
3. **Should the registry cover non-NBA prospects** (international, NCAA underclassmen not yet draft-eligible)? Recommendation: yes — that's precisely where name-only identity hurts most.
4. **Retire `nba-player-ids.json`** in Phase 4, or keep it as a generated view of the registry? Recommendation: regenerate it from the registry so nothing downstream breaks.
