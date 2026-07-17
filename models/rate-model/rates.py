"""Stage 2, part 2: the per-36 rate projection = recency baseline, shrunk to the
positional mean, re-aged. Composes with age_curves.py into the full rate model.

The projection factors a player's rate into SKILL and AGE and handles each in its
own space, then recombines:

  1. NEUTRALISE. Divide each past season's per-36 by its age multiplier (subtract
     the age offset, for FG%/FT%), expressing every season at peak-equivalent skill.
     Doing this per-season is what lets the age anchor cancel — no "baseline age" to
     track.
  2. BASELINE. Recency-weight the neutralised seasons, 60/30/10 by lag x games (the
     Stage 1 minutes weighting), into one peak-level skill estimate.
  3. SHRINK toward the neutralised POSITIONAL mean by games/(games+k). k is category-
     specific, measured in measure_rates.py: most per-36 counting rates are so
     reliable (k<=7 games) that a regular barely moves; STL (k~15) and the shooting
     percentages shrink hard, and EVERYONE shrinks when games are few — rookies and
     injury years, exactly where a raw rate lies most. FG%/FT% key on ATTEMPTS, not
     games (a 3-FGA guard's percentage is far noisier than a 20-FGA wing's at equal
     games), the volume-weighting the gate check called for and the V-score engine
     already applies.
  4. RE-AGE the shrunk skill to the projection season's age.

The backtest (main) is the point: it shows, per stat, whether shrinkage and the age
curve each beat the naive baselines, on held-out seasons the curves never saw. This
is where the age curve — marginal on a one-year horizon — is finally judged in the
company of everything else.

Run: python models/rate-model/rates.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from age_curves import (  # noqa: E402
    AGES, COUNTING, SHOOTING, SHORT, STATS, build, fit_curves,
)

# Within-position stabilization k, in GAMES, from measure_rates.py (the gate check).
# Shooting percentages are handled in ATTEMPTS below, so they are not here.
K_GAMES = {"PTS": 3, "REB": 3, "AST": 2, "STL": 15, "BLK": 6, "3PM": 3, "TOV": 7}
# Shooting k in games from the gate check; converted to attempts via league volume.
K_SHOOT_GAMES = {"FG%": 16, "FT%": 29}
ATT_COL = {"FG%": ("fgm", "fga"), "FT%": ("ftm", "fta")}
REC = {1: 0.6, 2: 0.3, 3: 0.1}   # recency weight by lag (seasons before target)
WINDOW = 3
MIN_TEST_GP = 25                 # a target season needs enough games to score against


def clip_age(a: float) -> int:
    return int(min(max(round(a), AGES[0]), AGES[-1]))


def neutral_pos_means(d: pd.DataFrame, curves: dict) -> dict:
    """Age-neutralised positional mean per stat = the peak-level prior to shrink to."""
    out = {}
    for P in ("G", "F", "C"):
        sub = d[d["pos"] == P]
        out[P] = {}
        for s in STATS:
            sh = SHORT[s]
            if s in COUNTING:
                mult = sub["age"].map(lambda a: curves[P][sh][clip_age(a)])
                out[P][sh] = float((sub[s] / mult).mean())
            else:
                off = sub["age"].map(lambda a: curves[P][sh][clip_age(a)])
                out[P][sh] = float((sub[s] - off).mean())
    return out


def league_att_per_game(d: pd.DataFrame) -> dict:
    return {sh: float(d[ATT_COL[sh][1]].sum() / d["gp"].sum()) for sh in K_SHOOT_GAMES}


def project(hist: pd.DataFrame, target_age: float, pos: str, curves: dict,
            pmeans: dict, att_pg: dict) -> dict:
    """Project per-36 rates for one player from his prior-season rows.

    hist: rows with season, age, gp, the per-36 + fg/ft columns, sorted so lag is
    computable by the caller (it passes only in-window seasons). Returns {SHORT: rate}.
    """
    lag = hist["_lag"].to_numpy()
    w = np.array([REC.get(int(l), 0.0) for l in lag]) * hist["gp"].to_numpy()
    w = w / w.sum() if w.sum() > 0 else np.ones(len(hist)) / len(hist)
    G = hist["gp"].sum()
    ta = clip_age(target_age)
    out = {}
    for s in STATS:
        sh = SHORT[s]
        ages = hist["age"].map(clip_age)
        if s in COUNTING:
            mult = np.array([curves[pos][sh][a] for a in ages])
            base = float(np.sum(w * (hist[s].to_numpy() / mult)))       # neutralised, weighted
            k = K_GAMES[sh]
            wt = G / (G + k)
            shrunk = wt * base + (1 - wt) * pmeans[pos][sh]
            out[sh] = shrunk * curves[pos][sh][ta]                       # re-age
        else:
            off = np.array([curves[pos][sh][a] for a in ages])
            base = float(np.sum(w * (hist[s].to_numpy() - off)))
            A = hist[ATT_COL[sh][1]].sum()                              # total attempts
            k_att = K_SHOOT_GAMES[sh] * att_pg[sh]
            wt = A / (A + k_att)
            shrunk = wt * base + (1 - wt) * pmeans[pos][sh]
            out[sh] = shrunk + curves[pos][sh][ta]
    return out


def backtest(d: pd.DataFrame) -> None:
    train = d[d["season"] <= 2021]
    curves = fit_curves(train, _pairs(train))
    pmeans = neutral_pos_means(train, curves)
    att_pg = league_att_per_game(train)
    raw_pm = {P: {SHORT[s]: float(train[train["pos"] == P][s].mean()) for s in STATS}
              for P in ("G", "F", "C")}

    test = d[d["season"] >= 2022].copy()
    hist_by = {aid: g.sort_values("season") for aid, g in d.groupby("athlete_id")}

    # Each method adds one component to the previous, so a column beating the one to
    # its left is that component earning its place: weighting, then shrinkage, then
    # the neutralise/re-age age machinery (full).
    methods = ["pos_mean", "last", "recency", "+shrink", "+age(full)"]
    ae = {m: {SHORT[s]: [] for s in STATS} for m in methods}
    n_scored = 0
    for _, row in test.iterrows():
        aid, S, pos = row["athlete_id"], row["season"], row["pos"]
        h = hist_by[aid]
        h = h[(h["season"] < S) & (h["season"] >= S - WINDOW)].copy()
        if not len(h) or row["gp"] < MIN_TEST_GP:
            continue
        h["_lag"] = S - h["season"]
        n_scored += 1
        full = project(h, row["age"], pos, curves, pmeans, att_pg)  # neutralise+shrink+re-age
        lagw = np.array([REC.get(int(l), 0.0) for l in h["_lag"]]) * h["gp"].to_numpy()
        lagw = lagw / lagw.sum()
        G = h["gp"].sum()
        last = h.sort_values("season").iloc[-1]
        for s in STATS:
            sh = SHORT[s]
            actual = row[s]
            recency_raw = float(np.sum(lagw * h[s].to_numpy()))         # weighted RAW, no shrink/age
            if s in COUNTING:
                wt = G / (G + K_GAMES[sh])
            else:
                A = h[ATT_COL[sh][1]].sum()
                wt = A / (A + K_SHOOT_GAMES[sh] * att_pg[sh])
            shrink_raw = wt * recency_raw + (1 - wt) * raw_pm[pos][sh]  # raw shrink, no age
            ae["pos_mean"][sh].append(abs(actual - raw_pm[pos][sh]))
            ae["last"][sh].append(abs(actual - last[s]))
            ae["recency"][sh].append(abs(actual - recency_raw))
            ae["+shrink"][sh].append(abs(actual - shrink_raw))
            ae["+age(full)"][sh].append(abs(actual - full[sh]))

    print(f"=== RATE BACKTEST — MAE by method (train<=2021, test>=2022, n={n_scored}) ===")
    print(f"  {'stat':<5} " + " ".join(f"{m:>11}" for m in methods))
    for s in STATS:
        sh = SHORT[s]
        cells = " ".join(f"{np.mean(ae[m][sh]):>11.4f}" for m in methods)
        print(f"  {sh:<5} {cells}")
    print("\n  overall mean of per-stat MAE (lower = better):")
    for m in methods:
        overall = np.mean([np.mean(ae[m][SHORT[s]]) for s in STATS])
        print(f"    {m:<12} {overall:.4f}")
    print("\n  (recency vs last = does weighting+neutralise beat last season; +shrink =")
    print("   does regression help; +age = does the curve add over shrink. pos_mean is")
    print("   the floor any real model must clear.)")


def _pairs(d: pd.DataFrame) -> pd.DataFrame:
    """Consecutive-season delta pairs (age_curves.fit_curves needs them)."""
    nxt = d[["athlete_id", "season"] + STATS].copy()
    nxt["season"] = nxt["season"] - 1
    nxt = nxt.rename(columns={s: s + "_n" for s in STATS})
    pair = d[["athlete_id", "season", "pos", "age_i"] + STATS].merge(
        nxt, on=["athlete_id", "season"], how="inner")
    for s in STATS:
        pair[s + "_delta"] = pair[s + "_n"] - pair[s]
        pair[s + "_dd"] = pair[s + "_delta"] - pair.groupby("season")[s + "_delta"].transform("mean")
    return pair


def main() -> None:
    d, _ = build()
    print(f"qualified player-seasons: {len(d)}\n")
    backtest(d)


if __name__ == "__main__":
    main()
