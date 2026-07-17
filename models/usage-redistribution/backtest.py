"""Does reconciling to the team anchor improve PER-PLAYER accuracy, not just team totals?

The gate check proved team usage totals are better predicted by the anchor than by
the bottom-up sum. But the artifact Stage 5 ships is per-player, and per-player is
what the V-score engine standardizes -- so the engine only earns its place if
redistributing the team total back onto players makes the INDIVIDUAL projections
better, not merely the team sums. It is not obvious it must: scaling a whole roster
by one factor to fix a total driven by one departed star could overshoot the
returning role players whose own volume was already right. This measures it.

Setup mirrors the gate check so the two are comparable: each player gets his own
recency-weighted per-36 rate and his ACTUAL minutes in the test season (Stage 1 owns
minutes; here we isolate what Stage 3 owns -- who takes the shots). We then compare,
at the (player, team, season) grain, the reconciled volume against the raw bottom-up
volume, both scored by mean absolute error vs the player's actual totals.

`strength` is the one knob (0 = raw bottom-up, 1 = team sums hit the anchor exactly).
It is tuned on 2014-2021 and reported once on 2022-2026, the same train/test split
rates.py uses. The league-trend term in the anchor is ablated the same way.

Run: python models/usage-redistribution/backtest.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO  # noqa: E402
from redistribute import (  # noqa: E402
    MAKE_OF, RECENCY, USAGE, league_curve, load_foundation, reconcile, team_anchors,
    team_volume,
)

TRAIN_MAX = 2021  # tune strength on <=2021, report once on >=2022 (rates.py's split)
STATS = USAGE + [MAKE_OF[s] for s in USAGE if s in MAKE_OF]


def player_bottomup(pts: pd.DataFrame, ts: pd.DataFrame) -> pd.DataFrame:
    """One row per (athlete, team, season) with bu_<s> = the player's projected
    per-team-game contribution to each stat: his recency-weighted per-36 rate x his
    ACTUAL minutes that season / 36, divided by the team's games. Rookies with no
    3-year history get the league-median per-36 rate (keyed to prior seasons only)."""
    # per-36 rate history per (athlete, season), pooled across teams (rate travels).
    psn = pts.groupby(["athlete_id", "season"], as_index=False).agg(
        min=("min", "sum"), gp=("gp", "sum"), **{s: (s, "sum") for s in STATS})
    for s in STATS:
        psn[f"r_{s}"] = np.where(psn["min"] > 0, psn[s] / psn["min"] * 36, 0.0)

    idx = {(a, s): row for (a, s), row in
           zip(zip(psn["athlete_id"], psn["season"]), psn.itertuples(index=False))}
    rcol = {s: psn.columns.get_loc(f"r_{s}") for s in STATS}
    gpc = psn.columns.get_loc("gp")

    prior_rows = []
    for a in psn["athlete_id"].unique():
        ss = psn.loc[psn["athlete_id"] == a, "season"]
        for t in range(int(ss.min()) + 1, int(ss.max()) + 2):
            num = {s: 0.0 for s in STATS}
            wsum = 0.0
            for lag, base in RECENCY.items():
                key = (a, t - lag)
                if key in idx:
                    row = idx[key]
                    w = base * row[gpc]
                    wsum += w
                    for s in STATS:
                        num[s] += w * row[rcol[s]]
            if wsum > 0:
                prior_rows.append({"athlete_id": a, "season": t,
                                   **{f"pr_{s}": num[s] / wsum for s in STATS}})
    priors = pd.DataFrame(prior_rows)

    # league-median per-36 fill for the historyless, from prior seasons only.
    med = {}
    for t in sorted(pts["season"].unique()):
        past = pts[(pts["season"] < t) & (pts["min"] > 100)]
        if len(past):
            med[t] = {s: float(np.nanmedian(past[s] / past["min"] * 36)) for s in STATS}

    j = pts.merge(priors, on=["athlete_id", "season"], how="left")
    j = j.merge(ts[["team", "season", "team_games"]], on=["team", "season"], how="left")
    j["is_rookie"] = j["pr_fga"].isna()
    for s in STATS:
        fill = j["season"].map(lambda t: med.get(t, {}).get(s, np.nan))
        rate = j[f"pr_{s}"].fillna(fill)
        # bottom-up per-team-game contribution, and the actual total to score against.
        j[f"bu_{s}"] = rate * j["min"] / 36.0 / j["team_games"]
        j[f"act_{s}"] = j[s] / j["team_games"]
    return j


def evaluate(bu: pd.DataFrame, vol: pd.DataFrame, lg: pd.DataFrame, seasons: list[int],
             strength: float, trend: bool) -> dict:
    """Per-player MAE (per-team-game units) for raw bottom-up vs reconciled, over the
    given seasons. Returns per-stat dicts plus the pooled usage-core average."""
    raw_ae = {s: [] for s in USAGE}
    rec_ae = {s: [] for s in USAGE}
    team_raw = {s: [] for s in USAGE}
    team_rec = {s: [] for s in USAGE}
    for t in seasons:
        players = bu[bu["season"] == t].copy()
        if not len(players):
            continue
        anchors = team_anchors(vol, lg, t, trend=trend)
        if not len(anchors):
            continue
        players = players[players["team"].isin(set(anchors["team"]))]
        out = reconcile(players, anchors, strength=strength)
        for s in USAGE:
            raw_ae[s].append((out[f"bu_{s}"] - out[f"act_{s}"]).abs())
            rec_ae[s].append((out[f"rec_{s}"] - out[f"act_{s}"]).abs())
            tg = out.groupby("team")
            team_raw[s].append((tg[f"bu_{s}"].sum() - tg[f"act_{s}"].sum()).abs())
            team_rec[s].append((tg[f"rec_{s}"].sum() - tg[f"act_{s}"].sum()).abs())
    res = {}
    for s in USAGE:
        res[s] = {
            "raw": pd.concat(raw_ae[s]).mean(), "rec": pd.concat(rec_ae[s]).mean(),
            "team_raw": pd.concat(team_raw[s]).mean(), "team_rec": pd.concat(team_rec[s]).mean(),
        }
    res["_player_core"] = np.mean([res[s]["rec"] for s in USAGE])
    res["_player_core_raw"] = np.mean([res[s]["raw"] for s in USAGE])
    return res


def main() -> None:
    pts, ts = load_foundation()
    vol = team_volume(pts, ts)
    lg = league_curve(vol)
    bu = player_bottomup(pts, ts)

    first = int(pts["season"].min())
    train = [t for t in range(first + 3, TRAIN_MAX + 1)]
    test = [t for t in range(TRAIN_MAX + 1, int(pts["season"].max()) + 1)]
    print(f"Stage 3 backtest -- per-player accuracy of usage redistribution")
    print(f"  train seasons {train[0]}-{train[-1]} | test seasons {test[0]}-{test[-1]}")

    # --- tune strength on the training seasons (with the league trend on).
    print(f"\n  tuning reconciliation strength on train (per-player usage-core MAE):")
    grid = [0.0, 0.25, 0.5, 0.75, 1.0]
    best, best_mae = 1.0, np.inf
    for stg in grid:
        r = evaluate(bu, vol, lg, train, strength=stg, trend=True)
        mark = ""
        if r["_player_core"] < best_mae:
            best_mae, best, mark = r["_player_core"], stg, "  <- best"
        print(f"    strength {stg:.2f}: player-core MAE {r['_player_core']:.4f}"
              f" (raw {r['_player_core_raw']:.4f}){mark}")

    # --- ablate the league-trend term at the chosen strength.
    print(f"\n  league-trend ablation at strength {best:.2f} (train):")
    for trend in (False, True):
        r = evaluate(bu, vol, lg, train, strength=best, trend=trend)
        print(f"    trend {'ON ' if trend else 'OFF'}: player-core MAE {r['_player_core']:.4f}"
              f"  | 3PA player MAE {r['fg3a']['rec']:.4f} team MAE {r['fg3a']['team_rec']:.4f}")

    # --- report ONCE on the held-out seasons.
    print(f"\n=== HELD-OUT TEST ({test[0]}-{test[-1]}), strength {best:.2f}, trend ON ===")
    r = evaluate(bu, vol, lg, test, strength=best, trend=True)
    print(f"  {'stat':>5} | {'player MAE':>18} | {'team MAE':>18} | player gain")
    print(f"  {'':>5} | {'raw':>8} {'reconciled':>9} | {'raw':>8} {'reconciled':>9} |")
    print("  " + "-" * 68)
    for s in USAGE:
        d = r[s]
        gain = (d["raw"] - d["rec"]) / d["raw"]
        print(f"  {s:>5} | {d['raw']:8.3f} {d['rec']:9.3f} | "
              f"{d['team_raw']:8.3f} {d['team_rec']:9.3f} | {gain:+6.1%}")
    core_gain = (r["_player_core_raw"] - r["_player_core"]) / r["_player_core_raw"]
    print(f"\n  usage-core per-player MAE: raw {r['_player_core_raw']:.4f} -> "
          f"reconciled {r['_player_core']:.4f}  ({core_gain:+.1%})")
    print(f"  -> reconciliation {'IMPROVES' if core_gain > 0 else 'HURTS'} per-player "
          f"accuracy; strength {best:.2f} ships.")


if __name__ == "__main__":
    main()
