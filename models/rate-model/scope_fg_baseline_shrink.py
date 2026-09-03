"""Scopes the moderate-deviation FG% correction the gate check in
measure_fg_volatility.py found: real, but only for MODERATE prior-season swings
away from a player's own trailing baseline (the extreme, >4pp buckets showed no
significant extra reversion once restricted to high volume, and flipped sign for
big drops -- more likely genuine skill change than noise, not something to correct).

Three things a correction needs before it can ship, same bar as YOUNG_FG_OFFSET in
rates.py:

  1. STABILITY across independent evidence, not one train/test split. rates.py's own
     backtest() (and the first pass in measure_fg_volatility.py) uses a single
     train<=2021/test>=2022 split. This walks FORWARD instead -- fit on every season
     strictly before the target, exactly the method the YOUNG_FG_OFFSET comment block
     describes -- and reports the moderate-band slope per era/split-half, so one lucky
     season or a handful of players can't be driving the whole effect.

  2. CONFOUND CHECK. A team change (trade/signing) or a real health dip can BOTH shift
     a shooting percentage without being "regression to the mean" at all -- and both
     are plausibly more common in extreme-deviation seasons, which could be exactly
     why the gate check found no extra reversion there. Split each bucket by
     confound-present vs clean to see whether "don't correct extremes" survives once
     confounds are held out, or whether it was really "don't correct CONFOUNDED
     extremes" and the moderate-band effect is confound-free to begin with.

  3. A SHIPPABLE COEFFICIENT fit on the CLEAN, moderate-band subsample only, with an
     uncertainty band on the slope -- not just "the sign was right."

This does not touch rates.py. It only proposes constants; wiring them in is a
separate, deliberate step once the numbers below are reviewed.

Run: python models/rate-model/scope_fg_baseline_shrink.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from age_curves import build, fit_curves  # noqa: E402
from measure_fg_volatility import (  # noqa: E402
    BUCKETS, MIN_BASELINE_FGA, MIN_LAG1_FGA, _baseline_fg,
)
from rates import (  # noqa: E402
    MIN_TEST_GP, WINDOW, _pairs, league_att_per_game, neutral_pos_means, project,
)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "projections-adjuster"))
from measure_availability import LOW as AVAIL_LOW  # noqa: E402

FIRST_TARGET = 2018   # earliest scored target -- leaves >=7 training seasons (2011-2017)
DEV_LO, DEV_HI = 0.02, 0.04   # the moderate band the gate check flagged, on |deviation|
MIN_FOLD_ROWS = 30


def team_changed(full: pd.DataFrame, d1_season: int) -> bool:
    """Did the player's primary team change INTO the deviation season (a trade or
    signing that season specifically, not merely at some earlier point in his
    career)? False (not flagged) if there's no adjacent season to compare."""
    d1 = full[full["season"] == d1_season]
    d0 = full[full["season"] == d1_season - 1]
    if not len(d1) or not len(d0):
        return False
    return bool(d1.iloc[0]["primary_team"] != d0.iloc[0]["primary_team"])


def health_dip(full: pd.DataFrame, d1_season: int) -> bool:
    """Was the deviation season itself a below-typical-health season for him
    specifically? LOW=0.65 is the exact 'notably below typical health' bar
    measure_availability.py already established and grid-searched -- reused here
    rather than picking a second threshold for the same concept."""
    d1 = full[full["season"] == d1_season]
    return bool(len(d1) and d1.iloc[0]["availability"] < AVAIL_LOW)


def walk_forward(d: pd.DataFrame) -> pd.DataFrame:
    """Fit on d[season < T] for every target season T in turn (expanding window,
    never sees T or later) and score T's qualifying rows. hist_by/h/lag1 mirror
    rates.py's own backtest() exactly; the only addition is the deviation tag and
    the two confound flags."""
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
            if row["fga"] < 1 or row["gp"] < MIN_TEST_GP:
                continue
            full = hist_by[aid]
            h = full[(full["season"] < T) & (full["season"] >= T - WINDOW)].copy()
            if not len(h):
                continue
            h["_lag"] = T - h["season"]
            lag1 = h[h["_lag"] == 1]
            if not len(lag1) or lag1.iloc[0]["fga"] < MIN_LAG1_FGA:
                continue
            lag1 = lag1.iloc[0]
            d1_season = T - 1
            base = _baseline_fg(full, d1_season)
            if base is None:
                continue
            baseline_fg, _ = base
            deviation = (lag1["fgm"] / lag1["fga"]) - baseline_fg

            pred = project(h, row["age"], pos, curves, pmeans, att_pg)["FG%"]
            actual = row["fgm"] / row["fga"]
            rows.append({
                "athlete_id": aid, "target_season": T, "d1_season": d1_season,
                "lag1_fga": lag1["fga"], "deviation": deviation,
                "predicted": pred, "actual": actual, "residual": actual - pred,
                "team_change": team_changed(full, d1_season),
                "health_dip": health_dip(full, d1_season),
            })
    return pd.DataFrame(rows)


def fold_stability(bt: pd.DataFrame) -> None:
    print("\n=== 1. FOLD STABILITY -- moderate-band slope, walk-forward per target season ===")
    band = bt[bt["deviation"].abs().between(DEV_LO, DEV_HI)]
    print(f"  moderate band |deviation| in [{DEV_LO},{DEV_HI}]: n={len(band)} across "
          f"{band['target_season'].nunique()} target seasons\n")
    print(f"  {'target':>6} {'n':>5} {'mean dev':>9} {'mean resid':>11}")
    for T, sub in band.groupby("target_season"):
        if len(sub) < MIN_FOLD_ROWS:
            print(f"  {T:>6} {len(sub):>5}   (n<{MIN_FOLD_ROWS}, skipped)")
            continue
        print(f"  {T:>6} {len(sub):>5} {sub['deviation'].mean():>+9.4f} "
              f"{sub['residual'].mean():>+11.4f}")

    print("\n  split-half (even vs odd target season -- independent of any single year):")
    even = band[band["target_season"] % 2 == 0]
    odd = band[band["target_season"] % 2 == 1]
    for name, sub in [("even seasons", even), ("odd seasons", odd)]:
        if len(sub) < 10:
            print(f"  {name:<14} too few rows")
            continue
        slope, intercept = np.polyfit(sub["deviation"], sub["residual"], 1)
        print(f"  {name:<14} n={len(sub):<5} slope={slope:+.3f} intercept={intercept:+.4f}")
    print("  (both halves the same sign and a similar magnitude => not one era's fluke.)")


def confound_check(bt: pd.DataFrame) -> pd.DataFrame:
    print("\n=== 2. CONFOUND CHECK -- team change / health dip, by deviation bucket ===")
    bt = bt.assign(confounded=bt["team_change"] | bt["health_dip"])
    print(f"  {'bucket':<22} {'n clean':>8} {'resid clean':>12} {'n conf.':>8} {'resid conf.':>12}")
    for lo, hi, name in BUCKETS:
        sub = bt[(bt["deviation"] > lo) & (bt["deviation"] <= hi)]
        clean = sub[~sub["confounded"]]
        conf = sub[sub["confounded"]]
        rc = clean["residual"].mean() if len(clean) else float("nan")
        rf = conf["residual"].mean() if len(conf) else float("nan")
        print(f"  {name:<22} {len(clean):>8} {rc:>+12.4f} {len(conf):>8} {rf:>+12.4f}")
    print("  (if 'clean' extreme buckets still show ~0 residual, extreme non-reversion is")
    print("   NOT just confound leakage -- it holds even for players with no flagged trade")
    print("   or health dip. If clean extremes DO revert and only confounded ones don't,")
    print("   the earlier 'don't correct extremes' finding was really about confounds.)")
    return bt


def ship_coefficient(bt: pd.DataFrame) -> None:
    print("\n=== 3. SHIP COEFFICIENT -- clean, moderate-band subsample only ===")
    clean_mod = bt[(~bt["confounded"]) & bt["deviation"].abs().between(DEV_LO, DEV_HI)]
    print(f"  n={len(clean_mod)}  (|deviation| in [{DEV_LO},{DEV_HI}], no team change, "
          f"no health dip in the deviation season)")
    if len(clean_mod) < 30:
        print("  too few rows to fit a coefficient -- widen the band or relax a filter.")
        return
    x, y = clean_mod["deviation"].to_numpy(), clean_mod["residual"].to_numpy()
    slope, intercept = np.polyfit(x, y, 1)
    resid_hat = intercept + slope * x
    ss_res = float(((y - resid_hat) ** 2).sum())
    n = len(clean_mod)
    se_slope = float(np.sqrt((ss_res / (n - 2)) / ((x - x.mean()) ** 2).sum()))
    t = slope / se_slope
    print(f"  residual ~= {intercept:+.4f} {slope:+.3f} x deviation   "
          f"(slope SE {se_slope:.3f}, t={t:+.2f})")
    print(f"\n  proposed correction: FG% += {-slope:.3f} x (baseline_fg - lag1_fg), applied only when")
    print(f"    * |lag1_fg - baseline_fg| is in [{DEV_LO}, {DEV_HI}]")
    print(f"    * lag1 FGA >= {MIN_LAG1_FGA}, baseline FGA >= {MIN_BASELINE_FGA}")
    print(f"    * no team change and no health dip (availability >= {AVAIL_LOW}) in the lag-1 season")
    print("  i.e. a SECOND shrink, toward the player's own trailing baseline, additive to")
    print("  the existing positional shrink -- same shape as YOUNG_FG_OFFSET, gated the")
    print("  same way, and explicitly NOT extended past the moderate band or through a")
    print("  confounded season, per the gate check and the confound split above.")


def main() -> None:
    d, _ = build()
    print(f"qualified player-seasons (gp>=30): {len(d)}")
    bt = walk_forward(d)
    print(f"walk-forward test rows (targets {FIRST_TARGET}-{int(d['season'].max())}): {len(bt)}")

    fold_stability(bt)
    bt = confound_check(bt)
    ship_coefficient(bt)


if __name__ == "__main__":
    main()
