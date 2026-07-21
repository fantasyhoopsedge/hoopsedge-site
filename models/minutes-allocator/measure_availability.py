"""Does Stage 1's availability prior need the same treatment Stage 1 already gave MPG?

measure_240.py asked whether the team-budget allocator is optional (no). This asks a
parallel question about `build_priors()`'s availability estimate: a plain 3-year
recency-weighted mean, with none of the "protect the extremes" reasoning ALPHA=1.0
already applies on the MPG side (see minutes.py's allocate() docstring).

THE SHRINKAGE, QUANTIFIED. Backtesting build_priors() against seasons it never saw
(2013-2026, walking one target season at a time, using only strictly-prior data --
exactly what a live run does) shows a real, not imagined, defect: split predictions
into quintiles, and the bottom quintile (predicted ~0.21 availability) actually
averages ~0.36, while the top quintile (predicted ~0.91) actually averages only
~0.73. Every extreme gets pulled toward the middle in reality more than a plain
recency-weighted mean assumes. Correlation is only ~0.50 -- durability is
genuinely hard to predict from 3 years of history, and that part is real, not a
bug -- but the estimator is compressing the distribution beyond what even that
weak signal justifies.

THE REFINEMENT ASH PROPOSED, AND WHY IT'S RIGHT. A single bad season and a
chronic pattern are not the same evidence. Embiid (2024 .48, 2025 .23, 2026 .46)
and Kawhi (repeated dips across a decade) are one story; Ty Jerome having ONE
rough season sandwiched between two good ones is a different one -- and the
current 3-year recency window cannot tell them apart, because Embiid's last
THREE seasons and a player's first-ever bad season both just look like "low
recent average" to a recency-weighted mean. Splitting the historical panel by
chronicity (a full-career lookback, not the 3-year window) proves the two
populations really do behave differently going forward:

    acute (this is the only/first dip on record):    next season avg 0.638, 55% revert to healthy
    chronic (2+ low seasons already on record):       next season avg 0.517, 39% revert to healthy

That is exactly the asymmetry Ash described: a first-time dip mostly reverts: a
repeated one mostly doesn't. The correction below leans acute dips back toward a
ROLE-TYPICAL baseline (not the player's own history, and not the population mean --
what a player at that MPG tier typically plays league-wide: starters .81 avail
median .88, rotation .74/.80, bench .41/.39) and leaves chronic cases alone.

Run: python models/minutes-allocator/measure_availability.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from minutes import build_priors, load_panels  # noqa: E402

LOW = 0.65  # "notably below typical health" -- see docstring; grid-searched below
TARGET_SEASONS = list(range(2018, 2027))  # 9 held-out seasons, each using only prior data


def mpg_tier(mpg: float) -> str:
    """4 buckets, not 3 -- collapsing reserve/fringe into one "bench" bucket erased a
    real, large gap: league-wide median games are starter 72, rotation 66 (these two
    barely differ -- a rotation player plays in almost as many games as a starter, just
    fewer minutes when he does), reserve 42, fringe 11 (these two are worlds apart).
    Ash caught this directly: "fringe players will hardly play games... rotation
    players likely play as many games as starters." The data agrees exactly."""
    if mpg >= 28:
        return "starter"
    if mpg >= 18:
        return "rotation"
    if mpg >= 8:
        return "reserve"
    return "fringe"


def role_typical_table(ps: pd.DataFrame) -> pd.Series:
    """Median availability by MPG tier, league-wide, ALL seasons -- the 'typical
    distribution for a starter/rotation/reserve/fringe player' Ash asked the model
    to assume."""
    return ps.assign(tier=ps["mpg"].map(mpg_tier)).groupby("tier")["availability"].median()


def chronicity(ps: pd.DataFrame, target: int, low: float = LOW) -> pd.DataFrame:
    """Per athlete, full-career (not 3yr) count of low-availability seasons strictly
    before `target`. This is deliberately NOT the 3-year recency window -- chronicity
    is a career-length question, distinguishing Embiid/Kawhi from a first-time dip
    requires seeing further back than recency-weighting does."""
    hist = ps[ps["season"] < target]
    return hist.groupby("athlete_id").agg(
        n_low_hist=("availability", lambda s: int((s < low).sum())),
        n_seasons_hist=("availability", "size"),
    ).reset_index()


def corrected_estimate(base: pd.DataFrame, chron: pd.DataFrame, role: pd.Series,
                        w_acute: float, low: float = LOW) -> pd.DataFrame:
    """base: build_priors() output (athlete_id, base_mpg, availability = the CURRENT
    recency-weighted estimate). Blends acute dips toward the role-typical baseline at
    w_acute (0 = fully role-typical, 1 = unchanged/current-method); chronic dips and
    non-dips pass through untouched."""
    d = base.merge(chron, on="athlete_id", how="left")
    d["n_low_hist"] = d["n_low_hist"].fillna(0)
    d["role_typ"] = d["base_mpg"].map(mpg_tier).map(role)

    is_dip = d["availability"] < low
    is_acute = is_dip & (d["n_low_hist"] <= 1)
    # Only pull UP: an acute dip below its role-typical level leans toward that
    # level; one already at/above it, or a chronic case, is untouched.
    below_typical = d["availability"] < d["role_typ"]
    apply_pull = is_acute & below_typical
    d["corrected"] = np.where(
        apply_pull, w_acute * d["availability"] + (1 - w_acute) * d["role_typ"], d["availability"]
    )
    return d


def evaluate(pred_col: str, d: pd.DataFrame) -> dict:
    d = d.dropna(subset=[pred_col, "actual_avail"])
    slope = np.polyfit(d[pred_col], d["actual_avail"], 1)[0]
    mae = (d[pred_col] - d["actual_avail"]).abs().mean()
    corr = d[pred_col].corr(d["actual_avail"])
    return {"n": len(d), "corr": corr, "slope": slope, "mae": mae}


def main() -> None:
    ps, _ = load_panels()
    role = role_typical_table(ps)
    print("role-typical median availability:", role.to_dict())
    print()

    grid = [0.0, 0.25, 0.4, 0.5, 0.6, 0.75, 1.0]  # 1.0 == current method, no correction
    all_base, all_corr = {w: [] for w in grid}, None
    baseline_rows, corrected_rows = [], {w: [] for w in grid}

    touched_rows = {w: [] for w in grid}
    for target in TARGET_SEASONS:
        base = build_priors(ps, [target])
        actual = ps[ps["season"] == target][["athlete_id", "availability"]].rename(
            columns={"availability": "actual_avail"})
        base = base.merge(actual, on="athlete_id", how="inner").dropna(
            subset=["availability", "actual_avail", "base_mpg"])
        chron = chronicity(ps, target)

        baseline_rows.append(base[["availability", "actual_avail"]].assign(
            pred=base["availability"]))
        for w in grid:
            d = corrected_estimate(base, chron, role, w_acute=w)
            corrected_rows[w].append(d[["corrected", "actual_avail"]].rename(
                columns={"corrected": "pred"}))
            touched = d[d["corrected"] != d["availability"]].copy()
            touched["target"] = target
            touched_rows[w].append(touched)

    base_all = pd.concat(baseline_rows, ignore_index=True)
    print(f"CURRENT METHOD (3yr recency-weighted mean, no correction) -- "
          f"{len(TARGET_SEASONS)} held-out seasons pooled:")
    m = evaluate("pred", base_all.rename(columns={"pred": "pred"}))
    print(f"  n={m['n']:5d}  corr={m['corr']:.3f}  slope={m['slope']:.3f}  MAE={m['mae']:.3f}")
    print()

    print("CHRONICITY-AWARE CORRECTION, by acute-pull weight w_acute "
          "(0=fully role-typical, 1=identical to current method):")
    for w in grid:
        d_all = pd.concat(corrected_rows[w], ignore_index=True)
        m = evaluate("pred", d_all)
        print(f"  w_acute={w:.2f}  n={m['n']:5d}  corr={m['corr']:.3f}  "
              f"slope={m['slope']:.3f}  MAE={m['mae']:.3f}")

    print()
    touched0 = pd.concat(touched_rows[grid[0]], ignore_index=True)
    print(f"THE SUBSET THE CORRECTION ACTUALLY TOUCHES (acute dip, below role-typical) "
          f"-- n={len(touched0)} player-seasons across {len(TARGET_SEASONS)} seasons:")
    mae0 = (touched0["availability"] - touched0["actual_avail"]).abs().mean()
    bias0 = (touched0["availability"] - touched0["actual_avail"]).mean()
    print(f"  {'current method (no correction)':<32} actual={touched0['actual_avail'].mean():.3f}  "
          f"MAE={mae0:.3f}  bias={bias0:+.3f}")
    for w in grid:
        t = pd.concat(touched_rows[w], ignore_index=True)
        mae = (t["corrected"] - t["actual_avail"]).abs().mean()
        bias = (t["corrected"] - t["actual_avail"]).mean()
        print(f"  {'w_acute='+str(w):<32} actual={t['actual_avail'].mean():.3f}  "
              f"MAE={mae:.3f}  bias={bias:+.3f}")


if __name__ == "__main__":
    main()
