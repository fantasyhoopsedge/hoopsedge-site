"""Steps 1-3 of the team-category scoping: does rotation shape actually differ by
contending/mid-tier/developing, and how big is the effect -- checked against real
data, not assumed from n=2 (DET vs MEM).

STEP 1 -- team win/loss, from data already cached on disk. No new ingestion: hoopR's
team_box feed (tb_{season}.parquet, already cached 2011-2026 in
data/draft-model/parquet/ by build_foundation.py's ensure_team_box()) carries a literal
`team_winner` boolean per team-game. Wins/losses fall out of a single groupby.

STEP 2 -- classify each team-season by WIN-PCT RANK within its own season (not a fixed
win% cutoff): top 16 of 30 = contending (the real playoff cutoff), bottom 8 = developing
(realistic lottery-tank territory), middle 6 = mid-tier. Rank-based because a 44-win
team is a playoff team in a weak year and a lottery team in a stacked one -- the
category is about relative standing, not an absolute win total.

STEP 3 -- for each category, measure the three things the contending/developing
narrative actually claims: top-8 rotation's share of total team minutes, rotation
size (players with genuine run), and the starter-vs-bench games-played gap. If these
don't differ by category, the whole team-category mechanism isn't worth building.

Run: python models/projections-adjuster/measure_team_tiers.py
"""

from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import HOOPR_NBA_TEAMS, PARQUET_CACHE, REGULAR_SEASON, REPO  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "projections-adjuster"))
from minutes import load_panels  # noqa: E402

SEASONS = list(range(2011, 2027))
N_CONTENDING = 16   # real playoff-field size
N_DEVELOPING = 8    # realistic bottom-of-lottery count


def team_win_pct(season: int) -> pd.DataFrame:
    path = os.path.join(PARQUET_CACHE, f"tb_{season}.parquet")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path} -- run build_foundation.py to cache it first")
    t = pd.read_parquet(path, columns=["season", "season_type", "team_abbreviation", "team_winner"])
    t = t[(t["season_type"] == REGULAR_SEASON) & t["team_abbreviation"].isin(HOOPR_NBA_TEAMS)]
    g = t.groupby("team_abbreviation").agg(wins=("team_winner", "sum"), games=("team_winner", "size"))
    g["win_pct"] = g["wins"] / g["games"]
    g["season"] = season
    return g.reset_index().rename(columns={"team_abbreviation": "team"})


def classify(win_pct_df: pd.DataFrame) -> pd.DataFrame:
    """Rank-based category, computed WITHIN each season."""
    df = win_pct_df.copy()
    df["rank"] = df.groupby("season")["win_pct"].rank(ascending=False, method="first")
    n = df.groupby("season")["team"].transform("count")
    df["category"] = "mid-tier"
    df.loc[df["rank"] <= N_CONTENDING, "category"] = "contending"
    df.loc[df["rank"] > n - N_DEVELOPING, "category"] = "developing"
    return df


def main() -> None:
    print(f"Step 1 -- team win/loss from cached team_box, {SEASONS[0]}-{SEASONS[-1]}")
    wp = pd.concat([team_win_pct(s) for s in SEASONS], ignore_index=True)
    if wp.groupby("season")["team"].count().min() < 28:
        bad = wp.groupby("season")["team"].count()
        print("  !! some seasons have <28 teams (lockout/expansion-era gaps) -- fine, just noting:")
        print(bad[bad < 28].to_string())

    cat = classify(wp)
    print(f"\nStep 2 -- classified {len(cat)} team-seasons "
          f"(contending={ (cat['category']=='contending').sum() }, "
          f"mid-tier={ (cat['category']=='mid-tier').sum() }, "
          f"developing={ (cat['category']=='developing').sum() })")

    ps, _ = load_panels()
    ps = ps.merge(cat[["team", "season", "category"]], left_on=["primary_team", "season"],
                  right_on=["team", "season"], how="inner")

    def tier(mpg: float) -> str:
        if mpg >= 28:
            return "starter"
        if mpg >= 18:
            return "rotation"
        return "bench"
    ps["role"] = ps["mpg"].map(tier)

    print("\nStep 3 -- does rotation shape actually differ by category?\n")

    # (a) top-8-by-minutes share of total team minutes, per team-season, averaged by category
    def top8_share(g: pd.DataFrame) -> float:
        tot = g["min"].sum()
        return g.nlargest(8, "min")["min"].sum() / tot if tot > 0 else float("nan")
    shares = ps.groupby(["team", "season", "category"]).apply(top8_share, include_groups=False)
    print("(a) top-8 players' share of total team minutes:")
    print(shares.groupby("category").agg(["mean", "std"]).round(3))

    # (b) rotation size: players per team-season with >=15 mpg AND >=20 gp (a real rotation spot)
    rotation_spot = ps[(ps["mpg"] >= 15) & (ps["gp"] >= 20)]
    rot_size = rotation_spot.groupby(["team", "season", "category"]).size()
    print("\n(b) rotation size (players with >=15 mpg and >=20 gp):")
    print(rot_size.groupby("category").agg(["mean", "std"]).round(2))

    # (c) starter-vs-bench games-played gap
    avail_by_role = ps.groupby(["category", "role"])["availability"].mean().unstack()
    print("\n(c) mean availability (season GP / team games) by role and category:")
    print(avail_by_role.round(3))
    print("\n    starter-minus-bench GP gap, in games (availability x 82):")
    gap = (avail_by_role["starter"] - avail_by_role["bench"]) * 82
    print(gap.round(1))

    # (d) spread of GP across the whole roster -- the "flat vs tiered" shape claim directly
    gp_std = ps.groupby(["team", "season", "category"])["availability"].std()
    print("\n(d) within-roster std of availability (higher = more spread-out/tiered rotation):")
    print(gp_std.groupby("category").agg(["mean"]).round(3))


if __name__ == "__main__":
    main()
