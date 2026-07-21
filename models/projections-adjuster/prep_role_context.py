"""Prepare the role-context CSV for the manual tier pass: add `class` + `dyn_rank`,
and sort by team then dynasty rank.

A helper for the human pass, not something the model reads -- Stage 1's load_role_tiers
only consumes `tier` (and `note`), and ignores extra columns. The point is to make the
hand pass legible and fast to navigate:

  class     rookie / sophomore / veteran, from the roster CSV's curated `yos`:
              yos == 'R' -> rookie     (never played; the 2026 draft class)
              yos == '1' -> sophomore  (one NBA season; the 2025 class -- breakout watch)
              yos >= 2   -> veteran
              yos blank  -> veteran by fallback (a few journeymen; each is printed)
            Rookies get their minutes from the Stage 4 board, so a tier edit there is a
            depth-chart call; sophomores are where a year-2 leap is expressed.

  dyn_rank  consensus dynasty rank from src/lib/dynasty-rankings.json, joined ON
            normalized NAME (never on a rank number -- see CLAUDE.md; keying on a
            persisted rank is the James-Harden-age bug). It is ADVISORY and DISPLAY-only,
            re-derived on every run, and never used as a join key downstream, so it does
            not persist a stale rank into anything. Re-run this after a dynasty refresh.

Rows are sorted by (team, dyn_rank, player): within each team the highest-value dynasty
assets come first, and the unranked deep-bench/two-way players fall to the bottom of the
team block. Idempotent: preserves every existing tier / note / source.

Run: python models/projections-adjuster/prep_role_context.py
"""

from __future__ import annotations

import csv
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "rookie-translation"))
from common import REPO, name_candidates, normalize_name  # noqa: E402

ROLE_CSV = os.path.join(REPO, "data", "nba-rosters", "role-context-2026-27.csv")
ROSTER_CSV = os.path.join(REPO, "data", "nba-rosters", "2026-27.csv")
DYNASTY_JSON = os.path.join(REPO, "src", "lib", "dynasty-rankings.json")
# Bundled roster reference the /admin/role-context editor imports. Production (Vercel)
# has a read-only, un-traced filesystem, so the app cannot read this CSV at runtime --
# it reads this JSON instead, overlaying live tiers from Supabase. Regenerated here so
# the two never drift; the CSV stays the model's interface, the JSON the app's.
BUNDLE_JSON = os.path.join(REPO, "src", "data", "role-context-2026-27.json")
UNRANKED = 10_000            # sorts unranked players to the end of their team block


def classify(yos: str) -> tuple[str, bool]:
    """(class, used_fallback). Fallback = blank yos defaulted to veteran."""
    y = (yos or "").strip()
    if y == "R":
        return "rookie", False
    if y == "1":
        return "sophomore", False
    if y.isdigit() and int(y) >= 2:
        return "veteran", False
    return "veteran", True


def load_yos() -> dict[str, str]:
    with open(ROSTER_CSV, encoding="utf-8", newline="") as fh:
        return {normalize_name(r["player"]): r["yos"] for r in csv.DictReader(fh)}


def load_dynasty_rank() -> dict[str, int]:
    """Normalized name -> consensusRank. Keyed on NAME per CLAUDE.md, never rank number."""
    with open(DYNASTY_JSON, encoding="utf-8") as fh:
        return {normalize_name(p["player"]): int(p["consensusRank"]) for p in json.load(fh)}


def main() -> None:
    yos_by_name = load_yos()
    rank_by_name = load_dynasty_rank()

    with open(ROLE_CSV, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    fields = list(rows[0].keys())
    for col, after in (("class", "player"), ("dyn_rank", "class")):
        if col not in fields:
            fields.insert(fields.index(after) + 1, col)

    counts = {"rookie": 0, "sophomore": 0, "veteran": 0}
    fallbacks, unmatched, unranked = [], [], 0
    for r in rows:
        norm = normalize_name(r["player"])
        yos = yos_by_name.get(norm)
        if yos is None:
            unmatched.append(r["player"])
        cls, fb = classify(yos)
        r["class"] = cls
        counts[cls] += 1
        if fb:
            fallbacks.append(r["player"])
        rank = next((rank_by_name[c] for c in name_candidates(norm) if c in rank_by_name), None)
        r["dyn_rank"] = rank if rank is not None else ""
        r["_sort"] = rank if rank is not None else UNRANKED
        if rank is None:
            unranked += 1

    rows.sort(key=lambda r: (r["team"], r["_sort"], normalize_name(r["player"])))
    for r in rows:
        del r["_sort"]

    with open(ROLE_CSV, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    # bundled JSON for the app (roster reference + baseline tier; live tiers overlay from
    # Supabase). camelCase to match the TS store; dynRank null when unranked.
    bundle = [{
        "team": r["team"], "player": r["player"], "class": r["class"],
        "dynRank": int(r["dyn_rank"]) if str(r["dyn_rank"]).strip() else None,
        "tier": r["tier"], "note": r["note"], "source": r["source"],
    } for r in rows]
    os.makedirs(os.path.dirname(BUNDLE_JSON), exist_ok=True)
    with open(BUNDLE_JSON, "w", encoding="utf-8") as fh:
        json.dump(bundle, fh, indent=2)

    print(f"prepped {len(rows)} role-context rows -> sorted by (team, dynasty rank, name)")
    print(f"  class:  rookie {counts['rookie']} | sophomore {counts['sophomore']} | "
          f"veteran {counts['veteran']}")
    print(f"  dyn_rank: {len(rows) - unranked} matched, {unranked} unranked "
          f"(deep bench / two-way -> bottom of each team block)")
    if fallbacks:
        print(f"  {len(fallbacks)} blank-yos -> veteran (verify): {', '.join(fallbacks)}")
    if unmatched:
        print(f"  !! {len(unmatched)} not in roster CSV (name mismatch): {', '.join(unmatched[:8])}")
    print(f"  wrote {os.path.relpath(ROLE_CSV, REPO)} (tiers/notes preserved)")
    print(f"  wrote {os.path.relpath(BUNDLE_JSON, REPO)} ({len(bundle)} rows, for the app)")


if __name__ == "__main__":
    main()
