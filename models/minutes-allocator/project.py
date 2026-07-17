"""Stage 1 applied to the real 2026-27 rosters — the artefact later stages read.

Reads:
  output/foundation/player_seasons.parquet   Stage 0 — the minutes history
  data/nba-rosters/2026-27.csv               who is on which team (the roster of record)
  data/nba-rosters/role-context-2026-27.csv  the manual role tiers (optional)
  output/rookie-translations-2026.json       Stage 4 — rookie MPG, for players with no NBA past

Writes output/stage1-minutes-2027.{parquet,json}: per player, projected MPG, games,
and load (minutes per team game), with every team summing to the 240 budget.

hoopR season numbering: 2027 == the 2026-27 season, so the priors are 2024-2026
(i.e. 2023-24 through 2025-26). Run build_foundation.py first.

Run: python models/minutes-allocator/project.py [--write-role-template]
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

from minutes import (
    ALPHA, DEFAULT_ROLE_TIER, MPG_CAP, ROLE_TIERS, TEAM_MINUTE_BUDGET, allocate, build_priors,
    load_panels,
)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO, name_candidates, normalize_name  # noqa: E402

TARGET_SEASON = 2027
ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
ROLE_CSV = os.path.join(REPO, "data", "nba-rosters", "role-context-2026-27.csv")
ROOKIE_JSON = os.path.join(REPO, "output", "rookie-translations-2026.json")
OUT_DIR = os.path.join(REPO, "output")

# "FA" is a roster STATUS, not a team — the one non-team placeholder in the
# ecosystem (see CLAUDE.md; never write "UFA"). Free agents must be dropped before
# allocation: handing the FA bucket a 240-minute budget would invent a 31st team
# and hand its unsigned players a rotation spot on it.
NOT_A_TEAM = {"FA"}


def load_roster() -> pd.DataFrame:
    r = pd.read_csv(ROSTER_CSV)
    r["norm_name"] = r["player"].map(normalize_name)
    dupes = r["norm_name"][r["norm_name"].duplicated()].tolist()
    if dupes:
        raise SystemExit(f"roster CSV has duplicate players: {dupes}")
    return r


def attach_ids(r: pd.DataFrame, ps: pd.DataFrame) -> pd.DataFrame:
    """Resolve each rostered player to a hoopR athlete_id via his name.

    Name is the only available key — the roster CSV is hand-maintained from cap
    sheets and carries no athlete_id — so this is the fragile join in Stage 1 and
    it is checked rather than trusted. Resolution goes through name_candidates(),
    which tries the nickname/legal-name aliases; without it the roster's "Cam
    Johnson" silently misses hoopR's "Cameron Johnson" and a starter drops to a
    rookie projection.

    Only seasons in the prior window are searched, so a player is matched to the
    identity that will actually supply his history.
    """
    recent = ps[ps["season"] >= TARGET_SEASON - 3][["athlete_id", "norm_name", "season"]]
    # Most games in the window wins, so a name collision resolves to the real player
    # rather than to whoever pandas happens to see first.
    recent = (recent.sort_values("season", ascending=False)
                    .drop_duplicates("norm_name")[["athlete_id", "norm_name"]])
    lookup = dict(zip(recent["norm_name"], recent["athlete_id"]))
    r["athlete_id"] = [
        next((lookup[c] for c in name_candidates(n) if c in lookup), np.nan)
        for n in r["norm_name"]
    ]
    return r


def load_role_tiers(r: pd.DataFrame) -> pd.DataFrame:
    """Attach the manual role multiplier. Absent file or absent player => no_change.

    Defaulting to 1.00 is the right default rather than a cop-out: most players'
    roles genuinely do not change, and the allocator only reads a multiplier
    RELATIVE to the rest of the roster, so an all-default team is unaffected.
    """
    r["role_tier"] = DEFAULT_ROLE_TIER
    r["role_note"] = ""
    if os.path.exists(ROLE_CSV):
        rc = pd.read_csv(ROLE_CSV)
        rc["norm_name"] = rc["player"].map(normalize_name)
        bad = sorted(set(rc["tier"]) - set(ROLE_TIERS))
        if bad:
            raise SystemExit(f"{ROLE_CSV}: unknown tier(s) {bad}; valid: {sorted(ROLE_TIERS)}")
        unknown = sorted(set(rc["norm_name"]) - set(r["norm_name"]))
        if unknown:
            raise SystemExit(
                f"{ROLE_CSV}: {len(unknown)} player(s) are not on any 2026-27 roster: "
                f"{unknown[:5]}. A role note for someone who is not on the team is either a "
                f"typo or a roster the CSV has not caught up with — fix one or the other."
            )
        m = dict(zip(rc["norm_name"], rc["tier"]))
        n = dict(zip(rc["norm_name"], rc.get("note", pd.Series(dtype=str))))
        r["role_tier"] = r["norm_name"].map(m).fillna(DEFAULT_ROLE_TIER)
        r["role_note"] = r["norm_name"].map(n).fillna("")
    r["role_mult"] = r["role_tier"].map(ROLE_TIERS)
    return r


def rookie_priors(ps: pd.DataFrame) -> tuple[dict[str, float], float, float]:
    """Stage 4's MPG for drafted rookies; league history for everyone else.

    Stage 4 covers the 62 players on the draft board. The roster carries ~125 with
    no NBA history — undrafted free agents, two-way signings, G League call-ups —
    and they are NOT on that board. They still occupy roster spots and take real
    minutes, so they cannot be dropped: leaving them out of the allocation would
    hand their share to the veterans above them. They get the historical median
    for a first-season player, which is the honest answer to "we know nothing
    about this man except that he is a rookie".
    """
    board = {}
    if os.path.exists(ROOKIE_JSON):
        doc = json.load(open(ROOKIE_JSON, encoding="utf-8"))
        for p in doc.get("players", []):
            # Board entries can carry projections: null (a prospect the model declined
            # to project). Falling through to the league median is the right answer
            # there — "no projection" is not "0 minutes".
            mpg = ((p.get("projections") or {}).get("mpg") or {}).get("p50")
            if mpg is not None:
                board[normalize_name(p["name"])] = float(mpg)

    # First NBA season per player, then the median MPG/availability of those seasons.
    #
    # Seasons whose "debut" is the first season in the panel are dropped: a player
    # observed in 2011 was not necessarily a rookie in 2011 — LeBron's first
    # observed season here is 2011, his eighth. Left-censoring puts every
    # established veteran of that era into the rookie pool and drags the median up,
    # which would then be handed to actual rookies as their projection.
    debut = ps.groupby("athlete_id")["season"].min().rename("debut")
    d = ps.merge(debut, on="athlete_id")
    first = d[(d["season"] == d["debut"]) & (d["debut"] > ps["season"].min())]
    return board, float(first["mpg"].median()), float(first["availability"].median())


def write_role_template(r: pd.DataFrame) -> None:
    """Emit an all-default role table to hand-edit. Never overwrites."""
    if os.path.exists(ROLE_CSV):
        raise SystemExit(f"{ROLE_CSV} already exists — refusing to overwrite your notes.")
    out = r.loc[~r["team"].isin(NOT_A_TEAM), ["team", "player"]].copy()
    out["tier"] = DEFAULT_ROLE_TIER
    out["note"] = ""
    out["source"] = ""
    out.sort_values(["team", "player"]).to_csv(ROLE_CSV, index=False)
    print(f"wrote {os.path.relpath(ROLE_CSV, REPO)} ({len(out)} rows, all {DEFAULT_ROLE_TIER}).")
    print(f"  Edit the `tier` column; valid tiers: {', '.join(ROLE_TIERS)}")
    print(f"  Only edit the players whose role actually changed — the default is correct for most.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-role-template", action="store_true",
                    help="create the manual role-context CSV scaffold and exit")
    args = ap.parse_args()

    ps, _ = load_panels()
    r = load_roster()
    if args.write_role_template:
        return write_role_template(r)

    print(f"Stage 1 — projecting {TARGET_SEASON} (the 2026-27 season) from {TARGET_SEASON-3}-"
          f"{TARGET_SEASON-1}")
    fa = r[r["team"].isin(NOT_A_TEAM)]
    r = r[~r["team"].isin(NOT_A_TEAM)].copy()
    print(f"  roster: {len(r)} players on {r['team'].nunique()} teams "
          f"({len(fa)} free agents held out — FA is a status, not a team)")
    if r["team"].nunique() != 30:
        raise SystemExit(f"expected 30 teams, found {r['team'].nunique()}: {sorted(r['team'].unique())}")

    r = attach_ids(r, ps)
    r = load_role_tiers(r)
    pri = build_priors(ps, [TARGET_SEASON])
    d = r.merge(pri.drop(columns="target_season"), on="athlete_id", how="left")
    d["target_season"] = TARGET_SEASON

    # --- rookies and the historyless.
    board, rk_mpg, rk_avail = rookie_priors(ps)
    d["is_rookie"] = d["base_mpg"].isna()
    d["source"] = np.where(~d["is_rookie"], "history", "rookie:league-median")
    from_board = d["norm_name"].map(lambda n: next((board[c] for c in name_candidates(n)
                                                    if c in board), np.nan))
    on_board = d["is_rookie"] & from_board.notna()
    d.loc[on_board, "source"] = "rookie:stage4"
    d["base_mpg"] = np.where(d["is_rookie"], np.where(on_board, from_board, rk_mpg), d["base_mpg"])
    d["availability"] = np.where(d["is_rookie"], rk_avail, d["availability"])

    vets_no_history = d[d["is_rookie"] & (d["yos"].astype(str) != "R")]
    print(f"  matched to hoopR history: {int((~d['is_rookie']).sum())} | "
          f"rookies from Stage 4: {int(on_board.sum())} | "
          f"rookies on league median ({rk_mpg:.1f} MPG): "
          f"{int((d['source'] == 'rookie:league-median').sum())}")
    if len(vets_no_history):
        # A non-rookie with no history is a name that did not join, and it is a
        # silent failure: he is projected as a rookie and his real minutes go to
        # his team-mates. Surface every one.
        print(f"  !! {len(vets_no_history)} NON-rookie(s) have no 3-year history — check for a "
              f"name-join miss (add to ROSTER_NAME_TO_HOOPR in common.py + its TS mirror):")
        for _, p in vets_no_history.iterrows():
            print(f"       {p['team']:>3} {p['player']} (yos {p['yos']})")

    # --- the formula.
    d["proj_mpg_raw"] = d["base_mpg"] * d["role_mult"]
    d["raw_load"] = d["proj_mpg_raw"] * d["availability"]
    al = allocate(d, alpha=ALPHA)
    al["proj_games"] = (al["availability"] * 82).round(1)

    # --- validation. The team budget is the assertion the whole stage rests on.
    sums = al.groupby("team")["proj_load"].sum()
    off = sums[(sums - TEAM_MINUTE_BUDGET).abs() > 0.5]
    print(f"\n  team minute budget: {sums.min():.1f}-{sums.max():.1f} "
          f"(target {TEAM_MINUTE_BUDGET})")
    if len(off):
        for t, v in off.items():
            print(f"  !! {t}: {v:.1f}")
        raise SystemExit("a team's minutes do not sum to the budget — the allocator is broken")
    if al["proj_mpg"].max() > MPG_CAP + 0.01:
        raise SystemExit(f"projected MPG above the {MPG_CAP} cap: {al['proj_mpg'].max():.1f}")
    neg = al[al["proj_load"] < 0]
    if len(neg):
        raise SystemExit(f"{len(neg)} negative minute projections")

    print(f"  roster size: {al.groupby('team').size().min()}-{al.groupby('team').size().max()} "
          f"players | projected MPG: {al['proj_mpg'].min():.1f}-{al['proj_mpg'].max():.1f}")
    tiers = al["role_tier"].value_counts()
    if set(tiers.index) == {DEFAULT_ROLE_TIER}:
        print(f"  role context: NOT APPLIED — every player is '{DEFAULT_ROLE_TIER}'. This is the "
              f"model with no human knowledge of the offseason in it. Run "
              f"--write-role-template and fill in the players whose roles moved.")
    else:
        print(f"  role context: {', '.join(f'{k}={v}' for k, v in tiers.items())}")

    cols = ["team", "player", "norm_name", "athlete_id", "target_season", "yos", "is_rookie",
            "source", "base_mpg", "role_tier", "role_mult", "availability", "proj_mpg",
            "proj_games", "proj_load", "n_hist"]
    out = al[cols].sort_values(["team", "proj_load"], ascending=[True, False])
    os.makedirs(OUT_DIR, exist_ok=True)
    pq = os.path.join(OUT_DIR, "stage1-minutes-2027.parquet")
    out.to_parquet(pq, index=False)
    js = os.path.join(OUT_DIR, "stage1-minutes-2027.json")
    with open(js, "w", encoding="utf-8") as fh:
        json.dump({
            "schemaVersion": 1,
            "stage": "1-minutes",
            "season": TARGET_SEASON,
            "seasonLabel": "2026-27",
            "budget": TEAM_MINUTE_BUDGET,
            "alpha": ALPHA,
            "roleContextApplied": set(tiers.index) != {DEFAULT_ROLE_TIER},
            "players": json.loads(out.to_json(orient="records")),
        }, fh, indent=2)
    print(f"\n  wrote {os.path.relpath(pq, REPO)} and {os.path.relpath(js, REPO)} ({len(out)} players)")

    print("\n  top projected minutes:")
    for _, p in out.nlargest(8, "proj_load").iterrows():
        print(f"    {p['team']:>3} {p['player']:<24} {p['proj_mpg']:5.1f} MPG x "
              f"{p['proj_games']:4.1f} G = {p['proj_load']:5.1f} min/team-game  [{p['source']}]")


if __name__ == "__main__":
    main()
