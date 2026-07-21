"""Stage 0: assemble the panels every later stage reads.

Stages 1-5 all need the same few facts — who played, how much, at what rate, on
what team, at what pace, at what age. Deriving those independently in each stage
is how five slightly-different definitions of "games played" end up in one model.
This builds them once.

Outputs (parquet, into output/foundation/ — gitignored, regenerate at will):
  player_team_seasons  one row per (athlete, season, team)  — team splits, for Stage 3
  player_seasons       one row per (athlete, season)        — totals,      for Stages 1/2
  team_seasons         one row per (team, season)           — pace/possessions

Run: python models/data-foundation/build_foundation.py [--seasons 2023-2026]

Sources and the traps in each (all verified against the 2026 feed, 2026-07-17):

  player_box  hoopR. `minutes > 0` is the definition of a game PLAYED; DNPs carry
              minutes = NULL, not 0. Must be filtered to HOOPR_NBA_TEAMS — hoopR
              files All-Star / Rising Stars games under season_type == 2, and
              those exhibition squads corrupt any team-level aggregate.

  team_box    hoopR. Use `total_turnovers` (= turnovers + team_turnovers, verified
              exact: 36,448 + 1,895 = 38,343 in 2026) — the possessions formula
              wants ALL turnovers, and plain `turnovers` silently drops the ~5%
              that are team-attributed. team_box has NO minutes column, so game
              length (i.e. OT) comes from player_box.

  nba_roster  Supabase, read-only. The ONLY source of DOB in the stack, and it
              covers just the ~606 players on a current roster. See the age
              coverage warning printed at the end — this is a real limitation,
              not a rounding error.

`reason` is deliberately only read when `did_not_play` is True. ESPN defaults the
field to "COACH'S DECISION" on rows where the player actually suited up (26,722
such rows in 2026 alone), so an ungated read tags most of the league as healthy
scratches. Gated, it is genuinely useful: 21.4% of real DNPs carry a specific
injury/illness/suspension reason.

83-GAME TEAMS ARE EXPECTED, NOT A BUG. Exactly two teams per season play 83
regular-season-tagged games: the NBA Cup finalists. ESPN files the Cup
championship game under season_type == 2, but the NBA excludes it from official
regular-season statistics — it is the one game that doesn't count. Verified:
2024 = LAL 123-109 IND (2023-12-09), 2025 = MIL 97-81 OKC (2024-12-17),
2026 = NY/SA (2025-12-16).

We KEEP that game, deliberately. `scripts/nba-data/client.ts:38` maps
season_type == 2 straight to "regular" with no Cup carve-out, so
nba_player_game_logs -> season_player_values -> the V-score baselines all already
count it. This layer feeds that engine, so matching it matters more than matching
NBA.com: if Stage 0 dropped the game, Stage 6 would backtest projections against
actuals measured over a different set of games. Revisit only if the TS pipeline
does too — the two must agree. validate_team_games() below enforces the shape so
a real anomaly can't hide behind this known one.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.request

import pandas as pd
import pyarrow.parquet as pq

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import (  # noqa: E402
    HOOPR_NBA_TEAMS, PARQUET_CACHE, REGULAR_SEASON, REPO, ensure_parquet, normalize_name,
)

TEAM_BOX_URL = (
    "https://raw.githubusercontent.com/sportsdataverse/hoopR-nba-data/main"
    "/nba/team_box/parquet/team_box_{season}.parquet"
)
OUT_DIR = os.path.join(REPO, "output", "foundation")
DOB_CSV = os.path.join(REPO, "data", "draft-model", "athlete_dob.csv")

BOX = {
    "points": "pts", "rebounds": "reb", "offensive_rebounds": "oreb",
    "defensive_rebounds": "dreb", "assists": "ast", "steals": "stl", "blocks": "blk",
    "turnovers": "tov", "field_goals_made": "fgm", "field_goals_attempted": "fga",
    "free_throws_made": "ftm", "free_throws_attempted": "fta",
    "three_point_field_goals_made": "fg3m", "three_point_field_goals_attempted": "fg3a",
}
# The 9-cat shape the V-score engine consumes. Percentages are NEVER stored — only
# makes and attempts, so the engine can volume-weight them itself.
RATE_STATS = ["pts", "reb", "ast", "stl", "blk", "tov", "fg3m", "fgm", "fga", "ftm", "fta"]


def ensure_team_box(season: int) -> str:
    """Same on-demand cache contract as common.ensure_parquet, for the team feed."""
    os.makedirs(PARQUET_CACHE, exist_ok=True)
    path = os.path.join(PARQUET_CACHE, f"tb_{season}.parquet")
    if not os.path.exists(path):
        urllib.request.urlretrieve(TEAM_BOX_URL.format(season=season), path)
    return path


def load_player_box(season: int) -> pd.DataFrame:
    """`reason` does not exist in the 2011 and 2012 feeds (it does from 2013 on).

    When it is absent the column is created as NA rather than filled with a
    default: a missing reason means we DON'T KNOW why a player sat, and writing 0
    injury-DNPs for those seasons would assert nobody got hurt in 2010-12 — a
    claim the data never made. NA propagates; 0 lies.
    """
    path = ensure_parquet(season)
    have = set(pq.ParquetFile(path).schema.names)
    want = ["season", "season_type", "game_id", "team_abbreviation", "athlete_id",
            "athlete_display_name", "minutes", "starter", "did_not_play", "reason"] + list(BOX)
    d = pd.read_parquet(path, columns=[c for c in want if c in have])
    for missing in (c for c in want if c not in have):
        if missing != "reason":
            raise SystemExit(f"season {season} player_box is missing required column {missing!r}")
        d["reason"] = pd.NA
    d = d[(d["season_type"] == REGULAR_SEASON) & d["team_abbreviation"].isin(HOOPR_NBA_TEAMS)]
    return d.rename(columns=BOX)


def build_players(seasons: list[int]) -> tuple[pd.DataFrame, pd.DataFrame]:
    frames = []
    for s in seasons:
        d = load_player_box(s)
        played = d[d["minutes"].notna() & (d["minutes"] > 0)].copy()
        # A DNP is an inactive row; `reason` is only meaningful here (see module docstring).
        dnp = d[d["did_not_play"] == True]  # noqa: E712 — pandas mask, not a bool test
        reason_known = d["reason"].notna().any()
        inj = dnp[dnp["reason"] != "COACH'S DECISION"] if reason_known else dnp.iloc[:0]

        agg = played.groupby(["athlete_id", "season", "team_abbreviation"], as_index=False).agg(
            athlete_display_name=("athlete_display_name", "first"),
            gp=("game_id", "nunique"),
            gs=("starter", "sum"),
            min=("minutes", "sum"),
            **{v: (v, "sum") for v in BOX.values()},
        )
        for label, src in (("dnp", dnp), ("dnp_injury", inj)):
            c = src.groupby(["athlete_id", "season", "team_abbreviation"], as_index=False).agg(
                **{label: ("game_id", "nunique")}
            )
            agg = agg.merge(c, on=["athlete_id", "season", "team_abbreviation"], how="left")
        agg["reason_known"] = reason_known
        frames.append(agg)

    pts = pd.concat(frames, ignore_index=True)
    # A player with no DNP rows genuinely had 0 — that fillna is right. But where the
    # feed carries no `reason` at all (2011-12), dnp_injury is UNKNOWN, and must stay
    # NA: 0 there would read as "nobody was injured", which is a claim, not an absence.
    pts["dnp"] = pts["dnp"].fillna(0).astype(int)
    pts["dnp_injury"] = pts["dnp_injury"].fillna(0).astype("Int64")
    pts.loc[~pts["reason_known"], "dnp_injury"] = pd.NA
    pts["gs"] = pts["gs"].astype(int)
    pts = pts.rename(columns={"team_abbreviation": "team"})
    pts["norm_name"] = pts["athlete_display_name"].map(normalize_name)

    # Season totals across teams. A traded player has one row per team above; summing
    # RAW TOTALS is the only correct way to combine them — averaging per-game or
    # per-36 values across stints would weight a 3-game stint like a 60-game one.
    keys = ["athlete_id", "season"]
    ps = pts.groupby(keys, as_index=False).agg(
        athlete_display_name=("athlete_display_name", "first"),
        norm_name=("norm_name", "first"),
        gp=("gp", "sum"), gs=("gs", "sum"), min=("min", "sum"),
        dnp=("dnp", "sum"),
        # min_count=1 so an all-NA season stays NA. pandas sums NA to 0 by default,
        # which would quietly resurrect the "nobody was injured in 2011-12" claim
        # that the NA in build_players() exists to prevent.
        dnp_injury=("dnp_injury", lambda s: s.sum(min_count=1)),
        reason_known=("reason_known", "first"),
        n_teams=("team", "nunique"),
        teams=("team", lambda s: ",".join(sorted(set(s)))),
        **{v: (v, "sum") for v in BOX.values()},
    )
    # Primary team = most games played, not last seen — a deadline pickup should not
    # outrank the 60 games that came before it.
    primary = pts.sort_values("gp", ascending=False).drop_duplicates(keys)[keys + ["team"]]
    ps = ps.merge(primary.rename(columns={"team": "primary_team"}), on=keys, how="left")

    for df in (pts, ps):
        df["mpg"] = df["min"] / df["gp"]
        df["start_rate"] = df["gs"] / df["gp"]
        for c in RATE_STATS:
            df[f"per36_{c}"] = df[c] / df["min"] * 36
    return pts, ps


def build_teams(seasons: list[int]) -> pd.DataFrame:
    frames = []
    for s in seasons:
        t = pd.read_parquet(
            ensure_team_box(s),
            columns=["season", "season_type", "game_id", "team_abbreviation",
                     "field_goals_attempted", "free_throws_attempted",
                     "offensive_rebounds", "total_turnovers", "team_score"],
        )
        t = t[(t["season_type"] == REGULAR_SEASON) & t["team_abbreviation"].isin(HOOPR_NBA_TEAMS)]

        # Game length comes from player minutes (team_box has no minutes column):
        # five players are on the floor at all times, so team minutes / 5 == game
        # minutes. This is what makes pace OT-correct rather than assuming 48.
        pb = load_player_box(s)
        gm = (pb[pb["minutes"].notna()]
              .groupby(["game_id", "team_abbreviation"], as_index=False)
              .agg(team_min=("minutes", "sum")))
        gm["game_min"] = gm["team_min"] / 5.0
        t = t.merge(gm, on=["game_id", "team_abbreviation"], how="left")

        # Standard possessions estimate. 0.44 is the conventional FTA->possession
        # coefficient (not all FTAs end a possession: and-1s and 1-of-2s don't).
        t["poss"] = (t["field_goals_attempted"] + 0.44 * t["free_throws_attempted"]
                     - t["offensive_rebounds"] + t["total_turnovers"])
        frames.append(t)

    tb = pd.concat(frames, ignore_index=True)
    # Both teams in a game face the same number of possessions; averaging the two
    # estimates cancels most of the 0.44-coefficient noise. This is standard.
    opp = tb.groupby("game_id", as_index=False).agg(game_poss=("poss", "mean"))
    tb = tb.merge(opp, on="game_id", how="left")

    ts = tb.groupby(["team_abbreviation", "season"], as_index=False).agg(
        tb_games=("game_id", "nunique"),
        poss=("game_poss", "sum"),
        game_min=("game_min", "sum"),
        pts=("team_score", "sum"),
    )
    ts = ts.rename(columns={"team_abbreviation": "team"})

    # team_games counts games the team has ACTUAL DATA for — game_ids where somebody
    # logged minutes — not game_ids that merely exist.
    #
    # 2020-21 is why. 45 of its games are hollow: player_box carries the game_id rows
    # but no minutes, and team_box omits them entirely (CHI has data for 49 games of
    # 72, NO for 50). Every team played all 72 in reality, so counting 72 is "true"
    # and useless: `gp` can only ever count games with data, so gp/72 would cap every
    # CHI player at 0.68 availability and paint a whole roster as injury-prone. It
    # also dragged the league minute budget to 231.45/game for 2021 against a
    # rock-steady ~241.9 everywhere else — real minutes over imaginary games.
    #
    # Matching the denominator to the numerator restores it. The cost is that 2021
    # availability means "of the games we can see", which is the honest claim the data
    # supports.
    frames = []
    for s in seasons:
        pb = load_player_box(s)
        pb = pb[pb["minutes"].notna() & (pb["minutes"] > 0)]
        frames.append(pb.groupby(["team_abbreviation", "season"], as_index=False)
                        .agg(team_games=("game_id", "nunique")))
    pbg = pd.concat(frames, ignore_index=True).rename(columns={"team_abbreviation": "team"})
    ts = ts.merge(pbg, on=["team", "season"], how="outer")

    ts["poss_per_game"] = ts["poss"] / ts["tb_games"]
    ts["pace48"] = 48 * ts["poss"] / ts["game_min"]
    ts["off_rtg"] = 100 * ts["pts"] / ts["poss"]
    # Rate stats (pace/off_rtg) stay keyed to the games team_box actually has: they are
    # per-possession averages, so a smaller sample is noisier but not biased. Only the
    # COUNT needs the complete feed. Surfaced rather than hidden — a big gap means the
    # season's pace rests on partial data.
    ts["tb_coverage"] = ts["tb_games"] / ts["team_games"]
    return ts


CUP_FIRST_SEASON = 2024  # the NBA Cup began in 2023-24; hoopR calls that season 2024.


def validate_team_games(ts: pd.DataFrame) -> list[str]:
    """Check the invariants that actually hold, which is NOT "everyone plays 82".

    An 82-game assumption is wrong across this range, and each exception is real
    NBA history rather than bad data:
      2012  66 games, all 30 teams          — the lockout
      2020  64-75, wildly uneven            — COVID suspension; only the 22 bubble
                                              teams played seeding games
      2021  72 games, all 30                — the COVID-shortened season
      2013  12 teams at 81 (1,224 games)    — six games absent from the feed
      2011/2014/2017/2018/2019  2 at 81     — a cancelled game apiece
    So team_games is simply read per team-season and used as the denominator it is.
    What genuinely holds is the shape:
      - 30 teams in every season
      - 83 games happens ONLY from the Cup era, and only for the two finalists
      - nobody exceeds 83, and nobody plays a fraction of a season
    Those catch what matters: a duplicated game or a leaked exhibition (an All-Star
    squad surviving the HOOPR_NBA_TEAMS filter would inflate a count here).
    """
    problems: list[str] = []
    for season, g in ts.groupby("season"):
        if len(g) != 30:
            problems.append(f"{season}: {len(g)} teams, expected 30")
        hi = g[g["team_games"] > 83]
        for _, r in hi.iterrows():
            problems.append(f"{season}: {r['team']} has {r['team_games']} games — >83 is impossible")
        # NOT a floor check. team_games counts games with data, and 2020-21 genuinely
        # has only 49 for CHI / 50 for NO because 45 games are hollow in the feed.
        # That is a coverage fact to report (see main()), not an error to reject.
        extra = sorted(g[g["team_games"] == 83]["team"].tolist())
        want = 2 if season >= CUP_FIRST_SEASON else 0
        if len(extra) != want:
            problems.append(
                f"{season}: {len(extra)} team(s) at 83 games {extra} — expected {want} "
                + ("(the two NBA Cup finalists)" if want else "(the Cup did not exist yet)")
            )
    return problems


def attach_age(ps: pd.DataFrame) -> pd.DataFrame:
    """Join DOB from data/draft-model/athlete_dob.csv and compute age as of Feb 1
    (Basketball-Reference's convention — a season-long age needs one fixed reference
    date, and mid-season is the least-wrong single choice).

    Joined on athlete_id, NOT name. The DOB cache is built from ESPN's athlete API
    and hoopR's athlete_id IS ESPN's id, so this is an integer join against the same
    provider that produced the box scores — it cannot drift, and none of the
    nickname/diacritic/suffix failure modes apply. See fetch_dob.py.

    nba_roster is not used here because it only holds CURRENTLY-rostered players, so
    coverage decayed the further back you looked (55% in 2024) — and the missing were
    the ones who aged out, i.e. exactly the players an aging curve needs to bend down.
    ESPN is the only source in the stack that covers players after they leave, which
    is what makes it usable here. That is the whole argument. It is NOT "ESPN is more
    accurate".

    ESPN IS NOT AUTHORITATIVE — it has real errors. Confirmed: Zach Edey
    (athlete_id 4600663) returns 2002-03-14; his actual DOB is 2002-05-14, and the
    hand-maintained roster CSV had it right. Of 28 checked disagreements with the
    roster, ESPN was right in 23 — a rate high enough to make bulk-applying it look
    safe, which is precisely the trap. Never propagate these DOBs onto the roster CSV
    or any user-facing surface without per-player verification; see the
    espn-dob-not-authoritative note.

    Tolerable HERE, and only here, because age enters the model as a smooth feature:
    an error of weeks-to-months moves a player fractionally along an aging curve and
    is swamped by the alternative, which is 45% of player-seasons missing an age
    entirely and biased toward survivors. Wrong-by-a-month beats absent-and-skewed
    for curve fitting. It would NOT be tolerable for displaying a player's age.
    """
    d = pd.read_csv(DOB_CSV)
    d = d[d["dob"].notna() & (d["dob"].astype(str) != "")][["athlete_id", "dob"]]
    d["dob"] = pd.to_datetime(d["dob"])

    ps = ps.merge(d, on="athlete_id", how="left")
    ref = pd.to_datetime(ps["season"].astype(str) + "-02-01")
    ps["age"] = (ref - ps["dob"]).dt.days / 365.25
    return ps


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", default="2023-2026", help="inclusive range, e.g. 2023-2026")
    args = ap.parse_args()
    lo, hi = (int(x) for x in args.seasons.split("-"))
    seasons = list(range(lo, hi + 1))

    print(f"Stage 0 foundation — seasons {lo}..{hi}")
    pts, ps = build_players(seasons)
    ts = build_teams(seasons)
    ps = attach_age(ps)

    # Availability needs the player's own team's game count, so it must be joined on
    # the primary team: a 41-game stint on a team that played 82 is 50% availability,
    # not 100% of some league-wide constant.
    ps = ps.merge(
        ts[["team", "season", "team_games"]].rename(columns={"team": "primary_team"}),
        on=["primary_team", "season"], how="left",
    )
    ps["availability"] = ps["gp"] / ps["team_games"]

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, df in (("player_team_seasons", pts), ("player_seasons", ps), ("team_seasons", ts)):
        p = os.path.join(OUT_DIR, f"{name}.parquet")
        df.to_parquet(p, index=False)
        print(f"  wrote {name:<20} {len(df):>6} rows  -> {os.path.relpath(p, REPO)}")

    print("\nsanity:")
    problems = validate_team_games(ts)
    if problems:
        for p in problems:
            print(f"  !! {p}")
        raise SystemExit("team-game counts are not the expected shape — fix before building on this")
    cup = ts[ts["team_games"] == 83].groupby("season")["team"].apply(lambda s: "+".join(sorted(s)))
    print(f"  team-seasons: {len(ts)} across {ts['season'].nunique()} season(s)")
    if len(cup):
        print(f"  NBA Cup finalists at 83 games: {', '.join(f'{s} {v}' for s, v in cup.items())}")
    short = ts[ts["team_games"] < 82].groupby("season")["team_games"].agg(["min", "max", "size"])
    for s, r in short.iterrows():
        print(f"  {s}: {int(r['size'])} team(s) under 82 ({int(r['min'])}-{int(r['max'])} games)"
              f" — expected for lockout/COVID/cancelled games, see validate_team_games()")
    gap = ts[ts["tb_coverage"] < 0.99]
    if len(gap):
        print(f"  team_box is missing games for {len(gap)} team-season(s) — pace/off_rtg there "
              f"rest on partial data (worst: {gap['tb_coverage'].min():.0%} of games).")

    # The real tripwire. Five players are on the floor for 48 minutes, so a team-game
    # is ~240 minutes plus overtime — and the league mean has sat in 241.3-242.1 for
    # fifteen straight seasons. That makes it the tightest invariant in the dataset and
    # a far better canary than any game-count rule: it is what exposed 2020-21's hollow
    # games (231.45 = real minutes divided by imaginary games) after the count checks
    # had waved them through.
    tm = pts.groupby(["season", "team"], as_index=False)["min"].sum().merge(
        ts[["season", "team", "team_games"]], on=["season", "team"], how="left")
    tm["per_game"] = tm["min"] / tm["team_games"]
    budget = tm.groupby("season")["per_game"].mean()
    bad = budget[(budget < 238) | (budget > 246)]
    print(f"  league minutes/game: {budget.min():.1f}-{budget.max():.1f} across seasons"
          f" (~241.9 expected: 240 regulation + overtime)")
    if len(bad):
        for s, v in bad.items():
            print(f"  !! {s}: {v:.2f} min/game is outside 238-246 — minutes and team_games "
                  f"disagree; suspect games present in the feed but carrying no data")
        raise SystemExit("league minute budget is off — the panels are not trustworthy")
    # pace48 runs ~2 above Basketball-Reference's published pace (~98.5 in 2023-24)
    # because this is the SIMPLE possessions estimate: it subtracts every offensive
    # rebound, where BBR estimates the OREB share off missed shots. The bias is a
    # near-constant level shift, so team-vs-team comparison — the only thing Stage 3
    # actually needs — is unaffected. Do not "fix" it to match BBR without checking
    # what that does to the relative ordering.
    print(f"  pace48 mean {ts['pace48'].mean():.1f} (simple estimator; runs ~2 above BBR's pace"
          f" by construction) | off_rtg mean {ts['off_rtg'].mean():.1f}")
    print(f"  traded players (n_teams>1): {(ps['n_teams'] > 1).sum()}")

    cov = ps["age"].notna().mean()
    print(f"\n  age coverage {cov:.1%} of player-seasons (ESPN, joined on athlete_id) — by season:")
    for s, g in ps.groupby("season"):
        n = g["age"].isna().sum()
        print(f"    {s}: {g['age'].notna().mean():6.1%}" + (f"  ({n} missing)" if n else ""))
    print(f"    age range {ps['age'].min():.1f}-{ps['age'].max():.1f}")
    # Coverage must be flat across seasons. If it starts sloping down as you go back,
    # the DOB source has reverted to something that only knows current players — which
    # is survivorship, and it silently biases any aging curve optimistic.
    by_season = ps.groupby("season")["age"].apply(lambda s: s.notna().mean())
    if by_season.min() < 0.98:
        print(f"  !! coverage dipped to {by_season.min():.1%} — expected ~100% from the DOB cache."
              f" Run: python models/data-foundation/fetch_dob.py --seasons {lo}-{hi}")


if __name__ == "__main__":
    main()
