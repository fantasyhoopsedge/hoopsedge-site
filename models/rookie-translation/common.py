"""Shared paths, name normalization, and aliases for the rookie translation model.

Option B: this layer reads hoopR player-box parquet directly and never writes to
Supabase. Nothing here touches the Next.js app, the V-score pipeline, or the
rookie board.
"""

from __future__ import annotations

import os
import re
import unicodedata
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DRAFT_MODEL_CSV = os.path.join(REPO, "data", "draft-model", "draft_model_data.csv")
TRAIN_TABLE = os.path.join(REPO, "data", "draft-model", "rookie_year_training.csv")
OUTPUT_JSON = os.path.join(REPO, "output", "rookie-translations-2026.json")

# Raw parquet is large and fully reproducible from HOOPR_URL, so it is cached on
# disk and gitignored rather than committed. Defaults to a repo-local directory so
# a fresh clone works with no setup; point FHE_PARQUET_CACHE at an existing cache
# to reuse one across checkouts.
PARQUET_CACHE = os.environ.get(
    "FHE_PARQUET_CACHE", os.path.join(REPO, "data", "draft-model", "parquet")
)

HOOPR_URL = (
    "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main"
    "/nba/player_box/parquet/player_box_{season}.parquet"
)


def ensure_parquet(season: int) -> str:
    """Return the local path to a season's player-box parquet, downloading if absent.

    Every reader goes through here so that no script depends on some *other* script
    having been run first to populate the cache.
    """
    os.makedirs(PARQUET_CACHE, exist_ok=True)
    path = os.path.join(PARQUET_CACHE, f"pb_{season}.parquet")
    if not os.path.exists(path):
        urllib.request.urlretrieve(HOOPR_URL.format(season=season), path)
    return path

# hoopR season numbering: 2026 == the 2025-26 season (matches scripts/nba-data/client.ts).
# A draft class of year N has its first possible NBA season in N+1, so covering
# classes 2010-2025 requires seasons 2011-2026 inclusive. Starting at 2011 is what
# makes "first season with minutes" verifiable for the 2010 class: we observe every
# season they could possibly have debuted in.
FIRST_SEASON = 2011
LAST_SEASON = 2026
SEASONS = list(range(FIRST_SEASON, LAST_SEASON + 1))

REGULAR_SEASON = 2  # season_type coding in the hoopR feed (3 == postseason)

# hoopR's raw codes for the 30 real franchises, plus NJ (the pre-2013 Nets).
# NOTE this is a FILTER, not an alias map — the canonical FHE codes live in
# src/lib/nba-teams.ts (TypeScript, not importable here) and we never write a team
# code out of this layer, so no normalization is needed.
#
# It exists because hoopR tags All-Star and Rising Stars games as season_type == 2
# (regular season). 452 player-games across 22 exhibitions leak through a naive
# season_type filter under codes like STARS/STRIPES/WORLD/USA/LEB/DUR/GIA/STE.
# That contaminated 29 of 706 rookie targets with an extra "game" of ~18 no-defense
# minutes — and because Rising Stars selects the BEST rookies (Tatum, Simmons,
# Morant, Young, Mitchell), the bias was concentrated exactly at the top of the
# distribution. Always filter on this set before aggregating by team or season.
HOOPR_NBA_TEAMS = {
    "ATL", "BKN", "BOS", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GS",
    "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NO", "NY",
    "OKC", "ORL", "PHI", "PHX", "POR", "SA", "SAC", "TOR", "UTAH", "WSH",
    "NJ",
}


def normalize_name(name: str) -> str:
    """Byte-identical to normalizePlayerName() in src/lib/dynasty-rankings.ts.

    lowercase -> strip diacritics -> strip .,'’ -> strip jr/sr/ii/iii/iv -> collapse ws
    """
    s = unicodedata.normalize("NFD", str(name).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[.,'’]", "", s)
    s = re.sub(r"\s+(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


# Draft-model name -> hoopR display name, for players hoopR lists under a nickname.
# Same class of bug as src/lib/player-name-aliases.ts (which maps nickname -> legal
# and is TypeScript-side only, so it cannot be imported here). Keys and values are
# already normalize_name()'d. Found by fuzzy-diffing the two name lists, not guessed —
# re-run that diff whenever either source is refreshed.
DRAFT_NAME_TO_HOOPR: dict[str, str] = {
    "gregory jackson": "gg jackson",
    "carlton carrington": "bub carrington",
}

# The roster CSV's nicknames -> hoopR's legal names. Same job as the map above
# (an FHE-side name -> the name hoopR files him under), different source, so it is
# kept separate to keep each one's provenance readable.
#
# MIRROR of NICKNAME_TO_LEGAL_NAME in src/lib/player-name-aliases.ts — same three
# players, same normalized keys. It is duplicated only because TypeScript cannot be
# imported here; it is NOT an independent map and must not drift. If you add a
# player to one, add him to the other. That file documents the bug this class of
# miss already caused once: these three players' consensus_rank silently stayed
# null in season_player_stats because a join went straight across without
# resolving the nickname.
ROSTER_NAME_TO_HOOPR: dict[str, str] = {
    "cam johnson": "cameron johnson",
    "herb jones": "herbert jones",
    "ron holland": "ronald holland",
}


def name_candidates(norm: str) -> list[str]:
    """Normalized names worth trying for `norm`, best first.

    Consults both alias maps: a caller joining against hoopR does not care whether
    a given name came from the draft model or the roster CSV, only that the join
    resolves.
    """
    alt = DRAFT_NAME_TO_HOOPR.get(norm) or ROSTER_NAME_TO_HOOPR.get(norm)
    return [norm, alt] if alt else [norm]


# --- upstream draft-slot corrections -----------------------------------------
# Empty, and should stay that way: an entry here means nba_roster.draft_pick is
# wrong at the source and every other consumer is still inheriting the error. Fix
# data/nba-rosters/2026-27.csv and re-run `npm run nba:roster` instead; only add an
# entry to unblock a run in the meantime, and delete it once upstream agrees
# (predict.py reports an override as REDUNDANT when it does).
#
# Precedent: the CSV recorded both Mikel Brown Jr. (BKN) and Aday Mara (OKC) as
# `2026-06` with no `2026-12` row, and log(pick) is the model's strongest feature,
# so Mara was over-projected by ~20% on scoring. Fixed at source 2026-07-16.
DRAFT_PICK_CORRECTIONS: dict[str, int] = {}


# --- top-5-pick rate-model bias correction -----------------------------------
# Cross-validation (train.py's top5_bias_correction()) shows the per-36 SKILL
# model (Stage B) has a genuine, systematic bias for picks 1-5 specifically: it
# underpredicts scoring/shot-volume/playmaking rates, while Stage A (minutes)
# and rebounding/stl/blk stay well-calibrated at every pick tier. Root-caused to
# class imbalance in the training data (~60-70 top-5-pick player-seasons vs
# ~310 picks-31-60 ones, a 5:1 ratio) — one shared linear fit is dominated by
# the mid/late-pick relationship and has too little signal to learn a separate,
# steeper slope for the small number of truly elite prospects. NOT primarily a
# Ridge alpha artifact (sweeping alpha 10 -> 0.3 only moved the pts bias a
# fraction); NOT a minutes-model problem (Stage A stays close to unbiased for
# picks 1-5 in every backtest run).
#
# Two alternatives were tried and rejected: sample-weighting picks 1-14 (w=5)
# cut the bias only partially while adding real cost elsewhere (higher overall
# MAE, and it overcorrected picks 15-60 into a new negative bias); log_pick x
# rate-feature interaction terms looked fine in aggregate but were unstable on
# real out-of-distribution targets — they LOWERED top-pick projections despite
# "fixing" the aggregate number, because products of already-extreme z-scores
# extrapolate unpredictably exactly where OOD prospects live.
#
# This is a simple additive per-36 correction instead: add back the average
# historical miss (true36 - predicted36) for picks 1-5.
#
# METHODOLOGY, v2 (2026-07-21): STRICT FORWARD-CHAIN, not nested-LOCO. For each
# eligible draft class Y, the model is fit ONLY on classes strictly before Y
# (the information a real deployment would have had), then judged against Y's
# actual top-5 outcomes. A class only counts if >=4 of its top-5 picks played
# NCAA ball (MIN_TOP5_YEAR_N in train.py) — years dominated by international/
# G-League/Overtime Elite picks (2023: Wembanyama, Scoot Henderson, both
# Thompson twins; 2024: Risacher, Sarr, Holland) have no feature row for those
# players at all, so a 1-2-player "class average" isn't a fair read of that
# class and would just add noise. That leaves 8 eligible classes — 2016-2022 +
# 2025 (2015 and earlier excluded by the same 5-class warm-up forward_chain()
# uses) — pooling to 36 top-5-pick player-seasons.
#
# v1 (nested-LOCO, computed 2026-07-20) put the pooled pts bias at only +0.55.
# Backtesting v1 against the actual 2025 top-5 class (Flagg/Harper/Edgecombe/
# Knueppel/Bailey) showed it undercorrected badly — and extending the same
# backtest back to 2016 confirmed the underprediction is a persistent, ~decade-
# long pattern (2018 and 2019 missed by MORE than 2022 or 2025 did), not a
# one-off. Nested-LOCO had been too optimistic because a class's "held-out"
# contribution could still be informed by classes that happened chronologically
# LATER than it — information no real deployment would have had. Forward-chain
# across those same 36 player-seasons puts the pooled pts bias at +1.88 —
# consistent with 2016-2022 and 2025 individually, not just in aggregate.
#
# SCOPED TO PICKS 1-5 ONLY (TOP5_PICK_CUTOFF). An EARLIER version of this note
# said picks 6-14 had a purely Stage-A (minutes) driven bias and that applying
# this correction there made things worse — both true statements, but about a
# single-split pooled-LOCO analysis that turned out not to be the full story.
# The forward-chain, year-by-year backtest below (MID_RATE_CORRECTION /
# LATE_RATE_CORRECTION) found a real, separate Stage-B bias in both lower
# tiers too, smaller than the top-5 one AND a different shape (FTM/FTA come
# out OVER-projected there, not under) — see that constant's comment. Each
# bucket gets its own independently-derived correction; none of the three
# should be inferred from another.
#
# Regenerate via train.py's top5_bias_correction() whenever a new draft class's
# rookie-year data becomes available (it will add one more forward-chain year
# once 2026's own rookie season is real, and may eventually make 2023/2024
# usable if MIN_TOP5_YEAR_N's NCAA-coverage picture changes). Computed
# 2026-07-21.
TOP5_PICK_CUTOFF = 5
TOP5_RATE_CORRECTION: dict[str, float] = {
    "pts": 1.880, "reb": -0.000, "ast": 0.743, "stl": -0.056, "blk": -0.016,
    "tov": 0.184, "fg3m": 0.311, "fgm": 0.604, "fga": 1.246, "ftm": 0.362, "fta": 0.451,
}

# --- picks 6-14 (lottery, non-top-5) and 15-30 (rest of round 1) --------------
# Same forward-chain methodology and honesty standard as TOP5_RATE_CORRECTION,
# run independently per bucket (2026-07-21, prompted by asking "if top-5 was
# underbaked, are we sure the rest of round 1 isn't too?"). Answer: no, it
# wasn't safe to assume that — both lower tiers show a real, smaller Stage-B
# bias, pooled across every year 2015-2025 with adequate NCAA coverage
# (MIN_MID_YEAR_N / MIN_LATE_YEAR_N — no year needed excluding this time,
# unlike the top-5 bucket, because 9- and 16-slot buckets are far less likely
# to be entirely swallowed by 2-3 international/G-League picks the way a
# 5-slot bucket can be).
#
# Roughly a third (6-14) to a half (15-30) of the top-5 pts miss (+0.68 and
# +0.90 vs +1.88), and NOT just a scaled-down copy of it: FTM/FTA are
# UNDER-projected for picks 1-5 but OVER-projected for both lower tiers
# (-0.28/-0.48 for 6-14, -0.15/-0.30 for 15-30) — a real sign flip, which is
# exactly why each bucket needs its own independently-measured correction
# rather than inheriting a scaled version of a neighboring one.
MID_PICK_CUTOFF = 14
LATE_PICK_CUTOFF = 30
MID_RATE_CORRECTION: dict[str, float] = {
    "pts": 0.677, "reb": 0.216, "ast": 0.139, "stl": -0.074, "blk": 0.002,
    "tov": -0.236, "fg3m": 0.540, "fgm": 0.206, "fga": 0.110, "ftm": -0.275, "fta": -0.484,
}
LATE_RATE_CORRECTION: dict[str, float] = {
    "pts": 0.898, "reb": 0.292, "ast": 0.162, "stl": 0.023, "blk": 0.078,
    "tov": -0.121, "fg3m": 0.483, "fgm": 0.281, "fga": 0.128, "ftm": -0.153, "fta": -0.300,
}


def validate_draft_slots(picks: dict[str, int], expect: int = 60) -> list[str]:
    """Check a draft class's slots form a clean 1..expect permutation.

    Exists because a duplicated slot is invisible in the output — it renders as a
    perfectly normal projection — but silently corrupts the model's strongest
    feature. Fail loudly instead.
    """
    problems: list[str] = []
    seen: dict[int, list[str]] = {}
    for name, pk in picks.items():
        seen.setdefault(pk, []).append(name)
    for pk, names in sorted(seen.items()):
        if len(names) > 1:
            problems.append(f"DUPLICATE slot {pk}: {', '.join(sorted(names))}")
    missing = [p for p in range(1, expect + 1) if p not in seen]
    if missing:
        problems.append(f"MISSING slots: {missing}")
    return problems
