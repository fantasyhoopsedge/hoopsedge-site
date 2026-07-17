"""Do the "breakout precursors" actually predict a minutes increase? Base rates, 2011-2026.

Fact-checks a public framework (DynastyHoopsHQ on X, 2026-07) that claims five
precursors identify breakout candidates before the market prices them. The
framework is interesting and testable, which is rarer than it sounds, so it gets
tested rather than adopted or dismissed.

WHY THIS SCRIPT EXISTS AT ALL: Stage 1's role_change_multiplier is the one input
in the model with no data behind it — a hand-maintained table of human judgement.
If these precursors are real and measurable, the multiplier could be derived
instead of asserted. That is the question here. Not "is the framework smart" but
"does it beat knowing a player's age and last season's minutes".

THE METHODOLOGICAL PROBLEM WITH THE ORIGINAL, which is the whole reason to measure:
it reasons backwards from known breakouts. "Run through last year's breakout list
and every single one had a displacement event." That is selecting on the dependent
variable. It establishes P(precursor | breakout), which can be 100% while the
precursor carries no information at all — nearly every young player has someone
aging or injury-prone ahead of him. The decision-useful quantity is the reverse,
P(breakout | precursor), against the base rate P(breakout). Only the second one
tells you whether to buy. So every number below is a forward rate on a population
defined BEFORE the outcome is known.

To be fair to the source, it makes the right SHAPE of claim — "which precursor-rich
player converts in which season is close to unpredictable... portfolio, not sniper"
is precisely a base-rate claim, and that is what is measured here. It also gets the
mechanism right in a way worth keeping regardless of the numbers: a breakout is an
existing per-minute profile getting multiplied by minutes, and minutes are a
coach's decision. That is the same identity Stage 1 is built on.

PRECURSOR 1, the costly signal (a new contract), is the hardest to test — the repo
has no historical contract panel, only the current 2026-27 cap sheet. But that
snapshot can be BACK-SOLVED: in hoopR numbering a deal's first season equals
(fa_year + option-suffix) - length + 1, so each rostered player's CURRENT deal
yields exactly one signing season. That is one signing per player, survivors only,
not a history — so precursor 1 is measured on its own (see precursor1()) and kept
OUT of both the clean 2011-2026 precursor table and the model below, because mixing
a survivor-only feature into either would leak survival and inflate everything.

The finding, and it is the opposite of the raw number: the headline ~2x lift is
ENTIRELY rookie-scale contracts — a player on his CBA-mandated first deal is just
"young and ascending", which age already carries. Strip the rookie deals to leave
only the ones a front office CHOSE to sign — precursor 1's actual claim — and the
lift collapses to ~1.2x on ~20 players with 2 breakouts. Underpowered, and null for
the framework's real claim. Saying more needs a historical salary source; the
back-solve reaches exactly one recent survivor cohort and no further.

Run: python models/breakout-precursors/measure.py
"""

from __future__ import annotations

import os
import re
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "minutes-allocator"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import (  # noqa: E402
    HOOPR_NBA_TEAMS, REGULAR_SEASON, REPO, SEASONS, ensure_parquet, name_candidates,
    normalize_name,
)
from minutes import load_panels  # noqa: E402

# Back-solving precursor 1 reads the same roster of record Stage 1 allocates on.
ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
ROSTER_SEASON = 2027  # hoopR: 2027 == the 2026-27 roster this snapshot describes.

# The candidate pool, taken from the framework's own words: "elite per-36 profiles
# playing under 24 minutes are the cheapest inventory in dynasty". 20 games is the
# floor for a rate to mean anything.
MPG_CEILING = 24.0
MIN_GP = 20

# "What changed was 25 minutes becoming 33." A breakout is a real jump in role AND
# arriving somewhere that matters — +5 MPG from 4 to 9 is not what anyone is buying.
BREAKOUT_DELTA = 5.0
BREAKOUT_FLOOR = 24.0

RATE_COLS = ["per36_pts", "per36_reb", "per36_ast", "per36_stl", "per36_blk"]


def load_positions() -> pd.DataFrame:
    """Most-played position per (athlete, season) from the box feed.

    Stage 0 does not carry position, and displacement is inherently positional — a
    guard is not blocked by an aging centre. Computed here rather than added to the
    foundation because this is a research question; if precursors earn a place in
    the model, position belongs in Stage 0 (Stage 3 will want it too).
    """
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
    p["pos"] = p["athlete_position_abbreviation"].map(
        {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}
    ).fillna("F")
    return p[["athlete_id", "season", "pos"]]


def build(ps: pd.DataFrame, pos: pd.DataFrame) -> pd.DataFrame:
    d = ps.merge(pos, on=["athlete_id", "season"], how="left")
    d["pos"] = d["pos"].fillna("F")

    # --- rate_score: per-36 production, z-scored WITHIN season and position.
    # Position matters: a centre's per-36 rebounds are not evidence of anything
    # against a guard's. Season matters: league rates drift. Crude but transparent —
    # this is a production composite, not a value model (that is Stage 5's job).
    league = d[d["gp"] >= MIN_GP].copy()
    z = []
    for c in RATE_COLS + ["per36_tov"]:
        g = league.groupby(["season", "pos"])[c]
        z.append(((league[c] - g.transform("mean")) / g.transform("std")).rename("z_" + c))
    league = pd.concat([league] + z, axis=1)
    league["rate_score"] = (league[["z_" + c for c in RATE_COLS]].sum(axis=1)
                            - league["z_per36_tov"])
    return league


def add_outcomes(d: pd.DataFrame) -> pd.DataFrame:
    nxt = d[["athlete_id", "season", "mpg", "gp"]].copy()
    nxt["season"] = nxt["season"] - 1
    nxt = nxt.rename(columns={"mpg": "next_mpg", "gp": "next_gp"})
    d = d.merge(nxt, on=["athlete_id", "season"], how="left")

    # A player with no next season did not break out — he left the league. Dropping
    # him would condition on survival and inflate every rate below, since washing
    # out is precisely the risk a "buy the precursor profile" strategy is taking.
    # He is scored as 0 MPG, not as missing.
    d["next_mpg"] = d["next_mpg"].fillna(0.0)
    d["survived"] = d["next_gp"].notna()
    d["d_mpg"] = d["next_mpg"] - d["mpg"]
    d["breakout"] = (d["d_mpg"] >= BREAKOUT_DELTA) & (d["next_mpg"] >= BREAKOUT_FLOOR)
    return d


def add_precursors(d: pd.DataFrame, league: pd.DataFrame) -> pd.DataFrame:
    # --- 2. rate before volume: a strong per-minute profile, at low minutes.
    q = league.groupby("season")["rate_score"].transform(lambda s: s.rank(pct=True))
    league = league.assign(rate_pct=q)
    d = d.merge(league[["athlete_id", "season", "rate_pct"]], on=["athlete_id", "season"],
                how="left")
    d["p2_rate"] = d["rate_pct"] >= 0.75

    # --- 3. displacement inventory: someone ahead of him, at his position, who is
    # old or fragile. "Expiring/trade-rumoured" is not testable (no contract history),
    # so this is the measurable half of the claim.
    # Renamed explicitly rather than via merge suffixes: age/availability exist only
    # on the team-mate side, so a suffix would never be applied to them and the
    # columns would silently collide with the candidate's own.
    ahead = league[["athlete_id", "season", "primary_team", "pos", "mpg", "age",
                    "availability"]].rename(columns={
        "athlete_id": "athlete_id_tm", "mpg": "mpg_tm", "age": "age_tm",
        "availability": "availability_tm"})
    pairs = d[["athlete_id", "season", "primary_team", "pos", "mpg"]].merge(
        ahead, on=["season", "primary_team", "pos"])
    pairs = pairs[(pairs["athlete_id"] != pairs["athlete_id_tm"])
                  & (pairs["mpg_tm"] > pairs["mpg"])]
    agg = pairs.groupby(["athlete_id", "season"], as_index=False).agg(
        aging_ahead=("age_tm", lambda s: bool((s >= 30).any())),
        fragile_ahead=("availability_tm", lambda s: bool((s <= 0.75).any())),
        n_ahead=("athlete_id_tm", "size"),
    )
    d = d.merge(agg, on=["athlete_id", "season"], how="left")
    for c in ("aging_ahead", "fragile_ahead"):
        d[c] = d[c].fillna(False).astype(bool)
    d["n_ahead"] = d["n_ahead"].fillna(0)
    d["p3_displacement"] = d["aging_ahead"] | d["fragile_ahead"]

    # --- 4. two-season ramp: his rates moved LAST year. "Year one moves the rates,
    # year two moves the totals" — so the buy signal is rate growth already banked.
    prev = league[["athlete_id", "season", "rate_score"]].copy()
    prev["season"] = prev["season"] + 1
    prev = prev.rename(columns={"rate_score": "prev_rate_score"})
    d = d.merge(prev, on=["athlete_id", "season"], how="left")
    d["p4_ramp"] = (d["rate_score"] - d["prev_rate_score"]) > 0

    # --- 5. stacking.
    d["n_signals"] = d[["p2_rate", "p3_displacement", "p4_ramp"]].sum(axis=1)
    return d


def rate_table(d: pd.DataFrame, col: str, label: str, base: float) -> None:
    for val in (True, False):
        g = d[d[col] == val]
        if not len(g):
            continue
        r = g["breakout"].mean()
        tag = "yes" if val else "no "
        print(f"  {label:<26} {tag} | {len(g):5d} | {100*r:5.1f}% | {r/base:5.2f}x")


def load_signings(ps: pd.DataFrame) -> pd.DataFrame:
    """Back-solve each rostered player's CURRENT contract into its signing season.

    hoopR season numbering (2027 == 2026-27), so a deal's first season is
    (fa_year + option-suffix) - length + 1. Verified against known deals: NAW
    (4yr, FA 2029) -> 2026 (signed summer 2025); Hield (4yr, FA "2027 +1"=2028)
    -> 2025 (signed summer 2024). The "+N" suffix is player/team option years the
    cap sheet appends after the guaranteed FA year, so it is added back in.

    rookie_scale flags the CBA-mandated first deal (signed at <=0 years of service),
    which is NOT a front office "choosing to bid" — the distinction precursor 1 is
    actually about, and the one that turns the result from 2x to noise.

    athlete_id is resolved by name through the SAME name_candidates() aliases the
    Stage 1 allocator uses, so the roster's "Cam Johnson" reaches hoopR's "Cameron
    Johnson" instead of silently dropping.
    """
    r = pd.read_csv(ROSTER_CSV)
    r["norm_name"] = r["player"].map(normalize_name)

    def parse(row: pd.Series) -> pd.Series:
        m = re.match(r"(\d+)\s*yr", str(row["contract"]))
        fa = str(row["fa_year"]).strip()
        if not m or not fa or fa.lower() == "nan":
            return pd.Series([np.nan, np.nan])  # two-way / Exhibit 10 / RFA / no FA year
        length = int(m.group(1))
        parts = fa.replace("+", " ").split()
        eff_fa = int(parts[0]) + (int(parts[1]) if len(parts) > 1 else 0)
        return pd.Series([eff_fa - length + 1, length])

    r[["sign_season", "clen"]] = r.apply(parse, axis=1)
    r = r[r["sign_season"].notna()].copy()
    r["sign_season"] = r["sign_season"].astype(int)
    r["clen"] = r["clen"].astype(int)

    yos = pd.to_numeric(r["yos"].replace("R", 0), errors="coerce")
    r["yos_at_sign"] = yos - (ROSTER_SEASON - r["sign_season"])
    r["rookie_scale"] = r["yos_at_sign"] <= 0

    lookup = dict(zip(ps.sort_values("season", ascending=False)
                        .drop_duplicates("norm_name")["norm_name"],
                      ps.sort_values("season", ascending=False)
                        .drop_duplicates("norm_name")["athlete_id"]))
    r["athlete_id"] = [next((lookup[c] for c in name_candidates(n) if c in lookup), np.nan)
                       for n in r["norm_name"]]
    r = r.dropna(subset=["athlete_id"])
    return r[["athlete_id", "sign_season", "clen", "rookie_scale"]]


def precursor1(pool: pd.DataFrame, ps: pd.DataFrame, base: float) -> None:
    """Precursor 1, measured alone on the one survivor cohort the snapshot reaches.

    Kept out of the pooled precursor table and the model on purpose: contract data
    exists only for players still rostered today, so a "not paid" control silently
    mixes in everyone who washed out (they have no current deal), which biases the
    lift UPWARD. Every number here is therefore an optimistic ceiling, and the point
    is that even the ceiling is null once rookie-scale deals are removed.
    """
    sign = load_signings(ps)
    my = sign[sign["clen"] >= 2]  # a one-year deal is not "the org betting early"
    paid = {(a, s) for a, s in zip(my["athlete_id"], my["sign_season"])}
    mkt = {(a, s) for a, s, rk in zip(my["athlete_id"], my["sign_season"], my["rookie_scale"])
           if not rk}
    p = pool.copy()
    p["p1_paid"] = [(a, s) in paid for a, s in zip(p["athlete_id"], p["season"])]
    p["p1_market"] = [(a, s) in mkt for a, s in zip(p["athlete_id"], p["season"])]

    lo, hi = my["sign_season"].min(), SEASONS[-1] - 1
    cov = p[p["season"].between(lo, hi)]
    print(f"\n1. THE COSTLY SIGNAL — back-solved from the current cap sheet (survivors only,")
    print(f"   one deal per player; kept out of the table above and the model below).")
    print(f"   coverage: signings land {lo}-{hi}; that window's pool base is "
          f"{100*cov['breakout'].mean():.1f}% (n={len(cov)}).")
    print(f"  {'':<30} | {'n':>4} | {'brk':>3} | {'rate':>5} | {'lift':>5}")
    for col, lbl in (("p1_paid", "signed multi-yr (incl rookie)"),
                     ("p1_market", "   of which team CHOSE to")):
        g = p[p[col]]
        if not len(g):
            continue
        r = g["breakout"].mean()
        print(f"  {lbl:<30} | {len(g):4d} | {int(g['breakout'].sum()):3d} | "
              f"{100*r:4.1f}% | {r/base:4.2f}x")
    print("  => the 2x is rookie-scale (== young + ascending, already in 'age'). The deals")
    print("     a front office actually chose to sign are ~base-rate on ~20 players. Null.")


def main() -> None:
    ps, _ = load_panels()
    print("Breakout precursors — do they predict a minutes jump? (hoopR 2011-2026)\n")
    pos = load_positions()
    league = build(ps, pos)
    d = add_outcomes(league)
    d = add_precursors(d, league)

    # The pool is defined by season-S facts only. No outcome touches it.
    pool = d[(d["mpg"] < MPG_CEILING) & (d["gp"] >= MIN_GP) & (d["season"] < SEASONS[-1])].copy()
    base = pool["breakout"].mean()
    print(f"POOL: {len(pool)} player-seasons under {MPG_CEILING:.0f} MPG with >={MIN_GP} games.")
    print(f'BREAKOUT = next season >= +{BREAKOUT_DELTA:.0f} MPG AND >= {BREAKOUT_FLOOR:.0f} MPG.')
    print(f"BASE RATE: {100*base:.1f}% ({int(pool['breakout'].sum())} of {len(pool)}).")
    print(f"  ({100*(1-pool['survived'].mean()):.1f}% of the pool has no next season at all — "
          f"scored as non-breakouts, not dropped.)\n")

    print("Is 24 MPG the right ceiling? Breakout rate by current MPG band:")
    b = d[(d["gp"] >= MIN_GP) & (d["season"] < SEASONS[-1])].copy()
    b["band"] = pd.cut(b["mpg"], [0, 8, 12, 16, 20, 24, 28, 48])
    for band, g in b.groupby("band", observed=True):
        print(f"  {str(band):<10} n={len(g):5d}  breakout {100*g['breakout'].mean():5.1f}%")

    print(f"\n{'PRECURSOR':<26} {'':<3} | {'n':>5} | {'breakout':>6} | {'lift':>5}")
    print(f"  {'-'*62}")
    rate_table(pool, "p2_rate", "2. rate before volume", base)
    rate_table(pool, "p3_displacement", "3. displacement", base)
    rate_table(pool, "aging_ahead", "   3a. aging ahead", base)
    rate_table(pool, "fragile_ahead", "   3b. fragile ahead", base)
    rate_table(pool, "p4_ramp", "4. two-season ramp", base)

    print(f"\n5. SIGNAL STACKING — 'the best bets rarely hinge on one clue':")
    print(f"  {'signals':<8} | {'n':>5} | {'breakout':>6} | {'lift':>5}")
    for n, g in pool.groupby("n_signals"):
        r = g["breakout"].mean()
        print(f"  {int(n):<8} | {len(g):5d} | {100*r:5.1f}% | {r/base:5.2f}x")

    precursor1(pool, ps, base)

    # --- The real question. Precursors are all correlated with being a young player
    # on a weak team, which is knowable without any framework. Do they add anything
    # over age and current minutes? Trained on 2011-2021, tested on 2022-2025 — a
    # time split, because a random split would leak the era.
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    pool = pool[pool["age"].notna()].copy()
    tr, te = pool[pool["season"] <= 2021], pool[pool["season"] > 2021]
    baseline = ["age", "mpg", "gp", "start_rate"]
    full = baseline + ["rate_pct", "p3_displacement", "p4_ramp", "n_ahead", "aging_ahead",
                       "fragile_ahead"]
    print(f"\n=== DO THEY ADD ANYTHING? (train {tr['season'].min()}-2021, test 2022-2025) ===")
    print(f"  train {len(tr)} / test {len(te)}")
    for label, feats in (("age + mpg + gp + start_rate", baseline), ("+ all precursors", full)):
        m = GradientBoostingClassifier(random_state=0)
        m.fit(tr[feats].astype(float), tr["breakout"])
        auc = roc_auc_score(te["breakout"], m.predict_proba(te[feats].astype(float))[:, 1])
        print(f"  {label:<28} AUC {auc:.3f}")
    print("  (0.5 = coin flip. If the two are equal, the precursors are re-describing age")
    print("   and minutes, which you already knew — no framework required.)")


if __name__ == "__main__":
    main()
