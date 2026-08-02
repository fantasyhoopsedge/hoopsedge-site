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

Run: python models/projections-adjuster/project.py [--write-role-template]
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
from measure_availability import chronicity, mpg_tier, role_typical_table

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import (  # noqa: E402
    DRAFT_PICK_CORRECTIONS, REPO, TRAIN_TABLE, name_candidates, normalize_name,
)

TARGET_SEASON = 2027
ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
ROLE_CSV = os.path.join(REPO, "data", "nba-rosters", "role-context-2026-27.csv")
ROOKIE_JSON = os.path.join(REPO, "output", "rookie-translations-2026.json")
DEPTH_CHART_CSV = os.path.join(REPO, "data", "nba-rosters", "depth-chart-2026-27.csv")
TEAM_CATEGORY_CSV = os.path.join(REPO, "data", "nba-rosters", "team-category-2026-27.csv")
TEAM_CATEGORY_BASELINE_JSON = os.path.join(REPO, "output", "team-category-baseline-2027.json")
OUT_DIR = os.path.join(REPO, "output")

# Mirror of INJURY_REDUCTION in src/lib/depth-chart-store.ts -- keep values byte-identical
# (same class of cross-language duplication as ROLE_TIERS/role-context-store.ts).
#
# TIER-DEPENDENT, NOT FLAT, AND WHY: a flat 15%/45% off whatever number came out was
# wrong in the same direction as the blend-gate bug below it -- a fringe/two-way guy
# who gets hurt doesn't just lose a fixed fraction of an already-tiny role, he
# typically loses the ROSTER SPOT/opportunity window entirely (someone else gets the
# call-up), which the schedule-math reasoning behind the original 15%/45% never
# accounted for. Still reasoned defaults, not backtested -- there is no historical
# field for injury severity by tier either -- but now scaled by how much margin each
# tier actually has to lose playing time to a healthy replacement:
#   starter/rotation: unchanged (15%/45%) -- these players get their job back
#   reserve: bigger cut (35%/75%) -- thinner margin, a healthy body plays those minutes instead
#   fringe: near-total (60%/95%) -- "unlikely to play any games this season" (Ash) for
#           a long-term injury; even short-term likely costs the roster spot
INJURY_REDUCTION: dict[str, dict[str, float]] = {
    "starter": {"none": 0.0, "short_term": 0.15, "long_term": 0.45},
    "rotation": {"none": 0.0, "short_term": 0.15, "long_term": 0.45},
    "reserve": {"none": 0.0, "short_term": 0.35, "long_term": 0.75},
    "fringe": {"none": 0.0, "short_term": 0.60, "long_term": 0.95},
}

# Weight on the player's OWN recency-weighted history vs the team-category x tier
# typical baseline, for a player on a TAGGED team. Two regimes, not one:
#   chronic (2+ historical low seasons, e.g. Embiid/Kawhi) -- his own durability
#     record is real, hard-won signal; keep leaning on it (55% own / 45% typical).
#   everything else -- Ash's own words: "starters would ASSUME to have the typical
#     distribution... otherwise". A hand-tagged tier is a direct statement of this
#     year's role, and should dominate a noisy 3-year history, not just nudge it
#     (85% typical / 15% own).
CHRONIC_BLEND_WEIGHT = 0.55
HEALTHY_BLEND_WEIGHT = 0.15

# "FA" is a roster STATUS, not a team — the one non-team placeholder in the
# ecosystem (see CLAUDE.md; never write "UFA"). Free agents must be dropped before
# allocation: handing the FA bucket a 240-minute budget would invent a 31st team
# and hand its unsigned players a rotation spot on it.
NOT_A_TEAM = {"FA"}

# Draft-slot buckets for rookie-season availability (see build_pick_tier_availability()).
# Boundaries mirror ROLE_TIERS' reasoning: pick-to-pick history is noisy (some single
# picks have n<15 seasons), so five wide bins are an honest read of what the historical
# sample actually supports, not a fitted curve pretending to more precision than it has.
PICK_TIERS: list[tuple[int, int]] = [(1, 5), (6, 14), (15, 30), (31, 45), (46, 60)]


def parse_draft_pick(draft) -> float:
    """Pick number from the roster CSV's `draft` field ("2026-06" / "2026-ND").

    NaN for undrafted ("ND") and for anything unparseable — both fall through to
    build_pick_tier_availability()'s undrafted prior, which is the correct default
    for "we don't know this man's draft slot" either way.
    """
    if not isinstance(draft, str) or "-" not in draft:
        return np.nan
    slot = draft.split("-", 1)[1]
    try:
        return float(slot)
    except ValueError:
        return np.nan


def load_roster() -> pd.DataFrame:
    r = pd.read_csv(ROSTER_CSV)
    r["norm_name"] = r["player"].map(normalize_name)
    dupes = r["norm_name"][r["norm_name"].duplicated()].tolist()
    if dupes:
        raise SystemExit(f"roster CSV has duplicate players: {dupes}")
    r["draft_pick"] = r["draft"].map(parse_draft_pick)
    # Same corrections predict.py applies to nba_roster.draft_pick, applied here to
    # the CSV's own `draft` column — one source of truth, one correction list (common.py).
    for name, correct in DRAFT_PICK_CORRECTIONS.items():
        mask = r["norm_name"] == name
        if mask.any():
            was = r.loc[mask, "draft_pick"].iloc[0]
            if was == correct:
                print(f"  NOTE: draft-pick correction for '{name}' is REDUNDANT "
                      f"(the CSV now says {correct}) — remove it from DRAFT_PICK_CORRECTIONS.")
            else:
                print(f"  applying draft-pick correction: '{name}' {was} -> {correct}")
                r.loc[mask, "draft_pick"] = correct
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


def rookie_priors(ps: pd.DataFrame) -> tuple[dict[str, float], float]:
    """Stage 4's MPG for drafted rookies; league history for everyone else.

    Stage 4 covers the 62 players on the draft board. The roster carries ~125 with
    no NBA history — undrafted free agents, two-way signings, G League call-ups —
    and they are NOT on that board. They still occupy roster spots and take real
    minutes, so they cannot be dropped: leaving them out of the allocation would
    hand their share to the veterans above them. They get the historical median
    MPG for a first-season player, which is the honest answer to "we know nothing
    about this man except that he is a rookie". Availability is NOT handled here —
    see build_pick_tier_availability(), which replaced a flat median with a
    draft-slot-aware one.
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

    # First NBA season per player, then the median MPG of those seasons.
    #
    # Seasons whose "debut" is the first season in the panel are dropped: a player
    # observed in 2011 was not necessarily a rookie in 2011 — LeBron's first
    # observed season here is 2011, his eighth. Left-censoring puts every
    # established veteran of that era into the rookie pool and drags the median up,
    # which would then be handed to actual rookies as their projection.
    debut = ps.groupby("athlete_id")["season"].min().rename("debut")
    d = ps.merge(debut, on="athlete_id")
    first = d[(d["season"] == d["debut"]) & (d["debut"] > ps["season"].min())]
    return board, float(first["mpg"].median())


def build_pick_tier_availability(ps: pd.DataFrame) -> tuple[dict[tuple[int, int], float], float]:
    """Historical rookie-season availability, bucketed by draft slot.

    Stage 1 used to hand EVERY rookie the same availability — the median across
    all first-season players, drafted or not (0.33, ~27 games) — which is right for
    nobody: a top-5 pick's median rookie year is 0.90 availability (74 games) and a
    second-round pick's is 0.24 (20 games). Averaging the two away is why a lottery
    pick and a 55th pick used to get an identical games-played projection.

    Matches rookie_year_training.csv's (pick, rookie_season) rows — already built
    by the rookie-translation model via the exact same debut-season logic — against
    Stage 0's own availability (gp/team_games) for that (player, season), then takes
    the median within each PICK_TIERS bucket. Undrafted players get a separate
    number: every Stage 0 debut season that does NOT match a drafted pick, which is
    dominated by cameo appearances (two-ways, 10-days, G League call-ups) rather
    than a rotation-caliber UDFA — the same population the roster CSV's "ND" rows
    draw from, so it is the right population to average.
    """
    train = pd.read_csv(TRAIN_TABLE)
    train["k"] = train["name"].map(normalize_name)
    idx = ps.set_index(["norm_name", "season"])["availability"].sort_index()

    def lookup(k: str, season: int) -> float | None:
        for cand in name_candidates(k):
            key = (cand, season)
            if key in idx.index:
                v = idx.loc[key]
                return float(v.iloc[0]) if isinstance(v, pd.Series) else float(v)
        return None

    train["avail"] = [lookup(k, s) for k, s in zip(train["k"], train["rookie_season"])]
    matched = train.dropna(subset=["avail"]).copy()
    matched["pick"] = matched["pick"].astype(int)

    tiers: dict[tuple[int, int], float] = {}
    rows = []
    for lo, hi in PICK_TIERS:
        sub = matched[(matched["pick"] >= lo) & (matched["pick"] <= hi)]
        tiers[(lo, hi)] = float(sub["avail"].median())
        rows.append((f"{lo}-{hi}", tiers[(lo, hi)], len(sub)))

    # Undrafted: every Stage 0 debut season (excluding the left-censored first panel
    # year, same reasoning as rookie_priors()) that matches no drafted pick that season.
    debut = ps.groupby("athlete_id")["season"].min().rename("first_season")
    d = ps.merge(debut, on="athlete_id")
    rookies = d[(d["season"] == d["first_season"]) & (d["first_season"] > ps["season"].min())]
    drafted_pairs = {(c, s) for k, s in zip(matched["k"], matched["rookie_season"])
                     for c in name_candidates(k)}
    is_drafted = rookies.apply(
        lambda r: any((c, r["season"]) in drafted_pairs for c in name_candidates(r["norm_name"])),
        axis=1,
    )
    undrafted_avail = float(rookies.loc[~is_drafted, "availability"].median())
    rows.append(("undrafted", undrafted_avail, int((~is_drafted).sum())))

    print("  rookie availability priors (historical 2011-2026, by draft slot):")
    for label, avail, n in rows:
        print(f"    {label:>10}: {avail:.2f} avail ({avail * 82:4.1f} G)  n={n}")

    return tiers, undrafted_avail


def pick_tier_avail(pick: float, tiers: dict[tuple[int, int], float], undrafted: float) -> float:
    """Availability for one rookie's draft slot; NaN (undrafted/unknown) -> undrafted tier."""
    if pd.isna(pick):
        return undrafted
    p = int(pick)
    for (lo, hi), v in tiers.items():
        if lo <= p <= hi:
            return v
    return undrafted  # picks outside 1-60 shouldn't occur; fail safe rather than KeyError


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


def apply_depth_chart_corrections(d: pd.DataFrame, ps: pd.DataFrame) -> pd.DataFrame:
    """Step 6: wires in two things that existed as validated-but-disconnected pieces --
    the chronicity-aware availability blend (measure_availability.py backtested it, but
    nothing ever fed it into a live run) and the /admin/depth-chart tool's hand-tagged
    tier/team-category/injury -- plus the injury reduction (Step 5).

    ROLE-CONTEXT AND DEPTH-CHART DO NOT COMPETE. role_mult (already applied to base_mpg
    upstream of this function) answers "how much does he play when he plays" -- an
    offseason-relative delta. This function answers "how many games does he play" --
    an absolute, team-situation-aware availability. Same reasoning, different axis;
    wiring both into the same variable would be the actual collision, and this doesn't.

    TWO PATHS, NOT ONE, AND WHY THE FIRST VERSION OF THIS FUNCTION WAS WRONG. The
    original wiring gated EVERY correction behind "is this player's OWN availability
    already a notable dip (<0.65)" -- a threshold calibrated for the narrow, validated
    purpose of fixing shrinkage bias on outliers. Applied to hand-tagged players it was
    much too strict: a normal healthy player often sits at 0.70-0.80 on his own
    history, never trips the 0.65 dip gate, and so a "Starter" tag did almost nothing
    to him (Zach Edey barely moved; Cedric Coward/Jaylen Wells/KCP didn't move at all).
    Ash caught this directly: "any player tagged as starter/healthy has to assume a
    lot more games than is being assumed." The fix is two genuinely different gates:

      UNTAGGED team (the default) -- the exact mechanism the backtest validated,
      unchanged: role_typ from the player's own projected-mpg bucket, gated on
      is_dip<0.65 AND acute (<=1 historical low season) AND non-rookie, blended
      60% own / 40% typical. This is a narrow, conservative correction for real
      outliers, and stays exactly as measured.

      TAGGED team + tagged tier -- a stated human judgement of THIS player's role
      this season, which should dominate a noisy 3-year history, not nudge it. Gated
      only on below_typ (no is_dip threshold -- a normal player sitting at 0.75
      against a 0.88 typical-starter baseline is exactly the case this should catch),
      blended at HEALTHY_BLEND_WEIGHT (85% typical) for anyone without a chronic
      history, or CHRONIC_BLEND_WEIGHT (55% typical) for a real multi-season
      durability case (Embiid/Kawhi-shaped) -- his own record is too hard-won a
      signal to override with a generic tier assumption. Applies to rookies too: the
      pull is still one-directional (only lifts availability that sits BELOW the
      tagged tier's typical, per below_typ), so a rookie whose pick-tier number
      already exceeds his tier's typical is left untouched, never dragged down.

    Both paths only ever pull availability UP toward role_typ, never down -- a
    proven, durable player whose own history beats the typical baseline keeps his
    own number regardless of path.

    Injury reduction is tier-dependent (Step 5, see INJURY_REDUCTION above) and
    applies on top of whichever path produced the pre-injury availability.
    """
    cat_table: dict[str, dict[str, float]] = {}
    mpg_cat_table: dict[str, dict[str, float]] = {}
    if os.path.exists(TEAM_CATEGORY_BASELINE_JSON):
        baseline_doc = json.load(open(TEAM_CATEGORY_BASELINE_JSON, encoding="utf-8"))
        cat_table = baseline_doc["availability"]
        mpg_cat_table = baseline_doc["mpg"]

    team_category: dict[str, str] = {}
    if os.path.exists(TEAM_CATEGORY_CSV):
        tc = pd.read_csv(TEAM_CATEGORY_CSV)
        team_category = dict(zip(tc["team"], tc["category"]))

    depth_tier: dict[tuple[str, str], str] = {}
    depth_injury: dict[tuple[str, str], str] = {}
    depth_override_games: dict[tuple[str, str], float] = {}
    depth_override_mpg: dict[tuple[str, str], float] = {}
    if os.path.exists(DEPTH_CHART_CSV):
        dc = pd.read_csv(DEPTH_CHART_CSV)
        depth_tier = dict(zip(zip(dc["team"], dc["player"]), dc["tier"]))
        depth_injury = dict(zip(zip(dc["team"], dc["player"]), dc["injury"]))
        if "override_games" in dc.columns:
            depth_override_games = {k: v for k, v in
                                     zip(zip(dc["team"], dc["player"]), dc["override_games"]) if pd.notna(v)}
        if "override_mpg" in dc.columns:
            depth_override_mpg = {k: v for k, v in
                                   zip(zip(dc["team"], dc["player"]), dc["override_mpg"]) if pd.notna(v)}

    # "cut" is not a games/minutes tier at all -- it means Ash doesn't expect this
    # player on the final roster (the harder half of the roster-overage problem
    # Exhibit-10 exclusion alone doesn't fix -- see main()). Drop these rows entirely,
    # same treatment as FA/Exhibit-10, before any of the below computes a baseline
    # for them that would never be used.
    is_cut = [depth_tier.get((t, p)) == "cut" for t, p in zip(d["team"], d["player"])]
    n_cut = sum(is_cut)
    if n_cut:
        print(f"  {n_cut} player(s) tagged \"won't make roster\" -- excluded from the team's minute allocation")
        d = d[[not c for c in is_cut]].copy()

    plain_role = role_typical_table(ps)  # starter/rotation/reserve/fringe -> league-wide median

    def row_lookup(row: pd.Series) -> tuple[float, float | None, bool, str]:
        """Returns (avail_typ, mpg_typ, is_team_tagged, resolved_tier). mpg_typ is
        None on the fallback path -- MPG is only ever tier-blended for team-tagged
        players (see the MPG blend below); the untagged fallback stays exactly the
        originally-validated availability-only mechanism, base_mpg untouched."""
        category = team_category.get(row["team"], "unset")
        depth_chart_tier = depth_tier.get((row["team"], row["player"]))
        if category in cat_table and depth_chart_tier in cat_table[category]:
            mpg_typ = mpg_cat_table.get(category, {}).get(depth_chart_tier)
            return float(cat_table[category][depth_chart_tier]), mpg_typ, True, depth_chart_tier
        # fallback: the validated backtest's own mechanism, off PROJECTED mpg
        # (base_mpg x role_mult) rather than raw history -- a role-context "won_job"
        # bump should move which bucket a player's typical baseline comes from too.
        mpg = row["base_mpg"] * row["role_mult"] if pd.notna(row["base_mpg"]) else np.nan
        bucket = mpg_tier(mpg) if pd.notna(mpg) else "fringe"
        return float(plain_role[bucket]), None, False, bucket

    chron = chronicity(ps, TARGET_SEASON, low=0.65)
    d = d.merge(chron, on="athlete_id", how="left")
    d["n_low_hist"] = d["n_low_hist"].fillna(0)
    lookups = d.apply(row_lookup, axis=1)
    d["role_typ"] = lookups.map(lambda t: t[0])
    d["mpg_typ"] = lookups.map(lambda t: t[1])
    d["team_tagged"] = lookups.map(lambda t: t[2])
    d["resolved_tier"] = lookups.map(lambda t: t[3])

    below_typ = d["availability"] < d["role_typ"]
    is_chronic = d["n_low_hist"] >= 2

    # Path A: team-tagged -- BOTH directions, not gated on below_typ. A tag is a
    # deliberate human statement of this year's role, and it has to be able to pull a
    # number DOWN as well as up: a "Fringe" tag on a player whose own history sits
    # above what fringe players typically get (e.g. real minutes on a since-lost
    # roster spot elsewhere) has to mean something, not just be ignored because his
    # history happens to be better than the tier he's now buried in. Only the
    # untagged fallback stays one-directional (see Path B) -- there, a coarse mpg
    # bucket with no human judgement behind it should never override a proven
    # iron-man's own record, but a hand-set tier tag is exactly that judgement.
    w_tagged = np.where(is_chronic, CHRONIC_BLEND_WEIGHT, HEALTHY_BLEND_WEIGHT)
    pull_tagged = d["team_tagged"]
    tagged_result = w_tagged * d["availability"] + (1 - w_tagged) * d["role_typ"]

    # Path B: untagged fallback, exactly the validated mechanism (is_dip + acute +
    # non-rookie) -- one-directional (below_typ), unchanged from the backtest.
    is_dip = d["availability"] < 0.65
    is_acute = is_dip & (~is_chronic) & (~d["is_rookie"])
    pull_fallback = (~d["team_tagged"]) & is_acute & below_typ
    fallback_result = 0.6 * d["availability"] + 0.4 * d["role_typ"]

    d["availability_pre_injury"] = np.select(
        [pull_tagged, pull_fallback], [tagged_result, fallback_result], default=d["availability"])

    # MPG blend: same weights/chronic-vs-not logic as availability, team-tagged only.
    # Ash: depth-chart tier should "auto-amend minutes per game" too, not just games --
    # base_mpg (still multiplied by role_mult afterwards, unchanged) is what gets
    # blended, so a role-context "won_job" bump still applies on top of the
    # tier-typical MPG rather than being overridden by it.
    has_mpg_typ = d["mpg_typ"].notna()
    mpg_blend_mask = d["team_tagged"] & has_mpg_typ
    d["base_mpg"] = np.where(
        mpg_blend_mask, w_tagged * d["base_mpg"] + (1 - w_tagged) * d["mpg_typ"], d["base_mpg"])

    d["injury_tag"] = [depth_injury.get((t, p), "none") for t, p in zip(d["team"], d["player"])]
    d["injury_reduction"] = [
        INJURY_REDUCTION.get(tier, {}).get(inj, 0.0)
        for tier, inj in zip(d["resolved_tier"], d["injury_tag"])
    ]
    d["availability"] = d["availability_pre_injury"] * (1 - d["injury_reduction"])

    # Manual GP/MPG overrides -- carried through as plain columns (NaN = not
    # overridden) rather than applied here. They are Ash's most direct, final word
    # for one specific player and have to win over every blend/injury adjustment
    # above, so main() applies them last, right before allocate() locks the load.
    d["override_games"] = [depth_override_games.get((t, p), np.nan) for t, p in zip(d["team"], d["player"])]
    d["override_mpg"] = [depth_override_mpg.get((t, p), np.nan) for t, p in zip(d["team"], d["player"])]

    n_tagged_teams = sum(1 for v in team_category.values() if v != "unset")
    n_pulled_tagged = int(pull_tagged.sum())
    n_pulled_fallback = int(pull_fallback.sum())
    n_injured = int((d["injury_tag"] != "none").sum())
    print(f"  depth-chart wiring: {n_tagged_teams}/30 teams tagged with a category | "
          f"{n_pulled_tagged} player(s) on tagged teams pulled toward tier-typical | "
          f"{n_pulled_fallback} untagged-team acute-dip player(s) pulled (fallback) | "
          f"{n_injured} player(s) carrying an injury reduction")
    return d


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

    # Exhibit 10s are training-camp-only deals by rule -- they convert to a G League
    # contract or get released before opening night in the vast majority of cases, so
    # they are not real roster members any more than "FA" is a team. Excluded AFTER
    # attach_ids/load_role_tiers (not alongside the FA filter above) so a role-context
    # note for one of them still validates cleanly against the full roster instead of
    # tripping the "player not on any roster" check -- the row is simply dropped here
    # once its (harmless, now-unused) role tier has been resolved. The harder overage
    # (teams still over the real 15-standard+3-two-way cap even after this) needs
    # Ash's own read of who wins each camp battle -- see the depth-chart tool's "cut"
    # tier, applied in apply_depth_chart_corrections().
    is_exhibit10 = r["contract"].fillna("").str.contains("Exhibit 10", case=False)
    exhibit10 = r[is_exhibit10]
    r = r[~is_exhibit10].copy()
    print(f"  {len(exhibit10)} Exhibit-10 camp deal(s) excluded — rarely survive to opening night")

    pri = build_priors(ps, [TARGET_SEASON])
    d = r.merge(pri.drop(columns="target_season"), on="athlete_id", how="left")
    d["target_season"] = TARGET_SEASON

    # --- rookies and the historyless.
    board, rk_mpg = rookie_priors(ps)
    pick_tiers, undrafted_avail = build_pick_tier_availability(ps)
    d["is_rookie"] = d["base_mpg"].isna()
    d["source"] = np.where(~d["is_rookie"], "history", "rookie:league-median")
    from_board = d["norm_name"].map(lambda n: next((board[c] for c in name_candidates(n)
                                                    if c in board), np.nan))
    on_board = d["is_rookie"] & from_board.notna()
    d.loc[on_board, "source"] = "rookie:stage4"
    d["base_mpg"] = np.where(d["is_rookie"], np.where(on_board, from_board, rk_mpg), d["base_mpg"])
    rookie_avail = d["draft_pick"].map(lambda p: pick_tier_avail(p, pick_tiers, undrafted_avail))
    d["availability"] = np.where(d["is_rookie"], rookie_avail, d["availability"])

    vets_no_history = d[d["is_rookie"] & (d["yos"].astype(str) != "R")]
    print(f"  matched to hoopR history: {int((~d['is_rookie']).sum())} | "
          f"rookies from Stage 4: {int(on_board.sum())} | "
          f"rookies on league median ({rk_mpg:.1f} MPG): "
          f"{int((d['source'] == 'rookie:league-median').sum())}")
    tier_labels = d.loc[d["is_rookie"], "draft_pick"].map(
        lambda p: "undrafted" if pd.isna(p) else next(
            (f"{lo}-{hi}" for lo, hi in PICK_TIERS if lo <= int(p) <= hi), "undrafted"))
    print(f"  rookie availability tiers applied: "
          f"{', '.join(f'{k}={v}' for k, v in tier_labels.value_counts().items())}")
    if len(vets_no_history):
        # A non-rookie with no history is a name that did not join, and it is a
        # silent failure: he is projected as a rookie and his real minutes go to
        # his team-mates. Surface every one.
        print(f"  !! {len(vets_no_history)} NON-rookie(s) have no 3-year history — check for a "
              f"name-join miss (add to ROSTER_NAME_TO_HOOPR in common.py + its TS mirror):")
        for _, p in vets_no_history.iterrows():
            print(f"       {p['team']:>3} {p['player']} (yos {p['yos']})")

    # --- Step 6: chronicity blend + depth-chart tier/team-category/injury.
    d = apply_depth_chart_corrections(d, ps)

    # --- the formula.
    d["proj_mpg_raw"] = d["base_mpg"] * d["role_mult"]
    d["raw_load"] = d["proj_mpg_raw"] * d["availability"]

    # --- manual overrides (depth-chart tool): applied last, after every blend/
    # injury adjustment above, and locked before allocate() runs -- the rest of
    # the team's minutes rescale around a locked player exactly the way they
    # already rescale around an MPG_CAP hit (see allocate()'s locked_col). An
    # overridden games number replaces availability outright (so proj_games
    # downstream reads back the number Ash typed); an overridden MPG with no
    # games override keeps the player's own computed availability and just
    # locks his rate. Mirror of src/lib/allocate-team.ts's client-side preview
    # in the /admin/depth-chart tool -- keep the two identical.
    has_ov_games = d["override_games"].notna()
    has_ov_mpg = d["override_mpg"].notna()
    d["availability"] = np.where(has_ov_games, d["override_games"] / 82.0, d["availability"])
    ov_mpg_val = np.where(has_ov_mpg, d["override_mpg"], d["proj_mpg_raw"])
    d["locked_load"] = np.where(has_ov_games | has_ov_mpg, ov_mpg_val * d["availability"], np.nan)
    n_overridden = int((has_ov_games | has_ov_mpg).sum())
    if n_overridden:
        print(f"  {n_overridden} player(s) carrying a manual GP/MPG override — locked before allocation")

    al = allocate(d, alpha=ALPHA, locked_col="locked_load")
    al["proj_games"] = (al["availability"] * 82).round(1)

    # --- validation. The team budget is the assertion the whole stage rests on --
    # EXCEPT it is not enforceable on a team where every player carries a manual
    # GP/MPG override: Ash's rule (stated directly) is that the allocator may only
    # "play with" GP/minutes for players WITHOUT an override, never rebalance
    # around one. A fully-overridden team has zero free players for the tilt to
    # touch, so its total is just whatever Ash's own numbers sum to -- not a bug
    # in allocate(), a fact about the input. Only fail hard when a team still has
    # real free capacity (unlocked players with a non-trivial raw claim) and STILL
    # misses budget, which means the allocator itself is broken.
    #
    # A free player can only ever ADD minutes, so there is a THIRD case that is also not
    # a code bug: the locked minutes ALONE already exceed the budget. No allocator can
    # fix that -- it is not allowed to touch an override, and the free players it may
    # touch are on the wrong side of the gap. Reporting it as "!! ALLOCATOR BUG" sends
    # the reader into allocate() to look for a defect that is not there, when the real
    # answer is that a team's hand-set minutes need to come down. Say so, with the exact
    # surplus, and treat it as input the same way a fully-locked team is treated.
    free_capacity = d.groupby("team").apply(
        lambda g: g.loc[g["locked_load"].isna(), "raw_load"].sum(), include_groups=False)
    locked_sum = d.groupby("team")["locked_load"].sum(min_count=1).fillna(0.0)
    sums = al.groupby("team")["proj_load"].sum()
    off = sums[(sums - TEAM_MINUTE_BUDGET).abs() > 0.5]
    print(f"\n  team minute budget: {sums.min():.1f}-{sums.max():.1f} "
          f"(target {TEAM_MINUTE_BUDGET})")
    if len(off):
        no_free = [t for t in off.index if free_capacity.get(t, 0.0) < 2.0]
        oversubscribed = [t for t in off.index
                          if t not in no_free and locked_sum.get(t, 0.0) > TEAM_MINUTE_BUDGET + 0.5]
        real_bug = off.drop(no_free + oversubscribed)
        for t, v in off.items():
            if t in no_free:
                tag = "fully manually-locked, no free capacity"
            elif t in oversubscribed:
                tag = (f"OVER-SUBSCRIBED: overrides alone = {locked_sum[t]:.1f}, "
                       f"{locked_sum[t] - TEAM_MINUTE_BUDGET:+.1f} vs budget — cut manual MPG/GP")
            else:
                tag = "!! ALLOCATOR BUG"
            print(f"  !! {t}: {v:.1f}  ({tag})")
        if len(real_bug):
            raise SystemExit(f"{len(real_bug)} team(s) miss budget WITH free capacity available "
                              f"and room under the locked minutes -- the allocator is broken: "
                              f"{sorted(real_bug.index)}")
        if no_free:
            print(f"  {len(no_free)} team(s) off-budget but every player is manually "
                  f"overridden (no free players to rebalance) -- accepted as Ash's own numbers, "
                  f"not an allocator failure: {sorted(no_free)}")
        if oversubscribed:
            print(f"  {len(oversubscribed)} team(s) off-budget because the MANUAL OVERRIDES "
                  f"alone exceed the budget -- a depth-chart edit, not an allocator failure: "
                  f"{sorted(oversubscribed)}")
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
            "source", "draft_pick", "base_mpg", "role_tier", "role_mult", "resolved_tier",
            "team_tagged", "role_typ", "injury_tag", "availability", "proj_mpg", "proj_games",
            "proj_load", "n_hist"]
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
