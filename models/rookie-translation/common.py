"""Shared paths, name normalization, and aliases for the rookie translation model.

Option B: this layer reads hoopR player-box parquet directly and never writes to
Supabase. Nothing here touches the Next.js app, the V-score pipeline, or the
rookie board.
"""

from __future__ import annotations

import os
import re
import unicodedata

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DRAFT_MODEL_CSV = os.path.join(REPO, "data", "draft-model", "draft_model_data.csv")
TRAIN_TABLE = os.path.join(REPO, "data", "draft-model", "rookie_year_training.csv")
OUTPUT_JSON = os.path.join(REPO, "output", "rookie-translations-2026.json")

# Raw parquet is cached outside the repo — it is large and reproducible.
PARQUET_CACHE = os.path.join(
    os.environ.get("TEMP", "/tmp"),
    "claude", "C--fantasyhoopsedge",
    "193c504a-b2fd-4889-90cb-39c2d71eccbd", "scratchpad", "parquet",
)

HOOPR_URL = (
    "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main"
    "/nba/player_box/parquet/player_box_{season}.parquet"
)

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


def name_candidates(norm: str) -> list[str]:
    alt = DRAFT_NAME_TO_HOOPR.get(norm)
    return [norm, alt] if alt else [norm]


# --- upstream draft-slot corrections -----------------------------------------
# TEMPORARY. The root error is in data/nba-rosters/2026-27.csv, which records BOTH
# Mikel Brown Jr. (BKN) and Aday Mara (OKC) as `2026-06` and has no `2026-12` row.
# nba_roster.draft_pick faithfully ingests that, so every consumer inherits it.
# Confirmed with Ash 2026-07-16: Mara is pick 12. log(pick) is the model's strongest
# feature, so at pick 6 Mara was over-projected by roughly 20% on scoring.
#
# Delete this entry once the CSV is fixed and `npm run nba:roster` has re-ingested —
# validate_draft_slots() reports the override as REDUNDANT when upstream agrees.
DRAFT_PICK_CORRECTIONS: dict[str, int] = {"aday mara": 12}


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
