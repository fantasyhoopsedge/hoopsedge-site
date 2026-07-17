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
