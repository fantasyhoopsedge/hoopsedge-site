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

RECONCILES MEMBERSHIP AND TEAM AGAINST THE ROSTER, because the roster moves under this
file and nothing else was putting it back in step:
  - a row for someone no longer on an active roster is DROPPED. Stage 1 hard-refuses to
    run while one exists ("a role note for someone who is not on the team is either a
    typo or a roster the CSV has not caught up with"), so leaving them turns a routine
    roster refresh into a blocked pipeline. Rows carrying a real tier/note are reported
    individually before they go -- losing a hand-made call silently would be worse than
    the block.
  - a rostered player with no row is ADDED at no_change, so he is visible in the tier
    pass instead of silently defaulting. Adding at no_change cannot move a projection.
  - `team` is REFRESHED from the roster. A traded player kept his old team here, and a
    stale team key is what broke the Usage Role publish once already (690d651); the
    roster is the source of truth for where someone plays, this file only for his role.
FA is a status, not a team (Stage 1 holds free agents out), so an FA is treated as
off-roster here -- the row comes back if and when he signs.

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


def load_roster() -> dict[str, dict]:
    """Active roster by normalized name. FA is held out: Stage 1 drops free agents, so a
    role note for one is exactly as unusable as a note for someone who was cut."""
    with open(ROSTER_CSV, encoding="utf-8", newline="") as fh:
        return {normalize_name(r["player"]): r
                for r in csv.DictReader(fh) if (r.get("team") or "").strip() != "FA"}


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

    # --- reconcile membership + team against the roster (see module docstring).
    roster = load_roster()
    dropped, retiered = [], []
    kept = []
    for r in rows:
        entry = roster.get(normalize_name(r["player"]))
        if entry is None:
            dropped.append(r)
            continue
        if r["team"] != entry["team"]:
            retiered.append((r["player"], r["team"], entry["team"]))
            r["team"] = entry["team"]
        kept.append(r)
    rows = kept
    have = {normalize_name(r["player"]) for r in rows}
    added = []
    for norm, entry in roster.items():
        if norm in have:
            continue
        new = {f: "" for f in fields}
        new.update({"team": entry["team"], "player": entry["player"], "tier": "no_change"})
        rows.append(new)
        added.append(entry["player"])

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
    if dropped:
        print(f"  dropped {len(dropped)} no longer on an active roster:")
        for r in dropped:
            hand = (r.get("tier") or "no_change") != "no_change" or (r.get("note") or "").strip()
            print(f"    {r['team']} {r['player']}  tier={r.get('tier') or '-'}"
                  + (f"  note={r['note']!r}  <-- HAND-SET, re-add it if he signs" if hand else ""))
    if added:
        print(f"  added {len(added)} newly rostered at no_change: {', '.join(sorted(added))}")
    if retiered:
        print(f"  team refreshed from roster for {len(retiered)}: "
              + ", ".join(f"{p} {a}->{b}" for p, a, b in retiered))
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
