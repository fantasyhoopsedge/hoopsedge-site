-- Extends nba_roster's salary horizon from 4 to 6 seasons.
--
-- Needed for players whose CURRENT season is the last year of an already-
-- expiring deal while a separately-signed extension (a different contract,
-- not a raise within the same one) starts the following season — the
-- extension's own years then run past salary_yr4. Two real cases forced
-- this: Victor Wembanyama (2026-27 = last year of rookie scale; 5yr/$252M
-- extension runs 2027-28..2031-32, needing yr5 AND yr6) and Donovan Mitchell
-- (2026-27 = last year of prior deal; 4yr/$272.9M extension runs
-- 2027-28..2030-31, needing yr5 only). roster_ingest.ts already parses a 5th
-- year from data/nba-salaries/current.csv's salary_y5 column but had nowhere
-- to write it — that silent truncation is the bug this migration closes.

alter table public.nba_roster
  add column if not exists salary_yr5 bigint,  -- = season + 4 (2030-31)
  add column if not exists salary_yr6 bigint;  -- = season + 5 (2031-32)
