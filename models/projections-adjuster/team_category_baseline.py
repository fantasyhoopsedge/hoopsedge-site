"""Step 4: the (team-category x role) typical-distribution table -- the refined
"role-typical baseline" the availability-chronicity blend (measure_availability.py)
pulls acute-dip players toward, now conditioned on team competitive posture instead
of just a raw MPG bucket.

FOUR CATEGORIES, NOT THREE, AND WHY. measure_team_tiers.py validated
contending/mid-tier/developing by historical win-pct rank -- real, but that taxonomy
describes how tanking worked under the OLD lottery odds. The 2026-27 anti-tank rules
(worse odds for the bottom 3, flat odds above) invert part of the incentive structure,
so team category now has to be a STATED COMPETITIVE POSTURE, not a computed record
bucket:

  contending      real playoff/seeding race                    -> historical CONTENDING baseline, unchanged
  playoff_bubble  outside the race but not lottery-bound        -> historical MID-TIER baseline, unchanged
  bottom3_risk    could finish bottom-3 -- new rule means this  -> blended 50/50 toward MID-TIER: still
                  team is now incentivized to WIN, not tank        probably a worse roster, but no longer
                                                                     incentivized to bury its best player
  safe_middle     safely clear of the bottom 3, no real playoff -> historical DEVELOPING baseline, unchanged:
                  path -- the "nothing to play for" zone the        the closest available proxy for genuine
                  reform creates, per Ash's read                    star-resting, though these teams have
                                                                     LESS incentive to win than any historical
                                                                     bucket actually measures (untested territory)

bottom3_risk and safe_middle are NOT separately backtestable -- the rule is new, there
is no historical season played under it. The blend weight (0.5) is a deliberate,
documented judgement call in the same spirit as minutes.py's ALPHA=1.0: a reasoned
starting point, not a fitted number, and it should move if the 2026-27 season's actual
results disagree with it.

WHICH TEAM GETS WHICH CATEGORY IS A HAND-TAGGED INPUT, NOT COMPUTED. Last season's
record does not determine this season's incentive posture -- that is exactly the
judgement this mechanism exists to capture (a 2026 mid-tier team could be this year's
playoff_bubble OR safe_middle team, and only someone tracking actual roster/trade/
tanking behavior can tell which). See team-category-2026-27.csv.

Run: python models/projections-adjuster/team_category_baseline.py
"""

from __future__ import annotations

import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO  # noqa: E402
sys.path.insert(0, os.path.dirname(__file__))
from minutes import load_panels  # noqa: E402
from measure_availability import mpg_tier  # noqa: E402
from measure_team_tiers import SEASONS, classify, team_win_pct  # noqa: E402

TEAM_CATEGORY_CSV = os.path.join(REPO, "data", "nba-rosters", "team-category-2026-27.csv")
OUT_JSON = os.path.join(REPO, "output", "team-category-baseline-2027.json")
BUNDLE_JSON = os.path.join(REPO, "src", "data", "team-category-2026-27.json")

# Mirror in team-category-store.ts -- keep values/labels byte-identical.
CATEGORY_OPTIONS = [
    {"value": "unset", "label": "Unset", "hint": "not yet assessed"},
    {"value": "contending", "label": "Contending", "hint": "real playoff/seeding race"},
    {"value": "playoff_bubble", "label": "Playoff bubble", "hint": "outside the race, not lottery-bound"},
    {"value": "bottom3_risk", "label": "Bottom-3 risk",
     "hint": "could finish bottom-3 -- incentivized to win under the new anti-tank rule"},
    {"value": "safe_middle", "label": "Safe middle",
     "hint": "clear of bottom-3, no real playoff path -- the rest-stars zone"},
]
BOTTOM3_RISK_BLEND = 0.5  # see docstring -- a judgement call, not a fitted value

# Ash's explicit 2026-27 calls, seeded directly; everyone else defaults to "unset"
# rather than an inferred guess -- last year's record doesn't determine this year's
# incentive posture, so silently mapping one onto the other would misrepresent a
# hand judgement as a computed fact.
SEED_CATEGORY: dict[str, str] = {
    "CHA": "safe_middle",
    "DAL": "safe_middle",
}
DEFAULT_CATEGORY = "unset"
CATEGORY_NOTE: dict[str, str] = {
    "CHA": "hunch (Ash, 2026-07-18): clear of bottom-3, no real playoff path -- rest-star zone",
    "DAL": "hunch (Ash, 2026-07-18): clear of bottom-3, no real playoff path -- rest-star zone",
}


def historical_role_baseline(ps: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Median availability AND median mpg by (historical win-pct category, MPG role),
    pooled 2011-2026. Both dimensions, not just availability -- Ash asked for depth-chart
    tier to "auto-amend minutes per game" too, not just games. mpg is looked up
    off the SAME tier a player already occupies (his own mpg decides the bucket), so
    this isn't circular: it answers "given a player is (say) a rotation-tier player,
    what does a typical rotation player at a team in this category actually average,
    in minutes as well as games"."""
    wp = pd.concat([team_win_pct(s) for s in SEASONS], ignore_index=True)
    cat = classify(wp)
    d = ps.merge(cat[["team", "season", "category"]], left_on=["primary_team", "season"],
                 right_on=["team", "season"], how="inner")
    d["role"] = d["mpg"].map(mpg_tier)
    return {
        "availability": d.groupby(["category", "role"])["availability"].median().unstack(),
        "mpg": d.groupby(["category", "role"])["mpg"].median().unstack(),
    }


def build_2026_27_table(hist: pd.DataFrame) -> pd.DataFrame:
    """The four 2026-27 categories, derived from the three historical ones per the
    blend rules in the module docstring. Works on either the availability or mpg
    frame -- same blend logic applies to both dimensions."""
    out = pd.DataFrame(index=hist.columns)
    out["contending"] = hist.loc["contending"]
    out["playoff_bubble"] = hist.loc["mid-tier"]
    out["bottom3_risk"] = (1 - BOTTOM3_RISK_BLEND) * hist.loc["developing"] + BOTTOM3_RISK_BLEND * hist.loc["mid-tier"]
    out["safe_middle"] = hist.loc["developing"]
    return out.T


def seed_team_category_csv(roster_teams: list[str]) -> None:
    if os.path.exists(TEAM_CATEGORY_CSV):
        print(f"  {os.path.relpath(TEAM_CATEGORY_CSV, REPO)} already exists -- not overwriting")
        return
    rows = [{"team": t, "category": SEED_CATEGORY.get(t, DEFAULT_CATEGORY), "note": CATEGORY_NOTE.get(t, "")}
            for t in sorted(roster_teams)]
    pd.DataFrame(rows).to_csv(TEAM_CATEGORY_CSV, index=False)
    print(f"  wrote {os.path.relpath(TEAM_CATEGORY_CSV, REPO)} ({len(rows)} teams, "
          f"{len(SEED_CATEGORY)} tagged, rest \"unset\")")


def bundle_team_category_reference() -> None:
    """Bundle the CANONICAL (current, hand-edited) team-category CSV as JSON for the
    /admin/depth-chart tool's team-category-store.ts. Safe to rerun anytime -- reads
    whatever is currently in team-category-2026-27.csv, never re-seeds over real tags
    (unlike seed_team_category_csv, which only ever runs once)."""
    if not os.path.exists(TEAM_CATEGORY_CSV):
        raise SystemExit(f"{TEAM_CATEGORY_CSV} missing -- run main() once to seed it first")
    tc = pd.read_csv(TEAM_CATEGORY_CSV).fillna("")
    rows = tc[["team", "category", "note"]].to_dict("records")
    os.makedirs(os.path.dirname(BUNDLE_JSON), exist_ok=True)
    with open(BUNDLE_JSON, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2)
    print(f"  wrote {os.path.relpath(BUNDLE_JSON, REPO)} ({len(rows)} teams)")


def main() -> None:
    ps, _ = load_panels()
    hist = historical_role_baseline(ps)
    print("Historical (2011-2026) median availability by win-pct-rank category and MPG role:")
    print(hist["availability"].round(3))
    print("\nHistorical (2011-2026) median MPG by win-pct-rank category and MPG role:")
    print(hist["mpg"].round(1))

    avail_table = build_2026_27_table(hist["availability"])
    mpg_table = build_2026_27_table(hist["mpg"])
    print("\n2026-27 four-category availability table (bottom3_risk/safe_middle are blended "
          f"judgement calls, blend={BOTTOM3_RISK_BLEND}):")
    print(avail_table.round(3))
    print("\n  ...in games (x82):")
    print((avail_table * 82).round(1))
    print("\n2026-27 four-category MPG table:")
    print(mpg_table.round(1))

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump({
            "schemaVersion": 2,
            "note": "availability (GP/team_games) AND mpg by 2026-27 team-category x MPG role. "
                     "bottom3_risk/safe_middle are documented blends, not backtested -- "
                     "see team_category_baseline.py docstring.",
            "bottom3RiskBlend": BOTTOM3_RISK_BLEND,
            "availability": json.loads(avail_table.round(4).to_json(orient="index")),
            "mpg": json.loads(mpg_table.round(2).to_json(orient="index")),
        }, fh, indent=2)
    print(f"\n  wrote {os.path.relpath(OUT_JSON, REPO)}")

    roster = pd.read_csv(os.path.join(REPO, "data", "nba-rosters", "2026-27.csv"))
    roster_teams = [t for t in roster["team"].unique() if t != "FA"]
    seed_team_category_csv(roster_teams)
    bundle_team_category_reference()


if __name__ == "__main__":
    main()
