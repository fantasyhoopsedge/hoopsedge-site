"""Does an independently-projected roster's shot/usage volume match the team total?

This is the Stage 3 gate question, and it is the exact analogue of Stage 1's
measure_240.py — but for volume, not minutes. Minutes are zero-sum at 240/team-game
and Stage 1 already enforces that; the open question is whether SHOT VOLUME and the
other usage stats (FGA, FTA, 3PA, AST, TOV) are *also* team-conserved, and whether
projecting each player's rate in isolation then summing lands on the team total or
drifts off it — the "130 team FGA when they took 90" failure the plan warns about.

The test isolates the part Stage 3 owns from the part Stage 1 owns. Stage 1 already
fixes team MINUTES, so we hand the bottom-up projection each player's *actual* minutes
in the test season and let it err only on RATE. The question is then precise: even
knowing exactly who plays and for how long, does summing each man's own recency-
weighted per-36 rate reproduce the team's shot volume? If a departed high-usage
player's shots are not re-absorbed by whoever remains, the sum undershoots — and it
should undershoot *most on high-churn teams*, which is the signature of a real
redistribution problem rather than a global miscalibration. We measure that too.

Two competing predictors of team V/game in season t, scored by team-level MAE:
  bottom-up  Sum_i (player i's recency-weighted per-36 V-rate) * (actual min_i) / 36,
             per team game.  Rookies/first-timers with no history get the league
             median per-36 rate — the honest "we know nothing but that he is new".
  top-down   the team's OWN recency-weighted V/game from t-3..t-1 (60/30/10 x games),
             the anchor a redistribution engine would reconcile toward.

If the top-down anchor is materially more accurate than the bottom-up sum, the
constraint carries information the isolated projections cannot -> BUILD. If the sum
already matches the team total, a redistribution engine is machinery for nothing.

Reads the Stage 0 panels (output/foundation/*.parquet); run build_foundation.py
first. Run: python models/usage-redistribution/measure_usage.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO  # noqa: E402

FOUND = os.path.join(REPO, "output", "foundation")
# The usage stats. STL/BLK are deliberately absent: a departed rim protector's blocks
# are NOT re-absorbed by his team-mates the way his shot attempts are, so those two
# are not team-conserved and must never be redistributed. REB is arguable (rebound
# chances are opponent- and pace-driven, only loosely a team-personnel quantity), so
# it is measured but held separate from the shoot/pass/turnover usage core.
USAGE = ["fga", "fta", "fg3a", "ast", "tov"]
CONTEXT = ["reb"]
STATS = USAGE + CONTEXT
RECENCY = {1: 0.6, 2: 0.3, 3: 0.1}  # 60/30/10 by lag, x games — the model-wide weighting


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    pts = pd.read_parquet(os.path.join(FOUND, "player_team_seasons.parquet"))
    ts = pd.read_parquet(os.path.join(FOUND, "team_seasons.parquet"))
    return pts, ts


def team_truth(pts: pd.DataFrame, ts: pd.DataFrame) -> pd.DataFrame:
    """Actual team V/game per (team, season), summed from the player rows.

    Summing player raw totals is the only correct combine (a 3-game stint and a
    60-game season are not equal per-game observations), then divided by the team's
    real game count from Stage 0 — which already carries the lockout/COVID/Cup-era
    game counts, so V/game is honest across every season in the panel.
    """
    g = pts.groupby(["team", "season"], as_index=False)[STATS].sum()
    g = g.merge(ts[["team", "season", "team_games"]], on=["team", "season"], how="left")
    for s in STATS:
        g[f"{s}_pg"] = g[s] / g["team_games"]
    return g


def recency_team_anchor(truth: pd.DataFrame) -> pd.DataFrame:
    """Top-down prediction: a team's own V/game, recency-weighted over t-3..t-1.

    A franchise persists across seasons even as its roster churns — pace and shot
    profile are stickier than any individual — so the team's recent history is a real
    prior. Weight is 60/30/10 by recency times games played (a lockout/COVID short
    season should count for less), matching the rest of the model.
    """
    rows = []
    by_team = {t: g.set_index("season") for t, g in truth.groupby("team")}
    for team, g in by_team.items():
        for t in g.index:
            num = {s: 0.0 for s in STATS}
            wsum = 0.0
            for lag, base in RECENCY.items():
                if (t - lag) in g.index:
                    prev = g.loc[t - lag]
                    w = base * prev["team_games"]
                    wsum += w
                    for s in STATS:
                        num[s] += w * prev[f"{s}_pg"]
            if wsum > 0:
                rows.append({"team": team, "season": t,
                             **{f"anchor_{s}": num[s] / wsum for s in STATS}})
    return pd.DataFrame(rows)


def player_rate_priors(pts: pd.DataFrame) -> pd.DataFrame:
    """Each player's recency-weighted per-36 rate for each target season t.

    Uses the player's own seasons t-3..t-1 across ALL teams (rate is a personal skill
    that travels with him), weighted 60/30/10 by recency times games. This is the
    central tendency Stage 2 projects; the gate check needs only its aggregate
    behaviour, not the full shrink/age machinery, so per-36 recency-mean stands in.
    """
    # collapse traded seasons to one per (athlete, season): pool minutes and totals,
    # then re-derive the per-36 rate, so a mid-season trade is one weighted rate, not
    # two half-rows that would each carry a full recency weight.
    psn = pts.groupby(["athlete_id", "season"], as_index=False).agg(
        min=("min", "sum"), gp=("gp", "sum"), **{s: (s, "sum") for s in STATS})
    for s in STATS:
        psn[f"r_{s}"] = np.where(psn["min"] > 0, psn[s] / psn["min"] * 36, 0.0)

    idx = {(a, s): row for (a, s), row in
           zip(zip(psn["athlete_id"], psn["season"]), psn.itertuples(index=False))}
    cols = {s: psn.columns.get_loc(f"r_{s}") for s in STATS}
    gp_col = psn.columns.get_loc("gp")

    rows = []
    for a in psn["athlete_id"].unique():
        seasons = psn.loc[psn["athlete_id"] == a, "season"].tolist()
        for t in range(min(seasons) + 1, max(seasons) + 2):
            num = {s: 0.0 for s in STATS}
            wsum = 0.0
            for lag, base in RECENCY.items():
                key = (a, t - lag)
                if key in idx:
                    r = idx[key]
                    w = base * r[gp_col]
                    wsum += w
                    for s in STATS:
                        num[s] += w * r[cols[s]]
            if wsum > 0:
                rows.append({"athlete_id": a, "season": t,
                             **{f"pr_{s}": num[s] / wsum for s in STATS}})
    return pd.DataFrame(rows)


def main() -> None:
    pts, ts = load()
    truth = team_truth(pts, ts)
    anchor = recency_team_anchor(truth)
    priors = player_rate_priors(pts)

    # league-median per-36 rate, computed on PRIOR seasons only per target year, is the
    # honest rookie fill: "new player, we know only that he is new". Keyed by season so
    # a rookie in t is filled from the league as it was through t-1, never leaking t.
    seasons = sorted(truth["season"].unique())
    league_med = {}
    for t in seasons:
        past = pts[pts["season"] < t]
        if len(past):
            per36 = {s: (past[s] / past["min"] * 36).replace([np.inf, -np.inf], np.nan)
                     for s in STATS}
            league_med[t] = {s: float(np.nanmedian(per36[s].where(past["min"] > 100)))
                             for s in STATS}

    # bottom-up: each player who logged minutes for the team in t, at his own projected
    # rate x his ACTUAL minutes (Stage 1 owns minutes; here we isolate rate).
    j = pts.merge(priors, on=["athlete_id", "season"], how="left")
    j = j[j["season"] >= seasons[0] + 3]  # need a 3-year prior window to be a fair test
    j["is_rookie"] = j["pr_fga"].isna()
    for s in STATS:
        fill = j["season"].map(lambda t: league_med.get(t, {}).get(s, np.nan))
        j[f"pr_{s}"] = j[f"pr_{s}"].fillna(fill)
        j[f"bu_{s}"] = j[f"pr_{s}"] * j["min"] / 36.0  # projected season total for player

    bu = j.groupby(["team", "season"], as_index=False).agg(
        **{f"bu_{s}": (f"bu_{s}", "sum") for s in STATS},
        n=("athlete_id", "size"), rookie_min=("min", lambda m: m[j.loc[m.index, "is_rookie"]].sum()),
        team_min=("min", "sum"))
    bu = bu.merge(ts[["team", "season", "team_games"]], on=["team", "season"])
    for s in STATS:
        bu[f"bu_{s}_pg"] = bu[f"bu_{s}"] / bu["team_games"]

    # roster churn: fraction of the team's t-1 minutes NOT returning to it in t. This is
    # the variable the redistribution engine exists to handle -- vacated usage.
    prev_min = (pts.groupby(["team", "season", "athlete_id"])["min"].sum().reset_index())
    churn_rows = []
    for (team, t), grp in j.groupby(["team", "season"]):
        p = prev_min[(prev_min["team"] == team) & (prev_min["season"] == t - 1)]
        if not len(p):
            continue
        returning = set(grp["athlete_id"]) & set(p["athlete_id"])
        ret_min = p[p["athlete_id"].isin(returning)]["min"].sum()
        churn_rows.append({"team": team, "season": t,
                           "churn": 1.0 - ret_min / p["min"].sum()})
    churn = pd.DataFrame(churn_rows)

    ev = truth.merge(anchor, on=["team", "season"]).merge(bu, on=["team", "season"]).merge(
        churn, on=["team", "season"], how="left")
    ev = ev[ev["season"] >= seasons[0] + 3]

    print(f"Stage 3 gate check -- usage redistribution")
    print(f"  test team-seasons: {len(ev)} ({ev['season'].min()}-{ev['season'].max()}), "
          f"each with a full 3-year prior window")
    print(f"  rookie share of team minutes: mean {(ev['rookie_min']/ev['team_min']).mean():.1%} "
          f"max {(ev['rookie_min']/ev['team_min']).max():.1%}")

    print(f"\n{'stat':>5} | {'actual/g':>8} | {'bottom-up sum':>22} | {'team anchor':>18} | winner")
    print(f"{'':>5} | {'mean':>8} | {'MAE':>6} {'bias':>7} {'p90|err|':>7} | {'MAE':>6} {'bias':>7} |")
    print("  " + "-" * 78)
    decisions = {}
    for s in STATS:
        a = ev[f"{s}_pg"]
        bu_err = ev[f"bu_{s}_pg"] - a
        an_err = ev[f"anchor_{s}"] - a
        bu_mae, an_mae = bu_err.abs().mean(), an_err.abs().mean()
        win = "ANCHOR" if an_mae < bu_mae - 1e-9 else "bottom-up"
        decisions[s] = (bu_mae, an_mae, win)
        tag = "" if s in USAGE else "  (context)"
        print(f"{s:>5} | {a.mean():8.1f} | {bu_mae:6.2f} {bu_err.mean():+7.2f} "
              f"{bu_err.abs().quantile(.9):7.2f} | {an_mae:6.2f} {an_err.mean():+7.2f} | {win}{tag}")

    # the signature test: does the bottom-up error grow with roster churn? A global
    # miscalibration would be flat across churn; a redistribution problem would not.
    print(f"\n  bottom-up FGA/game error by roster-churn quartile "
          f"(fraction of prior-year minutes that left):")
    cq = ev.dropna(subset=["churn"]).copy()
    cq["q"] = pd.qcut(cq["churn"], 4, labels=["Q1 low", "Q2", "Q3", "Q4 high"])
    for q, grp in cq.groupby("q", observed=True):
        e = grp["bu_fga_pg"] - grp["fga_pg"]
        print(f"    {q:>8} churn {grp['churn'].mean():.0%}: "
              f"FGA/g MAE {e.abs().mean():5.2f}  bias {e.mean():+5.2f}  (n={len(grp)})")

    # the plan's nightmare, quantified: how often is the isolated sum absurd?
    big = (ev["bu_fga_pg"] - ev["fga_pg"]).abs()
    print(f"\n  bottom-up team FGA/game off by >10: {int((big > 10).sum())} team-seasons "
          f"({(big > 10).mean():.1%}); worst { (ev['bu_fga_pg']-ev['fga_pg']).abs().max():.1f}")

    print(f"\n=== DECISION ===")
    print(f"  Rule: BUILD if the team anchor beats the bottom-up sum on the usage core")
    print(f"  (FGA/FTA/3PA/AST/TOV) -- that means team totals carry information the")
    print(f"  isolated per-player projections structurally cannot reconstruct.")
    core_anchor_wins = sum(decisions[s][2] == "ANCHOR" for s in USAGE)
    for s in USAGE:
        bu_mae, an_mae, win = decisions[s]
        gain = (bu_mae - an_mae) / bu_mae
        print(f"    {s:>5}: anchor {'beats' if win=='ANCHOR' else 'LOSES to'} bottom-up "
              f"by {gain:+.0%} MAE")
    verdict = "BUILD the redistribution engine" if core_anchor_wins >= 3 else \
              "SKIP -- isolated projections already match team totals"
    print(f"  -> {core_anchor_wins}/{len(USAGE)} usage stats favour the anchor  =>  {verdict}")


if __name__ == "__main__":
    main()
