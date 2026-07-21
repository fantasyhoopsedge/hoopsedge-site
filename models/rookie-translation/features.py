"""College feature construction for the rookie translation model.

Per Engelmann: use SOS-adjusted "true skill" rate estimates, never raw per-game
counts, which overrate volume against weak competition.

Three things happen here:
  1. Season totals -> per-100 possessions via NCAA_possessions_est (college tempo
     varies too much by team/era for per-game to be comparable).
  2. Empirical-Bayes stabilization toward a class prior, weighted by possessions,
     so a 4-game sample (Jayden Quaintance) does not enter at the same weight as
     a 38-game one.
  3. Z-scoring within draft class. This is the era control (college 3PA rate went
     0.189 in 2010 -> 0.374 in 2025) AND it neutralizes the sos/team_strength
     rescale that shifts 2025-26 about +1.1sd against 2010-24 history: a
     within-class z-score is invariant to any per-class affine rescale.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Shot-zone attempt columns. Dunks are a SEPARATE zone from rim, not nested —
# verified by point reconciliation (662/771 exact, mean residual 0.03%).
ZONES = {
    "rim": ("rim_made", "rim_miss"),
    "mid": ("mid_made", "mid_miss"),
    "dunk": ("dunks_made", "dunks_miss"),
}

RATE_COLS = [
    "r_pts", "r_oreb", "r_dreb", "r_ast", "r_stl", "r_blk", "r_tov",
    "r_fta", "r_3fga", "r_rim_att", "r_mid_att", "r_dunk_att", "r_fga",
]
EFF_COLS = ["e_ft", "e_3p", "e_rim", "e_mid"]
CTX_COLS = ["sos", "team_strength", "rec_rank", "mpg", "gp"]
# log_pick, not pick: draft value is convex in slot — the gap between picks 1 and 5
# is worth far more than between 45 and 49. Entered linearly, the model under-projected
# top-5 picks badly (23 mpg / 9.4 pts vs an actual 27.1 / 12.8). That was NOT ridge
# shrinkage — it persisted at alpha=0.1. log(pick) fixes the calibration (27.3 / 12.2)
# and lowers LOCO error ~4% at the same time.
RAW_COLS = ["age", "height", "log_pick", "international", "is_unranked"]

FEATURES = RATE_COLS + EFF_COLS + CTX_COLS + RAW_COLS


def _eb_shrink(made: pd.Series, att: pd.Series, prior_w: float = 40.0) -> pd.Series:
    """Empirical-Bayes shrink a make rate toward the population rate.

    prior_w is in attempts: a player with prior_w attempts sits halfway between
    their own rate and the prior. Keeps thin samples from entering as extremes.
    """
    p0 = made.sum() / max(att.sum(), 1)
    return (made + prior_w * p0) / (att + prior_w)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    poss = d["NCAA_possessions_est"].clip(lower=1)
    # NaN for undrafted / unresolved slots — surfaced as a flag, never imputed.
    d["log_pick"] = np.log(d["pick"].astype(float))

    for z, (mk, ms) in ZONES.items():
        d[f"{z}_att"] = d[mk] + d[ms]
    d["fga_tot"] = d["3fga"] + d["rim_att"] + d["mid_att"] + d["dunk_att"]

    # --- per-100 possession volume ---
    per100 = {
        "r_pts": d["pts"], "r_oreb": d["oreb"], "r_dreb": d["dreb"], "r_ast": d["ast"],
        "r_stl": d["stl"], "r_blk": d["blks"], "r_tov": d["tov"], "r_fta": d["fta"],
        "r_3fga": d["3fga"], "r_rim_att": d["rim_att"], "r_mid_att": d["mid_att"],
        "r_dunk_att": d["dunk_att"], "r_fga": d["fga_tot"],
    }
    for k, v in per100.items():
        d[k] = v / poss * 100

    # --- stabilized efficiencies ---
    # Dunk FG% is deliberately absent: median 0.925 with no usable variance.
    # Dunk ATTEMPT rate (r_dunk_att) carries the rim-athleticism signal instead.
    d["e_ft"] = _eb_shrink(d["ftm"], d["fta"])
    d["e_3p"] = _eb_shrink(d["3fgm"], d["3fga"])
    d["e_rim"] = _eb_shrink(d["rim_made"], d["rim_att"])
    d["e_mid"] = _eb_shrink(d["mid_made"], d["mid_att"])

    # rec_rank is a PERCENTILE (0-100, higher better) with 0 floor-coded as
    # "unranked" — that bucket includes Ja Morant and Gordon Hayward, so treating
    # 0 as continuous would tell the model they were worse recruits than a 3-star.
    d["is_unranked"] = ((d["rec_rank"] == 0) | d["rec_rank"].isna()).astype(int)
    rr = d["rec_rank"].replace(0, np.nan)
    d["rec_rank"] = rr.fillna(rr.median())

    # --- shrink volume rates toward the class prior by possession count ---
    med_poss = d["NCAA_possessions_est"].median()
    w = d["NCAA_possessions_est"] / (d["NCAA_possessions_est"] + 0.5 * med_poss)
    for c in RATE_COLS:
        d[c] = w * d[c] + (1 - w) * d.groupby("season")[c].transform("mean")

    return d


def zscore_within_class(d: pd.DataFrame, cols: list[str], ref: pd.DataFrame | None = None) -> pd.DataFrame:
    """Z-score `cols` within each draft class.

    Era control + rescale neutralizer. Each class is standardized against itself,
    so any per-class affine shift (the 2025-26 sos rescale) cancels out.
    """
    out = d.copy()
    for c in cols:
        g = out.groupby("season")[c]
        mu, sd = g.transform("mean"), g.transform("std")
        out[c] = (out[c] - mu) / sd.replace(0, np.nan)
        out[c] = out[c].fillna(0.0)
    return out


def feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    d = build_features(df)
    d = zscore_within_class(d, RATE_COLS + EFF_COLS + CTX_COLS)
    return d
