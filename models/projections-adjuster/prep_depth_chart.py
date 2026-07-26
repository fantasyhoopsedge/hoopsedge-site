"""Prepare the /admin/depth-chart tool's bundled reference data.

Joins three things Stage 1/5 and the salary pipeline already produce, so this adds no
new data collection, only a new combination:

  roster        data/nba-rosters/2026-27.csv            team, player, position
  projections   output/season-projections-2026-27.json  Stage 5's final projMpg/projGames
  contracts     data/nba-salaries/current.csv            salary_y2/y3 + contract_note

CONTRACT-STATUS DERIVATION. current.csv's `contract_note` free-text field tags specific
future seasons with one of exactly four patterns (verified against all 22 distinct notes
in the file): "Player Option YYYY-YY", "Team Option YYYY-YY", "Qualifying Offer YYYY-YY",
"Two-Way Contract YYYY-YY", semicolon-separated when a player carries more than one. For
a target season:
  - a tag matching that season wins (mapped to player_option / team_option /
    restricted_fa / non_guaranteed respectively -- a qualifying-offer year IS the
    mechanism that creates restricted free agency, so it maps there)
  - no tag, but a salary figure exists for that year -> guaranteed
  - no tag, no salary figure -> the contract has run out -> unrestricted_fa

hoopR/salary numbering: salary_current = 2025-26, so salary_y2 = 2026-27 (this tool's
"current" column) and salary_y3 = 2027-28 ("next" column) -- see CLAUDE.md's salary
year-offset note.

TWO ROWS ARE KNOWN-STALE ON PURPOSE, NOT A PARSING BUG. Two contract_notes are one-off
manual annotations rather than a dated tag ("UFA - unsigned; prior multi-year figure no
longer applies", "New LAL deal 2026-27 (1 yr / $2.4M) supersedes stale figure") -- both
rows already carry salary_y2=NaN, so the general "no tag, no salary -> UFA" rule already
produces a reasonable answer for the first; the second (Kevon Looney, actually re-signed
for 2026-27) will incorrectly show UFA because the number was never updated at the
source. That is a data-staleness gap in current.csv itself, not something this parser can
fix generically from one row -- flagged here rather than special-cased.

CONTRACT-MATCH FALLBACK. ~13% of the roster (mostly Exhibit-10/two-way/G-League-adjacent
signings) has no row in current.csv at all -- salary trackers don't bother with camp
invites. For those, read the roster CSV's own `contract` field directly ("Two-Way",
"Exhibit 10", "2nd Rd Pick" -> non_guaranteed; anything else with a real dollar figure
but no year-by-year breakdown -> guaranteed, shown without a precise per-year split).

DEPTH-CHART TIER is seeded from Stage 5's own projMpg (28+ starter, 18-28 rotation,
8-18 reserve, else fringe) as a reasonable default -- exactly like prep_role_context.py
seeds `class` from `yos`. It is meant to be overridden by hand in the editor; the model
itself is not wired to read it back (this is a standalone tool, not a Stage 1 input, by
design -- see the availability-chronicity conversation this was built alongside).

Run: python models/projections-adjuster/prep_depth_chart.py
"""

from __future__ import annotations

import json
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO, name_candidates, normalize_name  # noqa: E402

ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
SALARY_CSV = os.path.join(REPO, "data", "nba-salaries", "current.csv")
PROJECTIONS_JSON = os.path.join(REPO, "output", "season-projections-2026-27.json")
TIER_CSV = os.path.join(REPO, "data", "nba-rosters", "depth-chart-2026-27.csv")
BUNDLE_JSON = os.path.join(REPO, "src", "data", "depth-chart-2026-27.json")

SEASON_NOW, SEASON_NEXT = "2026-27", "2027-28"
NOTE_TAG_RE = re.compile(r"^(Player Option|Team Option|Qualifying Offer|Two-Way Contract)\s+(\d{4}-\d{2})$")
TAG_TO_STATUS = {
    "Player Option": "player_option",
    "Team Option": "team_option",
    "Qualifying Offer": "restricted_fa",
    "Two-Way Contract": "non_guaranteed",
}
NOT_A_TEAM = {"FA"}
DEFAULT_TIER = "reserve"


def seed_tier(mpg: float | None) -> str:
    if mpg is None:
        return "fringe"
    if mpg >= 28:
        return "starter"
    if mpg >= 18:
        return "rotation"
    if mpg >= 8:
        return "reserve"
    return "fringe"


def parse_note_tags(note: str) -> dict[str, str]:
    """{"2027-28": "player_option", ...} from a semicolon-separated contract_note."""
    tags: dict[str, str] = {}
    if not isinstance(note, str):
        return tags
    for part in note.split(";"):
        m = NOTE_TAG_RE.match(part.strip())
        if m:
            tags[m.group(2)] = TAG_TO_STATUS[m.group(1)]
    return tags


def season_status(salary: float | None, tags: dict[str, str], season: str) -> tuple[float | None, str]:
    if season in tags:
        return (salary if pd.notna(salary) else None, tags[season])
    if pd.notna(salary):
        return float(salary), "guaranteed"
    return None, "unrestricted_fa"


def fallback_status(contract: str) -> str:
    """For the ~13% with no current.csv row -- roster CSV's own free-text `contract`."""
    c = (contract or "").strip().lower()
    if "two-way" in c or "exhibit 10" in c or "2nd rd pick" in c:
        return "non_guaranteed"
    if c:
        return "guaranteed"
    return "unrestricted_fa"


def main() -> None:
    roster = pd.read_csv(ROSTER_CSV)
    roster = roster[~roster["team"].isin(NOT_A_TEAM)].copy()
    roster["k"] = roster["player"].map(normalize_name)

    sal = pd.read_csv(SALARY_CSV)
    sal["k"] = sal["player"].map(normalize_name)
    sal_lookup = {row["k"]: row for _, row in sal.iterrows()}

    proj_lookup: dict[str, dict] = {}
    if os.path.exists(PROJECTIONS_JSON):
        doc = json.load(open(PROJECTIONS_JSON, encoding="utf-8"))
        for p in doc.get("players", []):
            proj_lookup[p["norm_name"]] = p

    existing_tiers: dict[str, str] = {}
    existing_injuries: dict[str, str] = {}
    existing_override_games: dict[str, float] = {}
    existing_override_mpg: dict[str, float] = {}
    if os.path.exists(TIER_CSV):
        t = pd.read_csv(TIER_CSV)
        existing_tiers = dict(zip(zip(t["team"], t["player"]), t["tier"]))
        if "injury" in t.columns:
            existing_injuries = dict(zip(zip(t["team"], t["player"]), t["injury"]))
        if "override_games" in t.columns:
            existing_override_games = dict(zip(zip(t["team"], t["player"]), t["override_games"]))
        if "override_mpg" in t.columns:
            existing_override_mpg = dict(zip(zip(t["team"], t["player"]), t["override_mpg"]))

    matched, fell_back = 0, 0
    rows = []
    for _, r in roster.iterrows():
        k = r["k"]
        sal_row = next((sal_lookup[c] for c in name_candidates(k) if c in sal_lookup), None)
        proj = next((proj_lookup[c] for c in name_candidates(k) if c in proj_lookup), None)

        if sal_row is not None:
            matched += 1
            tags = parse_note_tags(sal_row.get("contract_note", ""))
            sal_now, status_now = season_status(sal_row.get("salary_y2"), tags, SEASON_NOW)
            sal_next, status_next = season_status(sal_row.get("salary_y3"), tags, SEASON_NEXT)
        else:
            fell_back += 1
            status_now = status_next = fallback_status(r.get("contract", ""))
            sal_now = sal_next = None

        mpg = proj["projMpg"] if proj else None
        games = proj["projGames"] if proj else None
        tier = existing_tiers.get((r["team"], r["player"])) or seed_tier(mpg)
        injury = existing_injuries.get((r["team"], r["player"])) or "none"
        override_games = existing_override_games.get((r["team"], r["player"]))
        override_mpg = existing_override_mpg.get((r["team"], r["player"]))
        override_games = float(override_games) if pd.notna(override_games) else None
        override_mpg = float(override_mpg) if pd.notna(override_mpg) else None

        # Season totals (not per-game) for the USG% aggregation below -- standard
        # usage rate is a ratio of season totals, not an average of per-game rates.
        pg = proj["perGame"] if proj else None
        mp_season = mpg * games if (mpg is not None and games is not None) else None
        fga_s = pg["fga"] * games if (pg and games is not None) else None
        fta_s = pg["fta"] * games if (pg and games is not None) else None
        tov_s = pg["tov"] * games if (pg and games is not None) else None

        # r["pos"] is NaN (a float, not a missing key) for the handful of new
        # signings added without full bio data -- pd.notna guards it the same
        # way overrideGames/overrideMpg/usg already are below, so json.dump
        # never sees a bare NaN token here either.
        pos = r.get("pos", "")
        rows.append({
            "team": r["team"], "player": r["player"], "pos": pos if pd.notna(pos) else "",
            "tier": tier, "injury": injury,
            "overrideGames": override_games, "overrideMpg": override_mpg,
            "projMpg": round(mpg, 1) if mpg is not None else None,
            "projGames": round(games, 1) if games is not None else None,
            "salaryNow": sal_now, "statusNow": status_now,
            "salaryNext": sal_next, "statusNext": status_next,
            "_mp": mp_season, "_fga": fga_s, "_fta": fta_s, "_tov": tov_s,
        })

    # Standard NBA usage rate, from each roster's own reconciled season totals:
    #   USG% = 100 * (FGA + 0.44*FTA + TOV) * (TeamMP/5) / (MP * (TeamFGA + 0.44*TeamFTA + TeamTOV))
    # A player with no Stage 5 projection (missing proj/pg above) gets usg=None
    # rather than 0 -- "no projection" is not "no usage". Computed on a SEPARATE
    # dataframe (not the rows list itself) -- round-tripping the full rows list
    # through a float64 dataframe silently turns every other None (salaryNow/Next
    # for FAs, missing projMpg/projGames) into NaN, which json.dump then writes as
    # the bare token `NaN` -- invalid JSON that TypeScript's parser rejects outright.
    usg_df = pd.DataFrame([{k: r[k] for k in ("team", "_mp", "_fga", "_fta", "_tov")} for r in rows])
    team_totals = usg_df.groupby("team")[["_mp", "_fga", "_fta", "_tov"]].sum()
    usg_df["usg"] = None
    for team, t in team_totals.iterrows():
        denom = t["_fga"] + 0.44 * t["_fta"] + t["_tov"]
        mask = usg_df["team"] == team
        num = usg_df.loc[mask, "_fga"] + 0.44 * usg_df.loc[mask, "_fta"] + usg_df.loc[mask, "_tov"]
        usg = 100 * num * (t["_mp"] / 5) / (usg_df.loc[mask, "_mp"] * denom)
        usg_df.loc[mask, "usg"] = usg.round(1)

    for r, usg in zip(rows, usg_df["usg"]):
        r["usg"] = float(usg) if pd.notna(usg) else None
        for k in ("_mp", "_fga", "_fta", "_tov"):
            del r[k]

    os.makedirs(os.path.dirname(BUNDLE_JSON), exist_ok=True)
    with open(BUNDLE_JSON, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2)

    if not os.path.exists(TIER_CSV):
        pd.DataFrame([{"team": r["team"], "player": r["player"], "tier": r["tier"], "injury": r["injury"],
                       "override_games": r["overrideGames"], "override_mpg": r["overrideMpg"]}
                      for r in rows]).to_csv(TIER_CSV, index=False)

    print(f"prepped {len(rows)} depth-chart rows across {roster['team'].nunique()} teams")
    print(f"  contract match: {matched} from current.csv, {fell_back} fell back to the roster CSV's own field")
    tiers = pd.Series([r['tier'] for r in rows]).value_counts()
    print(f"  seeded tiers: {dict(tiers)}")
    print(f"  wrote {os.path.relpath(BUNDLE_JSON, REPO)}")
    if not os.path.exists(TIER_CSV):
        print(f"  wrote {os.path.relpath(TIER_CSV, REPO)} (seed tiers only; hand-edit from here)")


if __name__ == "__main__":
    main()
