"""Fetch player dates of birth from ESPN, keyed on athlete_id.

Stage 2 cannot fit an aging curve without age, and age was the foundation's worst
gap: nba_roster is the stack's only DOB source and holds only CURRENTLY-rostered
players, so coverage fell away the further back you looked — 80.8% (2026), 67.8%
(2025), 55.2% (2024). That decay is survivorship. The players it drops are the
ones who left the league, which is precisely the population an aging curve needs
in order to bend down. Fit on the survivors alone and the curve reads optimistic,
convincingly and invisibly.

ESPN's core API fixes it at the source:

  https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/{id}

and it is the RIGHT source specifically because hoopR's `athlete_id` IS the ESPN
athlete id (verified: LeBron 1966, Curry 3975, Doncic 3945274). So this joins on
an integer, not a name — no normalize_name(), no nickname aliases, none of the
fuzzy-matching failure modes that this join key would otherwise inherit. ESPN
keeps athlete pages after players leave, so retirees resolve like anyone else.

The result is cached in data/draft-model/athlete_dob.csv and COMMITTED: DOBs are
immutable, the file is small, and committing it means no later stage depends on a
live network call. Re-runs only fetch ids the cache lacks.

Run: python models/data-foundation/fetch_dob.py [--seasons 2011-2026]
     python models/data-foundation/fetch_dob.py --verify   # cross-check vs nba_roster
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import (  # noqa: E402
    HOOPR_NBA_TEAMS, REGULAR_SEASON, REPO, ensure_parquet, normalize_name,
)

DOB_CSV = os.path.join(REPO, "data", "draft-model", "athlete_dob.csv")
ATHLETE_URL = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/{id}"
# Courtesy delay. This is an unauthenticated public endpoint being asked for a few
# thousand rows exactly once, so there is no reason to hammer it.
SLEEP_S = 0.25


def load_cache() -> dict[int, dict]:
    if not os.path.exists(DOB_CSV):
        return {}
    with open(DOB_CSV, encoding="utf-8", newline="") as fh:
        return {int(r["athlete_id"]): r for r in csv.DictReader(fh)}


def save_cache(rows: dict[int, dict]) -> None:
    os.makedirs(os.path.dirname(DOB_CSV), exist_ok=True)
    with open(DOB_CSV, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["athlete_id", "display_name", "dob"])
        w.writeheader()
        for k in sorted(rows):
            w.writerow(rows[k])


def athlete_ids(seasons: list[int]) -> pd.DataFrame:
    """Every athlete with real regular-season minutes, across the given seasons."""
    frames = []
    for s in seasons:
        d = pd.read_parquet(
            ensure_parquet(s),
            columns=["season", "season_type", "team_abbreviation", "athlete_id",
                     "athlete_display_name", "minutes"],
        )
        d = d[(d["season_type"] == REGULAR_SEASON)
              & d["team_abbreviation"].isin(HOOPR_NBA_TEAMS)
              & d["minutes"].notna() & (d["minutes"] > 0)]
        frames.append(d[["athlete_id", "athlete_display_name"]])
    return pd.concat(frames, ignore_index=True).drop_duplicates("athlete_id")


def fetch_one(aid: int, tries: int = 4) -> str | None:
    """404 means ESPN has no such athlete — a real answer, cached as 'no DOB'.

    5xx and timeouts are NOT answers, they are the endpoint having a moment, and
    retrying is the whole difference between a run that finishes and one that
    doesn't: a single transient `503 Backend fetch failed` killed a ~2,500-athlete
    run at 1,397 on 2026-07-17. ESPN was fine minutes later. Back off and re-ask.
    """
    url = ATHLETE_URL.format(id=aid)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(1, tries + 1):
        try:
            a = json.load(urllib.request.urlopen(req, timeout=30))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code < 500 or attempt == tries:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries:
                raise
        wait = 2 ** attempt  # 2s, 4s, 8s
        print(f"    {aid}: transient error, retry {attempt}/{tries - 1} in {wait}s")
        time.sleep(wait)
    dob = a.get("dateOfBirth")
    # "1984-12-30T08:00Z" -> "1984-12-30". The time component is a timezone artifact
    # of ESPN's storage, not a real birth time; keeping it would imply precision
    # that isn't there and would break a plain date parse downstream.
    return dob.split("T")[0] if dob else None


def build(seasons: list[int]) -> None:
    cache = load_cache()
    want = athlete_ids(seasons)
    todo = [r for _, r in want.iterrows() if int(r["athlete_id"]) not in cache]
    print(f"athletes with minutes {seasons[0]}..{seasons[-1]}: {len(want)} | cached: "
          f"{len(cache)} | to fetch: {len(todo)}")

    misses = 0
    for i, r in enumerate(todo, 1):
        aid = int(r["athlete_id"])
        try:
            dob = fetch_one(aid)
        except Exception as e:  # noqa: BLE001 — partial progress beats losing the run
            print(f"  ! {aid} {r['athlete_display_name']}: {type(e).__name__} {e} — saving and stopping")
            save_cache(cache)
            raise
        if dob is None:
            misses += 1
        cache[aid] = {"athlete_id": aid, "display_name": r["athlete_display_name"], "dob": dob or ""}
        if i % 100 == 0 or i == len(todo):
            print(f"  {i}/{len(todo)} fetched ({misses} without a DOB)")
            save_cache(cache)
        time.sleep(SLEEP_S)

    save_cache(cache)
    have = sum(1 for v in cache.values() if v["dob"])
    ids = set(want["athlete_id"].astype(int))
    cov = sum(1 for k, v in cache.items() if k in ids and v["dob"]) / max(len(ids), 1)
    print(f"\nwrote {os.path.relpath(DOB_CSV, REPO)}: {len(cache)} athletes, {have} with a DOB")
    print(f"coverage over requested seasons: {cov:.1%}")


def verify() -> None:
    """Cross-check ESPN against nba_roster's DOBs — two independent sources, so a
    disagreement means one of them is wrong about a real person and the join key
    (name, on the roster side) is the usual suspect.
    """
    cache = load_cache()
    if not cache:
        raise SystemExit(f"no cache at {DOB_CSV} — run the build first")
    esp = pd.DataFrame(cache.values())
    esp = esp[esp["dob"].astype(bool)].copy()
    esp["norm_name"] = esp["display_name"].map(normalize_name)
    esp["dob"] = pd.to_datetime(esp["dob"])

    r = pd.read_csv(os.path.join(REPO, "data", "nba-rosters", "2026-27.csv"), dtype=str)
    r = r[r["dob"].notna()].copy()
    r["norm_name"] = r["player"].map(normalize_name)
    r["roster_dob"] = pd.to_datetime(r["dob"], format="%m/%d/%y", errors="coerce")
    future = r["roster_dob"] > pd.Timestamp("2026-01-01")
    r.loc[future, "roster_dob"] -= pd.DateOffset(years=100)

    m = esp.merge(r[["norm_name", "roster_dob", "player"]], on="norm_name", how="inner")
    diff = m[m["dob"] != m["roster_dob"]]
    print(f"names present in BOTH sources: {len(m)}")
    print(f"DOB disagreements: {len(diff)}")
    for _, x in diff.head(15).iterrows():
        print(f"  {x['player']:<26} espn={x['dob'].date()}  roster={x['roster_dob'].date()}")
    if not len(diff):
        print("  (none — the two sources agree on every shared player)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", default="2011-2026", help="inclusive range, e.g. 2011-2026")
    ap.add_argument("--verify", action="store_true", help="cross-check the cache vs nba_roster")
    args = ap.parse_args()
    if args.verify:
        verify()
        return
    lo, hi = (int(x) for x in args.seasons.split("-"))
    build(list(range(lo, hi + 1)))


if __name__ == "__main__":
    main()
