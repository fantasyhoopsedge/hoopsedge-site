"""The player identity layer, Python side.

Reads the SAME generated snapshot the TypeScript app reads
(`src/lib/player-identity/registry.json`, written by `npm run identity:build`)
rather than getting a copy of it. A second copy is a second thing to drift, and
drift across the TS/Python boundary is the specific cost this layer exists to
remove — see docs/player-identity-layer.md, Cost 2 (the normalizer copy-pasted
four times in two languages) and Cost 3 (three alias maps that could not share
code).

Reading a file out of `src/` from Python is deliberate and not an accident of
layout: the snapshot is a generated artifact with one producer and two
consumers, and it lives where the bundler can import it. The alternative — mirror
it into `models/data/` — is exactly the arrangement that let
`ROSTER_NAME_TO_HOOPR` sit at three entries while its TypeScript "mirror" grew
to ten.

Usage:

    from player_identity import normalize_name, name_candidates, registry

    norm = normalize_name("Nikola Jokić")          # "nikola jokic"
    ident = registry().by_espn_id("3112335")       # IdentityRecord | None
    ident = registry().resolve(name="Cam Johnson") # alias-aware, refuses to guess

Import path: `models/` is not a package, so scripts one directory down add the
parent to sys.path. `models/rookie-translation/common.py` already does this and
re-exports `normalize_name`, so most model code needs no change.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REGISTRY_JSON = os.path.join(REPO, "src", "lib", "player-identity", "registry.json")


def normalize_name(name: str) -> str:
    """THE name normalizer — same rule as normalizePlayerName() in
    src/lib/player-identity/normalize.ts.

    lowercase -> strip diacritics -> strip .,'’ -> strip a trailing generational
    suffix (jr/sr/ii/iii/iv) -> collapse whitespace.

    This is still a second implementation, because Python cannot import
    TypeScript. What has changed is that the parity is now CHECKED rather than
    asserted: `npm run identity:verify` runs both against every name in the
    registry and fails on the first disagreement. Do not edit this without
    editing normalize.ts, and do not edit either without running that check.
    """
    s = unicodedata.normalize("NFD", str(name).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[.,'’]", "", s)
    s = re.sub(r"\s+(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class IdentityRecord:
    fhe_id: str
    display_name: str
    norm_name: str
    status: str
    espn_id: str | None = None
    nba_stats_id: str | None = None
    bbm_id: str | None = None
    fantrax_id: str | None = None
    dob: str | None = None
    draft_year: int | None = None
    current_team: str | None = None


class PlayerIdentityIndex:
    """Mirror of PlayerIdentityIndex in src/lib/player-identity/registry.ts.

    Same resolution ladder, same refusal to guess: provider id, then a unique
    alias-aware name, then DOB/draft-year/team to separate namesakes, then
    nothing. `resolve()` returning None means "I don't know", which is a valid
    and useful answer — a blank cell is a visible gap, a wrong join is a silent
    lie that attaches a real stat line to the wrong human.
    """

    def __init__(self, records: list[IdentityRecord], aliases: dict[str, str]):
        self._records = records
        self._by_fhe: dict[str, IdentityRecord] = {}
        self._by_provider: dict[str, dict[str, IdentityRecord]] = {
            "espn_id": {}, "nba_stats_id": {}, "bbm_id": {}, "fantrax_id": {},
        }
        self._by_norm: dict[str, list[IdentityRecord]] = {}
        for r in records:
            self._by_fhe[r.fhe_id] = r
            for field in self._by_provider:
                value = getattr(r, field)
                if value:
                    self._by_provider[field][value] = r
            self._by_norm.setdefault(r.norm_name, []).append(r)
        # Both directions, so a caller holding either form resolves.
        self._aliases: dict[str, str] = {}
        for nickname, legal in aliases.items():
            self._aliases[nickname] = legal
            self._aliases[legal] = nickname

    def __len__(self) -> int:
        return len(self._records)

    @property
    def aliases(self) -> dict[str, str]:
        """The alias map, both directions. Authored in
        src/lib/player-name-aliases.ts and carried here by the snapshot."""
        return dict(self._aliases)

    def name_candidates(self, name: str) -> list[str]:
        """Normalized keys worth trying, best first: the name, then its
        nickname/legal counterpart."""
        norm = normalize_name(name)
        alt = self._aliases.get(norm)
        return [norm, alt] if alt else [norm]

    def by_fhe_id(self, fhe_id: str | None) -> IdentityRecord | None:
        return self._by_fhe.get(fhe_id) if fhe_id else None

    def by_espn_id(self, espn_id: str | None) -> IdentityRecord | None:
        return self._by_provider["espn_id"].get(str(espn_id)) if espn_id else None

    def by_provider_id(self, field: str, value: str | None) -> IdentityRecord | None:
        return self._by_provider[field].get(str(value)) if value else None

    def candidates_by_name(self, name: str | None) -> list[IdentityRecord]:
        """Every identity a name could refer to. More than one is the
        duplicate-name case — do not resolve it by taking the first."""
        if not name:
            return []
        for key in self.name_candidates(name):
            hit = self._by_norm.get(key)
            if hit:
                return list(hit)
        return []

    def resolve(
        self,
        *,
        espn_id: str | None = None,
        nba_stats_id: str | None = None,
        bbm_id: str | None = None,
        fantrax_id: str | None = None,
        name: str | None = None,
        dob: str | None = None,
        draft_year: int | None = None,
        team: str | None = None,
    ) -> IdentityRecord | None:
        for field, value in (
            ("espn_id", espn_id), ("nba_stats_id", nba_stats_id),
            ("bbm_id", bbm_id), ("fantrax_id", fantrax_id),
        ):
            hit = self.by_provider_id(field, value)
            if hit:
                return hit

        candidates = self.candidates_by_name(name)
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]

        # Namesakes: separate them on evidence, strongest attribute first, and
        # only when a filter leaves exactly one standing.
        for attr, value in (("dob", dob), ("draft_year", draft_year), ("current_team", team)):
            if value is None:
                continue
            hits = [r for r in candidates if getattr(r, attr) == value]
            if len(hits) == 1:
                return hits[0]
        return None


@lru_cache(maxsize=1)
def registry() -> PlayerIdentityIndex:
    """The registry snapshot, parsed once per process.

    Raises if the snapshot is missing rather than returning an empty index: an
    empty registry silently turns every lookup into "no such player", which is
    indistinguishable from a genuine coverage problem. Run `npm run
    identity:build` if this fires.
    """
    if not os.path.exists(REGISTRY_JSON):
        raise FileNotFoundError(
            f"{REGISTRY_JSON} is missing — run `npm run identity:build` to generate it."
        )
    with open(REGISTRY_JSON, encoding="utf-8") as fh:
        snapshot = json.load(fh)

    records = [
        IdentityRecord(
            fhe_id=p["fheId"],
            display_name=p["displayName"],
            norm_name=p["normName"],
            status=p["status"],
            espn_id=p.get("espnId"),
            nba_stats_id=p.get("nbaStatsId"),
            bbm_id=p.get("bbmId"),
            fantrax_id=p.get("fantraxId"),
            dob=p.get("dob"),
            draft_year=p.get("draftYear"),
            current_team=p.get("currentTeam"),
        )
        for p in snapshot["players"]
    ]
    return PlayerIdentityIndex(records, snapshot.get("aliases", {}))


def name_candidates(norm_or_name: str) -> list[str]:
    """Module-level convenience wrapper — accepts a raw or normalized name."""
    return registry().name_candidates(norm_or_name)
