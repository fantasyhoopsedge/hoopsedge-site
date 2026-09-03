"""Scopes the fix the AST-TOV coupling gate check (measure_ast_tov_coupling.py)
earned: unlike every other correction candidate tested in this investigation, that
one survived walk-forward, split-half, and era checks with a stable +0.42 to +0.51
correlation every single season. This scopes an actual mechanism for it and
backtests whether it earns its place, same bar as everything else here.

THE MECHANISM: rates.py shrinks TOV toward a FLAT positional mean
(pmeans[pos]["TOV"]), the same target regardless of the player's own AST level.
That is exactly where the coupling gets lost -- AST is trusted almost immediately
(k=2 games) but TOV shrinks much harder (k=7), toward a target that knows nothing
about the player's own (already-trusted) AST estimate. This makes the TOV shrink
TARGET conditional on AST: instead of pmeans[pos]["TOV"], shrink toward
    pmeans[pos]["TOV"] + beta[pos] * (player's own neutral-shrunk AST - pmeans[pos]["AST"])
where beta[pos] is the real, measured TOV-per-AST slope within that position group
(age-neutralized, so it isn't confounded by a big man's AST/TOV both trending with
age the same way everyone's does). A player projected above his position's AST
mean gets a correspondingly higher TOV shrink target; below-average AST pulls the
TOV target down too. Everything else in rates.py (age curves, all other stats,
the attempts-based shooting shrink) is untouched.

VALIDATION, same forward-chain discipline as scope_fg_baseline_shrink.py: fit beta
per position on TRAIN data only inside each walk-forward fold (never sees the test
season), score every test row with both the shipped project() and this conditional
version, and compare TOV MAE/bias -- pooled, per season, split-half. Also re-checks
the AST-resid/TOV-resid correlation on the corrected projections: if the fix is
real, that +0.45 correlation should shrink toward zero, because the shared signal
it was flagging is now being used instead of left on the table.

Run: python models/rate-model/scope_ast_tov_shrink.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from age_curves import COUNTING, SHORT, STATS, build, fit_curves  # noqa: E402
from rates import (  # noqa: E402
    ATT_COL, K_GAMES, K_SHOOT_GAMES, MIN_TEST_GP, REC, WINDOW, YOUNG_FG_OFFSET,
    YOUNG_HIST_SEASONS, YOUNG_MAX_AGE, _pairs, clip_age, league_att_per_game, project,
)
import rates as rates_mod  # noqa: E402

FIRST_TARGET = 2018
MIN_BETA_GP = 30   # a player-season needs this many games to enter the beta fit


def neutralize(d: pd.DataFrame, curves: dict, stat_col: str, stat_key: str) -> pd.Series:
    out = pd.Series(index=d.index, dtype=float)
    for pos in ("G", "F", "C"):
        idx = d["pos"] == pos
        ages = d.loc[idx, "age"].map(clip_age)
        mult = ages.map(curves[pos][stat_key])
        out.loc[idx] = d.loc[idx, stat_col] / mult
    return out


def fit_beta(train: pd.DataFrame, curves: dict) -> dict[str, float]:
    """Weighted-by-games slope of neutral TOV on neutral AST, within position."""
    q = train[train["gp"] >= MIN_BETA_GP].copy()
    q["ast_n"] = neutralize(q, curves, "per36_ast", "AST")
    q["tov_n"] = neutralize(q, curves, "per36_tov", "TOV")
    betas = {}
    for pos in ("G", "F", "C"):
        sub = q[q["pos"] == pos]
        w = sub["gp"].to_numpy(float)
        x = sub["ast_n"].to_numpy(float)
        y = sub["tov_n"].to_numpy(float)
        xw = x - np.average(x, weights=w)
        yw = y - np.average(y, weights=w)
        betas[pos] = float(np.sum(w * xw * yw) / np.sum(w * xw * xw))
    return betas


def project_cond(hist: pd.DataFrame, target_age: float, pos: str, curves: dict,
                  pmeans: dict, att_pg: dict, betas: dict) -> dict:
    """rates.project(), with TOV's shrink target conditioned on the player's own
    neutral-shrunk AST instead of the flat positional mean. Everything else is
    byte-identical to rates.project()."""
    lag = hist["_lag"].to_numpy()
    w = np.array([REC.get(int(l), 0.0) for l in lag]) * hist["gp"].to_numpy()
    w = w / w.sum() if w.sum() > 0 else np.ones(len(hist)) / len(hist)
    G = hist["gp"].sum()
    ta = clip_age(target_age)
    out = {}
    ast_neutral_shrunk = None
    for s in STATS:
        sh = SHORT[s]
        ages = hist["age"].map(clip_age)
        if s in COUNTING:
            mult = np.array([curves[pos][sh][a] for a in ages])
            base = float(np.sum(w * (hist[s].to_numpy() / mult)))
            k = K_GAMES[sh]
            wt = G / (G + k)
            if sh == "TOV" and ast_neutral_shrunk is not None:
                target = pmeans[pos]["TOV"] + betas[pos] * (ast_neutral_shrunk - pmeans[pos]["AST"])
            else:
                target = pmeans[pos][sh]
            shrunk = wt * base + (1 - wt) * target
            if sh == "AST":
                ast_neutral_shrunk = shrunk
            out[sh] = shrunk * curves[pos][sh][ta]
        else:
            off = np.array([curves[pos][sh][a] for a in ages])
            base = float(np.sum(w * (hist[s].to_numpy() - off)))
            A = hist[ATT_COL[sh][1]].sum()
            k_att = K_SHOOT_GAMES[sh] * att_pg[sh]
            wt = A / (A + k_att)
            shrunk = wt * base + (1 - wt) * pmeans[pos][sh]
            out[sh] = shrunk + curves[pos][sh][ta]
    if len(hist) in YOUNG_HIST_SEASONS and target_age <= YOUNG_MAX_AGE:
        out["FG%"] += YOUNG_FG_OFFSET
    return out


def walk_forward(d: pd.DataFrame) -> pd.DataFrame:
    hist_by = {aid: g.sort_values("season") for aid, g in d.groupby("athlete_id")}
    last_season = int(d["season"].max())
    rows = []
    betas_by_season = {}
    for T in range(FIRST_TARGET, last_season + 1):
        train = d[d["season"] < T]
        if train["season"].nunique() < 5:
            continue
        curves = fit_curves(train, _pairs(train))
        pmeans = rates_mod.neutral_pos_means(train, curves)
        att_pg = league_att_per_game(train)
        betas = fit_beta(train, curves)
        betas_by_season[T] = betas

        test = d[d["season"] == T]
        for _, row in test.iterrows():
            aid, pos = row["athlete_id"], row["pos"]
            if row["gp"] < MIN_TEST_GP:
                continue
            full = hist_by[aid]
            h = full[(full["season"] < T) & (full["season"] >= T - WINDOW)].copy()
            if not len(h):
                continue
            h["_lag"] = T - h["season"]
            base_pred = project(h, row["age"], pos, curves, pmeans, att_pg)
            cond_pred = project_cond(h, row["age"], pos, curves, pmeans, att_pg, betas)

            actual_ast = row["per36_ast"]
            actual_tov = row["per36_tov"]
            rows.append({
                "athlete_id": aid, "season": T, "pos": pos,
                "actual_tov": actual_tov, "actual_ast": actual_ast,
                "base_tov": base_pred["TOV"], "cond_tov": cond_pred["TOV"],
                "base_ast_resid": actual_ast - base_pred["AST"],
                "base_tov_resid": actual_tov - base_pred["TOV"],
                "cond_tov_resid": actual_tov - cond_pred["TOV"],
            })
    print("\nbeta[pos] (TOV/36 change per AST/36, neutral scale) by target season:")
    for T, b in betas_by_season.items():
        print(f"  {T}: G={b['G']:+.3f}  F={b['F']:+.3f}  C={b['C']:+.3f}")
    return pd.DataFrame(rows)


def report(bt: pd.DataFrame) -> None:
    bt = bt.assign(base_ae=(bt["actual_tov"] - bt["base_tov"]).abs(),
                    cond_ae=(bt["actual_tov"] - bt["cond_tov"]).abs(),
                    base_err=bt["actual_tov"] - bt["base_tov"],
                    cond_err=bt["actual_tov"] - bt["cond_tov"])

    print(f"\n=== TOV accuracy, baseline vs AST-conditioned (n={len(bt)}) ===")
    print(f"  MAE   baseline={bt['base_ae'].mean():.4f}   conditioned={bt['cond_ae'].mean():.4f}"
          f"   (lower is better)")
    print(f"  bias  baseline={bt['base_err'].mean():+.4f}  conditioned={bt['cond_err'].mean():+.4f}"
          f"   (closer to 0 is better)")

    print(f"\n  residual correlation with AST error (should shrink toward 0 if this is real):")
    print(f"  corr(ast_resid, base_tov_resid) = {bt['base_ast_resid'].corr(bt['base_tov_resid']):+.3f}")
    print(f"  corr(ast_resid, cond_tov_resid) = {bt['base_ast_resid'].corr(bt['cond_tov_resid']):+.3f}")

    print(f"\n  per season -- MAE (base vs cond) and win margin:")
    print(f"  {'season':>6} {'n':>5} {'MAE base':>9} {'MAE cond':>9} {'delta':>8}")
    wins = 0
    for T, sub in bt.groupby("season"):
        mb, mc = sub["base_ae"].mean(), sub["cond_ae"].mean()
        wins += mc < mb
        print(f"  {T:>6} {len(sub):>5} {mb:>9.4f} {mc:>9.4f} {mc - mb:>+8.4f}")
    print(f"  conditioned version wins (lower MAE) in {wins}/{bt['season'].nunique()} seasons")

    print(f"\n  per position:")
    for pos, sub in bt.groupby("pos"):
        mb, mc = sub["base_ae"].mean(), sub["cond_ae"].mean()
        print(f"  {pos}: n={len(sub):<5} MAE base={mb:.4f}  cond={mc:.4f}  delta={mc - mb:+.4f}")


def main() -> None:
    d, _ = build()
    print(f"qualified player-seasons (gp>=30): {len(d)}")
    bt = walk_forward(d)
    print(f"walk-forward test rows: {len(bt)}")
    report(bt)


if __name__ == "__main__":
    main()
