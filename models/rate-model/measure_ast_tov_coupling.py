"""Stage 2 gate check: does the shipped model already capture the real AST-TOV
coupling (r=0.814 in the fantasy-correlation study Ash brought in, the single
strongest category relationship measured there), or does projecting them on fully
independent shrink/age paths leave a real, currently-unexploited pattern in the
model's own ERRORS?

THE ASYMMETRY UNDER TEST: rates.py shrinks AST with k=2 games (near-instant trust
of a player's own recent rate) and TOV with k=7 games (meaningfully more pulled
toward the positional mean). A player whose recent AST and TOV are BOTH genuinely
elevated -- real signal, the same ball-handling-load story behind the 0.814
correlation -- has that signal trusted almost immediately on AST but discounted
harder on TOV. If that asymmetry actually costs the model anything, it should show
up as a POSITIVE correlation between the model's own AST residual and its own TOV
residual: when the model under-shoots a player's AST (he ran more of the offense
than projected), does it ALSO tend to under-shoot his TOV, in a way the model isn't
using? If the two residual streams are close to independent, the per-player
recency-weighted history each projection is already built from is doing the job,
and the shared 0.814 signal is not being left on the table.

METHOD: same forward-chain walk-forward as scope_fg_baseline_shrink.py -- fit on
every season strictly before the target (never a single static split), score every
qualifying test row with the UNMODIFIED shipped model, then correlate the signed
AST residual against the signed TOV residual. Checked for fold stability (per
season, split-half) exactly like every other correction candidate in this thread,
because a correlation that only shows up in one lucky split is not evidence.

A second angle: does a genuine playmaking-role SPIKE in a player's most recent
season (his AST well above his own trailing baseline -- the same
deviation-from-baseline framing used for the FG% scope) predict the model's TOV
projection falling short specifically? AST is trusted almost instantly; if TOV
lags behind that same signal, a spike season should predict a positive TOV
residual in the following, projected season.

Run: python models/rate-model/measure_ast_tov_coupling.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from age_curves import build, fit_curves  # noqa: E402
from rates import (  # noqa: E402
    MIN_TEST_GP, WINDOW, _pairs, league_att_per_game, neutral_pos_means, project,
)

FIRST_TARGET = 2018
MIN_BASELINE_GP = 60          # games needed in the pre-prior seasons to trust an AST baseline
BASELINE_WINDOW = 5


def _baseline_ast(hist_full: pd.DataFrame, deviation_season: int) -> tuple[float, float] | None:
    """Games-weighted per-36 AST over seasons strictly before `deviation_season`,
    pooled over BASELINE_WINDOW years. None if under MIN_BASELINE_GP."""
    prior = hist_full[(hist_full["season"] < deviation_season)
                       & (hist_full["season"] >= deviation_season - BASELINE_WINDOW)]
    gp = prior["gp"].sum()
    if gp < MIN_BASELINE_GP:
        return None
    return float((prior["per36_ast"] * prior["gp"]).sum() / gp), float(gp)


def walk_forward(d: pd.DataFrame) -> pd.DataFrame:
    hist_by = {aid: g.sort_values("season") for aid, g in d.groupby("athlete_id")}
    last_season = int(d["season"].max())
    rows = []
    for T in range(FIRST_TARGET, last_season + 1):
        train = d[d["season"] < T]
        if train["season"].nunique() < 5:
            continue
        curves = fit_curves(train, _pairs(train))
        pmeans = neutral_pos_means(train, curves)
        att_pg = league_att_per_game(train)

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
            pred = project(h, row["age"], pos, curves, pmeans, att_pg)

            ast_resid = row["per36_ast"] - pred["AST"]
            tov_resid = row["per36_tov"] - pred["TOV"]

            lag1 = h[h["_lag"] == 1]
            deviation = None
            if len(lag1):
                base = _baseline_ast(full, T - 1)
                if base is not None:
                    deviation = float(lag1.iloc[0]["per36_ast"]) - base[0]

            rows.append({
                "athlete_id": aid, "season": T, "pos": pos,
                "ast_resid": ast_resid, "tov_resid": tov_resid,
                "ast_deviation": deviation,
            })
    return pd.DataFrame(rows)


def residual_correlation(bt: pd.DataFrame) -> None:
    print(f"\n=== 1. RESIDUAL CORRELATION -- model's own AST error vs TOV error (n={len(bt)}) ===")
    r = bt["ast_resid"].corr(bt["tov_resid"])
    slope, intercept = np.polyfit(bt["ast_resid"], bt["tov_resid"], 1)
    print(f"  corr(AST residual, TOV residual) = {r:+.3f}")
    print(f"  TOV resid ~= {intercept:+.4f} {slope:+.4f} x AST resid")
    print("  (positive => when the model under-shoots a player's AST, it tends to")
    print("   under-shoot his TOV too -- a real, currently-unused shared signal.")
    print("   near zero => the independent per-stat treatment is already fine.)")

    print("\n  per season:")
    print(f"  {'season':>6} {'n':>5} {'corr':>7}")
    for s, sub in bt.groupby("season"):
        if len(sub) < 30:
            print(f"  {s:>6} {len(sub):>5}   (n<30, skipped)")
            continue
        print(f"  {s:>6} {len(sub):>5} {sub['ast_resid'].corr(sub['tov_resid']):>+7.2f}")

    print("\n  split-half (even vs odd target season):")
    even = bt[bt["season"] % 2 == 0]
    odd = bt[bt["season"] % 2 == 1]
    for name, sub in [("even seasons", even), ("odd seasons", odd)]:
        rc = sub["ast_resid"].corr(sub["tov_resid"])
        sl, _ = np.polyfit(sub["ast_resid"], sub["tov_resid"], 1)
        print(f"  {name:<14} n={len(sub):<5} corr={rc:+.3f}  slope={sl:+.3f}")

    print("\n  split-half (pre-2022 vs 2022+, era check):")
    early = bt[bt["season"] < 2022]
    late = bt[bt["season"] >= 2022]
    for name, sub in [("<2022", early), (">=2022", late)]:
        rc = sub["ast_resid"].corr(sub["tov_resid"])
        sl, _ = np.polyfit(sub["ast_resid"], sub["tov_resid"], 1)
        print(f"  {name:<14} n={len(sub):<5} corr={rc:+.3f}  slope={sl:+.3f}")


def spike_check(bt: pd.DataFrame) -> None:
    d = bt.dropna(subset=["ast_deviation"])
    print(f"\n=== 2. PLAYMAKING-SPIKE CHECK -- does last season's AST jump predict this")
    print(f"       season's TOV residual? (n={len(d)}) ===")
    if len(d) < 30:
        print("  too few rows.")
        return
    r = d["ast_deviation"].corr(d["tov_resid"])
    slope, intercept = np.polyfit(d["ast_deviation"], d["tov_resid"], 1)
    print(f"  corr(prior-season AST spike, this-season TOV residual) = {r:+.3f}")
    print(f"  TOV resid ~= {intercept:+.4f} {slope:+.4f} x AST spike")
    buckets = [(-np.inf, -1.0, "big drop  (<-1.0)"), (-1.0, -0.3, "drop      (-1.0..-0.3)"),
               (-0.3, 0.3, "flat      (-0.3..+0.3)"), (0.3, 1.0, "rise      (+0.3..+1.0)"),
               (1.0, np.inf, "big rise  (>+1.0)")]
    print(f"\n  {'bucket':<22} {'n':>5} {'mean dev':>9} {'mean tov resid':>15}")
    for lo, hi, name in buckets:
        sub = d[(d["ast_deviation"] > lo) & (d["ast_deviation"] <= hi)]
        if not len(sub):
            continue
        print(f"  {name:<22} {len(sub):>5} {sub['ast_deviation'].mean():>+9.3f} "
              f"{sub['tov_resid'].mean():>+15.4f}")


def main() -> None:
    d, _ = build()
    print(f"qualified player-seasons (gp>=30): {len(d)}")
    bt = walk_forward(d)
    print(f"walk-forward test rows (targets {FIRST_TARGET}-{int(d['season'].max())}): {len(bt)}")

    residual_correlation(bt)
    spike_check(bt)


if __name__ == "__main__":
    main()
