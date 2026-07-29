-- Which year of a player's own contract the CURRENT roster season falls in,
-- e.g. "2 of 5" for a player one season into a 5-year deal. Purely derived
-- (contract_years and the FA-year boundary already fully determine it) —
-- stored rather than computed on read so the team-rosters UI doesn't need to
-- re-derive the arithmetic, and so a bad derivation is visible/auditable in
-- the same place as the rest of the resolved contract fields.

alter table public.nba_roster
  add column if not exists contract_year_position text;
