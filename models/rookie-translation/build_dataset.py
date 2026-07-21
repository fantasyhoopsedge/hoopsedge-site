"""Build the Year-1 training table: college features -> rookie-season 9-cat production.

Targets are the 11 counting quantities the V-score engine actually consumes
(PTS REB AST STL BLK TOV 3PM FGM FGA FTM FTA per game) — never FG%/FT%, which the
engine derives itself from makes/attempts.

Rookie year is the player's FIRST SEASON WITH NBA MINUTES, not draft+1, so
injury-delayed debuts (Chet Holmgren, DaRon Holmes II, Jaylen Clark) land on the
season they actually played.

Run: python models/rookie-translation/build_dataset.py
"""

from __future__ import annotations

import os

import pandas as pd

from common import (
    DRAFT_MODEL_CSV, HOOPR_NBA_TEAMS, REGULAR_SEASON, SEASONS, TRAIN_TABLE,
    ensure_parquet, name_candidates, normalize_name,
)

BOX = [
    "points", "rebounds", "assists", "steals", "blocks", "turnovers",
    "three_point_field_goals_made", "field_goals_made", "field_goals_attempted",
    "free_throws_made", "free_throws_attempted", "minutes",
]
TARGETS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta"]
RENAME = {
    "points": "pts", "rebounds": "reb", "assists": "ast", "steals": "stl",
    "blocks": "blk", "turnovers": "tov", "three_point_field_goals_made": "fg3m",
    "field_goals_made": "fgm", "field_goals_attempted": "fga",
    "free_throws_made": "ftm", "free_throws_attempted": "fta", "minutes": "min",
}


def load_season(season: int) -> pd.DataFrame:
    df = pd.read_parquet(
        ensure_parquet(season),
        columns=["season", "season_type", "team_abbreviation", "athlete_id",
                 "athlete_display_name"] + BOX,
    )
    # DNPs carry minutes = NULL (not 0); a game played is minutes > 0.
    df = df[(df["season_type"] == REGULAR_SEASON) & df["minutes"].notna() & (df["minutes"] > 0)]
    # season_type==2 is NOT sufficient: hoopR files All-Star / Rising Stars games under it.
    df = df[df["team_abbreviation"].isin(HOOPR_NBA_TEAMS)]
    return df


def build_season_totals() -> pd.DataFrame:
    frames = []
    for s in SEASONS:
        d = load_season(s)
        frames.append(d)
        print(f"  season {s}: {len(d):6d} player-games, {d['athlete_id'].nunique():4d} players")
    allg = pd.concat(frames, ignore_index=True)
    agg = allg.groupby(["athlete_id", "season"]).agg(
        name=("athlete_display_name", "last"), g=("points", "size"), **{c: (c, "sum") for c in BOX}
    ).reset_index().rename(columns=RENAME)
    for t in TARGETS + ["min"]:
        agg[t + "_pg"] = agg[t] / agg["g"]
    return agg


def main() -> None:
    print(f"Loading hoopR player-box parquet, seasons {SEASONS[0]}-{SEASONS[-1]} ...")
    totals = build_season_totals()

    # First season with minutes, per athlete. Valid because our earliest draft class
    # is 2010, whose first possible season (2011) is the first season we load — so a
    # player's first observed season really is their first.
    first = totals.groupby("athlete_id")["season"].min().rename("first_season")
    totals = totals.merge(first, on="athlete_id")
    rookie = totals[totals["season"] == totals["first_season"]].copy()
    rookie["k"] = rookie["name"].map(normalize_name)
    print(f"\nrookie-year rows (first season w/ minutes): {len(rookie)}")

    dup = rookie["k"].duplicated(keep=False)
    if dup.any():
        print(f"  ambiguous names (same normalized name, >1 athlete): {rookie[dup]['k'].nunique()}")

    # College features: historical classes only (2010-2025 have a draft pick).
    dm = pd.read_csv(DRAFT_MODEL_CSV)
    hist = dm[dm["pick"].notna()].copy()
    hist["k"] = hist["name"].map(normalize_name)

    lookup: dict[str, list] = {}
    for _, r in rookie.iterrows():
        lookup.setdefault(r["k"], []).append(r)

    rows, unmatched, collisions = [], [], []
    for _, p in hist.iterrows():
        hit = None
        for cand in name_candidates(p["k"]):
            for r in lookup.get(cand, []):
                # A real debut cannot precede the draft. first_season < class+1 means
                # we matched a different player who shares the name.
                if r["first_season"] >= p["season"] + 1:
                    if hit is None or r["first_season"] < hit["first_season"]:
                        hit = r
            if hit is not None:
                break
        if hit is None:
            if any(c in lookup for c in name_candidates(p["k"])):
                collisions.append((p["name"], int(p["season"])))
            else:
                unmatched.append((p["name"], int(p["season"])))
            continue
        rec = {"name": p["name"], "k": p["k"], "draft_class": int(p["season"]),
               "pick": float(p["pick"]), "rookie_season": int(hit["first_season"]),
               "debut_lag": int(hit["first_season"]) - int(p["season"]) - 1,
               "g": int(hit["g"]), "mpg": float(hit["min_pg"])}
        for t in TARGETS:
            rec["y_" + t] = float(hit[t + "_pg"])
        rows.append(rec)

    out = pd.DataFrame(rows)
    print(f"\nmatched: {len(out)} / {len(hist)} historical draftees")
    print(f"never reached NBA (no rookie season found): {len(unmatched)}")
    print(f"name present but debut precedes draft (collision, dropped): {len(collisions)}")
    if collisions:
        for c in collisions[:10]:
            print("   ", c)

    print("\nrows per draft class:")
    print(out.groupby("draft_class").size().to_string())
    print("\ndelayed debuts (played later than draft+1):")
    d = out[out["debut_lag"] > 0]
    print(f"  {len(d)} players; lag distribution: {d['debut_lag'].value_counts().sort_index().to_dict()}")
    print(d.nlargest(6, "debut_lag")[["name", "draft_class", "rookie_season", "debut_lag", "mpg"]].to_string(index=False))

    os.makedirs(os.path.dirname(TRAIN_TABLE), exist_ok=True)
    out.to_csv(TRAIN_TABLE, index=False)
    print(f"\nwrote {TRAIN_TABLE}  ({len(out)} rows)")


if __name__ == "__main__":
    main()
