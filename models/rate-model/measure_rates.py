"""Stage 2 gate check: is there persistent per-minute signal to project, and how
much category-specific regression does each stat need?

Stage 1 gives minutes. Stage 2 must give the per-minute PROFILE that minutes
multiply into a box score. Before choosing an architecture, two questions decide
how it is built — measure them, do not assume them:

  1. PERSISTENCE. Do per-36 rates carry from season to season at all? If a stat's
     year-over-year correlation is near zero, no model projects it — the honest
     projection is the positional mean, full stop. And per-36 has to persist
     SEPARATELY from minutes, or "rate is a skill distinct from opportunity" (the
     premise of splitting Stage 1 from Stage 2) is false and the split is theatre.

  2. STABILIZATION. Different stats settle at wildly different sample sizes — the
     Stage 2 plan calls for category-specific shrinkage, and this is where that
     number comes from. Split-half reliability on our own hoopR games gives, per
     stat, the games k at which the observed rate is half signal / half noise;
     shrink a player's rate toward the positional mean with weight k/(k+games).
     The hypothesis to confirm or kill: STL/BLK need far heavier shrinkage than
     PTS/REB. If every stat stabilizes the same, one global shrinkage suffices and
     the per-category machinery is unjustified.

Unlike the Stage 1 gate, this one does not decide WHETHER to build — something must
project rates. It decides the UNIT (per-36 vs per-game), whether regression is
per-category, and the baseline persistence a fitted model has to beat.

hoopR game box (2011-2026), regular season, real NBA franchises, minutes > 0.

Run: python models/rate-model/measure_rates.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import HOOPR_NBA_TEAMS, REGULAR_SEASON, SEASONS, ensure_parquet  # noqa: E402

# The stats Stage 2 must emit, as per-36 counting rates. FG/FT handled separately
# as (made, attempted) because a percentage is not a rate that averages — it is
# volume-weighted, exactly the discipline the V-score engine already applies.
COUNTING = ["points", "rebounds", "assists", "steals", "blocks",
            "three_point_field_goals_made", "turnovers"]
SHORT = {"points": "PTS", "rebounds": "REB", "assists": "AST", "steals": "STL",
         "blocks": "BLK", "three_point_field_goals_made": "3PM", "turnovers": "TOV"}
POS_MAP = {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}

MIN_GP_PERSIST = 30   # a season's rate means little on fewer games
SPLIT_GAMES = 20      # games per side for split-half; fixes sample size so k is clean
RNG = np.random.default_rng(0)


def load_games() -> pd.DataFrame:
    cols = ["season", "season_type", "game_id", "team_abbreviation", "athlete_id",
            "athlete_position_abbreviation", "minutes", "did_not_play",
            "field_goals_made", "field_goals_attempted", "free_throws_made",
            "free_throws_attempted"] + COUNTING
    frames = []
    for s in SEASONS:
        d = pd.read_parquet(ensure_parquet(s), columns=cols)
        d = d[(d["season_type"] == REGULAR_SEASON) & d["team_abbreviation"].isin(HOOPR_NBA_TEAMS)
              & (~d["did_not_play"].fillna(False)) & d["minutes"].notna() & (d["minutes"] > 0)]
        frames.append(d)
    g = pd.concat(frames, ignore_index=True)
    g["pos"] = g["athlete_position_abbreviation"].map(POS_MAP).fillna("F")
    return g


def season_rates(g: pd.DataFrame) -> pd.DataFrame:
    agg = {c: (c, "sum") for c in COUNTING}
    agg.update(min=("minutes", "sum"), gp=("minutes", "size"),
               fgm=("field_goals_made", "sum"), fga=("field_goals_attempted", "sum"),
               ftm=("free_throws_made", "sum"), fta=("free_throws_attempted", "sum"),
               pos=("pos", lambda s: s.mode().iat[0]))
    ps = g.groupby(["athlete_id", "season"]).agg(**agg).reset_index()
    for c in COUNTING:
        ps[SHORT[c] + "_36"] = 36 * ps[c] / ps["min"]
    ps["FGpct"] = ps["fgm"] / ps["fga"].clip(lower=1)
    ps["FTpct"] = ps["ftm"] / ps["fta"].clip(lower=1)
    ps["mpg"] = ps["min"] / ps["gp"]
    return ps


def persistence(ps: pd.DataFrame) -> None:
    print("\n=== 1. PERSISTENCE — season S to S+1 correlation (qualified both years) ===")
    nxt = ps.copy(); nxt["season"] = nxt["season"] - 1
    rate_cols = [SHORT[c] + "_36" for c in COUNTING] + ["FGpct", "FTpct"]
    j = ps.merge(nxt, on=["athlete_id", "season"], suffixes=("", "_n"))
    j = j[(j["gp"] >= MIN_GP_PERSIST) & (j["gp_n"] >= MIN_GP_PERSIST)]
    print(f"  {len(j)} player-season pairs, both seasons >= {MIN_GP_PERSIST} games.")
    print(f"  {'stat':<7} {'per-36 r':>9} {'per-game r':>11}   (minutes r = "
          f"{j['mpg'].corr(j['mpg_n']):.2f}, for reference)")
    for c in COUNTING:
        s = SHORT[c]
        r36 = j[s + "_36"].corr(j[s + "_36_n"])
        pg = (j[c] / j["gp"]).corr(j[c + "_n"] / j["gp_n"])
        print(f"  {s:<7} {r36:>9.2f} {pg:>11.2f}")
    for s in ("FGpct", "FTpct"):
        print(f"  {s:<7} {j[s].corr(j[s + '_n']):>9.2f} {'--':>11}")
    print("  (per-36 r near per-game r AND well above 0 => rate is a real, minutes-")
    print("   independent skill; that is the license to project it as its own stage.)")


def split_half(g: pd.DataFrame) -> None:
    print(f"\n=== 2. STABILIZATION — split-half reliability, {SPLIT_GAMES} games/side ===")
    # keep only players with enough games to draw two disjoint SPLIT_GAMES samples
    counts = g.groupby(["athlete_id", "season"])["minutes"].size()
    big = counts[counts >= 2 * SPLIT_GAMES].index
    gg = g.set_index(["athlete_id", "season"]).loc[big].reset_index()

    rows_a, rows_b = [], []
    for (aid, s), grp in gg.groupby(["athlete_id", "season"]):
        idx = RNG.permutation(len(grp))
        a = grp.iloc[idx[:SPLIT_GAMES]]; b = grp.iloc[idx[SPLIT_GAMES:2 * SPLIT_GAMES]]
        pos = grp["pos"].mode().iat[0]
        rows_a.append({**_half_rates(a), "pos": pos})
        rows_b.append({**_half_rates(b), "pos": pos})
    A, B = pd.DataFrame(rows_a), pd.DataFrame(rows_b)
    stats = [SHORT[c] for c in COUNTING] + ["FGpct", "FTpct"]

    # Pooled reliability conflates two things: how precise a 20-game estimate is, and
    # how far apart PLAYERS are. For a rate the model regresses toward the POSITIONAL
    # mean, only the within-position part is the signal — so residualize each stat by
    # its position mean before correlating. Pooled overstates reliability (hence
    # understates shrinkage) most for the stats with the biggest positional spread.
    Aw, Bw = A.copy(), B.copy()
    for s in stats:
        pooled_pos_mean = pd.concat([A[[s, "pos"]], B[[s, "pos"]]]).groupby("pos")[s].mean()
        Aw[s] = A[s] - A["pos"].map(pooled_pos_mean)
        Bw[s] = B[s] - B["pos"].map(pooled_pos_mean)

    print(f"  {len(A)} player-seasons with >= {2*SPLIT_GAMES} games. k = games until a")
    print(f"  rate is half signal; shrink toward positional mean with weight games/(games+k).")
    print(f"  {'stat':<7} {'pooled-r':>9} {'within-r':>9} {'k(within)':>10}   shrink")
    order = []
    for s in stats:
        rw = Aw[s].corr(Bw[s])
        order.append((s, A[s].corr(B[s]), rw))
    for s, rp, rw in sorted(order, key=lambda t: t[2]):  # noisiest (needs most shrink) first
        k = SPLIT_GAMES * (1 - rw) / rw if rw > 0 else float("inf")
        note = "light" if k < 25 else ("moderate" if k < 60 else "HEAVY")
        kdisp = f"{k:>7.0f}g" if np.isfinite(k) else "    inf"
        print(f"  {s:<7} {rp:>9.2f} {rw:>9.2f} {kdisp:>10}   {note}")
    print("  (within-r is the honest one: pooled-r borrows the positional spread as if")
    print("   it were reliability. The gap is largest exactly for REB/BLK.)")


def _half_rates(h: pd.DataFrame) -> dict:
    mins = h["minutes"].sum()
    d = {SHORT[c]: 36 * h[c].sum() / mins for c in COUNTING}
    d["FGpct"] = h["field_goals_made"].sum() / max(h["field_goals_attempted"].sum(), 1)
    d["FTpct"] = h["free_throws_made"].sum() / max(h["free_throws_attempted"].sum(), 1)
    return d


def positional_spread(ps: pd.DataFrame) -> None:
    print("\n=== 3. POSITIONAL MEANS — is the regression target position-specific? ===")
    q = ps[ps["gp"] >= MIN_GP_PERSIST]
    print(f"  per-36 mean by position group (n={len(q)} qualified player-seasons):")
    print(f"  {'stat':<7} {'G':>7} {'F':>7} {'C':>7}   spread")
    for c in COUNTING:
        s = SHORT[c]
        m = q.groupby("pos")[s + "_36"].mean()
        g_, f_, c_ = m.get("G", np.nan), m.get("F", np.nan), m.get("C", np.nan)
        spread = np.nanmax([g_, f_, c_]) - np.nanmin([g_, f_, c_])
        print(f"  {s:<7} {g_:>7.1f} {f_:>7.1f} {c_:>7.1f}   {spread:>5.1f}")
    print("  (big spread => a single league mean is the wrong prior; regress by position.)")


def main() -> None:
    g = load_games()
    print(f"player-games (regular season, real teams, played): {len(g)}")
    ps = season_rates(g)
    persistence(ps)
    split_half(g)
    positional_spread(ps)

    print("\n=== DECISION ===")
    print("  1. UNIT = per-36. Its persistence tracks per-game on every stat while")
    print("     minutes-r is only 0.77 — rate is a real, minutes-independent skill, so")
    print("     Stage 1 (minutes) x Stage 2 (rate) is a genuine factoring, not theatre.")
    print("  2. REGRESSION = per-category, toward the POSITIONAL mean, weight games/(games+k).")
    print("     But the plan's prior is WRONG: BLK is NOT high-variance (k~6g, as stable as")
    print("     REB) — rim protectors block consistently. The stats that need real shrinkage")
    print("     are FT% (k~29g) > FG% ~ STL (k~15g); the rest stabilize inside a week of games.")
    print("  3. SHOOTING shrinkage must key on ATTEMPTS, not games — k for FG%/FT% here is an")
    print("     average over the attempt distribution; a 3-FGA guard stabilizes far slower than")
    print("     a 20-FGA one. This is the volume-weighting the V-score engine already applies.")
    print("  4. Shrinkage bites hardest at low games (rookies, injury years), the exact regime")
    print("     feeding the engine as realized z-scores — the compression trap from Stage 1.")
    print("  5. BASELINE a fitted rate model must beat: last-season per-36, shrunk by these k,")
    print("     plus the age curve. That is the next build.")


if __name__ == "__main__":
    main()
