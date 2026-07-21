"""Fit and check Stage 1 against fifteen seasons of what actually happened.

Every default in minutes.py is set here. The questions, none of which have an
obvious answer from the armchair:

  1. how far back should base_mpg look, and how should it weight?
  2. does discounting small-sample seasons help?
  3. median or mean availability — and does reading a missed season as zero help?
  4. does the allocator beat leaving projections unconstrained, and at what alpha?

Protocol: parameters are chosen on 2014-2022 and then reported once on 2023-2026,
which is never touched during selection. A grid this size will find something that
looks good on its own tuning data by chance; the holdout is what says whether it
was real. 2014 is the first target season with three priors available (Stage 0
starts at 2011).

Truth is a player's actual minutes per team game, assigned to his PRIMARY team.
Rookies are carried in the allocation (they take real minutes, and leaving them
out would hand their share to the veterans) but excluded from the error, because
projecting a player with no NBA history is Stage 4's job, not Stage 1's.

Run: python models/projections-adjuster/backtest.py
"""

from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

from minutes import (
    ALPHA, AVAIL_STAT, GAP_AS_ZERO, GP_SCALE_GAMES, MPG_CAP, RECENCY, TEAM_MINUTE_BUDGET,
    allocate, build_priors, load_panels,
)

TUNE = list(range(2014, 2023))
HOLDOUT = list(range(2023, 2027))
ALL = TUNE + HOLDOUT

WEIGHT_SETS = {
    "60/30/10": {1: 0.60, 2: 0.30, 3: 0.10},
    "65/35": {1: 0.65, 2: 0.35},
    "last only": {1: 1.0},
    "equal 3": {1: 1 / 3, 2: 1 / 3, 3: 1 / 3},
    "50/30/20": {1: 0.50, 2: 0.30, 3: 0.20},
}


def build_truth(ps: pd.DataFrame) -> pd.DataFrame:
    """Actual load per (athlete, season): season minutes / his primary team's games.

    Primary-team assignment is what the live model can express — it projects a
    player onto one roster — so the backtest has to score the same shape. A traded
    player's full-season minutes land entirely on the team he played most for.
    """
    t = ps[["athlete_id", "season", "primary_team", "min", "gp", "mpg", "team_games",
            "availability", "n_teams"]].copy()
    t["actual_load"] = t["min"] / t["team_games"]
    return t.rename(columns={"season": "target_season", "primary_team": "team",
                             "mpg": "actual_mpg", "availability": "actual_avail"})


def assemble(ps: pd.DataFrame, seasons: list[int], **prior_kw) -> pd.DataFrame:
    truth = build_truth(ps)
    truth = truth[truth["target_season"].isin(seasons)]
    pri = build_priors(ps, seasons, **prior_kw)
    d = truth.merge(pri, on=["athlete_id", "target_season"], how="left")

    # Rookie placeholder, from PRIOR seasons only — using the whole-sample median
    # would leak the target season's own answer back into its inputs.
    d["is_rookie"] = d["base_mpg"].isna()
    rk = d[d["is_rookie"]].groupby("target_season")["actual_load"].median()
    prior_median = {S: rk[rk.index < S].median() for S in seasons}
    fallback = rk.median()  # only for the first target season, which has no prior
    d["base_mpg"] = np.where(
        d["is_rookie"],
        d["target_season"].map(lambda S: prior_median.get(S) if not pd.isna(prior_median.get(S)) else fallback),
        d["base_mpg"],
    )
    d["availability"] = np.where(d["is_rookie"], 1.0, d["availability"])
    d["raw_load"] = d["base_mpg"] * d["availability"]
    return d


def score(d: pd.DataFrame, col: str) -> dict:
    """Error on real players only. Rotation MAE is reported separately because a
    league-wide mean is dominated by the ~40% of the sample that barely plays, and
    getting a 3-minute player wrong by 2 minutes is not the same failure as getting
    a starter wrong by 2."""
    m = ~d["is_rookie"] & d[col].notna()
    e = d.loc[m, col] - d.loc[m, "actual_load"]
    rot = m & (d["actual_load"] >= 10)
    er = d.loc[rot, col] - d.loc[rot, "actual_load"]
    return {"mae": e.abs().mean(), "rot_mae": er.abs().mean(), "bias": e.mean(), "n": int(m.sum())}


def team_sums(d: pd.DataFrame, col: str) -> dict:
    g = d.groupby(["target_season", "team"])[col].sum()
    err = g - TEAM_MINUTE_BUDGET
    return {"mean": g.mean(), "sd": g.std(), "within10": (err.abs() <= 10).mean()}


def shape(d: pd.DataFrame, col: str) -> dict:
    """How well does the projected minutes distribution match the real one, and does
    the parameter reorder anyone?

    MAE alone cannot answer the question Stage 1 actually faces. A minimum-error
    projection is a conditional mean and is therefore narrower than reality by
    construction, so tuning on MAE alone silently selects a compressed distribution
    — which matters enormously downstream, where these minutes become counting
    stats and then z-scores. p99 and corr are what expose that: p99 says whether
    the top of the league is the right size, corr says whether the choice costs any
    ordering. See allocate() in minutes.py.
    """
    m = ~d["is_rookie"] & d[col].notna()
    p, a = d.loc[m, col], d.loc[m, "actual_load"]
    return {"p99": p.quantile(0.99), "p99_act": a.quantile(0.99),
            "max": p.max(), "max_act": a.max(),
            "corr": np.corrcoef(p, a)[0, 1]}


def main() -> None:
    ps, _ = load_panels()
    print(f"Stage 1 backtest — tune {TUNE[0]}-{TUNE[-1]}, holdout {HOLDOUT[0]}-{HOLDOUT[-1]}")

    # --- Is the budget actually 241.75 once players are assigned to a primary team?
    # It cannot be exactly: a traded player's minutes all land on one team, so churn
    # moves minutes between rosters. If that spread is large the whole constant-budget
    # premise is wrong, so measure it before relying on it.
    base = assemble(ps, ALL)
    g = base.groupby(["target_season", "team"])["actual_load"].sum()
    print(f"\nactual load per team (primary-team assignment): mean {g.mean():.1f} "
          f"sd {g.std():.1f} | p10 {g.quantile(.1):.0f} p90 {g.quantile(.9):.0f}")
    print(f"  vs the true team budget of {TEAM_MINUTE_BUDGET} — the gap is in-season trade churn, "
          f"which the projection cannot see and does not try to.")
    print(f"  players projected: {len(base)} ({int(base['is_rookie'].sum())} rookies carried, "
          f"excluded from error)")

    # --- 1/2. base_mpg: lookback weights and small-sample discounting.
    print("\n=== base_mpg weights (unconstrained, tuning seasons) ===")
    print(f"  {'weights':<10} {'gp-scale':>9} | {'MAE':>6} {'rot MAE':>8} {'bias':>7}")
    best_w, best_gp, best = None, None, np.inf
    for name, w in WEIGHT_SETS.items():
        for gp_scale in (0, GP_SCALE_GAMES):
            d = assemble(ps, TUNE, recency=w, gp_scale_games=gp_scale)
            s = score(d, "raw_load")
            flag = ""
            if s["rot_mae"] < best:
                best, best_w, best_gp = s["rot_mae"], name, gp_scale
                flag = "  <-"
            print(f"  {name:<10} {gp_scale or 'off':>9} | {s['mae']:6.2f} {s['rot_mae']:8.2f} "
                  f"{s['bias']:+7.2f}{flag}")
    print(f"  -> {best_w}, gp-scale {best_gp or 'off'}")
    W = WEIGHT_SETS[best_w]

    # --- 3. availability.
    print("\n=== availability (unconstrained, tuning seasons) ===")
    print(f"  {'stat':<8} {'gap=0':>6} | {'MAE':>6} {'rot MAE':>8} {'bias':>7}")
    best_av, best_gap, best = None, None, np.inf
    for stat, gap in itertools.product(("median", "mean", "wmean"), (True, False)):
        d = assemble(ps, TUNE, recency=W, gp_scale_games=best_gp, avail_stat=stat, gap_as_zero=gap)
        s = score(d, "raw_load")
        flag = ""
        if s["rot_mae"] < best:
            best, best_av, best_gap = s["rot_mae"], stat, gap
            flag = "  <-"
        print(f"  {stat:<8} {str(gap):>6} | {s['mae']:6.2f} {s['rot_mae']:8.2f} "
              f"{s['bias']:+7.2f}{flag}")
    print(f"  -> {best_av}, gap_as_zero={best_gap}")

    kw = dict(recency=W, gp_scale_games=best_gp, avail_stat=best_av, gap_as_zero=best_gap)
    d_tune = assemble(ps, TUNE, **kw)
    # Count gaps from a gap_as_zero=True build regardless of what won — with it off,
    # n_gap is 0 by construction and reports nothing about how big the population is.
    probe = assemble(ps, TUNE, recency=W, gp_scale_games=best_gp, avail_stat=best_av,
                     gap_as_zero=True)
    ng = int((probe["n_gap"] > 0).sum())
    print(f"  players with an in-league missed season in their 3-year window: {ng} "
          f"({100*ng/len(probe):.1f}%) — the population gap_as_zero acts on")

    # --- 4. the allocator.
    print("\n=== allocator alpha (tuning seasons) ===")
    u = score(d_tune, "raw_load")
    ut = team_sums(d_tune, "raw_load")
    sh0 = shape(d_tune, "raw_load")
    print(f"  {'alpha':>5} | {'MAE':>6} {'rot MAE':>8} | {'team sum':>8} {'within10':>9} | "
          f"{'p99':>5} {'max':>5} {'corr':>6}")
    print(f"  {'none':>5} | {u['mae']:6.2f} {u['rot_mae']:8.2f} | "
          f"{ut['mean']:8.1f} {100*ut['within10']:8.0f}% | {sh0['p99']:5.1f} {sh0['max']:5.1f} "
          f"{sh0['corr']:6.3f}")
    print(f"  {'ACTUAL':>5} | {'':>6} {'':>8} | {TEAM_MINUTE_BUDGET:8.1f} {'100':>8}% | "
          f"{sh0['p99_act']:5.1f} {sh0['max_act']:5.1f} {'1.000':>6}   <- what a projection "
          f"should look like")
    best_a, best = None, np.inf
    for a in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4):
        al = allocate(d_tune, alpha=a)
        s, t, sh = score(al, "proj_load"), team_sums(al, "proj_load"), shape(al, "proj_load")
        flag = ""
        if s["rot_mae"] < best:
            best, best_a = s["rot_mae"], a
            flag = "  <- best MAE"
        if abs(a - ALPHA) < 1e-9:
            flag += "  <- SHIPPED"
        print(f"  {a:5.1f} | {s['mae']:6.2f} {s['rot_mae']:8.2f} | "
              f"{t['mean']:8.1f} {100*t['within10']:8.0f}% | {sh['p99']:5.1f} {sh['max']:5.1f} "
              f"{sh['corr']:6.3f}{flag}")
    print(f"  allocator {'helps' if best < u['rot_mae'] else 'HURTS — do not ship it'}: "
          f"rotation MAE {u['rot_mae']:.2f} unconstrained -> {best:.2f} at alpha {best_a}.")
    print(f"  NOTE alpha is a pure rescale — corr is flat across the whole grid, so it reorders")
    print(f"  nobody. MAE picks {best_a}; the p99 column is why minutes.py ships {ALPHA} instead.")
    print(f"  Read allocate() before changing ALPHA. This tuner cannot see the argument.")

    # --- holdout. First and only look.
    print(f"\n=== HOLDOUT {HOLDOUT[0]}-{HOLDOUT[-1]} (never used for selection) ===")
    d_out = assemble(ps, HOLDOUT, **kw)
    al = allocate(d_out, alpha=ALPHA)  # the shipped setting, not the tuner's pick
    u, s = score(d_out, "raw_load"), score(al, "proj_load")
    ut, t = team_sums(d_out, "raw_load"), team_sums(al, "proj_load")
    sh = shape(al, "proj_load")
    print(f"  {'model':<20} | {'MAE':>6} {'rot MAE':>8} {'bias':>7} | {'team sum':>8} "
          f"{'within10':>9} | {'p99':>5}")
    print(f"  {'unconstrained':<20} | {u['mae']:6.2f} {u['rot_mae']:8.2f} {u['bias']:+7.2f} | "
          f"{ut['mean']:8.1f} {100*ut['within10']:8.0f}% | {shape(d_out,'raw_load')['p99']:5.1f}")
    print(f"  {f'allocated (a={ALPHA})':<20} | {s['mae']:6.2f} {s['rot_mae']:8.2f} "
          f"{s['bias']:+7.2f} | {t['mean']:8.1f} {100*t['within10']:8.0f}% | {sh['p99']:5.1f}")
    if best_a != ALPHA:
        alt = allocate(d_out, alpha=best_a)
        sa, sha = score(alt, "proj_load"), shape(alt, "proj_load")
        print(f"  {f'allocated (a={best_a})':<20} | {sa['mae']:6.2f} {sa['rot_mae']:8.2f} "
              f"{sa['bias']:+7.2f} | {team_sums(alt,'proj_load')['mean']:8.1f} {100:8.0f}% | "
              f"{sha['p99']:5.1f}   (tuner's pick — lower MAE, compressed p99)")
    print(f"  {'ACTUAL':<20} | {'':>6} {'':>8} {'':>7} | {TEAM_MINUTE_BUDGET:8.1f} {'100':>8}% | "
          f"{sh['p99_act']:5.1f}")
    # Persistence: last season's MPG, straight through. Any model that cannot beat
    # this is not earning its complexity.
    naive = assemble(ps, HOLDOUT, recency={1: 1.0}, gp_scale_games=0, avail_stat="wmean",
                     gap_as_zero=False)
    n = score(naive, "raw_load")
    print(f"  {'persistence':<14} | {n['mae']:6.2f} {n['rot_mae']:8.2f} {n['bias']:+7.2f} | "
          f"{'':>8} {'':>5} {'':>9}  (last season's MPG, unconstrained)")
    gain = 100 * (1 - s["rot_mae"] / n["rot_mae"])
    print(f"\n  Stage 1 beats persistence by {gain:.1f}% on rotation-player MAE.")
    print(f"  MPG cap ({MPG_CAP}) binds on {int((al['proj_mpg'] > MPG_CAP - 0.01).sum())} "
          f"player-seasons.")

    print("\n=== SETTINGS (compare against minutes.py) ===")
    print(f"  RECENCY        = {W}   (shipped: {RECENCY})")
    print(f"  GP_SCALE_GAMES = {best_gp}   (shipped: {GP_SCALE_GAMES})")
    print(f"  avail_stat     = {best_av!r}, gap_as_zero={best_gap}   "
          f"(shipped: {AVAIL_STAT!r}, {GAP_AS_ZERO})")
    print(f"  ALPHA          = {best_a} by MAE   (shipped: {ALPHA}, deliberately — see allocate())")


if __name__ == "__main__":
    main()
