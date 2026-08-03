"""Extract the IDENTITY columns from Basketball Monster player-ranking exports.

    python scripts/bbm/extract_bbm_ids.py "~/Downloads/BBM_PlayerRankings (4).xls" ...

BBM's "Export to Excel" produces a legacy OLE2 .xls with 43 columns — ranks,
per-game stats and category values alongside two id columns. Only the identity
part is wanted here; the stats are FHE's own job and would go stale immediately.

  ID      → Basketball Monster's own player id (stable across seasons)
  NBA ID  → the NBA Stats / NBA.com person id (verified: Nikola Jokic = 203999),
            i.e. the SAME namespace as src/lib/nba-player-ids.json and the digits
            inside the `sl-<nbaComId>` placeholders in season_player_stats.

Output is data/player-ids/bbm-players.csv, one row per BBM player id, merged
across every export passed in, with a `seasons` column recording which exports
each player appeared in. That file is the committed source of truth — this
script only needs re-running when BBM publishes fresh exports.

Python rather than TypeScript purely because reading legacy .xls needs xlrd
(`pip install xlrd`), and adding a binary-Excel parser to the Next bundle's
dependency tree to read three files once a season is a bad trade.

Season labelling is by CONTENT, not filename: BBM's export filenames are just
"BBM_PlayerRankings (n).xls" and carry no season. Pass --season for each file in
the same order as the files, or let it infer from the roster (see infer_season).
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import unicodedata

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    sys.exit("pandas is required:  python -m pip install pandas xlrd")

# This docstring and the CSV both contain non-ASCII; a Windows console defaults
# to cp1252 and raises UnicodeEncodeError on --help without this.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_CSV = os.path.join(REPO_ROOT, "data", "player-ids", "bbm-players.csv")

COLUMNS = ["bbm_id", "nba_stats_id", "name", "norm_name", "team", "pos", "seasons"]


def normalize_name(name: str) -> str:
    """Byte-identical to normalizePlayerName() in src/lib/dynasty-rankings.ts.

    lowercase -> strip diacritics -> strip .,'’ -> strip jr/sr/ii/iii/iv -> collapse ws
    """
    s = unicodedata.normalize("NFD", str(name).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[.,'’]", "", s)
    s = re.sub(r"\s+(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def infer_season(df: "pd.DataFrame") -> str:
    """Guess which dataset an export is, from who is in it.

    Filenames carry no season, so this fingerprints the roster instead. Summer
    League is obvious (tiny game counts). The two full seasons are separated by
    players whose availability differs: Cooper Flagg debuted in 2025-26, while
    Damian Lillard and Kyrie Irving both missed it injured.
    """
    names = set(df["Name"].astype(str))
    if df["g"].max() <= 12:
        return "2027-summer"
    if "Cooper Flagg" in names:
        return "2026"
    if "Damian Lillard" in names or "Kyrie Irving" in names:
        return "2025"
    return "unknown"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="+", help="BBM .xls export(s)")
    ap.add_argument(
        "--season",
        action="append",
        default=None,
        help="Season label per file, in order (e.g. 2026). Inferred when omitted.",
    )
    args = ap.parse_args()

    if args.season and len(args.season) != len(args.files):
        sys.exit(f"--season given {len(args.season)} time(s) for {len(args.files)} file(s)")

    players: dict[int, dict] = {}

    for i, path in enumerate(args.files):
        path = os.path.expanduser(path)
        df = pd.read_excel(path)
        missing = {"ID", "NBA ID", "Name"} - set(df.columns)
        if missing:
            sys.exit(f"{path}: missing expected column(s) {sorted(missing)}")

        season = args.season[i] if args.season else infer_season(df)
        with_id = int(df["NBA ID"].notna().sum())
        print(f"{os.path.basename(path)}: {len(df)} rows, {with_id} with an NBA Stats id -> season={season}")

        for _, r in df.iterrows():
            bbm_id = int(r["ID"])
            entry = players.setdefault(
                bbm_id,
                {"bbm_id": bbm_id, "nba_stats_id": "", "name": "", "norm_name": "", "team": "", "pos": "", "seasons": []},
            )
            # Later files win on the mutable fields (name/team/pos change; the
            # ids don't), so pass exports oldest-first for the freshest team.
            entry["name"] = str(r["Name"]).strip()
            entry["norm_name"] = normalize_name(r["Name"])
            if pd.notna(r.get("Team")):
                entry["team"] = str(r["Team"]).strip()
            if pd.notna(r.get("Pos")):
                entry["pos"] = str(r["Pos"]).strip()
            # An NBA Stats id only ever appears once a player has NBA service, so
            # never let a blank from an earlier export overwrite a known one.
            if pd.notna(r["NBA ID"]):
                entry["nba_stats_id"] = str(int(r["NBA ID"]))
            if season not in entry["seasons"]:
                entry["seasons"].append(season)

    rows = sorted(players.values(), key=lambda e: e["name"].lower())
    os.makedirs(os.path.dirname(OUT_CSV), exist_ok=True)
    with open(OUT_CSV, "w", encoding="utf8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        for e in rows:
            w.writerow({**e, "seasons": " ".join(sorted(e["seasons"]))})

    with_nba = sum(1 for e in rows if e["nba_stats_id"])
    print(f"\n{len(rows)} distinct BBM players -> {os.path.relpath(OUT_CSV, REPO_ROOT)}")
    print(f"  with an NBA Stats id: {with_nba} ({with_nba / len(rows):.0%})")
    print(f"  without (no NBA service yet): {len(rows) - with_nba}")


if __name__ == "__main__":
    main()
