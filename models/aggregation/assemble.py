"""Stage 5: assemble the final 2026-27 projection artifact + confidence tiers.

This is where the model becomes one number per player. It multiplies Stage 1 minutes
by Stage 2/4 rates, reconciles the team usage totals through Stage 3, tags each player
with a confidence tier, and writes the single artifact the V-score engine consumes in
place of BBM: output/season-projections-2026-27.json.

The pieces and how they fit:
  Stage 1  output/stage1-minutes-2027.json      the roster of record + projected MPG,
                                                 games, load (min/team-game), source.
  Stage 2  output/rate-model/stage2-rates-2027.json   veteran per-36 rates + makes.
  Stage 4  output/rookie-translations-2026.json  rookie per-GAME projections.
  Stage 3  redistribute.team_anchors/reconcile   pull team usage totals to the anchor.
  Stage 0  output/foundation/player_seasons.parquet   history for the league-median
                                                 fallback and the tiering signals.

MAKES AND ATTEMPTS ARE EMITTED SEPARATELY (never a bare FG%/FT%): the V-score engine
volume-weights the percentages itself, and feeding it a pre-computed percentage breaks
that. PTS is always recomputed from the reconciled makes as 2*FGM + FTM + 3PM.

Two unit conventions meet here and must be reconciled deliberately: Stage 2 is per-36,
Stage 4 is per-game. Everything is converted to a per-36 rate and then multiplied by
the SINGLE source of truth for minutes (Stage 1's projected MPG), so a rookie whose
Stage 4 line assumed 27 MPG but whom Stage 1 allocates 22 is scaled to 22 -- minutes
live in exactly one place.

hoopR numbering: 2027 == 2026-27. Run build_foundation.py, then Stages 1/2/4, first.
Run: python models/aggregation/assemble.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "usage-redistribution"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "projections-adjuster"))
from common import REPO, name_candidates, normalize_name  # noqa: E402
from minutes import TEAM_MINUTE_BUDGET  # noqa: E402
from redistribute import (  # noqa: E402
    FOUND, MAKE_OF, SHIP_STRENGTH, USAGE, league_curve, load_foundation, reconcile,
    team_anchors, team_volume,
)
from tiering import TierSignals, assign_tier  # noqa: E402

TARGET = 2027
STAGE1 = os.path.join(REPO, "output", "stage1-minutes-2027.json")
STAGE2 = os.path.join(REPO, "output", "rate-model", "stage2-rates-2027.json")
STAGE4 = os.path.join(REPO, "output", "rookie-translations-2026.json")
ROLE_CSV = os.path.join(REPO, "data", "nba-rosters", "role-context-2026-27.csv")
RATE_OVERRIDE_CSV = os.path.join(REPO, "data", "nba-rosters", "rate-overrides-2026-27.csv")
OUT = os.path.join(REPO, "output", "season-projections-2026-27.json")

# The 11 counting/volume stats the 9-cat engine consumes. 3PM/FGM/FTM are makes; FGA/
# FTA are attempts; PTS is derived. STL/BLK/REB are NOT usage-reconciled (see Stage 3).
STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta"]
# Stage 2 emits uppercase with 3PM for made-threes; normalize to our lowercase keys.
S2_KEY = {"pts": "PTS", "reb": "REB", "ast": "AST", "stl": "STL", "blk": "BLK",
          "tov": "TOV", "fg3m": "3PM", "fgm": "FGM", "fga": "FGA", "ftm": "FTM", "fta": "FTA"}

# Role-context USAGE multiplier -- the player-level analogue of Stage 3's team-level
# system_mult. Ash's role-context `tier` (carried here on each player via Stage 1) nudges a
# tagged player's per-36 USAGE rate BEFORE Stage 3 reconciles the team total, so the tag
# shifts the WITHIN-team usage distribution toward (won_job/expanded) or away from
# (reduced/clear_backup) the player while Stage 3 conserves the team total -- purely
# redistributive, it can never inflate a team's usage (the safety net that lets a tag bump
# a beneficiary meaningfully without runaway projections). Applied to shot/pass/turnover
# usage only: FG%/FT% held fixed (each make rides its attempt by the same factor), 3PM left
# FLAT (measure_usage_tiers.py: 3P volume is a shot-profile trait, ~0 slope vs vacancy),
# STL/BLK/REB untouched (not usage-conserved), PTS rebuilt from the reconciled makes.
#
# ORTHOGONAL TO MINUTES, deliberately SMALLER than the minutes tier. Stage 1's role_mult
# (won_job x1.15) moves how MANY minutes a player gets; this moves how aggressive he is PER
# minute -- two real, separate effects, so both applying is not a double-count. This is
# sized as the smaller residual on top of the minutes change (won_job usage x1.08 vs minutes
# x1.15). (Where Ash hand-sets minutes via a depth-chart override, role_mult is bypassed and
# only this usage nudge applies -- cleaner still.)
#
# v0 magnitudes from the vacancy-scaled backtest: won_job (a big vacated role) moves more
# than expanded; the down side is asymmetric because a squeezed player keeps taking his own
# shots in his own minutes more than a departing star's are re-absorbed. Provisional until a
# role-context backtest refines them; kept modest since Stage 3 rescales around them anyway.
USG_TIERS = {"won_job": 1.08, "expanded": 1.04, "no_change": 1.00,
             "reduced": 0.95, "clear_backup": 0.88}
# The usage rates it scales: attempts + their makes (so FG%/FT% stay invariant), assists,
# turnovers. NEVER fg3m / reb / stl / blk (not usage-scaled) or pts (rebuilt from makes).
USG_MULT_STATS = ["fga", "fgm", "fta", "ftm", "ast", "tov"]

# Manual SHOOTING-EFFICIENCY override -- the third human hook, alongside the depth chart
# (minutes) and role-context (usage). Those two can move how much a player plays and how
# often he shoots; neither can say he will shoot it BETTER than his history implies, and
# some cases genuinely call for that. Read from RATE_OVERRIDE_CSV, applied to the per-36
# rates BEFORE Stage 3, so the makes ride the reconciled attempts and the team's usage
# total is conserved -- an override changes a player's efficiency, never his team's volume.
#
# USE IT SPARINGLY AND ONLY FOR SHOT-MIX EVIDENCE. The rate model regresses a big one-year
# efficiency jump because, league-wide, a big jump mostly regresses: a +3 to +5 pp
# league-adjusted FG% year is followed by -1.72 pp on average (n=414, only 33% hold it).
# The honest exception is a jump that came from a documented change in WHERE the shots
# come from rather than from shots simply falling -- shot MIX persists year to year far
# better than shot-making does, and nothing in Stage 2 can see mix. That is the bar: a
# measurable diet change, not a hunch that someone will improve.
OVERRIDE_PCT = {"fg_pct": ("fgm", "fga"), "ft_pct": ("ftm", "fta")}

# hoopR -> canonical FHE codes (the roster CSV's spelling; src/lib/nba-teams.ts is the
# TS source of truth, not importable here). This is the ONE place roster space (canonical)
# meets foundation space (hoopR): Stage 3 anchors come out in hoopR codes and are
# translated here so they join the roster's teams. It mirrors nba-teams.ts the same way
# ROSTER_NAME_TO_HOOPR mirrors the TS name-alias map -- not a new dialect, a bridge to the
# existing standard. Only the 7 franchises hoopR spells differently appear; the rest are
# identity.
HOOPR_TO_CANONICAL = {"GS": "GSW", "NO": "NOR", "NY": "NYK", "PHX": "PHO",
                      "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}


def load_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def s4_val(v) -> float:
    """Stage 4 projections are per-game; a value is either a scalar or a {p50:...} band."""
    if isinstance(v, dict):
        return float(v.get("p50"))
    return float(v)


def apply_rate_overrides(rates: pd.DataFrame) -> int:
    """Pin a player's projected FG%/FT% to a hand-set value. See OVERRIDE_PCT.

    Rewrites the MAKE rate to `pct x attempt rate`, leaving attempts alone, so the
    override survives Stage 3 untouched (reconcile scales a make by the same factor as
    its attempt). Matching is on normalize_name via name_candidates -- the same alias
    path Stages 1/2 use -- so a nickname in the CSV resolves like it does everywhere
    else. An unmatched row is a loud failure, not a silent no-op: a typo'd override
    that quietly does nothing is worse than no override at all.
    """
    if not os.path.exists(RATE_OVERRIDE_CSV):
        return 0
    ov = pd.read_csv(RATE_OVERRIDE_CSV)
    if not len(ov):
        return 0
    by_name = {}
    for i, nm in enumerate(rates["norm_name"]):
        by_name.setdefault(nm, i)
    n = 0
    for _, r in ov.iterrows():
        stat = str(r["stat"]).strip()
        if stat not in OVERRIDE_PCT:
            raise SystemExit(f"rate-override: unknown stat {stat!r} "
                             f"(expected one of {sorted(OVERRIDE_PCT)})")
        target = normalize_name(str(r["player"]))
        idx = next((by_name[c] for c in name_candidates(target) if c in by_name), None)
        if idx is None:
            raise SystemExit(f"rate-override: {r['player']!r} is not in the projected "
                             f"roster -- fix the name or drop the row")
        pct = float(r["value"])
        if not 0.0 < pct < 1.0:
            raise SystemExit(f"rate-override: {r['player']} {stat}={pct} is not a "
                             f"fraction between 0 and 1")
        make, att = OVERRIDE_PCT[stat]
        before = rates.iloc[idx][f"r_{make}"] / max(rates.iloc[idx][f"r_{att}"], 1e-9)
        rates.iloc[idx, rates.columns.get_loc(f"r_{make}")] = (
            pct * rates.iloc[idx][f"r_{att}"])
        print(f"  rate override: {r['player']} {stat} {100*before:.1f}% -> {100*pct:.1f}%"
              + (f"  ({r['note']})" if "note" in ov.columns and pd.notna(r.get("note")) else ""))
        n += 1
    return n


def league_median_per36(ps: pd.DataFrame) -> dict[str, float]:
    """The 'we know nothing but that he is on an NBA roster' rate: median per-36 over
    real rotation players in the recent window. Used for roster spots with no history
    (undrafted / two-way / G-League call-ups) -- the rate analogue of Stage 1 handing
    them the league-median MPG."""
    recent = ps[(ps["season"] >= TARGET - 3) & (ps["min"] >= 500)]
    return {s: float(np.nanmedian(recent[s] / recent["min"] * 36)) for s in STATS}


def build_rates(stage1: list[dict], ps: pd.DataFrame) -> pd.DataFrame:
    """One per-36 rate row per rostered player, from the right source for each."""
    s2 = {int(p["athlete_id"]): p for p in load_json(STAGE2)}
    s4_doc = load_json(STAGE4)
    s4 = {}
    for p in s4_doc.get("players", []):
        pr = p.get("projections") or {}
        if pr.get("mpg"):  # a projected rookie (some prospects are declined -> null)
            s4[normalize_name(p["name"])] = (p, pr)
    med = league_median_per36(ps)

    # Rate provenance is decided HERE, independent of Stage 1's `source` (which is about
    # where a player's MINUTES came from). Stage 2 only fit the ~421 qualifying veterans
    # (a >=30 GP season in the window); a rostered player with a handful of career games
    # is source="history" to Stage 1 but has no trustworthy rate, so he correctly falls
    # to the league median -- the rate analogue of "we don't really know". The tier then
    # follows rate provenance, not minutes provenance.
    rows, counts = [], {"veteran": 0, "rookie:stage4": 0, "league-median": 0}
    for pl in stage1:
        aid = int(pl["athlete_id"]) if pd.notna(pl.get("athlete_id")) else None
        rec = {"athlete_id": pl.get("athlete_id"), "player": pl["player"],
               "norm_name": pl["norm_name"], "team": pl["team"], "role_tier": pl["role_tier"],
               "proj_mpg": pl["proj_mpg"], "proj_games": pl["proj_games"],
               "proj_load": pl["proj_load"], "availability": pl["availability"]}

        s4hit = next((s4[c] for c in name_candidates(pl["norm_name"]) if c in s4), None)
        if aid is not None and aid in s2:                      # qualifying veteran
            v = s2[aid]
            rec["rate_source"], rec["pos"] = "veteran", v.get("pos", "F")
            for s in STATS:
                rec[f"r_{s}"] = float(v[S2_KEY[s]])            # already per-36
        elif s4hit is not None:                                # projected rookie (Stage 4)
            p, pr = s4hit
            rec["rate_source"], rec["pos"] = "rookie:stage4", p.get("pos", "F")
            mpg = s4_val(pr["mpg"]) or 1.0
            for s in STATS:                                    # per-game -> per-36
                rec[f"r_{s}"] = s4_val(pr[s]) / mpg * 36
        else:                                                  # no trustworthy rate
            rec["rate_source"], rec["pos"] = "league-median", "F"
            for s in STATS:
                rec[f"r_{s}"] = med[s]
        rec["is_rookie"] = rec["rate_source"] != "veteran"
        counts[rec["rate_source"]] += 1
        rows.append(rec)

    print(f"  rate sources: {counts['veteran']} veterans (Stage 2), "
          f"{counts['rookie:stage4']} rookies (Stage 4), "
          f"{counts['league-median']} on league-median (sub-qualifying history / two-way)")
    return pd.DataFrame(rows)


def injury_and_seasons(ps: pd.DataFrame) -> dict[int, dict]:
    """Per athlete_id: consistent-season count and durability signals over the window.

    Durability is deliberately availability-based, not a diagnosis. dnp_injury both
    over- and under-counts (it misses season-enders, which leave NO box rows at all, and
    can't tell a rest DNP from an injury one), so games-missed is the honest quantity --
    but it is framed as CONFIDENCE, not cause. The bar is calibrated to the modern load-
    management league (median rotation availability is ~0.78, so <0.68 is genuinely
    below-normal). Low is reserved for a durability PATTERN (the spec's "recurrence
    risk"): two straight reduced seasons, or one catastrophic <0.30 (a Tatum-Achilles
    year). A single below-normal season is Medium, not Low.
    """
    out = {}
    win = ps[ps["season"].between(TARGET - 3, TARGET - 1)]
    for aid, g in win.groupby("athlete_id"):
        g = g.sort_values("season")
        seasons = int((g["gp"] >= 30).sum())                  # "consistent" = >=30 GP
        latest = g.iloc[-1]
        avail_recent = float(latest["availability"]) if pd.notna(latest["availability"]) else 1.0
        last2 = g[g["season"] >= TARGET - 2]
        avail_2yr = float(last2["availability"].mean()) if len(last2) else avail_recent
        injury_games = int(last2["dnp_injury"].fillna(0).sum())
        # a real rotation player at his healthiest in the window (so an injury-shortened
        # latest season doesn't demote a star out of the rotation gate).
        rotation = float(g["mpg"].max()) >= 20
        sig = rotation and (avail_recent < 0.30 or (len(last2) >= 2 and avail_2yr < 0.60))
        minor = rotation and (not sig) and (avail_recent < 0.68)
        out[int(aid)] = {"seasons": seasons, "avail_recent": round(avail_recent, 3),
                         "avail_2yr": round(avail_2yr, 3), "injury_games": injury_games,
                         "sig_injury": sig, "minor_injury": minor}
    return out


def last_team_canonical(ps: pd.DataFrame) -> dict[int, str]:
    """Each athlete's most-recent actual team, in canonical codes, for team-change
    detection. Foundation is hoopR-coded; translate so it compares to the roster."""
    recent = ps.sort_values("season").drop_duplicates("athlete_id", keep="last")
    return {int(a): HOOPR_TO_CANONICAL.get(t, t)
            for a, t in zip(recent["athlete_id"], recent["primary_team"])}


def main() -> None:
    stage1 = load_json(STAGE1)["players"]
    pts_panel, ts_panel = load_foundation()                       # player_team_seasons, team_seasons
    psn = pd.read_parquet(os.path.join(FOUND, "player_seasons.parquet"))  # totals + availability/DOB

    rates = build_rates(stage1, psn)
    print(f"Stage 5 -- assembling {len(rates)} players on {rates['team'].nunique()} teams")

    # --- role-context usage nudge (Stage 2.5). Scale each tagged player's per-36 usage rate
    # BEFORE the bottom-up + Stage 3 reconcile below, so a tag redistributes usage WITHIN the
    # team (Stage 3 conserves the team total). Attempts + their makes move together (FG%/FT%
    # invariant); 3PM/REB/STL/BLK/PTS are untouched here. See USG_TIERS.
    rates["usg_mult"] = rates["role_tier"].map(USG_TIERS).fillna(1.0)
    for s in USG_MULT_STATS:
        rates[f"r_{s}"] = rates[f"r_{s}"] * rates["usg_mult"]
    n_up = int(rates["usg_mult"].gt(1.0).sum())
    n_dn = int(rates["usg_mult"].lt(1.0).sum())
    print(f"  role-context usage nudge: {n_up} up (won_job x{USG_TIERS['won_job']} / "
          f"expanded x{USG_TIERS['expanded']}), {n_dn} down (reduced x{USG_TIERS['reduced']} / "
          f"clear_backup x{USG_TIERS['clear_backup']}); Stage 3 conserves each team total")

    # --- manual efficiency overrides (Stage 2.6). Last word on FG%/FT%, applied after the
    # usage nudge (which moves makes and attempts together and so leaves the percentage
    # invariant anyway) and before the bottom-up, so Stage 3 carries the override through.
    n_ov = apply_rate_overrides(rates)
    if not n_ov:
        print("  rate overrides: none")

    # --- per-game raw + bottom-up per-team-game (for reconciliation).
    for s in STATS:
        rates[f"pg_{s}"] = rates[f"r_{s}"] * rates["proj_mpg"] / 36.0
        rates[f"bu_{s}"] = rates[f"r_{s}"] * rates["proj_load"] / 36.0

    # --- Stage 3 reconciliation. Anchors come out hoopR-coded; translate to canonical
    # so they join the roster's teams, then pull each team's usage totals to them.
    vol = team_volume(pts_panel, ts_panel)
    lg = league_curve(vol)
    anchors = team_anchors(vol, lg, TARGET, trend=True)
    anchors["team"] = anchors["team"].map(lambda t: HOOPR_TO_CANONICAL.get(t, t))
    missing = set(rates["team"]) - set(anchors["team"])
    if missing:
        raise SystemExit(f"no anchor for team(s) {sorted(missing)} -- team-code bridge gap")

    rec = reconcile(rates, anchors, strength=SHIP_STRENGTH)
    # apply the row-level effective factor (team factor + any 3PM<=FGM clamp) to per-game.
    for s in USAGE + [MAKE_OF[s] for s in USAGE if s in MAKE_OF]:
        eff = np.where(rec[f"bu_{s}"] > 0, rec[f"rec_{s}"] / rec[f"bu_{s}"], 1.0)
        rec[f"pg_{s}"] = rec[f"pg_{s}"] * eff
    # PTS is always rebuilt from the reconciled makes, never scaled as its own quantity.
    rec["pg_pts"] = 2 * rec["pg_fgm"] + rec["pg_ftm"] + rec["pg_fg3m"]

    # --- confidence tiers.
    inj = injury_and_seasons(psn)
    last_team = last_team_canonical(psn)
    records, tier_counts = [], {"High": 0, "Medium": 0, "Low": 0}
    for _, r in rec.iterrows():
        aid = int(r["athlete_id"]) if pd.notna(r["athlete_id"]) else None
        h = inj.get(aid, {}) if aid else {}
        seasons = h.get("seasons", 0)
        team_change = bool(aid and last_team.get(aid) and last_team[aid] != r["team"])
        sig = TierSignals(
            is_rookie=bool(r["is_rookie"]),
            seasons=seasons,
            team_change=team_change,
            role_change=r["role_tier"] != "no_change",
            sig_injury=bool(h.get("sig_injury", False)),
            minor_injury=bool(h.get("minor_injury", False)),
        )
        tier, reasons = assign_tier(sig)
        tier_counts[tier] += 1

        pg = {s: round(float(r[f"pg_{s}"]), 3) for s in STATS}
        fg_pct = pg["fgm"] / pg["fga"] if pg["fga"] > 0 else 0.0
        ft_pct = pg["ftm"] / pg["fta"] if pg["fta"] > 0 else 0.0
        g = float(r["proj_games"])
        records.append({
            "athlete_id": aid, "player": r["player"], "norm_name": r["norm_name"],
            "team": r["team"], "pos": r["pos"], "rateSource": r["rate_source"],
            "confidenceTier": tier, "confidenceReasons": reasons,
            "signals": {"seasons": seasons, "isRookie": sig.is_rookie,
                        "teamChange": team_change, "roleChange": sig.role_change,
                        "sigInjury": sig.sig_injury, "minorInjury": sig.minor_injury,
                        "availRecent": h.get("avail_recent"), "avail2yr": h.get("avail_2yr"),
                        "injuryGames": h.get("injury_games")},
            "projGames": round(g, 1), "projMpg": round(float(r["proj_mpg"]), 1),
            "perGame": {**pg, "fgPct": round(fg_pct, 4), "ftPct": round(ft_pct, 4)},
            "totals": {s: round(pg[s] * g, 1) for s in STATS},
        })

    validate(records, rec, anchors)

    payload = {
        "schemaVersion": 1, "stage": "5-aggregation", "season": TARGET,
        "seasonLabel": "2026-27", "generatedAt": datetime.now(timezone.utc).isoformat(),
        "shipStrength": SHIP_STRENGTH,
        "roleContextApplied": load_json(STAGE1).get("roleContextApplied", False),
        "roleContextUsage": {"applied": True, "tiers": USG_TIERS, "stats": USG_MULT_STATS},
        "tierCounts": tier_counts,
        "note": ("Per-game makes/attempts (never a bare percentage); PTS = 2*FGM+FTM+3PM. "
                 "Team usage totals reconciled through Stage 3. Role-context USAGE nudge "
                 "applied to tagged players (shot/pass/TOV rate only; FG%/FT% fixed, 3PM flat) "
                 "before Stage 3. Stage 2 adds a +0.6pp FG% correction for players with 1-2 "
                 "qualifying prior seasons aged <=23.5 (rates.YOUNG_FG_OFFSET). Manual FG%/FT% "
                 "overrides from rate-overrides-2026-27.csv applied before Stage 3. "
                 "confidenceTier is a real field. Usage-tier magnitudes are a "
                 "provisional v0; team_system_mult pass still pending."),
        "players": sorted(records, key=lambda p: (p["team"], -p["perGame"]["pts"])),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    print(f"  tiers: {tier_counts}")
    print(f"  wrote {os.path.relpath(OUT, REPO)} ({len(records)} players)")
    show = sorted(records, key=lambda p: -p["perGame"]["pts"])[:6]
    print("\n  top projected scorers (per game):")
    for p in show:
        pg = p["perGame"]
        print(f"    {p['team']:>3} {p['player']:<22} {pg['pts']:5.1f}p {pg['reb']:4.1f}r "
              f"{pg['ast']:4.1f}a {pg['fg3m']:4.1f}3 {pg['stl']:3.1f}s {pg['blk']:3.1f}b "
              f"{pg['tov']:3.1f}to  FG {pg['fgPct']:.3f} FT {pg['ftPct']:.3f}  [{p['confidenceTier']}]")


def validate(records: list[dict], rec: pd.DataFrame, anchors: pd.DataFrame) -> None:
    """Fail loudly on anything that would silently corrupt a downstream z-score."""
    problems = []
    for p in records:
        pg = p["perGame"]
        if pg["fgm"] > pg["fga"] + 1e-6 or pg["ftm"] > pg["fta"] + 1e-6 or pg["fg3m"] > pg["fgm"] + 1e-6:
            problems.append(f"{p['player']}: makes exceed attempts ({pg['fgm']}/{pg['fga']}, "
                            f"3PM {pg['fg3m']}/FGM {pg['fgm']})")
        if any(pg[s] < 0 for s in STATS):
            problems.append(f"{p['player']}: negative per-game stat")
        implied = 2 * pg["fgm"] + pg["ftm"] + pg["fg3m"]
        if abs(implied - pg["pts"]) > 0.05:
            problems.append(f"{p['player']}: PTS {pg['pts']} != 2*FGM+FTM+3PM {implied:.2f}")
    # team FGA totals should sit near the anchors (the blend, not exact -- strength 0.5).
    # EXCEPT on a team Stage 1 already flagged as fully manually-locked and off the
    # 241.75 minute budget (see project.py's own budget check) -- fewer team minutes
    # mechanically means fewer team shots, so a downstream FGA gap there is the same
    # known cause rippling forward, not a new bug. Warn instead of failing the build.
    team_load = rec.groupby("team")["proj_load"].sum()
    off_budget_teams = set(team_load[(team_load - TEAM_MINUTE_BUDGET).abs() > 0.5].index)

    a = anchors.set_index("team")["anchor_fga"]
    tg = rec.assign(fga_tg=rec["pg_fga"] * rec["availability"]).groupby("team")["fga_tg"].sum()
    warnings = []
    for team in tg.index:
        if team in a.index and abs(tg[team] - a[team]) > 6:  # generous: blend + rookies + minutes
            msg = f"{team}: team FGA/g {tg[team]:.1f} far from anchor {a[team]:.1f}"
            (warnings if team in off_budget_teams else problems).append(
                msg + ("  (known: team is off the minute budget, manually locked)"
                       if team in off_budget_teams else ""))
    if warnings:
        print(f"  {len(warnings)} team(s) miss the FGA anchor check but are already known "
              f"off-budget (manually locked, no free players) -- not a new problem:")
        for w in warnings:
            print(f"  .. {w}")
    if problems:
        for pr in problems[:12]:
            print(f"  !! {pr}")
        raise SystemExit(f"{len(problems)} validation problem(s) -- artifact not trustworthy")


if __name__ == "__main__":
    main()
