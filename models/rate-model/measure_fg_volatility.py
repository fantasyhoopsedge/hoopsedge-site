"""Stage 2 gate check: does a season-level FG% swing away from a player's own
established baseline predict next-season reversion BEYOND what the shipped model
(rates.py: recency-weighted, ATTEMPTS-shrunk toward the positional mean, re-aged)
already predicts?

Prompted 2026-08-16 by two players: Derrick White .442->.394 and Tari Eason
.487->.416, both on FULL, high-attempt seasons (1,108 and 580 FGA respectively).
rates.py's only dampening mechanism for a shooting percentage is attempts-based
shrinkage (K_SHOOT_GAMES, converted to attempts) -- built to correct WITHIN-season
sampling noise (a guy who goes 8/20 shouldn't be trusted as a 40% shooter). It says
nothing about SEASON-TO-SEASON true-rate volatility: touch, health, shot quality
and role all move a player's real percentage from one full season to the next, even
at 1,000+ attempts -- and a bigger sample makes the attempts-shrink trust that
number MORE, not less, which is exactly backwards if the season itself was the
outlier.

METHOD, the same forward-chain discipline as YOUNG_FG_OFFSET in rates.py: fit
curves on train<=2021 only, project test seasons (>=2022) with the UNMODIFIED
shipped model, then bucket the SIGNED residual (actual - predicted) by how far the
player's OWN prior season already sat from his trailing baseline (his
attempts-weighted FG% over seasons strictly BEFORE that one -- never the season
being judged, never the season being predicted). If the shipped model already
accounts for this, the residual should be flat across buckets. If a big prior-
season DROP predicts a positive residual (actual came in higher than the model
expected -- more reversion happened than the model allowed for) and a big prior-
season RISE predicts a negative one, that is the gate signal for a career-baseline
shrink term to add alongside the existing positional one.

Also runs a HIGH-VOLUME-ONLY cut (lag-1 FGA >= HIGH_VOL_FGA) -- the specific claim
under test is that the effect survives even when the prior season had plenty of
attempts, which is exactly the case the attempts-shrink alone cannot fix.

--player NAME prints a single player's shot-mix history (FG% split into 2P%/3P%,
since a drop can come from shot selection, true efficiency, or both) plus what the
shipped model -- fit on ALL data, same as project_roster.py's real forward build --
projects for his next season.

Run: python models/rate-model/measure_fg_volatility.py
     python models/rate-model/measure_fg_volatility.py --player "Derrick White"
"""

from __future__ import annotations

import argparse
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from age_curves import build, fit_curves  # noqa: E402
from rates import (  # noqa: E402
    MIN_TEST_GP, WINDOW, _pairs, league_att_per_game, neutral_pos_means, project,
)

MIN_BASELINE_FGA = 300     # attempts needed in the pre-prior seasons to trust a baseline
BASELINE_WINDOW = 5        # seasons before the lag-1 season pooled for the baseline
MIN_LAG1_FGA = 50          # a token "last season" sample can't define a deviation
HIGH_VOL_FGA = 400         # lag-1 FGA cutoff for the "does volume mask it" cut
BUCKETS = [(-np.inf, -0.04, "big drop  (<-4pp)"),
           (-0.04, -0.02, "drop      (-4..-2pp)"),
           (-0.02, 0.02, "flat      (-2..+2pp)"),
           (0.02, 0.04, "rise      (+2..+4pp)"),
           (0.04, np.inf, "big rise  (>+4pp)")]


def _baseline_fg(hist_full: pd.DataFrame, deviation_season: int) -> tuple[float, float] | None:
    """Attempts-weighted FG% over seasons strictly before `deviation_season`, pooled
    over BASELINE_WINDOW years. None if under MIN_BASELINE_FGA (no trustworthy prior)."""
    prior = hist_full[(hist_full["season"] < deviation_season)
                       & (hist_full["season"] >= deviation_season - BASELINE_WINDOW)]
    fga = prior["fga"].sum()
    if fga < MIN_BASELINE_FGA:
        return None
    return float(prior["fgm"].sum() / fga), float(fga)


def backtest(d: pd.DataFrame, high_vol_only: bool = False) -> pd.DataFrame:
    """Forward-chain: fit on <=2021, score every qualifying test season (>=2022)
    with rates.py's own project(), exactly as rates.py's own backtest() does --
    the only addition is tagging each row with its lag-1 deviation from baseline."""
    train = d[d["season"] <= 2021]
    curves = fit_curves(train, _pairs(train))
    pmeans = neutral_pos_means(train, curves)
    att_pg = league_att_per_game(train)

    test = d[d["season"] >= 2022]
    hist_by = {aid: g.sort_values("season") for aid, g in d.groupby("athlete_id")}

    rows = []
    for _, row in test.iterrows():
        aid, S, pos = row["athlete_id"], row["season"], row["pos"]
        if row["fga"] < 1:
            continue
        full = hist_by[aid]
        h = full[(full["season"] < S) & (full["season"] >= S - WINDOW)].copy()
        if not len(h) or row["gp"] < MIN_TEST_GP:
            continue
        h["_lag"] = S - h["season"]
        lag1 = h[h["_lag"] == 1]
        if not len(lag1) or lag1.iloc[0]["fga"] < MIN_LAG1_FGA:
            continue
        lag1 = lag1.iloc[0]
        if high_vol_only and lag1["fga"] < HIGH_VOL_FGA:
            continue
        base = _baseline_fg(full, S - 1)   # baseline excludes the lag-1 season itself
        if base is None:
            continue
        baseline_fg, baseline_fga = base
        deviation = (lag1["fgm"] / lag1["fga"]) - baseline_fg

        pred = project(h, row["age"], pos, curves, pmeans, att_pg)["FG%"]
        actual = row["fgm"] / row["fga"]
        rows.append({
            "athlete_id": aid, "season": S, "pos": pos,
            "lag1_fga": lag1["fga"], "baseline_fga": baseline_fga,
            "deviation": deviation, "predicted": pred, "actual": actual,
            "residual": actual - pred,
        })
    return pd.DataFrame(rows)


def report(bt: pd.DataFrame, label: str) -> None:
    print(f"\n--- {label} (n={len(bt)}) ---")
    if len(bt) < 10:
        print("  (too few qualifying rows)")
        return
    r = bt["deviation"].corr(bt["residual"])
    slope, intercept = np.polyfit(bt["deviation"], bt["residual"], 1)
    print(f"  corr(prior-season deviation from baseline, model residual) = {r:+.3f}")
    print(f"  residual ~= {intercept:+.4f} {slope:+.3f} x deviation")
    print("  (slope < 0 => model under-corrects: a bigger prior-season drop leaves a")
    print("   bigger POSITIVE residual -- real FG% came back up more than the model")
    print("   allowed for; a bigger prior-season rise leaves a bigger NEGATIVE one.)")
    print(f"\n  {'bucket':<22} {'n':>5} {'mean dev':>9} {'mean resid':>11} {'resid SE':>9}")
    for lo, hi, name in BUCKETS:
        sub = bt[(bt["deviation"] > lo) & (bt["deviation"] <= hi)]
        if not len(sub):
            continue
        se = sub["residual"].std(ddof=1) / np.sqrt(len(sub)) if len(sub) > 1 else float("nan")
        print(f"  {name:<22} {len(sub):>5} {sub['deviation'].mean():>+9.4f} "
              f"{sub['residual'].mean():>+11.4f} {se:>9.4f}")


def player_case(d: pd.DataFrame, name: str) -> None:
    sub = d[d["athlete_display_name"] == name].sort_values("season")
    if not len(sub):
        print(f"\n(no match for {name!r})")
        return
    disp = sub.assign(
        fg2m=sub.fgm - sub.fg3m, fg2a=sub.fga - sub.fg3a,
        fg_pct=sub.fgm / sub.fga, fg3a_share=sub.fg3a / sub.fga,
    )
    disp["fg2_pct"] = disp.fg2m / disp.fg2a.replace(0, np.nan)
    disp["fg3_pct"] = sub.fg3m / sub.fg3a.replace(0, np.nan)
    print(f"\n=== {name} — season-by-season shot profile ===")
    print(disp[["season", "gp", "age", "fga", "fg3a_share", "fg_pct", "fg2_pct", "fg3_pct"]]
          .to_string(index=False, float_format=lambda x: f"{x:.3f}"))

    last_season = int(sub["season"].max())
    base = _baseline_fg(sub, last_season)   # baseline excludes the most recent season
    if base:
        baseline_fg, baseline_fga = base
        last_row = sub[sub["season"] == last_season].iloc[0]
        last_fg_pct = last_row["fgm"] / last_row["fga"]
        print(f"\n  trailing baseline FG% (seasons < {last_season}, {baseline_fga:.0f} FGA) "
              f"= {baseline_fg:.4f}")
        print(f"  most recent season ({last_season}) FG% = {last_fg_pct:.4f}  "
              f"deviation = {last_fg_pct - baseline_fg:+.4f}  on {last_row['fga']:.0f} FGA")
    else:
        print(f"\n  (not enough pre-{last_season} attempts for a trustworthy baseline)")

    # what the SHIPPED model actually projects next -- fit on ALL data, exactly like
    # project_roster.py's real forward build (never the train<=2021 split above).
    curves = fit_curves(d, _pairs(d))
    pmeans = neutral_pos_means(d, curves)
    att_pg = league_att_per_game(d)
    hist = sub[sub["season"] >= last_season - WINDOW + 1].copy()
    hist["_lag"] = last_season + 1 - hist["season"]
    target_age = float(sub[sub["season"] == last_season]["age"].iloc[0]) + 1
    pos = sub["pos"].iloc[-1]
    pred = project(hist, target_age, pos, curves, pmeans, att_pg)
    print(f"  shipped-model projection for {last_season + 1} FG% = {pred['FG%']:.4f}  "
          f"(age {target_age:.1f}, pos {pos})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", default=None, help="print one player's shot-mix case study")
    args = ap.parse_args()

    d, _ = build()
    print(f"qualified player-seasons (gp>=30): {len(d)}")

    report(backtest(d, high_vol_only=False), "ALL prior-season volumes")
    report(backtest(d, high_vol_only=True), f"HIGH VOLUME ONLY (lag-1 FGA >= {HIGH_VOL_FGA})")

    print("\n=== DECISION ===")
    print("  If the high-volume cut still shows a negative slope / a big-bucket residual")
    print("  asymmetry, the attempts-only shrink in rates.py is confirmed blind to season-")
    print("  to-season baseline deviation, and a second shrink term (toward the player's")
    print("  own trailing FG%, gated on |deviation| and lag-1 FGA) is worth adding -- same")
    print("  shape as YOUNG_FG_OFFSET: measured, signed, gated, not a blanket rule. If the")
    print("  slope flattens or flips sign in the high-volume cut, the effect is a small-")
    print("  sample artifact the attempts-shrink already handles and there is nothing to add.")

    if args.player:
        player_case(d, args.player)


if __name__ == "__main__":
    main()
