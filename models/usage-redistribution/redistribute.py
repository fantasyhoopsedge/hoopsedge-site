"""Stage 3 engine: reconcile bottom-up player volume to team-total anchors.

The gate check (measure_usage.py) established that team usage totals (FGA, FTA,
3PM, AST, TOV) are team-conserved and better predicted by a team's own recency-
weighted history than by summing each player's independently-projected rate --
because a departed high-usage player's shots are re-absorbed by whoever remains,
which no isolated per-player projection can know. This module does the re-absorbing.

The mechanism is proportional (multiplicative) redistribution, which is exactly
"weighted by remaining players' relative usage": scaling every player's projected
volume by one team factor f = anchor / bottom-up-sum keeps each player's share of
the team total fixed, so a player already projected for more volume (higher rate x
more minutes = higher usage) absorbs proportionally more of any vacated share. The
gap a departure leaves is filled by the players who are actually there, in
proportion to how much they already shoot -- not split evenly.

EFFICIENCY IS NEVER TOUCHED. The engine changes VOLUME only. When it scales a
player's FGA by f it scales his FGM by the same f, holding his FG% exactly fixed;
likewise FTA/FTM. 3PM is reconciled on its own (it is a category, not an attempt). That
is what keeps the V-score engine's volume-
weighted percentages correct downstream -- Stage 3 reallocates who takes the shots,
never how well they go in. PTS falls out as 2*FGM + FTM + 3PM.

STL, BLK, REB are NOT reconciled here and pass straight through from Stage 2/4.
Steals and blocks are not team-conserved (a departed shot-blocker's blocks are not
inherited by his team-mates). Rebounds ARE roughly team-conserved but are driven by
rebound opportunity, not usage, so redistributing them "weighted by usage" would be
wrong; team-rebound reconciliation weighted by rebound RATE is a possible future
refinement, deliberately out of scope for the usage engine.

Importable engine (mirrors rates.py). Backtested by backtest.py; applied to the
2026-27 roster by project_roster.py.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO  # noqa: E402

FOUND = os.path.join(REPO, "output", "foundation")

# The team-conserved usage volumes the engine reconciles -- exactly the 9-cat
# quantities the artifact emits that are shared at the team level. FGA/FTA are
# attempts (their makes ride along to hold FG%/FT% fixed); 3PM is a made-three,
# which is itself a 9-cat category (there is no 3PA in the contract -- FG%/FT% come
# from makes/attempts, but three-pointers are counted as MAKES), so it is reconciled
# directly. AST/TOV are counts. STL/BLK/REB are NOT here (not usage-conserved).
USAGE = ["fga", "fta", "fg3m", "ast", "tov"]
# make paired to each ATTEMPT, so scaling volume preserves the shooting percentage.
# 3PM is deliberately absent: it is a category in its own right, not an attempt with a
# make riding it, so it is reconciled on its own line above.
MAKE_OF = {"fga": "fgm", "fta": "ftm"}
RECENCY = {1: 0.6, 2: 0.3, 3: 0.1}  # 60/30/10 by lag x games -- the model-wide weighting

# HOW HARD to pull the bottom-up sum toward the anchor. 0 = untouched, 1 = team sums
# hit the anchor exactly. backtest.py tunes on 2014-2021, reports on 2022-2026. The
# per-player usage-core MAE is a flat plateau over 0.50-0.75 (they differ by ~1e-4,
# noise) and both beat the extremes; full reconciliation (1.0) is worse because the
# anchor is itself ~2-FGA noisy and vacated usage is only PARTIALLY re-absorbed -- some
# of a departed star's shots genuinely evaporate. We ship the LOWER end, 0.50, for two
# reasons: (1) robustness -- pull less hard toward an approximate target; (2) it is the
# only point that keeps the 3PM category at worst neutral per-player (-0.2% at 0.50 vs
# -2.1% at 0.75). The pooled usage-core MAE is dominated by FGA's scale and will trade
# 3PM accuracy for a fraction of a percent on FGA if you let argmin pick -- but 3PM is a
# full 9-cat category standardized on its own, so it must not be sacrificed to a pooled
# average. Same pooled-metric trap as Stage 1's alpha. Partial reconciliation is a shrink
# between two imperfect estimates, and unlike a player-level shrink it is a pure team-
# level rescale, so it preserves the cross-player spread the V-score engine standardizes
# (it moves team levels, not the star-vs-bench gap).
SHIP_STRENGTH = 0.5


def load_foundation() -> tuple[pd.DataFrame, pd.DataFrame]:
    pts = pd.read_parquet(os.path.join(FOUND, "player_team_seasons.parquet"))
    ts = pd.read_parquet(os.path.join(FOUND, "team_seasons.parquet"))
    return pts, ts


def team_volume(pts: pd.DataFrame, ts: pd.DataFrame) -> pd.DataFrame:
    """Actual team V/game per (team, season). Summed from player rows (the only
    correct combine for traded players), divided by Stage 0's real game count."""
    stats = USAGE + [MAKE_OF[s] for s in USAGE if s in MAKE_OF]
    g = pts.groupby(["team", "season"], as_index=False)[stats].sum()
    g = g.merge(ts[["team", "season", "team_games"]], on=["team", "season"], how="left")
    for s in stats:
        g[f"{s}_pg"] = g[s] / g["team_games"]
    return g


def league_curve(vol: pd.DataFrame) -> pd.DataFrame:
    """League mean V/game per season -- the secular trend (3PA has risen every year;
    both the raw sum and a naive team anchor lag it). The anchor optionally rides
    this trend so it is not permanently one year behind the league."""
    return vol.groupby("season", as_index=False).agg(
        **{f"{s}_lg": (f"{s}_pg", "mean") for s in USAGE})


def _recency_weighted(g: pd.DataFrame, target: int, col: str) -> float | None:
    """60/30/10-by-recency, times games, over target-3..target-1. None if no window."""
    num = wsum = 0.0
    idx = g.set_index("season")
    for lag, base in RECENCY.items():
        if (target - lag) in idx.index:
            row = idx.loc[target - lag]
            w = base * row["team_games"]
            num += w * row[col]
            wsum += w
    return num / wsum if wsum > 0 else None


def team_anchors(vol: pd.DataFrame, lg: pd.DataFrame, target: int,
                 trend: bool = True) -> pd.DataFrame:
    """Per-team anchor V/game for `target`: recency-weighted team history, optionally
    shifted by the league's own trend from the window to the target season.

    The league shift is a level correction, not a team-specific one: every team's
    3PA anchor rises by the same league-wide amount, which is the honest thing a
    recency prior can say about a leaguewide trend without team coaching intel. The
    system/coaching-change adjustment the plan mentions is genuinely human input --
    the team-total analogue of Stage 1's role-context -- and is left as a hook
    (team_system_mult) rather than guessed here.
    """
    lg_idx = lg.set_index("season")
    rows = []
    for team, g in vol.groupby("team"):
        rec = {s: _recency_weighted(g, target, f"{s}_pg") for s in USAGE}
        if any(v is None for v in rec.values()):
            continue
        if trend:
            for s in USAGE:
                lg_rec = _recency_weighted_series(lg_idx, target, f"{s}_lg", g)
                lg_pred = _extrapolate(lg_idx, target, f"{s}_lg")
                if lg_rec is not None and lg_pred is not None:
                    rec[s] += lg_pred - lg_rec
        rows.append({"team": team, "season": target, **{f"anchor_{s}": rec[s] for s in USAGE}})
    return pd.DataFrame(rows)


def _recency_weighted_series(lg_idx: pd.DataFrame, target: int, col: str,
                             team_g: pd.DataFrame) -> float | None:
    """League recency-weighted level over the same window/weights as the team anchor,
    so the trend shift subtracts like-for-like. Games weight comes from the team's own
    window (the league mean is per-team already, so any team's games are a fine proxy
    for 'this window's weighting')."""
    num = wsum = 0.0
    tg = team_g.set_index("season")
    for lag, base in RECENCY.items():
        s = target - lag
        if s in lg_idx.index and s in tg.index:
            w = base * tg.loc[s, "team_games"]
            num += w * lg_idx.loc[s, col]
            wsum += w
    return num / wsum if wsum > 0 else None


def _extrapolate(lg_idx: pd.DataFrame, target: int, col: str) -> float | None:
    """Linear extrapolation of the league level to `target` from the 3 prior seasons.
    Captures a monotone secular trend (3PA) while a flat/noisy series barely moves."""
    xs = [target - lag for lag in (3, 2, 1) if (target - lag) in lg_idx.index]
    if len(xs) < 2:
        return None
    ys = [lg_idx.loc[x, col] for x in xs]
    m, b = np.polyfit(xs, ys, 1)
    return float(m * target + b)


def reconcile(players: pd.DataFrame, anchors: pd.DataFrame, strength: float = 1.0,
              clip: tuple[float, float] = (0.5, 2.0)) -> pd.DataFrame:
    """Scale each player's bottom-up per-team-game volume so team sums hit the anchor.

    players: one row per (team, player) with columns bu_<s> = that player's projected
             per-team-game contribution to stat s (per36 rate x load / 36), for every
             s in USAGE and every paired make in MAKE_OF.
    anchors: per-team anchor_<s> = target team V/game.
    strength: 0 leaves the bottom-up sum untouched, 1 matches the anchor exactly. The
              usage total is meant to be hit, so 1.0 is the default; strength exists
              so the backtest can show the per-player accuracy curve and prove full
              reconciliation is the right call rather than assuming it.
    clip: per-team factor bounds. A team whose bottom-up sum is wildly off (a roster
          the model barely knows) should not have a single player's volume doubled on
          a runaway factor; the anchor is a prior, not gospel. Bounds are logged.

    Returns players with rec_<s> columns (reconciled per-team-game volume); paired
    makes are scaled by the SAME factor as their attempt, holding each shooting % fixed.
    """
    out = players.copy()
    a = anchors.set_index("team")
    factors = []
    for s in USAGE:
        sums = out.groupby("team")[f"bu_{s}"].transform("sum")
        target = out["team"].map(a[f"anchor_{s}"])
        raw = np.where(sums > 0, target / sums, 1.0)
        f = 1.0 + strength * (raw - 1.0)
        f = np.clip(f, clip[0], clip[1])
        out[f"f_{s}"] = f
        out[f"rec_{s}"] = out[f"bu_{s}"] * f
        if s in MAKE_OF:  # the make rides its attempt's factor -> FG%/FT%/3P% unchanged
            out[f"rec_{MAKE_OF[s]}"] = out[f"bu_{MAKE_OF[s]}"] * f
        factors.append(pd.Series(f, name=s))
    # 3PM can never exceed FGM: FGA and 3PM carry independent factors, so a heavy-3
    # shooter's made-threes could be nudged past his made-field-goals. Clamp the rare
    # violation and let FGM (which rides the larger, better-anchored FGA) stand.
    over = out["rec_fg3m"] > out["rec_fgm"]
    out.loc[over, "rec_fg3m"] = out.loc[over, "rec_fgm"]
    return out


def validate(out: pd.DataFrame, anchors: pd.DataFrame, strength: float,
             tol: float = 0.25) -> list[str]:
    """The assertion the stage rests on. At strength s the reconciled team sum is a
    convex blend (1-s)*bottom_up + s*anchor, NOT the anchor itself -- so the invariant
    is that each team's reconciled sum equals that blend (to tolerance; the factor clip
    and the 3PM<=FGM clamp can hold a runaway team slightly off on purpose). Also: no
    negative volume."""
    problems: list[str] = []
    a = anchors.set_index("team")
    for s in USAGE:
        got = out.groupby("team")[f"rec_{s}"].sum()
        bu = out.groupby("team")[f"bu_{s}"].sum()
        for team in got.index:
            if team not in a.index:
                continue
            want = (1 - strength) * bu[team] + strength * a.loc[team, f"anchor_{s}"]
            if abs(got[team] - want) > tol:
                # only a problem if the factor was NOT clipped -- a clipped team is
                # intentionally off the blend target.
                fcol = out.loc[out["team"] == team, f"f_{s}"].iloc[0]
                if 0.5 < fcol < 2.0:
                    problems.append(f"{team} {s}: reconciled {got[team]:.1f} != target {want:.1f}")
    neg = (out[[f"rec_{s}" for s in USAGE]] < 0).any(axis=1)
    if neg.any():
        problems.append(f"{int(neg.sum())} player-rows have negative reconciled volume")
    return problems
