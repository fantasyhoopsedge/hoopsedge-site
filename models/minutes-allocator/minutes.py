"""Stage 1: how many minutes does each player get?

The single highest-leverage stage. Every counting stat downstream is a rate
multiplied by these minutes, so an error here scales into all nine categories at
once — a 10% minutes miss is a 10% miss on points, rebounds, assists, steals,
blocks, turnovers and threes simultaneously.

The projection is:

    mpg_i    = base_mpg_i * role_mult_i        minutes per game he PLAYS
    games_i  = availability_i * team_games     games he plays at all
    load_i   = mpg_i * availability_i          minutes per TEAM game  <- sums to 240

`load` is the quantity the team budget constrains, and keeping it a separate name
from `mpg` is load-bearing. The two are constantly confused because the 240 check
is usually stated as "sum the projected MPG", which is false: fifteen players
averaging 25 MPG sum to 375, not 240. What actually sums to the budget is minutes
per team game, and the identity is exact rather than approximate --

    sum_i mpg_i * availability_i
      = sum_i (min_i / gp_i) * (gp_i / team_games)
      = sum_i min_i / team_games
      = team minutes per game

-- which is 241.75 in the real data (2011-2026 mean, see Stage 0). Downstream
stages want mpg (rate x mpg x gp), the allocator wants load; conflating them
either double-counts availability or drops it.

THE ALLOCATOR IS NOT OPTIONAL. measure_240.py exists to answer whether it is, and
the answer was no: the best independent per-player model puts only 19.8% of
team-seasons within +/-10 minutes of the budget (sd 41.5). Independent
projections have no mechanism to make a roster sum to anything, and rosters carry
~19 players for ~240 minutes, so they systematically overshoot. See allocate().

Every number here is set by backtest.py against fifteen seasons, not by taste. If
you change one, re-run it. The single exception is ALPHA, which is deliberately NOT
the tuner's optimum and carries its own argument — read allocate() before touching
it.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO  # noqa: E402

FOUNDATION = os.path.join(REPO, "output", "foundation")

# Recency weights by lag (1 = last season). Roughly 60/30/10; renormalized over
# whichever seasons a player actually has, so a 2-season player gets 67/33 for free
# without a separate rule.
RECENCY = {1: 0.60, 2: 0.30, 3: 0.10}

# A season earns its full recency weight only once it has this many games. A
# 5-game season is a 5-game sample of a role, and handing it the undiluted 0.60
# lag-1 weight lets a cameo overwrite two full seasons of evidence. Below the
# threshold the weight scales linearly with games played; the season still counts,
# it just counts in proportion to what it saw.
GP_SCALE_GAMES = 20

# Team minutes per game: 240 regulation (5 players x 48) + overtime. The empirical
# 2011-2026 mean is 241.75 and it has never left 239.3-248.7 for a full season.
# Using the constant rather than a per-team number is deliberate — OT frequency is
# not a knowable-in-advance team trait, and pretending to project it would be
# fitting noise.
TEAM_MINUTE_BUDGET = 241.75

# Nobody plays 40 MPG over a season any more. The league leader has landed at
# 36-38 for a decade, so this is a guard against the allocator inventing a workload
# no NBA player has carried, not a projection of anyone in particular. It binds on
# 25 player-seasons out of ~2,700 in the holdout — a backstop, not a lever.
MPG_CAP = 38.0

# The allocator's tilt exponent, and THE ONE NUMBER HERE THAT IS NOT THE BACKTEST
# OPTIMUM. backtest.py minimizes rotation MAE at 0.8 (5.34 vs 5.67 on holdout); we
# ship 1.0 on purpose. Do not "correct" this by re-running the tuner — it will tell
# you 0.8, it is right, and it is answering a different question. See allocate().
ALPHA = 1.0

# How availability is pooled across the 3-year window, and whether a season the
# player missed entirely counts as zero. Both fitted — see build_priors().
AVAIL_STAT = "wmean"
GAP_AS_ZERO = False

# --- role_change_multiplier ---------------------------------------------------
# The one place human knowledge enters Stage 1. base_mpg is a memory of last
# season's depth chart; when a team trades its starting centre, nothing in the
# player's own history knows that. These tiers carry that news.
#
# DELIBERATELY COARSE, AND NOT TO BE REFINED INTO A CONTINUOUS SCALE. The input is
# a human reading a transaction log — that supports "this man's role got bigger",
# not "this man's role got 12.4% bigger". Five buckets is an honest description of
# the information available; a fitted coefficient would be false precision dressed
# as rigour. There is no data to fit it against either: role change is not a
# recorded quantity, so any number here is a judgement whatever its decimal places.
#
# These multiply MPG (minutes per game played), NOT availability and NOT load — a
# role change is about the size of a player's job, not his health. The allocator
# renormalizes afterwards, so what matters is a player's multiplier RELATIVE to his
# teammates': marking a whole roster 1.15 changes nothing at all.
ROLE_TIERS: dict[str, float] = {
    "won_job": 1.15,      # clear path to a starting spot that was contested or vacated
    "expanded": 1.08,     # more responsibility, short of a starting job
    "no_change": 1.00,    # the default, and correct for the large majority of players
    "reduced": 0.90,      # a rotation squeezed by an arrival or a returning starter
    "clear_backup": 0.70, # signed or traded into an obvious backup role
}
DEFAULT_ROLE_TIER = "no_change"


def load_panels() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Read the Stage 0 panels. Run build_foundation.py first if this raises."""
    try:
        ps = pd.read_parquet(os.path.join(FOUNDATION, "player_seasons.parquet"))
        ts = pd.read_parquet(os.path.join(FOUNDATION, "team_seasons.parquet"))
    except (FileNotFoundError, OSError) as e:
        raise SystemExit(
            f"missing Stage 0 panels ({e}).\n"
            f"Run: python models/data-foundation/build_foundation.py --seasons 2011-2026"
        )
    return ps, ts


def build_priors(
    ps: pd.DataFrame,
    target_seasons: list[int],
    recency: dict[int, float] = RECENCY,
    gp_scale_games: int = GP_SCALE_GAMES,
    avail_stat: str = AVAIL_STAT,
    gap_as_zero: bool = GAP_AS_ZERO,
) -> pd.DataFrame:
    """Per (athlete, target_season): base_mpg and availability from prior seasons.

    Strictly backward-looking — for target season S it reads only S-1..S-3, so the
    same function serves the backtest and the live projection and cannot leak.

    base_mpg is a recency-weighted mean of MPG, and MPG is min/gp: minutes per game
    PLAYED, never per team game. Dividing by team games would fold availability
    into the rate, and then availability_factor would apply it a second time.

    availability is gp / his own team's games — the team's, not 82. Stage 0's
    denominator is per team-season for a reason (2012 played 66, 2021 played 72,
    and 2021's feed only *has* 49 games for CHI), so a 41-game season means 50%
    availability, not 41/82 of some constant.

    THE GAP TRAP (gap_as_zero), AND WHY IT DEFAULTS TO OFF DESPITE BEING REAL. A
    player who missed an ENTIRE season has no row in player_seasons — Stage 0
    defines a game played as minutes > 0, so a zero-game season leaves no trace.
    Pooling over "the seasons he appears in" therefore silently drops exactly the
    seasons that make him a durability risk: Ben Simmons played 0 games in 2021-22,
    and an average over present-only seasons scores that year as if it never
    happened. Reading an absent post-debut season as availability 0 fixes that, and
    it is the honest description of what happened.

    It still lost the backtest, narrowly and in a split decision: it improves
    overall MAE (5.91 -> 5.84) and slightly worsens rotation-player MAE
    (5.71 -> 5.76), which is the metric selection runs on. The mechanism is
    plausible — with recency weights, a missed LAST season carries 0.60 weight at
    zero, which caps a returning starter near 0.40 availability and buries him
    under a bench player who suited up. The correction is right about the risk and
    too violent about the size of it. It touches 4.1% of player-seasons, and the
    whole disagreement is 0.05 minutes per game, so this is close to a coin flip
    rather than a settled question — worth revisiting with a softer discount
    (half-weight, say) instead of a hard zero. Keep the flag; n_gap is returned
    either way so a caller can see the affected population.

    base_mpg ignores gaps entirely, in both modes: a missed season says nothing
    about the size of a player's role when he is healthy.
    """
    if avail_stat not in ("median", "mean", "wmean"):
        raise ValueError(f"unknown avail_stat {avail_stat!r}")
    lags = sorted(recency)
    debut = ps.groupby("athlete_id")["season"].min()

    out = []
    for S in target_seasons:
        per_lag = {
            l: ps.loc[ps["season"] == S - l].set_index("athlete_id")[["mpg", "gp", "availability"]]
            for l in lags
        }
        ids = sorted(set().union(*(set(d.index) for d in per_lag.values())))
        if not ids:
            continue
        f = pd.DataFrame(index=pd.Index(ids, name="athlete_id"))
        for l in lags:
            f[f"mpg{l}"] = per_lag[l]["mpg"]
            f[f"gp{l}"] = per_lag[l]["gp"]
            f[f"av{l}"] = per_lag[l]["availability"]

        # --- base_mpg: recency x sample-size weights, renormalized over present seasons.
        mpg = np.column_stack([f[f"mpg{l}"].to_numpy(float) for l in lags])
        gp = np.column_stack([f[f"gp{l}"].to_numpy(float) for l in lags])
        w = np.array([recency[l] for l in lags], dtype=float)[None, :].repeat(len(f), axis=0)
        if gp_scale_games:
            w = w * np.clip(np.nan_to_num(gp) / gp_scale_games, 0, 1)
        w = np.where(np.isnan(mpg), 0.0, w)
        wsum = w.sum(axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            f["base_mpg"] = np.where(wsum > 0, (w * np.nan_to_num(mpg)).sum(axis=1) / wsum, np.nan)
        f["n_hist"] = (~np.isnan(mpg)).sum(axis=1)

        # --- availability: gaps after debut are zeroes, not absences (see docstring).
        av = np.column_stack([f[f"av{l}"].to_numpy(float) for l in lags])
        av = np.clip(av, 0, 1)  # a traded player can round fractionally over 1.0
        if gap_as_zero:
            d = f.index.map(debut).to_numpy(float)
            season_of_lag = np.array([S - l for l in lags], dtype=float)[None, :]
            in_league_gap = np.isnan(av) & (season_of_lag >= d[:, None])
            av = np.where(in_league_gap, 0.0, av)
            f["n_gap"] = in_league_gap.sum(axis=1)
        else:
            f["n_gap"] = 0
        if avail_stat == "median":
            f["availability"] = np.nanmedian(av, axis=1)
        elif avail_stat == "mean":
            f["availability"] = np.nanmean(av, axis=1)
        else:
            aw = np.array([recency[l] for l in lags], dtype=float)[None, :].repeat(len(f), axis=0)
            aw = np.where(np.isnan(av), 0.0, aw)
            s = aw.sum(axis=1)
            f["availability"] = np.where(s > 0, (aw * np.nan_to_num(av)).sum(axis=1) / s, np.nan)

        f["target_season"] = S
        out.append(f.reset_index()[
            ["athlete_id", "target_season", "base_mpg", "availability", "n_hist", "n_gap"]
        ])

    return pd.concat(out, ignore_index=True)


def allocate(
    df: pd.DataFrame,
    alpha: float = ALPHA,
    budget: float = TEAM_MINUTE_BUDGET,
    mpg_cap: float = MPG_CAP,
    load_col: str = "raw_load",
    team_keys: tuple[str, ...] = ("target_season", "team"),
) -> pd.DataFrame:
    """Scale each team's projected loads onto the 240-minute budget.

    Needed because minutes are ZERO-SUM within a team and a per-player model does
    not know that. Rosters carry ~19 players who log minutes; project each one
    independently off his own history and they sum to ~245 with sd 41.5 — over
    80% of team-seasons land outside +/-10 of the budget (measure_240.py). The
    surplus is real, not noise: last year's 20-MPG backup is still projected at 20
    MPG after the team signed someone ahead of him, and both keep their minutes.

    The scale is a tilted proportional one:

        load_i = budget * load_i^alpha / sum_j load_j^alpha

    alpha is the one knob and it controls WHO absorbs the correction. alpha = 1 is
    plain proportional scaling: a 15% surplus takes 15% off the star and 15% off
    the 12th man alike. alpha > 1 concentrates minutes at the top; alpha < 1
    flattens the roster, taking proportionally more off the high-minute players.

    WE SHIP alpha = 1.0 EVEN THOUGH THE TUNER SAYS 0.8. Both facts are real and
    they are not in conflict; they answer different questions.

    Why the tuner says 0.8: alpha < 1 buys regression to the mean. A player coming
    off 34 MPG is likelier to fall than rise and a 12-MPG player has more room above
    him than below, so flattening the roster shrinks both toward the middle and cuts
    rotation MAE from 5.67 to 5.34 on the holdout. That is correct. A minimum-error
    point projection IS a conditional mean, and a conditional mean is always
    narrower than the distribution it predicts — the compression is the shrinkage
    working, not a defect.

    Why we decline it anyway: these minutes are multiplied by rates into counting
    stats and handed to the 9-cat V-score engine, which standardizes them AS IF
    they were realized outcomes. Feed that engine shrunk minutes and star counting
    stats come out low, their z-scores come out low, and the model understates
    exactly the players it exists to identify. At alpha 0.8 the projected p99 load
    is 30.4 against an actual 33.7; at 1.0 it is 33.8 — the real distribution,
    nearly exactly.

    The tie-breaker is that the MAE is bought with nothing we need. alpha does not
    reorder anyone: correlation with actual load is 0.716-0.719 across the entire
    grid, flat. It is a pure rescale. So 0.8 is a better number and 1.0 is a better
    projection, and the 6% MAE we give up buys a calibrated one at no cost in rank.
    (If a future consumer wants the minimum-error estimate rather than a calibrated
    one — a straight "how many minutes will he play" answer, no z-scores — 0.8 is
    the right call for it, and passing alpha explicitly is the way to get it.)

    The obvious argument for alpha > 1 — starter minutes are the most stable thing
    in basketball, roster crunch lands on the bench, so protect the top and squeeze
    the bottom — is simply wrong, and monotonically so: rotation MAE rises without
    interruption to 7.24 at alpha 1.6, and the distribution overshoots too. It is
    recorded here because it is convincing and someone will re-derive it.

    Note the exponent applies to the LOAD (minutes per team game), so a player
    already projected near zero stays near zero rather than being scaled up into
    a rotation spot.

    The cap then enforces that no one exceeds MPG_CAP minutes per game played, and
    the freed minutes are re-tilted over the uncapped players — iterated, because
    redistribution can push the next player over the cap in turn. Without this the
    scale-up case (a team whose projections undershoot) hands 45 MPG to a star.
    """
    df = df.copy()
    df["proj_load"] = np.nan
    # Group on the full roster key, not just the team. A budget is spent by ONE team
    # in ONE season, and grouping on team alone silently pools every season together
    # and splits 241.75 across all of them.
    keys = [k for k in team_keys if k in df.columns]
    if not keys:
        raise ValueError(f"none of the roster keys {team_keys} are present in the frame")
    for _, idx in df.groupby(keys).groups.items():
        load = df.loc[idx, load_col].to_numpy(float).copy()
        avail = df.loc[idx, "availability"].to_numpy(float)
        load = np.nan_to_num(load, nan=0.0)
        # A player's load cap is his MPG cap scaled by how often he suits up: the
        # budget is spent per team game, and a 60%-available player cannot occupy
        # 38 minutes of one.
        cap = mpg_cap * np.nan_to_num(avail, nan=0.0)

        free = np.ones(len(load), dtype=bool)
        fixed = np.zeros(len(load))
        for _ in range(20):
            remaining = budget - fixed.sum()
            tilt = np.where(free, np.power(np.clip(load, 0, None), alpha), 0.0)
            if tilt.sum() <= 0 or remaining <= 0:
                break
            scaled = remaining * tilt / tilt.sum()
            over = free & (scaled > cap)
            if not over.any():
                fixed = np.where(free, scaled, fixed)
                break
            fixed[over] = cap[over]
            free = free & ~over
        df.loc[idx, "proj_load"] = fixed

    # Back out the display quantities. mpg is what Stage 2 multiplies rates by;
    # load is what the budget constrains. Deriving mpg from the allocated load
    # keeps the two consistent by construction.
    with np.errstate(invalid="ignore", divide="ignore"):
        df["proj_mpg"] = np.where(df["availability"] > 0, df["proj_load"] / df["availability"], 0.0)
    return df
