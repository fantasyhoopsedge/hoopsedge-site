"""Stage 3 applied to 2026-27: the team-total usage anchors Stage 5 reconciles toward.

Stage 3 owns two things: the reconcile() mechanism (redistribute.py, validated on 15
seasons by backtest.py) and the ANCHORS it reconciles toward -- the per-team target
V/game for FGA, FTA, 3PA, AST, TOV. This script produces the second for the real
2026-27 season. Stage 5, when it assembles each roster's bottom-up volume from Stage 1
minutes x Stage 2/4 rates, will import reconcile() and pull those sums toward these
anchors at SHIP_STRENGTH.

The anchor is each team's own recency-weighted V/game (60/30/10 x games over 2024-2026),
plus a league-trend term so the 3PA anchor is not permanently a year behind the league's
still-rising 3-point volume. The system/coaching-change adjustment the plan mentions is
human input -- the team-total analogue of Stage 1's role-context -- and is left as a hook
(team_system_mult, defaulting to 1.0) rather than guessed here; wire it in alongside
Ash's role-context pass before the final Stage 5 artifact.

hoopR numbering: 2027 == 2026-27; priors are seasons 2024-2026. Run build_foundation.py
first. Writes output/usage-redistribution/team-anchors-2027.json.
Run: python models/usage-redistribution/project_anchors.py
"""

from __future__ import annotations

import json
import os

import pandas as pd

from redistribute import (
    USAGE, RECENCY, league_curve, load_foundation, team_anchors, team_volume, REPO,
)

TARGET = 2027
OUT_DIR = os.path.join(REPO, "output", "usage-redistribution")


def main() -> None:
    pts, ts = load_foundation()
    vol = team_volume(pts, ts)
    lg = league_curve(vol)

    anchors = team_anchors(vol, lg, TARGET, trend=True)
    if len(anchors) != 30:
        raise SystemExit(f"expected 30 team anchors, got {len(anchors)}: "
                         f"{sorted(anchors['team'])}")

    # sanity: anchors must sit in a plausible NBA band, and 3PA should ride ABOVE the
    # most recent season on the still-rising league trend (that is the term's whole job).
    last = vol[vol["season"] == TARGET - 1].set_index("team")
    a = anchors.set_index("team")
    bands = {"fga": (80, 96), "fta": (16, 30), "fg3a": (25, 48), "ast": (18, 33), "tov": (10, 18)}
    problems = []
    for s in USAGE:
        lo, hi = bands[s]
        bad = a[(a[f"anchor_{s}"] < lo) | (a[f"anchor_{s}"] > hi)]
        for team, row in bad.iterrows():
            problems.append(f"{team} anchor_{s}={row[f'anchor_{s}']:.1f} outside [{lo},{hi}]")
    if problems:
        for p in problems:
            print(f"  !! {p}")
        raise SystemExit("an anchor is outside its plausible band -- check the trend term")

    print(f"Stage 3 anchors -- {TARGET} (2026-27), recency 2024-2026 + league trend")
    print(f"  30 teams; per-team target V/game for {', '.join(u.upper() for u in USAGE)}\n")
    print(f"  league mean anchor vs 2026 actual (the trend term's effect):")
    for s in USAGE:
        print(f"    {s.upper():>4}: anchor {a[f'anchor_{s}'].mean():5.1f}  "
              f"2026 actual {last[f'{s}_pg'].mean():5.1f}  "
              f"trend {a[f'anchor_{s}'].mean() - last[f'{s}_pg'].mean():+.2f}")

    # a few teams that changed a lot, so the anchor is legible.
    a["fga_move"] = a["anchor_fga"] - last["fga_pg"]
    print(f"\n  biggest FGA/game anchor moves vs 2026 (recency pulls multi-year, not just last):")
    movers = a.reindex(a["fga_move"].abs().sort_values(ascending=False).index).head(6)
    for team, row in movers.iterrows():
        print(f"    {team:>3}: 2026 {last.loc[team, 'fga_pg']:5.1f} -> anchor "
              f"{row['anchor_fga']:5.1f} ({row['fga_move']:+.1f})")

    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "stage": "3-usage-anchors",
        "season": TARGET,
        "seasonLabel": "2026-27",
        "priorWindow": [TARGET - 3, TARGET - 1],
        "recency": {str(k): v for k, v in RECENCY.items()},
        "leagueTrend": True,
        "usageStats": USAGE,
        "note": ("Per-team target V/game. Stage 5 reconciles the assembled bottom-up "
                 "(minutes x rates) toward these at SHIP_STRENGTH via redistribute.reconcile(). "
                 "STL/BLK/REB are not anchored. team_system_mult (coaching/system change) "
                 "is a pending human hook, defaulting to 1.0."),
        "anchors": json.loads(anchors.sort_values("team").to_json(orient="records")),
    }
    out = os.path.join(OUT_DIR, "team-anchors-2027.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    print(f"\n  wrote {os.path.relpath(out, REPO)} ({len(anchors)} teams)")


if __name__ == "__main__":
    main()
