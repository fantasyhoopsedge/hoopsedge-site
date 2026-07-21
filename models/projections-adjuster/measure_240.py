"""Does an independently-projected roster violate the 240-minute team budget?

This is the gate question. If independent per-player projections already sum to
~240.7 per team, a constrained allocator is unnecessary machinery and should be
skipped. Measure before building.

The constraint reduces cleanly: Sum_i (mpg_i * gp_i) / team_games is just total
team minutes / team_games, so we test "predict each player's season minutes
independently, sum per team, compare to the real budget."

Ground truth comes from hoopR player-box parquet (2011-2026), filtered to real
NBA franchises — hoopR files All-Star and Rising Stars games under
season_type == 2, and those exhibition squads show up as 50-65 minute "teams"
that would corrupt every team-level aggregate here.

Run: python models/projections-adjuster/measure_240.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import HOOPR_NBA_TEAMS, REGULAR_SEASON, SEASONS, ensure_parquet  # noqa: E402


def load_all() -> pd.DataFrame:
    frames = []
    for s in SEASONS:
        d = pd.read_parquet(
            ensure_parquet(s),
            columns=["season", "season_type", "game_id", "team_abbreviation",
                     "athlete_id", "athlete_display_name", "minutes"],
        )
        d = d[(d["season_type"] == REGULAR_SEASON) & d["minutes"].notna() & (d["minutes"] > 0)]
        d = d[d["team_abbreviation"].isin(HOOPR_NBA_TEAMS)]
        frames.append(d)
    return pd.concat(frames, ignore_index=True)


def main() -> None:
    allg = load_all()
    print(f"player-games (real NBA teams only): {len(allg)}")

    # player x team x season
    pts = allg.groupby(["season", "team_abbreviation", "athlete_id"]).agg(
        name=("athlete_display_name", "last"), mins=("minutes", "sum"), gp=("minutes", "size"),
    ).reset_index()
    tg = allg.groupby(["season", "team_abbreviation"])["game_id"].nunique().rename("team_games")
    pts = pts.merge(tg, on=["season", "team_abbreviation"])

    # player x season (all teams) — the basis for a prior-year independent projection
    psn = allg.groupby(["season", "athlete_id"]).agg(
        mins=("minutes", "sum"), gp=("minutes", "size")).reset_index()
    psn["mpg"] = psn["mins"] / psn["gp"]

    truth = pts.groupby(["season", "team_abbreviation"]).agg(
        actual=("mins", "sum"), team_games=("team_games", "first"), n=("athlete_id", "size")).reset_index()
    truth["actual_per_game"] = truth["actual"] / truth["team_games"]
    print("\n=== GROUND TRUTH (after excluding exhibitions) ===")
    print(f"  team-seasons: {len(truth)}  | codes: {pts['team_abbreviation'].nunique()}")
    print(f"  actual team minutes/game: mean {truth['actual_per_game'].mean():.2f} "
          f"median {truth['actual_per_game'].median():.2f} "
          f"min {truth['actual_per_game'].min():.1f} max {truth['actual_per_game'].max():.1f}")
    print(f"  roster size (players logging minutes): mean {truth['n'].mean():.1f} "
          f"min {truth['n'].min()} max {truth['n'].max()}")

    # --- the independent projection: each player's minutes = their PRIOR season minutes.
    # This is the naive per-player projection any uncoupled model produces. Rookies /
    # first-timers have no prior and are handled two ways below.
    prior = psn.copy()
    prior["season"] = prior["season"] + 1
    prior = prior.rename(columns={"mins": "prior_mins", "gp": "prior_gp", "mpg": "prior_mpg"})
    j = pts.merge(prior[["season", "athlete_id", "prior_mins", "prior_gp", "prior_mpg"]],
                  on=["season", "athlete_id"], how="left")
    j = j[j["season"] > SEASONS[0]]  # need a prior year

    j["has_prior"] = j["prior_mins"].notna()
    league_rookie_mins = j.loc[~j["has_prior"], "mins"].median()
    print(f"\n  players with no prior season (rookies/first-timers): "
          f"{int((~j['has_prior']).sum())} of {len(j)} "
          f"({100*(~j['has_prior']).mean():.1f}%) — median actual minutes {league_rookie_mins:.0f}")

    for label, fill in [("rookies -> 0 minutes", 0.0),
                        ("rookies -> league median rookie minutes", float(league_rookie_mins))]:
        j["proj"] = j["prior_mins"].fillna(fill)
        agg = j.groupby(["season", "team_abbreviation"]).agg(
            proj=("proj", "sum"), actual=("mins", "sum"), team_games=("team_games", "first")).reset_index()
        agg["proj_per_game"] = agg["proj"] / agg["team_games"]
        agg["actual_per_game"] = agg["actual"] / agg["team_games"]
        agg["err"] = agg["proj_per_game"] - agg["actual_per_game"]
        print(f"\n=== INDEPENDENT PROJECTION (persistence, {label}) ===")
        print(f"  projected team minutes/game: mean {agg['proj_per_game'].mean():.1f} "
              f"sd {agg['proj_per_game'].std():.1f} | "
              f"p10 {agg['proj_per_game'].quantile(.1):.0f} p90 {agg['proj_per_game'].quantile(.9):.0f}")
        print(f"  error vs actual: mean {agg['err'].mean():+.1f} | "
              f"median {agg['err'].median():+.1f} | MAE {agg['err'].abs().mean():.1f}")
        within = (agg["err"].abs() <= 10).mean()
        print(f"  team-seasons landing within +/-10 min of the budget: {100*within:.1f}%")
        print(f"  worst overshoot {agg['err'].max():+.0f} | worst undershoot {agg['err'].min():+.0f}")

    # --- give the independent approach its best shot: a FITTED per-player model.
    # Persistence is crude; a regularized model regresses to the mean and should be
    # better behaved. It still has no mechanism to make a team's minutes sum to
    # anything in particular — that is the whole question.
    from sklearn.ensemble import GradientBoostingRegressor

    exp = allg.groupby("athlete_id")["season"].min().rename("first_season")
    f = j.merge(exp, on="athlete_id")
    f["yos"] = f["season"] - f["first_season"]
    f["prior_mins"] = f["prior_mins"].fillna(0.0)
    f["prior_mpg"] = f["prior_mpg"].fillna(0.0)
    f["prior_gp"] = f["prior_gp"].fillna(0.0)
    f["has_prior"] = f["has_prior"].astype(int)
    feats = ["prior_mins", "prior_mpg", "prior_gp", "has_prior", "yos"]

    pred = np.full(len(f), np.nan)
    seasons = sorted(f["season"].unique())
    for s in seasons:
        te = (f["season"] == s).to_numpy()
        tr = ~te
        m = GradientBoostingRegressor(random_state=0)
        m.fit(f.loc[tr, feats].to_numpy(float), f.loc[tr, "mins"].to_numpy())
        pred[te] = m.predict(f.loc[te, feats].to_numpy(float)).clip(0, None)
    f["proj"] = pred

    agg = f.groupby(["season", "team_abbreviation"]).agg(
        proj=("proj", "sum"), actual=("mins", "sum"), team_games=("team_games", "first")).reset_index()
    agg["proj_per_game"] = agg["proj"] / agg["team_games"]
    agg["actual_per_game"] = agg["actual"] / agg["team_games"]
    agg["err"] = agg["proj_per_game"] - agg["actual_per_game"]
    print("\n=== INDEPENDENT PROJECTION (FITTED model, leave-one-season-out) ===")
    print(f"  per-player MAE: {np.mean(np.abs(f['mins'] - f['proj'])):.0f} minutes "
          f"(vs {np.mean(np.abs(f['mins'] - f['mins'].mean())):.0f} predicting the mean)")
    print(f"  projected team minutes/game: mean {agg['proj_per_game'].mean():.1f} "
          f"sd {agg['proj_per_game'].std():.1f} | "
          f"p10 {agg['proj_per_game'].quantile(.1):.0f} p90 {agg['proj_per_game'].quantile(.9):.0f}")
    print(f"  error vs actual: mean {agg['err'].mean():+.1f} | median {agg['err'].median():+.1f} "
          f"| MAE {agg['err'].abs().mean():.1f}")
    print(f"  team-seasons within +/-10 min of budget: {100*(agg['err'].abs() <= 10).mean():.1f}%")
    print(f"  worst overshoot {agg['err'].max():+.0f} | worst undershoot {agg['err'].min():+.0f}")

    print("\n=== DECISION ===")
    ok = (agg["err"].abs() <= 10).mean()
    print(f"  Rule: if independent projections land at 240 +/- 10, skip the allocator.")
    print(f"  Best independent model puts {100*ok:.1f}% of team-seasons inside +/-10.")
    print(f"  -> {'SKIP the allocator' if ok > 0.8 else 'BUILD the allocator — the constraint is violated'}")


if __name__ == "__main__":
    main()
