"""Gate check: does a role-context USAGE multiplier (the player-level analogue of Stage
3's team-level anchor) earn its place, and if so at roughly what magnitude?

Stage 3 (redistribute.py) reconciles team-total volume by scaling every player's bottom-up
sum by ONE team-level factor, proportional to his existing share. The CHA/LaMelo on-off
split that motivated this script showed that is not what actually happens at the player
level: when a high-usage player leaves the floor, the vacated shot/pass/turnover volume
does not spread evenly across the roster -- it concentrates on the teammates who already
shared his shot-creation role (Miller, Knueppel), while low-usage bigs barely move. This
asks whether that pattern replicates across real, full-season roster changes (not just an
on/off split within one season), and whether it is predictable enough to justify a second,
role-context-driven multiplier on top of Stage 1's minutes-only tier.

No hand-labeled role-context history exists for past seasons (the CSV only covers 2026-27),
so this cannot replay Ash's own tags retroactively. It asks the more basic question a tier
multiplier has to answer regardless of *why* a role changed: when a team's clear lead
offensive player stops appearing for that team, or reappears after missing a season, how
much does the raw per-36 usage (FGA/FTA/AST/TOV/3PM) of the players who stay actually move
-- and is "usage stays flat" beaten by sizing the shift to (a) the teammate's own prior
usage level?

  VACATED    season s: player X is a "star" on team T (gp>=40, mpg>=28 -- the same
             "starter" threshold measure_availability.py's mpg_tier() already uses).
             season s+1: X is not on team T with meaningful minutes (gp<15) -- traded,
             waived, retired, or hurt; the mechanism doesn't matter, the team-level
             effect (his usage is gone) is the same. Calibrates the UP side: won_job /
             expanded.

  RECLAIMED  the mirror, chained off the same event: X has ~no games for T at s+1 (hurt,
             not traded -- he comes BACK), then returns to T at s+2 with gp>=40 and
             mpg>=18 (a real return, not a token game). Compares teammate usage at s+1
             (inflated, X absent) -> s+2 (X back). Calibrates the DOWN side: reduced /
             clear_backup. This is the exact Kyrie/Haliburton-return shape.

Each event contributes one row per surviving/returning teammate (team T, gp>=20 in both
compared seasons, star excluded). Teammates are bucketed by their OWN per-36 usage proxy
in the "before" season (global quartiles within each event type, not per-team rank --
per-team samples are too thin to rank reliably) to test whether the shift concentrates on
already-high-usage teammates, matching what the CHA split showed.

Decision rule: BUILD the multiplier if a bucket-and-vacancy-aware prediction beats a flat
"no change" baseline on held-out seasons; the per-bucket mean relative delta on the train
split is then the empirical starting point for USG_TIERS (replacing any hand-guessed
table) -- same role a backtest.py plays for every other stage's constant.

Reads output/foundation/player_team_seasons.parquet; run build_foundation.py first.
Run: python models/usage-redistribution/measure_usage_tiers.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO  # noqa: E402

FOUND = os.path.join(REPO, "output", "foundation")
USAGE = ["fga", "fta", "fg3m", "ast", "tov"]

STAR_GP, STAR_MPG = 40, 28.0          # "starter" bucket, matching measure_availability.py
RETURN_GP, RETURN_MPG = 40, 18.0      # a real return, allowing a lighter reintegration mpg
ABSENT_GP = 15                        # below this = "not meaningfully on this team"
TEAMMATE_MIN_GP = 20                  # both sides, or the delta is noise
TRAIN_MAX_SEASON = 2021               # matches rates.py's own train<=2021/test>=2022 split


def load() -> pd.DataFrame:
    d = pd.read_parquet(os.path.join(FOUND, "player_team_seasons.parquet"))
    d["usg_proxy"] = d["per36_fga"] + 0.44 * d["per36_fta"] + d["per36_tov"]
    return d


def find_events(d: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    by_at: dict[tuple[float, str], dict[int, "pd.Series"]] = {}
    for r in d.itertuples(index=False):
        by_at.setdefault((r.athlete_id, r.team), {})[int(r.season)] = r

    vacated, reclaimed = [], []
    for (aid, team), seasons in by_at.items():
        for s, row in seasons.items():
            if not (row.gp >= STAR_GP and row.mpg >= STAR_MPG):
                continue
            nxt = seasons.get(s + 1)
            nxt_gp = nxt.gp if nxt is not None else 0
            if nxt_gp >= ABSENT_GP:
                continue  # he was still meaningfully on this team next season
            vacated.append({"athlete_id": aid, "team": team, "before": s, "after": s + 1,
                             "star_usg": row.usg_proxy, "star_name": row.athlete_display_name})
            ret = seasons.get(s + 2)
            if ret is not None and ret.gp >= RETURN_GP and ret.mpg >= RETURN_MPG:
                reclaimed.append({"athlete_id": aid, "team": team, "before": s + 1, "after": s + 2,
                                   "star_usg": row.usg_proxy, "star_name": row.athlete_display_name})
    return vacated, reclaimed


def teammate_rows(d: pd.DataFrame, events: list[dict], event_type: str) -> pd.DataFrame:
    frames = []
    for ev in events:
        b = d[(d["team"] == ev["team"]) & (d["season"] == ev["before"])
              & (d["athlete_id"] != ev["athlete_id"]) & (d["gp"] >= TEAMMATE_MIN_GP)]
        a = d[(d["team"] == ev["team"]) & (d["season"] == ev["after"])
              & (d["athlete_id"] != ev["athlete_id"]) & (d["gp"] >= TEAMMATE_MIN_GP)]
        cols = ["athlete_id", "athlete_display_name", "usg_proxy"] + [f"per36_{s}" for s in USAGE]
        m = b[cols].merge(a[cols], on="athlete_id", suffixes=("_b", "_a"))
        if not len(m):
            continue
        m["team"] = ev["team"]
        m["before_season"] = ev["before"]
        m["after_season"] = ev["after"]
        m["star_name"] = ev["star_name"]
        m["star_usg"] = ev["star_usg"]
        frames.append(m)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    out["event_type"] = event_type
    for s in USAGE:
        out[f"d_{s}"] = out[f"per36_{s}_a"] - out[f"per36_{s}_b"]
        out[f"rd_{s}"] = out[f"d_{s}"] / out[f"per36_{s}_b"].clip(lower=1.0)
    return out


def quartile_bucket(s: pd.Series) -> pd.Series:
    return pd.qcut(s, 4, labels=["Q1 low", "Q2", "Q3", "Q4 high"], duplicates="drop")


def evaluate(rows: pd.DataFrame, label: str) -> None:
    print(f"\n=== {label} — {len(rows)} teammate-observations across "
          f"{rows[['team', 'before_season']].drop_duplicates().shape[0]} events, "
          f"seasons {rows['before_season'].min()}-{rows['before_season'].max()} ===")
    if len(rows) < 20:
        print("  too few observations to fit anything — reporting raw stats only.")

    rows = rows.copy()
    # NEW PREDICTOR: bucket by VACANCY SIZE (the departing star's own usage), not the
    # teammate's own prior usage. The question is whether a bigger hole -> bigger teammate
    # gains, which is the physically motivated model (more vacated team volume to absorb).
    rows["bucket"] = quartile_bucket(rows["star_usg"])
    edges = rows.groupby("bucket", observed=True)["star_usg"].agg(["min", "max"])
    print(f"\n  vacancy-size (departing star's usg_proxy per-36) quartile edges:")
    for q in ["Q1 low", "Q2", "Q3", "Q4 high"]:
        if q in edges.index:
            print(f"    {q:>8}: {edges.loc[q, 'min']:.1f} – {edges.loc[q, 'max']:.1f}")

    print(f"\n  ABSOLUTE (per-36) teammate delta by VACANCY-SIZE bucket:")
    print(f"  {'stat':>5} | {'all: mean d':>12} | " +
          " | ".join(f"{q:>9}" for q in ["Q1 low", "Q2", "Q3", "Q4 high"]))
    for s in USAGE:
        overall = rows[f"d_{s}"].mean()
        by_q = rows.groupby("bucket", observed=True)[f"d_{s}"].mean()
        cells = " | ".join(f"{by_q.get(q, float('nan')):>+9.2f}" for q in ["Q1 low", "Q2", "Q3", "Q4 high"])
        print(f"  {s:>5} | {overall:>+11.2f}  | {cells}")

    # held-out check with THREE nested predictors, so we separate two distinct questions:
    #   zero      predict no change at all       -> today's model (no role-context usage bump)
    #   const     predict the train GLOBAL mean delta, same for everyone
    #             -> a FLAT, un-scaled role-context bump (option 2 from the discussion)
    #   linear    predict a + b*star_usg (OLS on train) -> the bump SCALED by vacancy size
    # const-beats-zero  => a usage bump earns its place at all.
    # linear-beats-const => vacancy size carries information beyond a flat bump (i.e. the
    #                       multiplier should scale with how big the departing role was).
    train = rows[rows["before_season"] <= TRAIN_MAX_SEASON]
    test = rows[rows["before_season"] > TRAIN_MAX_SEASON]
    if len(train) < 15 or len(test) < 15:
        print(f"\n  (train={len(train)}, test={len(test)} — too few for a held-out split; "
              f"skipping the beat-the-baseline check for this event type)")
        return

    print(f"\n  held-out MAE (per-36) — train<={TRAIN_MAX_SEASON} n={len(train)}, "
          f"test>{TRAIN_MAX_SEASON} n={len(test)}:")
    print(f"  {'stat':>5} | {'zero':>7} | {'const':>7} | {'linear':>7} | "
          f"{'const>zero':>10} | {'lin>const':>9} | slope(per +1 usg)")
    const_wins = lin_wins = 0
    for s in USAGE:
        actual = test[f"d_{s}"].to_numpy()
        zero_mae = np.abs(actual).mean()
        const_pred = train[f"d_{s}"].mean()
        const_mae = np.abs(actual - const_pred).mean()
        m, b = np.polyfit(train["star_usg"], train[f"d_{s}"], 1)
        lin_pred = m * test["star_usg"].to_numpy() + b
        lin_mae = np.abs(actual - lin_pred).mean()
        cw, lw = const_mae < zero_mae, lin_mae < const_mae
        const_wins += cw; lin_wins += lw
        print(f"  {s:>5} | {zero_mae:>7.3f} | {const_mae:>7.3f} | {lin_mae:>7.3f} | "
              f"{'YES' if cw else 'no':>10} | {'YES' if lw else 'no':>9} | {m:>+.4f}")
    print(f"  -> const beats zero on {const_wins}/{len(USAGE)} (does ANY bump help), "
          f"linear beats const on {lin_wins}/{len(USAGE)} (does vacancy SIZE help)")


def main() -> None:
    d = load()
    vacated, reclaimed = find_events(d)
    print(f"found {len(vacated)} VACATED events, {len(reclaimed)} RECLAIMED events "
          f"(seasons {d['season'].min()}-{d['season'].max()})")

    vac_rows = teammate_rows(d, vacated, "vacated")
    rec_rows = teammate_rows(d, reclaimed, "reclaimed")

    if len(vac_rows):
        evaluate(vac_rows, "VACATED (usage should EXPAND for surviving teammates)")
    if len(rec_rows):
        evaluate(rec_rows, "RECLAIMED (usage should COMPRESS for surviving teammates)")

    print("\n=== a few named examples, for a sanity check against the CHA/DAL/IND reasoning ===")
    for label, rows in (("VACATED", vac_rows), ("RECLAIMED", rec_rows)):
        if not len(rows):
            continue
        sample = rows.sort_values("star_usg", ascending=False).head(5)
        for _, r in sample.iterrows():
            print(f"  [{label}] {r['star_name']} ({r['team']} {r['before_season']}->{r['after_season']}): "
                  f"{r['athlete_display_name_b']} FGA/36 {r['per36_fga_b']:.1f}->{r['per36_fga_a']:.1f} "
                  f"({r['rd_fga']:+.0%})")


if __name__ == "__main__":
    main()
