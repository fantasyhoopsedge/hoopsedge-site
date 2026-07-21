"""Stage 2 applied to the real 2026-27 roster — the per-36 rate artifact Stage 5 reads.

Mirrors Stage 1's project.py, for rates instead of minutes. For every rostered
VETERAN (a player with qualifying NBA history), projects his 2026-27 per-36 profile
via the full rate model (age_curves + rates), and emits makes/attempts separately so
the V-score engine's volume-weighted percentages stay correct — never a bare FG%/FT%.

Rookies and players with no >=30-game season in the 2024-2026 window are NOT here:
their rates come from Stage 4 (rookie translation). This artifact is the veteran half
of the input Stage 5 multiplies by Stage 1 minutes.

hoopR numbering: 2027 == 2026-27. Priors are 2024-2026 (2023-24 .. 2025-26). Run
build_foundation.py first.

Writes output/rate-model/stage2-rates-2027.{parquet,json}.
Run: python models/rate-model/project_roster.py
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from age_curves import COUNTING, SHORT, STATS, build, fit_curves  # noqa: E402
from common import REPO, name_candidates, normalize_name  # noqa: E402
from rates import (  # noqa: E402
    WINDOW, _pairs, clip_age, league_att_per_game, neutral_pos_means, project,
)

TARGET = 2027
ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
OUT_DIR = os.path.join(REPO, "output", "rate-model")
EMIT = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TOV", "FGM", "FGA", "FTM", "FTA"]


def main() -> None:
    d, _ = build()
    curves = fit_curves(d, _pairs(d))            # fit on ALL data for the real projection
    pmeans = neutral_pos_means(d, curves)
    att_pg = league_att_per_game(d)

    roster = pd.read_csv(ROSTER_CSV)
    roster["norm_name"] = roster["player"].map(normalize_name)
    roster["age"] = pd.to_numeric(roster["age"], errors="coerce")

    # resolve athlete_id by name through the same aliases Stage 1 uses
    recent = d.sort_values("season", ascending=False).drop_duplicates("norm_name")
    lookup = dict(zip(recent["norm_name"], recent["athlete_id"]))
    pos_last = dict(zip(recent["norm_name"], recent["pos"]))

    records, no_hist = [], []
    for _, r in roster.iterrows():
        aid = next((lookup[c] for c in name_candidates(r["norm_name"]) if c in lookup), None)
        if aid is None or pd.isna(r["age"]):
            no_hist.append(r["player"]); continue
        h = d[(d["athlete_id"] == aid) & (d["season"] < TARGET)
              & (d["season"] >= TARGET - WINDOW)].copy()
        if not len(h):
            no_hist.append(r["player"]); continue
        h["_lag"] = TARGET - h["season"]
        pos = pos_last.get(r["norm_name"], "F")
        rate = project(h, r["age"], pos, curves, pmeans, att_pg)
        rate["FGM"] = rate["FGA"] * rate["FG%"]
        rate["FTM"] = rate["FTA"] * rate["FT%"]
        rec = {"athlete_id": int(aid), "player": r["player"], "team": r["team"], "pos": pos,
               "age": round(float(r["age"]), 1), "hist_seasons": int(len(h)),
               "hist_gp": int(h["gp"].sum())}
        rec.update({k: round(float(rate[k]), 3) for k in EMIT})
        rec["FG%"] = round(float(rate["FG%"]), 3)
        rec["FT%"] = round(float(rate["FT%"]), 3)
        records.append(rec)

    out = pd.DataFrame(records).sort_values(["team", "player"]).reset_index(drop=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    out.to_parquet(os.path.join(OUT_DIR, "stage2-rates-2027.parquet"), index=False)
    with open(os.path.join(OUT_DIR, "stage2-rates-2027.json"), "w") as f:
        json.dump(records, f, indent=2)

    print(f"projected {len(out)} veterans; {len(no_hist)} rostered players have no "
          f"qualifying history (rookies / deep bench -> Stage 4).")
    print(f"  identity check: mean |PTS - (2*FGM + FTM + 3PM)| per-36 = "
          f"{(out['PTS'] - (2*out['FGM'] + out['FTM'] + out['3PM'])).abs().mean():.2f}")
    show = ["player", "team", "pos", "age", "PTS", "REB", "AST", "STL", "BLK", "3PM",
            "TOV", "FGM", "FGA", "FTM", "FTA", "FG%", "FT%"]
    print("\nsample (per-36) — a few stars:")
    for name in ("Nikola Jokic", "Anthony Edwards", "Stephen Curry", "Victor Wembanyama"):
        row = out[out["player"] == name]
        if len(row):
            print("  " + "  ".join(f"{row.iloc[0][c]}" if c in ("player","team","pos")
                                    else f"{c}={row.iloc[0][c]}" for c in show[3:]))
            print(f"    ({name})")
    print(f"\nwrote {OUT_DIR}\\stage2-rates-2027.{{parquet,json}}")


if __name__ == "__main__":
    main()
