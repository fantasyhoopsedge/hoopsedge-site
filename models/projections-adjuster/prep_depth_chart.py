"""Prepare the /admin/depth-chart tool's bundled reference data.

Joins three things Stage 1/5 and the salary pipeline already produce, so this adds no
new data collection, only a new combination:

  roster        data/nba-rosters/2026-27.csv            team, player, position
  projections   output/season-projections-2026-27.json  Stage 5's final projMpg/projGames
  contracts     data/nba-salaries/current.csv            salary_current/y2 + contract_note

CONTRACT-STATUS DERIVATION. current.csv's `contract_note` free-text field tags specific
future seasons with one of exactly four patterns (verified against all 22 distinct notes
in the file): "Player Option YYYY-YY", "Team Option YYYY-YY", "Qualifying Offer YYYY-YY",
"Two-Way Contract YYYY-YY", semicolon-separated when a player carries more than one. For
a target season:
  - a tag matching that season wins (mapped to player_option / team_option /
    restricted_fa / non_guaranteed respectively -- a qualifying-offer year IS the
    mechanism that creates restricted free agency, so it maps there)
  - no tag, but a salary figure exists for that year -> guaranteed
  - no tag, no salary figure -> the contract has run out -> unrestricted_fa

current.csv's salary_current is THIS roster's own season (2026-27, this tool's
"current" column) and salary_y2 is next season (2027-28, "next" column) -- NOT a fixed
one-season offset. A real bug shipped from assuming current.csv was always one season
behind (true of a stale prior refresh, hardcoded here instead of re-derived) -- it
silently fed every player's 2027-28 salary into the "now" column across the whole
depth-chart tool and the live team-rosters page until a real screenshot mismatch caught
it (Donovan Mitchell showing $60.9M "now" instead of his real $50.1M). If current.csv is
ever refreshed for a season other than this roster's own `season`, this mapping needs to
shift again -- re-derive it from what season current.csv was actually pulled for, don't
hardcode an offset.

CONTRACT-MATCH FALLBACK. ~13% of the roster (mostly Exhibit-10/two-way/G-League-adjacent
signings) has no row in current.csv at all -- salary trackers don't bother with camp
invites. For those, read the roster CSV's own `contract` field directly ("Two-Way",
"Exhibit 10", "2nd Rd Pick" -> non_guaranteed; anything else with a real dollar figure
but no year-by-year breakdown -> guaranteed, shown without a precise per-year split).

DEPTH-CHART TIER is seeded from Stage 5's own projMpg (28+ starter, 18-28 rotation,
8-18 reserve, else fringe) as a reasonable default -- exactly like prep_role_context.py
seeds `class` from `yos`. It is meant to be overridden by hand in the editor; the model
itself is not wired to read it back (this is a standalone tool, not a Stage 1 input, by
design -- see the availability-chronicity conversation this was built alongside).

Run: python models/projections-adjuster/prep_depth_chart.py
"""

from __future__ import annotations

import json
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO, name_candidates, normalize_name  # noqa: E402

ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
SALARY_CSV = os.path.join(REPO, "data", "nba-salaries", "current.csv")
PROJECTIONS_JSON = os.path.join(REPO, "output", "season-projections-2026-27.json")
TIER_CSV = os.path.join(REPO, "data", "nba-rosters", "depth-chart-2026-27.csv")
BUNDLE_JSON = os.path.join(REPO, "src", "data", "depth-chart-2026-27.json")

SEASON_NOW, SEASON_NEXT = "2026-27", "2027-28"
NOTE_TAG_RE = re.compile(r"^(Player Option|Team Option|Qualifying Offer|Two-Way Contract)\s+(\d{4}-\d{2})$")
TAG_TO_STATUS = {
    "Player Option": "player_option",
    "Team Option": "team_option",
    "Qualifying Offer": "restricted_fa",
    "Two-Way Contract": "non_guaranteed",
}
NOT_A_TEAM = {"FA"}
DEFAULT_TIER = "reserve"


def seed_tier(mpg: float | None) -> str:
    if mpg is None:
        return "fringe"
    if mpg >= 28:
        return "starter"
    if mpg >= 18:
        return "rotation"
    if mpg >= 8:
        return "reserve"
    return "fringe"


def parse_note_tags(note: str) -> dict[str, str]:
    """{"2027-28": "player_option", ...} from a semicolon-separated contract_note."""
    tags: dict[str, str] = {}
    if not isinstance(note, str):
        return tags
    for part in note.split(";"):
        m = NOTE_TAG_RE.match(part.strip())
        if m:
            tags[m.group(2)] = TAG_TO_STATUS[m.group(1)]
    return tags


def season_status(salary: float | None, tags: dict[str, str], season: str) -> tuple[float | None, str]:
    if season in tags:
        return (salary if pd.notna(salary) else None, tags[season])
    if pd.notna(salary):
        return float(salary), "guaranteed"
    return None, "unrestricted_fa"


def fallback_status(contract: str) -> str:
    """For the ~13% with no current.csv row -- roster CSV's own free-text `contract`."""
    c = (contract or "").strip().lower()
    if "two-way" in c or "exhibit 10" in c or "2nd rd pick" in c:
        return "non_guaranteed"
    if c:
        return "guaranteed"
    return "unrestricted_fa"


def reconcile_tier_csv(roster: pd.DataFrame, proj_lookup: dict) -> None:
    """Bring depth-chart-2026-27.csv back in step with the roster, keyed on (team, player).

    That composite key is the whole problem: a traded player's row is stranded under his
    old team, and EVERY consumer keys the same way. Stage 1 looks up (team, player) and
    finds nothing, so a hand-set override silently reverts to the model's own number --
    Spencer Jones was carrying MPG 16 under OKC and projecting 0.5 at DEN. The editor is
    worse than silent: it lists players from the BUNDLE (rebuilt from the roster, so he
    appears under DEN) but publish writes the CSV, and depth-chart-store's fileApply
    raises `no roster row for ...` on a key that isn't there -- which fails the WHOLE
    publish, not just that row. Two players with no CSV row at all (Koloko, Bufkin, both
    traded into NOR) made NOR unpublishable.

    So: re-key by NAME when the team moved, carrying tier/injury/overrides across; add
    rostered players who have no row; drop rows for players off the roster entirely. The
    name fallback is strict on both sides for the same reason as the role-context one --
    a shared name is exactly where a wrong guess assigns someone else's minutes.
    """
    if not os.path.exists(TIER_CSV):
        return
    t = pd.read_csv(TIER_CSV)
    for col in ("tier", "injury", "override_games", "override_mpg"):
        if col not in t.columns:
            t[col] = ""
    t["k"] = t["player"].map(normalize_name)

    roster_keys = set(zip(roster["team"], roster["player"]))
    roster_by_k = {k: r for k, r in zip(roster["k"], roster.to_dict("records"))}
    roster_k_counts = roster["k"].value_counts().to_dict()
    csv_k_counts = t["k"].value_counts().to_dict()

    keep, dropped, rekeyed = [], [], []
    for row in t.to_dict("records"):
        if (row["team"], row["player"]) in roster_keys:
            keep.append(row)
            continue
        target = roster_by_k.get(row["k"])
        if target is not None and roster_k_counts.get(row["k"], 0) == 1 and csv_k_counts.get(row["k"], 0) == 1:
            # "cut" is a statement about the team the row is ON -- he didn't make THAT
            # roster. A trade has already answered that question, so carrying it across
            # would silently bench a player on his new team (Kentavious Caldwell-Pope,
            # cut from MEM, arrived at PHI as cut/0/0 and would have dropped out of
            # Philadelphia's allocation entirely). Reset him to a seeded tier instead;
            # the 0/0 overrides are part of the same cut artifact and go with it.
            had = f"G {row['override_games']}, MPG {row['override_mpg']}"
            if row["tier"] == "cut":
                proj = next((proj_lookup[c] for c in name_candidates(row["k"]) if c in proj_lookup), None)
                row["tier"] = seed_tier(proj["projMpg"] if proj else None)
                note = f"was CUT on the old team -> reseeded {row['tier']}"
            else:
                note = f"tier {row['tier']} kept"
            # THE TIER TRAVELS, THE NUMBER DOES NOT. A GP/MPG override is a claim on ONE
            # team's 241.75 -- Spencer Jones's 16 minutes were carved out of OKC's
            # rotation, and pasting that figure into Denver's just adds 16 minutes to a
            # roster that was already full (DEN 254.5, LAC 246.6 when this carried).
            # The judgment worth keeping is the TIER, which is what the allocator reads;
            # the minutes get re-derived in the new team's budget, and Ash can re-set
            # them against a chip that now shows him the running total.
            row["override_games"] = ""
            row["override_mpg"] = ""
            rekeyed.append(f"{row['player']}: {row['team']} -> {target['team']} "
                           f"({note}; overrides cleared, had {had})")
            row["team"] = target["team"]
            keep.append(row)
        else:
            dropped.append(f"{row['team']} {row['player']} (tier {row['tier']}, "
                           f"G {row['override_games']}, MPG {row['override_mpg']})")

    have = set(zip((r["team"] for r in keep), (r["player"] for r in keep)))
    added = []
    for r in roster.to_dict("records"):
        if (r["team"], r["player"]) in have:
            continue
        proj = next((proj_lookup[c] for c in name_candidates(r["k"]) if c in proj_lookup), None)
        keep.append({"team": r["team"], "player": r["player"],
                     "tier": seed_tier(proj["projMpg"] if proj else None),
                     "injury": "none", "override_games": "", "override_mpg": "", "k": r["k"]})
        added.append(f"{r['team']} {r['player']}")

    out = pd.DataFrame(keep)[["team", "player", "tier", "injury", "override_games", "override_mpg"]]
    out = out.sort_values(["team", "player"]).reset_index(drop=True)
    out.to_csv(TIER_CSV, index=False)
    print(f"  reconciled {os.path.relpath(TIER_CSV, REPO)} to the roster: "
          f"{len(rekeyed)} re-keyed, {len(added)} added, {len(dropped)} dropped")
    for m in rekeyed:
        print(f"    re-keyed  {m}")
    for m in added:
        print(f"    added     {m} (seeded tier, no override)")
    for m in dropped:
        print(f"    dropped   {m}")


def main() -> None:
    roster = pd.read_csv(ROSTER_CSV)
    roster = roster[~roster["team"].isin(NOT_A_TEAM)].copy()
    roster["k"] = roster["player"].map(normalize_name)

    sal = pd.read_csv(SALARY_CSV)
    sal["k"] = sal["player"].map(normalize_name)
    sal_lookup = {row["k"]: row for _, row in sal.iterrows()}

    proj_lookup: dict[str, dict] = {}
    if os.path.exists(PROJECTIONS_JSON):
        doc = json.load(open(PROJECTIONS_JSON, encoding="utf-8"))
        for p in doc.get("players", []):
            proj_lookup[p["norm_name"]] = p

    # Conservative fallback when PROJECTIONS_JSON is absent or missing a
    # player: keep the LAST bundle's projMpg/projGames/usg rather than
    # writing null over real data. Real incident 2026-09-04: the weekly
    # roster-refresh workflow calls this script but never regenerates
    # PROJECTIONS_JSON (that's the separate, human-gated projections
    # workflow) -- with no fallback, that run silently wiped projMpg/
    # projGames/usg to null for all 604 players, wrecking the exact numbers
    # a projections rebuild had just committed hours earlier. This mirrors
    # the "a null doesn't blank a value we already have" rule the sync
    # scripts already use for the same reason.
    prev_bundle: dict[tuple[str, str], dict] = {}
    if os.path.exists(BUNDLE_JSON):
        for p in json.load(open(BUNDLE_JSON, encoding="utf-8")):
            prev_bundle[(p["team"], p["player"])] = p

    reconcile_tier_csv(roster, proj_lookup)

    existing_tiers: dict[str, str] = {}
    existing_injuries: dict[str, str] = {}
    existing_override_games: dict[str, float] = {}
    existing_override_mpg: dict[str, float] = {}
    if os.path.exists(TIER_CSV):
        t = pd.read_csv(TIER_CSV)
        existing_tiers = dict(zip(zip(t["team"], t["player"]), t["tier"]))
        if "injury" in t.columns:
            existing_injuries = dict(zip(zip(t["team"], t["player"]), t["injury"]))
        if "override_games" in t.columns:
            existing_override_games = dict(zip(zip(t["team"], t["player"]), t["override_games"]))
        if "override_mpg" in t.columns:
            existing_override_mpg = dict(zip(zip(t["team"], t["player"]), t["override_mpg"]))

    matched, fell_back = 0, 0
    rows = []
    for _, r in roster.iterrows():
        k = r["k"]
        sal_row = next((sal_lookup[c] for c in name_candidates(k) if c in sal_lookup), None)
        proj = next((proj_lookup[c] for c in name_candidates(k) if c in proj_lookup), None)

        if sal_row is not None:
            matched += 1
            tags = parse_note_tags(sal_row.get("contract_note", ""))
            sal_now, status_now = season_status(sal_row.get("salary_current"), tags, SEASON_NOW)
            sal_next, status_next = season_status(sal_row.get("salary_y2"), tags, SEASON_NEXT)
        else:
            fell_back += 1
            status_now = status_next = fallback_status(r.get("contract", ""))
            sal_now = sal_next = None

        fallback = prev_bundle.get((r["team"], r["player"])) if proj is None else None
        mpg = proj["projMpg"] if proj else (fallback["projMpg"] if fallback else None)
        games = proj["projGames"] if proj else (fallback["projGames"] if fallback else None)
        tier = existing_tiers.get((r["team"], r["player"])) or seed_tier(mpg)
        injury = existing_injuries.get((r["team"], r["player"])) or "none"
        override_games = existing_override_games.get((r["team"], r["player"]))
        override_mpg = existing_override_mpg.get((r["team"], r["player"]))
        override_games = float(override_games) if pd.notna(override_games) else None
        override_mpg = float(override_mpg) if pd.notna(override_mpg) else None

        # Season totals (not per-game) for the USG% aggregation below -- standard
        # usage rate is a ratio of season totals, not an average of per-game rates.
        pg = proj["perGame"] if proj else None
        mp_season = mpg * games if (mpg is not None and games is not None) else None
        fga_s = pg["fga"] * games if (pg and games is not None) else None
        fta_s = pg["fta"] * games if (pg and games is not None) else None
        tov_s = pg["tov"] * games if (pg and games is not None) else None

        # r["pos"] is NaN (a float, not a missing key) for the handful of new
        # signings added without full bio data -- pd.notna guards it the same
        # way overrideGames/overrideMpg/usg already are below, so json.dump
        # never sees a bare NaN token here either.
        pos = r.get("pos", "")
        rows.append({
            "team": r["team"], "player": r["player"], "pos": pos if pd.notna(pos) else "",
            "tier": tier, "injury": injury,
            "overrideGames": override_games, "overrideMpg": override_mpg,
            "projMpg": round(mpg, 1) if mpg is not None else None,
            "projGames": round(games, 1) if games is not None else None,
            "salaryNow": sal_now, "statusNow": status_now,
            "salaryNext": sal_next, "statusNext": status_next,
            "_mp": mp_season, "_fga": fga_s, "_fta": fta_s, "_tov": tov_s,
            "_fallback_usg": fallback.get("usg") if fallback else None,
        })

    # Standard NBA usage rate, from each roster's own reconciled season totals:
    #   USG% = 100 * (FGA + 0.44*FTA + TOV) * (TeamMP/5) / (MP * (TeamFGA + 0.44*TeamFTA + TeamTOV))
    # A player with no Stage 5 projection (missing proj/pg above) gets usg=None
    # rather than 0 -- "no projection" is not "no usage". Computed on a SEPARATE
    # dataframe (not the rows list itself) -- round-tripping the full rows list
    # through a float64 dataframe silently turns every other None (salaryNow/Next
    # for FAs, missing projMpg/projGames) into NaN, which json.dump then writes as
    # the bare token `NaN` -- invalid JSON that TypeScript's parser rejects outright.
    usg_df = pd.DataFrame([{k: r[k] for k in ("team", "_mp", "_fga", "_fta", "_tov")} for r in rows])
    team_totals = usg_df.groupby("team")[["_mp", "_fga", "_fta", "_tov"]].sum()
    usg_df["usg"] = None
    for team, t in team_totals.iterrows():
        denom = t["_fga"] + 0.44 * t["_fta"] + t["_tov"]
        # A team with zero fresh-projection players (every _fga/_fta/_tov None,
        # which pandas' groupby().sum() reduces to 0.0 rather than NaN) sums to
        # denom=0 -- would ZeroDivisionError. Their rows fall through to the
        # per-player _fallback_usg below, same as the mpg/games fallback.
        if denom == 0:
            continue
        mask = usg_df["team"] == team
        num = usg_df.loc[mask, "_fga"] + 0.44 * usg_df.loc[mask, "_fta"] + usg_df.loc[mask, "_tov"]
        usg = 100 * num * (t["_mp"] / 5) / (usg_df.loc[mask, "_mp"] * denom)
        usg_df.loc[mask, "usg"] = usg.round(1)

    for r, usg in zip(rows, usg_df["usg"]):
        r["usg"] = float(usg) if pd.notna(usg) else r["_fallback_usg"]
        for k in ("_mp", "_fga", "_fta", "_tov", "_fallback_usg"):
            del r[k]

    os.makedirs(os.path.dirname(BUNDLE_JSON), exist_ok=True)
    with open(BUNDLE_JSON, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2)

    if not os.path.exists(TIER_CSV):
        pd.DataFrame([{"team": r["team"], "player": r["player"], "tier": r["tier"], "injury": r["injury"],
                       "override_games": r["overrideGames"], "override_mpg": r["overrideMpg"]}
                      for r in rows]).to_csv(TIER_CSV, index=False)

    print(f"prepped {len(rows)} depth-chart rows across {roster['team'].nunique()} teams")
    print(f"  contract match: {matched} from current.csv, {fell_back} fell back to the roster CSV's own field")
    tiers = pd.Series([r['tier'] for r in rows]).value_counts()
    print(f"  seeded tiers: {dict(tiers)}")
    print(f"  wrote {os.path.relpath(BUNDLE_JSON, REPO)}")
    if not os.path.exists(TIER_CSV):
        print(f"  wrote {os.path.relpath(TIER_CSV, REPO)} (seed tiers only; hand-edit from here)")


if __name__ == "__main__":
    main()
