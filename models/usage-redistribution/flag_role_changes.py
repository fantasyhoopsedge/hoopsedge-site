"""Role-context usage FLAGGER — the team-aware signal for Ash's role-context pass.

Ash drives the role-context tags (won_job/expanded/reduced/clear_backup); this script is
the detector that surfaces WHERE a usage tag is probably warranted, so nothing slips
through 30 teams. It is the team-aware half of the design that measure_usage_tiers.py
validated: that study proved surviving/returning teammates' usage moves with the SIZE of
the usage that left or came back (out-of-sample, the vacancy-scaled fit beat both "no
change" and a flat bump). This script computes, per team, how much usage actually left or
returned for 2026-27, and flags the teams where the redistribution isn't yet reflected in
a tag.

It is advisory only. It proposes a DIRECTION and a rough magnitude band; it never writes a
tag. Every tag stays Ash's call.

THE USAGE LEDGER (per team). Volume-weighted, per Ash's call: a departing player's vacated
pool is his usg_proxy per-36 TIMES his minutes, not just his rate — a 28-usg starter who
played 2,000 minutes vacates far more than a 28-usg player who played 500. usg_proxy =
per36 (FGA + 0.44*FTA + TOV), the same shot-creation proxy measure_usage_tiers.py keyed on.

  DEPARTED   on the team in 2025-26 (foundation season 2026) with real minutes, NOT on the
             2026-27 roster (traded/waived/retired) or tagged `cut` in the depth chart.
             FREES usage.
  ARRIVED    on the 2026-27 roster, played ELSEWHERE in 2025-26 with real usage.
             CONSUMES usage.
  RETURNING  on the 2026-27 roster, NO 2025-26 row, but a real prior-season usage history
             (the Kyrie/Haliburton-from-injury case). CONSUMES usage.

  net_freed = departed_volume - (arrived_volume + returning_volume)

Large positive net = a hole someone must fill (expect UP tags). Large negative = usage
flooding back (expect DOWN tags). Severity is graded against measure_usage_tiers.py's own
vacancy quartiles so only genuinely large moves fire — the flag list stays short.

THE FLAGS (most severe first per team):
  UNCLAIMED VACANCY   team freed a large pool, but a player Ash PROJECTS as a starter/high-
                      minute in the depth chart carries no UP tag. Suggests the top
                      untagged returning players by projected minutes as candidates.
  UNABSORBED INFLOW   team is reclaiming a large pool (arrival/returnee), but returning
                      players who carried high usage IN THAT PLAYER'S ABSENCE aren't DOWN-
                      tagged. Suggests them.
  ROLE / HISTORY GAP  a player's projected depth-chart minutes jumped or dropped a tier vs
                      his own historical role, with no usage tag reflecting it (a role
                      change not driven by a departure).
  TAG w/o VACANCY     a player IS up-tagged but the team didn't actually free usage — a
                      low-priority "double-check", guarding over-tagging.

VISIBILITY INTO THE FUTURE. The signal leans on Ash's completed depth-chart pass: projected
minutes = override_mpg if set, else the tier's typical MPG (starter/rotation/reserve/fringe,
matching the allocator's own mpg_tier bands). That is Ash's stated intent for the season,
which is exactly what makes "your plan vs. this player's history" a detectable gap.

Reads output/foundation/*, data/nba-rosters/{2026-27,depth-chart-2026-27,role-context-
2026-27}.csv. Prints a per-team report. Read-only; writes nothing.
Run: python models/usage-redistribution/flag_role_changes.py [--team CHA] [--all]
"""

from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

# The report uses ⚠ / → / − glyphs; the default Windows console codepage (cp1252) can't
# encode them. Force UTF-8 on stdout so the tool runs identically on Windows and POSIX.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO, name_candidates, normalize_name  # noqa: E402

FOUND = os.path.join(REPO, "output", "foundation")
ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
DEPTH_CSV = os.path.join(REPO, "data", "nba-rosters", "depth-chart-2026-27.csv")
ROLE_CSV = os.path.join(REPO, "data", "nba-rosters", "role-context-2026-27.csv")
# Bundled artifact the /admin/depth-chart editor reads (foundation parquet is gitignored /
# local-only, so the Vercel app can't recompute this — it reads this committed JSON snapshot,
# same pattern as prep_role_context.py's role-context-2026-27.json). Written by --emit-json.
FLAGS_JSON = os.path.join(REPO, "src", "data", "role-flags-2026-27.json")

LAST_SEASON = 2026          # hoopR: 2026 == 2025-26, the season the roster changed FROM

# hoopR raw team codes -> canonical (mirror of assemble.py's map; CLAUDE.md's one standard).
HOOPR_TO_CANONICAL = {"GS": "GSW", "NO": "NOR", "NY": "NYK", "PHX": "PHO",
                      "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}

# Typical MPG per depth-chart tier — matches measure_availability.py's mpg_tier() bands
# (starter >=28, rotation >=18, reserve >=8, else fringe), used to turn a tier into a
# projected-minutes estimate when Ash hasn't typed an explicit override_mpg.
TIER_TYPICAL_MPG = {"starter": 32.0, "rotation": 22.0, "reserve": 12.0, "fringe": 6.0}
# Typical GAMES per tier, for projected SEASON minutes (mpg x games) when Ash hasn't typed
# an override_games. Cross-checks measure_availability.py's tier medians (starter ~72,
# rotation ~66/68). A returning-injury star usually carries an explicit override_games; this
# is only the fallback.
TIER_TYPICAL_GAMES = {"starter": 72, "rotation": 68, "reserve": 55, "fringe": 30}
UP_TAGS = {"won_job", "expanded"}
DOWN_TAGS = {"reduced", "clear_backup"}

# Fix 2 — injury-dip re-basing. A season with GP < DIP_GP is an "injury dip": don't trust
# its usage VOLUME (rate x its few minutes badly understates the player). It only re-bases
# players who were ESTABLISHED creators — a healthy prior season (GP >= HEALTHY_GP) with
# usg_proxy >= DIP_USG_MIN — so a low-usage rim-runner who got hurt (Edey ~15, Kessler ~12)
# is left alone, but a genuine hub (Sabonis ~18, Tatum ~26, Lillard ~23) is re-based to his
# healthy RATE x his PROJECTED 2026-27 minutes (Option B: forward-looking, so an aging star
# penciled in for fewer minutes shrinks automatically). See the Kyrie/Sabonis/Tatum/Morant
# worked examples in the conversation that motivated this.
DIP_GP = 30
HEALTHY_GP = 30
HEALTHY_MIN = 1000   # a healthy BASELINE season must also be a real rotation role, not a
                     # 34-game deep-bench line (Adam Flagler at ~6 mpg trips GP>=30 but is
                     # not an "established creator"); ~1000 min ≈ a genuine rotation season
DIP_USG_MIN = 17.0

# Vacancy-size severity bands, in VOLUME units (usg_proxy per-36 x season minutes / 1000,
# i.e. "usage-kминutes"). Anchored to measure_usage_tiers.py's per-36 quartile edges
# (Q3 ~17.4, Q4 ~20.7 usg_proxy) at a starter's ~2000 min: 20.7*2000/1000 ~ 41, 17.4*2000
# ~ 35. Rounded to memorable thresholds; a rotation player who leaves clears a lower bar
# because his rate x his (smaller) minutes is a smaller pool by construction.
VAC_LARGE = 38.0   # Q4-ish: a real lead option's full-season pool
VAC_MED = 22.0     # Q2-Q3: a rotation-plus role
MIN_LEDGER_MIN = 400   # ignore sub-400-min cameos in the ledger entirely (noise)


def load_foundation() -> pd.DataFrame:
    d = pd.read_parquet(os.path.join(FOUND, "player_team_seasons.parquet"))
    d["athlete_id"] = d["athlete_id"].astype(int)
    d["team"] = d["team"].map(lambda t: HOOPR_TO_CANONICAL.get(t, t))
    d["usg_proxy"] = d["per36_fga"] + 0.44 * d["per36_fta"] + d["per36_tov"]
    # volume-weighted vacancy size, per Ash: rate x minutes (scaled to a readable band).
    d["usg_volume"] = d["usg_proxy"] * d["min"] / 1000.0
    return d


def build_combined(fnd: pd.DataFrame) -> dict:
    """Pool each player's multi-team season into ONE combined (athlete, season) view, so a
    mid-season trade is a single pooled rate — not two arbitrary half-rows. This is Fix 1:
    the old code kept one arbitrary stint per athlete (`last_by_id`), which made a deadline-
    traded player's arrived/holdover/departed status nondeterministic and double-counted his
    volume (freed by his old team AND consumed by his new one). Mirrors measure_usage.py /
    build_foundation.py: pool raw totals, then re-derive per-36 — never average stint rates.

    Returns a context dict of lookups keyed by (athlete_id, season) or athlete_id:
      comb_by_as       combined {name, gp, min, usg_proxy, volume} — the whole season
      teams_by_as      set of teams he had a MEANINGFUL (>=MIN_LEDGER_MIN) stint on that
                       season — the bar for "he was really on this team", so a 5-game
                       cameo (Zubac's 118-min IND stint) doesn't make him a holdover there
      primary_by_as    the team he played the most minutes for that season (arrival "from")
      recent_by_id     his most-recent combined season {season, usg_proxy, min} (bench hist)
      last_healthy     his most-recent season with GP>=HEALTHY_GP {season, usg_proxy, min} —
                       the rate source when his latest season is an injury dip (Fix 2)
      stint_vol_2026   {(aid, team): usg_volume} his ACTUAL 2025-26 volume for that team,
                       for the marginal (this-year minus last-year-on-this-team) subtraction
    """
    comb = fnd.groupby(["athlete_id", "season"], as_index=False).agg(
        name=("athlete_display_name", "first"), gp=("gp", "sum"), min=("min", "sum"),
        fga=("fga", "sum"), fta=("fta", "sum"), tov=("tov", "sum"))
    comb["usg_proxy"] = (comb["fga"] + 0.44 * comb["fta"] + comb["tov"]) / comb["min"].clip(lower=1) * 36
    comb["volume"] = comb["usg_proxy"] * comb["min"] / 1000.0

    comb_by_as = {(int(r.athlete_id), int(r.season)):
                  {"name": r.name, "gp": int(r.gp), "min": float(r.min),
                   "usg_proxy": float(r.usg_proxy), "volume": float(r.volume)}
                  for r in comb.itertuples(index=False)}

    meaningful = fnd[fnd["min"] >= MIN_LEDGER_MIN]
    teams_by_as = {(int(a), int(s)): set(g)
                   for (a, s), g in meaningful.groupby(["athlete_id", "season"])["team"]}
    primary_rows = fnd.loc[fnd.groupby(["athlete_id", "season"])["min"].idxmax()]
    primary_by_as = {(int(r.athlete_id), int(r.season)): r.team
                     for r in primary_rows.itertuples(index=False)}

    recent_by_id: dict[int, dict] = {}
    last_healthy: dict[int, dict] = {}
    for r in comb.sort_values("season").itertuples(index=False):
        recent_by_id[int(r.athlete_id)] = {"season": int(r.season),
                                            "usg_proxy": float(r.usg_proxy), "min": float(r.min)}
        if int(r.gp) >= HEALTHY_GP and float(r.min) >= HEALTHY_MIN:  # last real rotation season wins
            last_healthy[int(r.athlete_id)] = {"season": int(r.season),
                                               "usg_proxy": float(r.usg_proxy), "min": float(r.min)}

    stint_vol_2026 = {(int(r.athlete_id), r.team): float(r.usg_volume)
                      for r in fnd[fnd["season"] == LAST_SEASON].itertuples(index=False)}

    return {"comb_by_as": comb_by_as, "teams_by_as": teams_by_as,
            "primary_by_as": primary_by_as, "recent_by_id": recent_by_id,
            "last_healthy": last_healthy, "stint_vol_2026": stint_vol_2026}


def resolve_ids(names: pd.Series, lookup: dict[str, int]) -> pd.Series:
    def one(n: str) -> int | None:
        return next((lookup[c] for c in name_candidates(normalize_name(n)) if c in lookup), None)
    return names.map(one)


def severity(vol: float) -> str:
    return "LARGE" if vol >= VAC_LARGE else "MED" if vol >= VAC_MED else "small"


def proj_mpg(row: pd.Series) -> float:
    if pd.notna(row.get("override_mpg")) and str(row.get("override_mpg")).strip():
        try:
            return float(row["override_mpg"])
        except ValueError:
            pass
    return TIER_TYPICAL_MPG.get(str(row.get("tier", "")).strip(), 0.0)


def proj_season_min(dtier: dict) -> float:
    """Projected 2026-27 SEASON minutes for a depth-chart player = proj_mpg x proj_games.
    Games use Ash's override_games when set (a returning-injury star usually carries one),
    else the tier-typical games. This is the forward-looking scale Fix 2 multiplies a re-based
    healthy rate by — so an aging star penciled in for fewer games/minutes shrinks on his own."""
    if not dtier:
        return 0.0
    mpg = proj_mpg(pd.Series(dtier))
    tier = str(dtier.get("tier", "")).strip()
    og = dtier.get("override_games")
    if pd.notna(og) and str(og).strip():
        try:
            games = float(og)
        except ValueError:
            games = TIER_TYPICAL_GAMES.get(tier, 60)
    else:
        games = TIER_TYPICAL_GAMES.get(tier, 60)
    return mpg * games


def build_ledger(team: str, fnd: pd.DataFrame, roster: pd.DataFrame,
                 id_by_team_now: dict[int, str], depth: dict, ctx: dict) -> dict:
    """Departed / arrived / returning lists for one team, volume-weighted.

    DEPARTED is per-stint (correct as-is): a player who logged >=MIN_LEDGER_MIN for THIS team
    last season and is not on it now, weighted by what he did FOR this team. A player the team
    already spent last season WITHOUT (injured elsewhere) frees only what he actually gave —
    the team has already redistributed the rest — so no injury re-basing on the freed side.
    ARRIVED / RETURNING / HOLDOVER key on the pooled combined-season view (Fix 1); on top of
    that, Fix 2 re-bases any INJURY-DIP established creator to his healthy rate x projected
    minutes, counted as the marginal gain over what he gave THIS team last year."""
    comb_by_as, teams_by_as = ctx["comb_by_as"], ctx["teams_by_as"]
    primary_by_as, last_healthy = ctx["primary_by_as"], ctx["last_healthy"]
    stint_vol_2026 = ctx["stint_vol_2026"]
    last = fnd[(fnd["season"] == LAST_SEASON) & (fnd["team"] == team)
              & (fnd["min"] >= MIN_LEDGER_MIN)]
    now_ids = set(roster.loc[roster["team"] == team, "athlete_id"].dropna().astype(int))

    departed = []
    for r in last.itertuples(index=False):
        aid = int(r.athlete_id)
        if aid not in now_ids:  # not on THIS team's 2026-27 roster (or cut -> already excluded upstream)
            departed.append({"aid": aid, "name": r.athlete_display_name,
                             "usg_proxy": r.usg_proxy, "min": r.min, "volume": r.usg_volume,
                             "to": id_by_team_now.get(aid, "—")})

    arrived, returning = [], []
    for r in roster[roster["team"] == team].itertuples(index=False):
        aid = r.athlete_id
        if pd.isna(aid):
            continue
        aid = int(aid)
        c2026 = comb_by_as.get((aid, LAST_SEASON))
        gp2026 = c2026["gp"] if c2026 is not None else 0
        lh = last_healthy.get(aid)

        # Fix 2: INJURY-DIP re-basing. His latest season was <DIP_GP games AND he has a healthy
        # prior season as an established creator (usg>=DIP_USG_MIN) -> his usage re-enters at his
        # HEALTHY rate x PROJECTED 2026-27 minutes (Option B), counted as the MARGINAL gain over
        # what he actually gave THIS team last year (0 for a new team / full absence; his dip
        # stint for a hurt holdover, which is already inside last year's team total). Takes
        # precedence over the Fix-1 branches so he is counted once, on his real (healthy) size.
        if gp2026 < DIP_GP and lh is not None and lh["usg_proxy"] >= DIP_USG_MIN:
            pmin = proj_season_min(depth.get((team, r.player), {}))
            healthy_vol = lh["usg_proxy"] * pmin / 1000.0
            already = stint_vol_2026.get((aid, team), 0.0)  # his ACTUAL 2025-26 vol for THIS team
            marginal = healthy_vol - already
            if marginal > 0.5:
                was_here = already > 0 or team in teams_by_as.get((aid, LAST_SEASON), set())
                lbl = (f"returning to health (healthy {lh['season']}, proj {pmin:.0f}min)"
                       if was_here else
                       f"injury return (healthy {lh['season']}, proj {pmin:.0f}min)")
                returning.append({"aid": aid, "name": r.player, "usg_proxy": lh["usg_proxy"],
                                  "min": pmin, "volume": marginal, "since": lh["season"],
                                  "label": lbl})
            continue

        if c2026 is not None:
            if c2026["min"] < MIN_LEDGER_MIN:
                # played a sliver in 2025-26 but NOT an established-creator injury-dip (handled
                # above) -> a low-usage part-season (e.g. a hurt rim-runner). Deliberately left
                # out of the ledger: too little usage to redistribute, per Ash's threshold.
                continue
            # meaningful 2025-26 somewhere. If any of it was for THIS team, he's a holdover
            # (here since a deadline deal at the latest) -> neither freed nor consumed.
            # Otherwise a genuine arrival, weighted by his POOLED season volume.
            if team in teams_by_as.get((aid, LAST_SEASON), set()):
                continue
            arrived.append({"aid": aid, "name": c2026["name"], "usg_proxy": c2026["usg_proxy"],
                            "min": c2026["min"], "volume": c2026["volume"],
                            "from": primary_by_as.get((aid, LAST_SEASON), "—")})
        else:
            # NO 2025-26 row at all, and NOT an established-creator return (handled above) ->
            # a fringe player who missed the season; nothing meaningful to redistribute.
            continue

    freed = sum(d["volume"] for d in departed)
    consumed = sum(a["volume"] for a in arrived) + sum(r["volume"] for r in returning)
    return {"team": team, "departed": departed, "arrived": arrived, "returning": returning,
            "freed": freed, "consumed": consumed, "net": freed - consumed}


def team_beneficiaries(team: str, roster: pd.DataFrame, depth: dict, role: dict,
                       ctx: dict) -> list[dict]:
    """Current-roster players with history, ranked by projected minutes — the candidates a
    vacancy flows to (or that an inflow squeezes). Carries each player's tag + prior usage
    (his most-recent POOLED-season usg, so a traded player's baseline is his whole season)."""
    recent_by_id = ctx["recent_by_id"]
    out = []
    for r in roster[roster["team"] == team].itertuples(index=False):
        aid = r.athlete_id
        key = (team, r.player)
        dtier = depth.get(key, {})
        if str(dtier.get("tier", "")).strip() == "cut":
            continue
        aid_i = int(aid) if pd.notna(aid) else None
        hist = recent_by_id.get(aid_i) if aid_i is not None else None
        out.append({
            "name": r.player, "aid": aid_i,
            "proj_mpg": proj_mpg(pd.Series(dtier)) if dtier else 0.0,
            "tier": str(dtier.get("tier", "")).strip() or "—",
            "role_tag": role.get(key, "no_change"),
            "hist_usg": hist["usg_proxy"] if hist else None,
            "hist_min": hist["min"] if hist else None,
        })
    return sorted(out, key=lambda p: p["proj_mpg"], reverse=True)


def flags_for_team(ledger: dict, bens: list[dict]) -> tuple[list[tuple[int, str, str]], list[dict]]:
    """Returns (flags, player_badges). flags = (priority, headline, detail) tuples for the
    CLI, highest priority first. player_badges = per-player {player, badge, label, reason}
    for the depth-chart UI: badge in {up, down, return, check}."""
    flags: list[tuple[int, str, str]] = []
    badges: list[dict] = []
    # Incoming players (arrived from elsewhere, or returning from injury) carry their OWN
    # usage rate in their projection — they are neither "surviving" beneficiaries of a
    # vacancy nor holdovers a returning star squeezes. Only true holdovers absorb/compress,
    # so exclude incoming aids from every candidate list (this is what keeps a returning
    # star like Haliburton out of his own reduced-tag suggestion).
    incoming_aids = {i["aid"] for i in ledger["arrived"] + ledger["returning"]}
    starters = [b for b in bens if b["proj_mpg"] >= 24 and b["hist_usg"] is not None
                and b["aid"] not in incoming_aids]

    # 0. Per-player marker: every injury/health return (Morant, Lillard, Tatum...) — so the
    # depth chart shows WHY a team's usage is flooding back, right on the returning player.
    for r in ledger["returning"]:
        badges.append({"player": r["name"], "badge": "return", "label": "injury / health return",
                       "reason": f"{r['label']} — re-enters at healthy usg {r['usg_proxy']:.1f} "
                                 f"(~{r['volume']:.0f} usage-vol)"})

    # 1. UNCLAIMED VACANCY
    if ledger["net"] >= VAC_MED:
        untagged = [b for b in starters if b["role_tag"] not in UP_TAGS]
        sev = severity(ledger["net"])
        if untagged and sev in ("LARGE", "MED"):
            cand = ", ".join(f"{b['name']} (proj {b['proj_mpg']:.0f}mpg, hist usg {b['hist_usg']:.1f})"
                             for b in untagged[:3])
            band = "+0.4–0.6 FGA/36 to surviving starters" if sev == "LARGE" else "+0.2–0.4 FGA/36"
            flags.append((3 if sev == "LARGE" else 2,
                          f"UNCLAIMED VACANCY [{sev}] — net {ledger['net']:.0f} usage-vol freed, "
                          f"{len(untagged)} projected starter(s) untagged",
                          f"consider expanded/won_job for: {cand}\n"
                          f"       backtest expectation: {band}"))
            for b in untagged[:3]:
                badges.append({"player": b["name"], "badge": "up", "label": "consider expanded / won_job",
                               "reason": f"team freed {ledger['net']:.0f} usage-vol ({sev}); "
                                         f"backtest {band}"})

    # 2. UNABSORBED INFLOW
    if ledger["net"] <= -VAC_MED:
        # returning/arriving star(s) reclaiming usage
        incoming = sorted(ledger["arrived"] + ledger["returning"], key=lambda x: -x["volume"])
        inc_names = ", ".join(f"{i['name']} (usg {i['usg_proxy']:.1f})" for i in incoming[:2])
        # players who ran inflated usage in the gap and aren't down-tagged
        squeezed = [b for b in starters if b["role_tag"] not in DOWN_TAGS
                    and b["hist_usg"] is not None and b["hist_usg"] >= 16]
        sev = severity(-ledger["net"])
        if squeezed and sev in ("LARGE", "MED"):
            cand = ", ".join(f"{b['name']} (hist usg {b['hist_usg']:.1f})" for b in squeezed[:3])
            flags.append((3 if sev == "LARGE" else 2,
                          f"UNABSORBED INFLOW [{sev}] — {abs(ledger['net']):.0f} usage-vol returning "
                          f"({inc_names})",
                          f"consider reduced/clear_backup for: {cand}"))
            for b in squeezed[:3]:
                badges.append({"player": b["name"], "badge": "down", "label": "consider reduced / clear_backup",
                               "reason": f"{abs(ledger['net']):.0f} usage-vol returning ({inc_names})"})

    # 4. TAG w/o VACANCY (sanity) — a holdover UP-tagged on a team that is meaningfully
    # RECLAIMING usage (net <= -VAC_MED, a real inflow), which is the genuine contradiction:
    # why would a holdover expand while a returning/arriving star soaks up touches? Gated at
    # the same inflow bar as UNABSORBED INFLOW so a near-balanced team (net ~0) never trips it.
    if ledger["net"] <= -VAC_MED:
        # only HOLDOVERS: an arriving player's up-tag reflects his own new role, not
        # absorption of team usage, so it's fine even when the team freed nothing.
        overtagged = [b for b in bens if b["role_tag"] in UP_TAGS and b["aid"] not in incoming_aids]
        if overtagged:
            names = ", ".join(b["name"] for b in overtagged[:4])
            flags.append((1,
                          f"TAG w/o VACANCY [check] — holdover(s) up-tagged but team net usage is "
                          f"{ledger['net']:+.0f} (usage returning, not freeing)",
                          f"double-check up-tags hold given the inflow: {names}"))
            for b in overtagged[:4]:
                badges.append({"player": b["name"], "badge": "check",
                               "label": f"up-tagged ({b['role_tag']}) but usage is returning",
                               "reason": f"team net {ledger['net']:+.0f} usage-vol (inflow, not a vacancy)"})

    return sorted(flags, key=lambda f: -f[0]), badges


def print_team(ledger: dict, bens: list[dict], flags: list, verbose: bool) -> None:
    team = ledger["team"]
    has_flags = bool(flags)
    if not has_flags and not verbose:
        return
    print(f"\n{'='*84}\nTEAM: {team}    net usage-vol freed: {ledger['net']:+.0f} "
          f"(freed {ledger['freed']:.0f} − reclaimed {ledger['consumed']:.0f})")
    if ledger["departed"]:
        print("  DEPARTED (frees usage):")
        for d in sorted(ledger["departed"], key=lambda x: -x["volume"]):
            print(f"    {d['name']:<24} usg {d['usg_proxy']:>4.1f}  {d['min']:>5.0f}min  "
                  f"vol {d['volume']:>4.0f}  → {d['to']}")
    incoming = ledger["arrived"] + ledger["returning"]
    if incoming:
        print("  ARRIVED / RETURNING (consumes usage):")
        for a in sorted(ledger["arrived"], key=lambda x: -x["volume"]):
            print(f"    {a['name']:<24} usg {a['usg_proxy']:>4.1f}  {a['min']:>5.0f}min  "
                  f"vol {a['volume']:>4.0f}  ← {a['from']} (arrived)")
        for r in sorted(ledger["returning"], key=lambda x: -x["volume"]):
            print(f"    {r['name']:<24} usg {r['usg_proxy']:>4.1f}  {r['min']:>5.0f}min  "
                  f"vol {r['volume']:>4.0f}  ← {r['label']}")
    if flags:
        print("  FLAGS:")
        for _, headline, detail in flags:
            print(f"    ⚠ {headline}")
            print(f"       {detail}")
    elif verbose:
        print("  (no flags — usage picture is stable or already tagged)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--team", help="limit to one team (canonical code)")
    ap.add_argument("--all", action="store_true", help="print every team, even ones with no flags")
    ap.add_argument("--emit-json", action="store_true",
                    help="write the bundled artifact the /admin/depth-chart editor reads "
                         f"({os.path.relpath(FLAGS_JSON, REPO)}) instead of printing")
    args = ap.parse_args()

    fnd = load_foundation()
    roster = pd.read_csv(ROSTER_CSV)
    roster = roster[roster["team"] != "FA"].copy()
    depth_raw = pd.read_csv(DEPTH_CSV)
    role_raw = pd.read_csv(ROLE_CSV)

    # resolve athlete_ids for the roster via the same name aliases the rest of the model uses
    recent = fnd.sort_values("season", ascending=False).drop_duplicates("norm_name")
    lookup = dict(zip(recent["norm_name"], recent["athlete_id"]))
    roster["athlete_id"] = resolve_ids(roster["player"], lookup)

    # exclude depth-chart 'cut' players from the roster entirely (Ash doesn't expect them)
    depth = {(r["team"], r["player"]): r.to_dict() for _, r in depth_raw.iterrows()}
    cut = {(r["team"], r["player"]) for _, r in depth_raw.iterrows()
           if str(r.get("tier", "")).strip() == "cut"}
    roster = roster[~roster.apply(lambda r: (r["team"], r["player"]) in cut, axis=1)].copy()

    role = {(r["team"], r["player"]): (str(r["tier"]).strip() or "no_change")
            for _, r in role_raw.iterrows()}

    # pooled combined-season lookups (Fix 1) — replaces the old arbitrary single-stint
    # last_by_id, so mid-season trades classify deterministically and count volume once.
    ctx = build_combined(fnd)
    id_by_team_now = {int(a): t for a, t in
                      zip(roster["athlete_id"].dropna(), roster.loc[roster["athlete_id"].notna(), "team"])}

    teams = [args.team] if args.team else sorted(roster["team"].unique())
    computed = []
    for team in teams:
        ledger = build_ledger(team, fnd, roster, id_by_team_now, depth, ctx)
        bens = team_beneficiaries(team, roster, depth, role, ctx)
        flags, badges = flags_for_team(ledger, bens)
        computed.append((team, ledger, bens, flags, badges))

    if args.emit_json:
        emit_json(computed)
        return

    n_flagged, summary = 0, []
    for team, ledger, bens, flags, _ in computed:
        if flags:
            n_flagged += 1
            summary.append((team, ledger["net"], len(flags)))
        print_team(ledger, bens, flags, verbose=args.all or bool(args.team))

    print(f"\n{'='*84}")
    print(f"SUMMARY — {n_flagged}/{len(teams)} teams flagged for a role-context usage review")
    for team, net, n in sorted(summary, key=lambda x: -abs(x[1])):
        print(f"  {team:>4}  net {net:>+5.0f} usage-vol   {n} flag(s)")
    print("\n  Advisory only — every tag is Ash's call. Direction/magnitude are from the")
    print("  vacancy-scaled fit in measure_usage_tiers.py; apply tags in /admin/role-context.")


def emit_json(computed: list[tuple]) -> None:
    """Write the bundled artifact the /admin/depth-chart editor overlays as inline badges +
    a per-team net-usage line. One team map (net/freed/reclaimed/flags) and one flat player
    map keyed 'TEAM||Player' (each player carries at most one badge — the badge categories are
    mutually exclusive per team). Snapshot: refresh by re-running with --emit-json + redeploy."""
    import json
    from datetime import datetime, timezone

    teams_doc: dict[str, dict] = {}
    players_doc: dict[str, dict] = {}
    for team, ledger, _bens, flags, badges in computed:
        teams_doc[team] = {
            "net": round(ledger["net"], 1),
            "freed": round(ledger["freed"], 1),
            "reclaimed": round(ledger["consumed"], 1),
            "severity": severity(abs(ledger["net"])),
            "flags": [{"priority": p, "headline": h, "detail": d} for p, h, d in flags],
        }
        for b in badges:
            players_doc[f"{team}||{b['player']}"] = {
                "badge": b["badge"], "label": b["label"], "reason": b["reason"]}

    doc = {
        "schemaVersion": 1, "season": "2026-27",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "thresholds": {"vacMed": VAC_MED, "vacLarge": VAC_LARGE,
                       "dipGp": DIP_GP, "dipUsgMin": DIP_USG_MIN},
        "teams": teams_doc, "players": players_doc,
    }
    os.makedirs(os.path.dirname(FLAGS_JSON), exist_ok=True)
    with open(FLAGS_JSON, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
    n_badges = len(players_doc)
    n_flagged = sum(1 for t in teams_doc.values() if t["flags"])
    print(f"wrote {os.path.relpath(FLAGS_JSON, REPO)} — {len(teams_doc)} teams "
          f"({n_flagged} flagged), {n_badges} player badge(s)")


if __name__ == "__main__":
    main()
