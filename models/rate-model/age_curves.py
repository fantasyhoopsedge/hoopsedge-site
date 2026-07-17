"""Stage 2, part 1: position-segmented age curves for per-36 production.

The rate model projects a player's per-minute profile from a recency-weighted
history — but that history was compiled at ages that differ from the season being
projected, and production moves with age. This fits, per position group and per
stat, HOW it moves, so the baseline can be nudged from its historical age to the
projection age.

THE TRAP, and the whole reason not to just average rate by age: survivorship.
Only the players who still produce are in the league at 34, so a cross-sectional
"mean per-36 by age" compares 24-year-olds to a harder-selected population of
34-year-olds and reports the decline as far too gentle. Measured here (guard PTS):
the naive curve fades ~2.4 per-36 from peak to 36; the within-player DELTA method
says ~6. The naive number would tell the model a 34-year-old guard is basically
still at his peak. He is not.

METHOD:
  1. Delta method — average each player's OWN consecutive-season change, then chain
     those deltas into a curve. This never compares one population to another.
  2. Season de-trend — subtract each season-transition's league-mean delta, so a
     leaguewide shift (rising 3PA, pace) is not read as aging. The plan's warning
     that pre-2018 aging research does not transfer is handled by fitting on our own
     data AND removing era drift.
  3. Gaussian-kernel smoothing over age (n-weighted), so thin old-age cells borrow
     from neighbours instead of spiking on 20 players.
  4. Counting stats become MULTIPLIERS (|yearly change| scales with level — corr
     .18-.51 — so a percentage travels across player tiers where a fixed offset does
     not). FG%/FT% stay ADDITIVE: they barely age and a ratio-of-a-ratio is nonsense.

USE (by the rate model, next build):
  counting: proj_rate = base_rate * mult[pos][stat][proj_age] / mult[pos][stat][base_age]
  shooting: proj_pct  = base_pct + (add[pos][stat][proj_age] - add[pos][stat][base_age])
where base_age is the recency-weighted mean age of the seasons in base_rate. The
ratio/difference form cancels the peak anchor, so the anchor is just a convention.

Writes output/rate-model/age-curves.json. Run: python models/rate-model/age_curves.py
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "minutes-allocator"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import HOOPR_NBA_TEAMS, REGULAR_SEASON, REPO, SEASONS, ensure_parquet  # noqa: E402
from minutes import load_panels  # noqa: E402

# per-36 counting rates (multiplicative curve) and shooting percentages (additive).
# FGA/FTA are volume rates carried so the projection can emit makes/attempts
# separately (FGM = FGA x FG%): the V-score engine's volume-weighted percentages
# require makes and attempts, never a bare percentage.
COUNTING = ["per36_pts", "per36_reb", "per36_ast", "per36_stl", "per36_blk",
            "per36_fg3m", "per36_tov", "per36_fga", "per36_fta"]
SHOOTING = ["fg_pct", "ft_pct"]
STATS = COUNTING + SHOOTING
SHORT = {"per36_pts": "PTS", "per36_reb": "REB", "per36_ast": "AST", "per36_stl": "STL",
         "per36_blk": "BLK", "per36_fg3m": "3PM", "per36_tov": "TOV",
         "per36_fga": "FGA", "per36_fta": "FTA", "fg_pct": "FG%", "ft_pct": "FT%"}
POS_MAP = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}

MIN_GP = 30          # a season's rate has to mean something to enter a delta
AGES = list(range(19, 40))
BW = 2.0             # kernel bandwidth in years
FLOOR = 0.30         # a multiplier never implies a player loses >70% of a skill
OUT = os.path.join(REPO, "output", "rate-model", "age-curves.json")


def load_positions() -> pd.DataFrame:
    """Most-played position per (athlete, season). Belongs in Stage 0 eventually —
    Stage 3 wants it too — but computed here while this is still its own sub-project."""
    frames = []
    for s in SEASONS:
        d = pd.read_parquet(ensure_parquet(s), columns=[
            "season", "season_type", "team_abbreviation", "athlete_id",
            "athlete_position_abbreviation", "minutes"])
        d = d[(d["season_type"] == REGULAR_SEASON) & d["team_abbreviation"].isin(HOOPR_NBA_TEAMS)
              & d["minutes"].notna() & (d["minutes"] > 0)]
        g = (d.groupby(["athlete_id", "season", "athlete_position_abbreviation"], as_index=False)
              .agg(m=("minutes", "sum")))
        frames.append(g.sort_values("m", ascending=False).drop_duplicates(["athlete_id", "season"]))
    p = pd.concat(frames, ignore_index=True)
    p["pos"] = p["athlete_position_abbreviation"].map(POS_MAP).fillna("F")
    return p[["athlete_id", "season", "pos"]]


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    ps, _ = load_panels()
    d = ps.merge(load_positions(), on=["athlete_id", "season"], how="left")
    d["pos"] = d["pos"].fillna("F")
    d["fg_pct"] = d["fgm"] / d["fga"].clip(lower=1)
    d["ft_pct"] = d["ftm"] / d["fta"].clip(lower=1)
    d["age_i"] = d["age"].round().astype("Int64")
    d = d[(d["gp"] >= MIN_GP) & d["age"].notna()].copy()

    nxt = d[["athlete_id", "season"] + STATS].copy()
    nxt["season"] = nxt["season"] - 1
    nxt = nxt.rename(columns={s: s + "_n" for s in STATS})
    pair = d[["athlete_id", "season", "pos", "age_i"] + STATS].merge(
        nxt, on=["athlete_id", "season"], how="inner")
    for s in STATS:
        pair[s + "_delta"] = pair[s + "_n"] - pair[s]
        pair[s + "_dd"] = pair[s + "_delta"] - pair.groupby("season")[s + "_delta"].transform("mean")
    return d, pair


SHRINK_K = 60.0      # pseudo-count: a pos/age cell needs ~this many pairs to outweigh
                     # the pooled curve. Tames near-zero cells (guard blocks) where a
                     # tiny positional level makes the multiplier explode on noise.


def _smoothed_delta(sub: pd.DataFrame, col: str) -> tuple[dict, dict]:
    """n-weighted Gaussian-smoothed mean delta by age, plus the effective n per age."""
    by = sub.groupby("age_i")[col].agg(["mean", "size"])
    idx = np.array(list(by.index), dtype=float)
    md, nn = {}, {}
    for a in AGES:
        w = np.exp(-0.5 * ((idx - a) / BW) ** 2) * by["size"].values
        nn[a] = float(w.sum())
        md[a] = float(np.sum(w * by["mean"].values) / w.sum()) if w.sum() > 0 else 0.0
    return md, nn


def kernel_chain(sub: pd.DataFrame, col: str, pooled: dict | None = None) -> dict[int, float]:
    """Smoothed delta chained to an offset curve anchored so peak (max) = 0. If a
    pooled all-position delta is given, shrink each cell toward it by effective n."""
    md, nn = _smoothed_delta(sub, col)
    if pooled is not None:
        md = {a: (nn[a] * md[a] + SHRINK_K * pooled[a]) / (nn[a] + SHRINK_K) for a in AGES}
    curve, run = {}, 0.0
    for a in AGES:
        curve[a] = run
        run += md[a]
    mx = max(curve.values())
    return {a: v - mx for a, v in curve.items()}


def fit_curves(d: pd.DataFrame, pair: pd.DataFrame) -> dict:
    curves = {"_meta": {"method": "delta+season-detrend+kernel", "bw": BW, "floor": FLOOR,
                        "multiplicative": [SHORT[s] for s in COUNTING],
                        "additive": [SHORT[s] for s in SHOOTING], "ages": [AGES[0], AGES[-1]]}}
    pooled_delta = {s: _smoothed_delta(pair, s + "_dd")[0] for s in STATS}
    pooled_off = {s: kernel_chain(pair, s + "_dd") for s in STATS}
    # A position's per-age SHAPE is only trustworthy where it actually accumulates the
    # stat. Below 40% of the top position's level (guard blocks, centre threes), there
    # is no signal — the fit peaks at 39 on noise — so use the pooled all-position
    # curve. This keeps the real signals (centre-block decline is the strongest in the
    # set) and drops only the cells a position barely records.
    top_level = {s: max(d[d["pos"] == P][s].mean() for P in ("G", "F", "C")) for s in COUNTING}
    pooled_mult = {s: {int(a): max(FLOOR, 1.0 + pooled_off[s][a] / max(d[s].mean(), 1e-6))
                       for a in AGES} for s in COUNTING}
    for P in ("G", "F", "C"):
        sub = pair[pair["pos"] == P]
        lvl = d[d["pos"] == P]
        curves[P] = {}
        for s in STATS:
            if s in SHOOTING:
                off = kernel_chain(sub, s + "_dd", pooled_delta[s])
                curves[P][SHORT[s]] = {int(a): round(off[a], 4) for a in AGES}   # % points
            elif lvl[s].mean() < 0.40 * top_level[s]:                            # thin cell
                curves[P][SHORT[s]] = dict(pooled_mult[s])
            else:
                off = kernel_chain(sub, s + "_dd", pooled_delta[s])
                L = max(lvl[s].mean(), 1e-6)
                curves[P][SHORT[s]] = {int(a): max(FLOOR, 1.0 + off[a] / L) for a in AGES}
    return curves


def validate(d: pd.DataFrame, pair: pd.DataFrame) -> None:
    """Does the curve beat assuming no age change? Fit on <=2021, test on 2022+, so
    the curve never sees its own test seasons. MAE of predicting next-year rate."""
    tr = pair[pair["season"] <= 2021]
    te = pair[pair["season"] >= 2022].copy()
    curves = fit_curves(d[d["season"] <= 2021], tr)
    print(f"\n=== VALIDATION — predict next-season rate, train<=2021 test>=2022 (n={len(te)}) ===")
    print(f"  {'stat':<5} {'MAE flat':>9} {'MAE +age':>9} {'gain':>7}")
    for s in STATS:
        base = te[s].to_numpy(float)
        actual = te[s + "_n"].to_numpy(float)
        pred = base.copy()
        for i, (P, a) in enumerate(zip(te["pos"], te["age_i"])):
            a0, a1 = int(a), int(a) + 1
            c = curves[P][SHORT[s]]
            if a0 in c and a1 in c:
                pred[i] = base[i] * c[a1] / c[a0] if s in COUNTING else base[i] + (c[a1] - c[a0])
        mae_flat = np.nanmean(np.abs(actual - base))
        mae_age = np.nanmean(np.abs(actual - pred))
        gain = 100 * (mae_flat - mae_age) / mae_flat
        print(f"  {SHORT[s]:<5} {mae_flat:>9.4f} {mae_age:>9.4f} {gain:>6.1f}%")
    print("  (positive gain = the age nudge reduces next-season error over 'no change'.)")


def survivorship_demo(d: pd.DataFrame, pair: pd.DataFrame) -> None:
    print("=== SURVIVORSHIP — guard PTS/36, naive level vs delta-chained ===")
    gd, gp = d[d["pos"] == "G"], pair[pair["pos"] == "G"]
    naive = gd.groupby("age_i")["per36_pts"].mean()
    off = kernel_chain(gp, "per36_pts_dd")
    n0 = naive.get(26, np.nan)
    print(f"  {'age':>3} {'naive':>7} {'delta-curve (per-36 from peak)':>32}")
    for a in (22, 26, 30, 34, 36):
        print(f"  {a:>3} {naive.get(a, np.nan):>7.2f} {off[a]:>+20.2f}")
    print(f"  naive fade peak->36: {n0 - naive.get(36, np.nan):.2f}/36 | "
          f"delta fade: {-off[36]:.2f}/36  (~{-off[36]/(n0-naive.get(36,np.nan)):.1f}x steeper)")


def main() -> None:
    d, pair = build()
    print(f"qualified player-seasons (>= {MIN_GP} gp): {len(d)} | consecutive pairs: {len(pair)}\n")
    survivorship_demo(d, pair)

    curves = fit_curves(d, pair)
    print("\n=== FITTED CURVES — multiplier vs peak (counting) / % offset (shooting) ===")
    for s in STATS:
        cells = []
        for P in ("G", "F", "C"):
            c = curves[P][SHORT[s]]
            if s in COUNTING:
                cells.append(f"{P} {c[36]/max(c[26],1e-6):.2f}@36")
            else:
                cells.append(f"{P} {c[36]-c[26]:+.3f}@36")
        peak = {P: max(curves[P][SHORT[s]], key=curves[P][SHORT[s]].get) for P in ("G", "F", "C")}
        print(f"  {SHORT[s]:<5} peak G/F/C={peak['G']}/{peak['F']}/{peak['C']}  "
              f"| vs26@36: {'  '.join(cells)}")

    validate(d, pair)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(curves, f, indent=2)
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
