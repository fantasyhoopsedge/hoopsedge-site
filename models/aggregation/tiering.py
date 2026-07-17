"""Stage 5 confidence tiering: how much to trust each player's projection.

Presenting every projection as equally precise is dishonest -- a 10-year star on the
same team and an undrafted two-way rookie do not carry the same uncertainty, and a
deep-league dynasty audience that already thinks in variance wants that told to them.
So every player carries a tier (a REAL output field, not an internal QA note):

  High    3+ consistent seasons, no offseason team change, not a rookie, no role/
          depth-chart flag, no injury flag. A known quantity in a known role.
  Medium  a role change is flagged, OR only 1-2 seasons of history, OR a minor injury
          history, OR a straight team change (a known player, new system).
  Low     a rookie (or no NBA track record at all), OR a major trade/signing
          disruption (team change that also moves the player's role or lands on thin
          history), OR a significant injury-recurrence risk.

The tier is the MOST severe trigger that fires, so the rules read as a cascade from
Low up. Every trigger is also emitted in `reasons`, so the tier is auditable and Ash
can see exactly why a player landed where he did. The major/minor boundaries (which
team change is "major", which injury is "significant") are genuine judgment calls;
the thresholds here are explicit and conservative, and the raw signals ride along in
the artifact so they can be retuned without re-deriving them.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class TierSignals:
    """Everything the tiering rules read, assembled per player in assemble.py."""
    is_rookie: bool          # no NBA track record (Stage 4 rookie OR historyless roster spot)
    seasons: int             # # of consistent seasons in the 3-year window (>=30 GP each)
    team_change: bool        # moved franchises this offseason (from the transaction ledger)
    role_change: bool        # role tier != no_change (expanded/reduced), a depth-chart flag
    sig_injury: bool         # significant durability risk: chronic, or one catastrophic season
    minor_injury: bool       # one below-normal-availability season


def assign_tier(s: TierSignals) -> tuple[str, list[str]]:
    """Return (tier, reasons). Reasons are every trigger that fired, most-severe first."""
    reasons: list[str] = []

    # --- Low triggers (any one caps the tier at Low) -------------------------------
    if s.is_rookie:
        reasons.append("rookie / no NBA track record")
    if s.sig_injury:
        reasons.append("significant durability risk (chronic / injury-shortened)")
    # A team change is a "major" disruption -- Low -- only when it also moves the
    # player's role or lands on thin history. A star traded into the same role is real
    # uncertainty but not Low; a role player changing teams AND roles is.
    major_disruption = s.team_change and (s.role_change or s.seasons < 3)
    if major_disruption:
        reasons.append("major trade/signing disruption (team + role/thin history)")
    if reasons:
        return "Low", reasons

    # --- Medium triggers -----------------------------------------------------------
    if s.role_change:
        reasons.append("role change flagged")
    if s.seasons in (1, 2):
        reasons.append(f"only {s.seasons} season(s) of history")
    if s.minor_injury:
        reasons.append("reduced recent availability")
    if s.team_change:
        reasons.append("offseason team change")
    if reasons:
        return "Medium", reasons

    # --- High: nothing fired -------------------------------------------------------
    return "High", [f"{s.seasons}+ consistent seasons, stable role & team"]
