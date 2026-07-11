-- Qualifying-Offer year tagging for nba_roster.
--
-- salary_yr1..yr4 already carry a real dollar figure for a QO year (current.csv
-- has it — it's just a formulaic RFA cap hold, not a negotiated salary). This
-- column flags WHICH of those years are QO so the app can badge them
-- distinctly instead of showing them as an ordinary confirmed salary.
-- Mirrors the existing salary_estimated_years column: comma-separated season
-- labels, e.g. '2028-29' or '2028-29, 2029-30'.

alter table public.nba_roster
  add column if not exists salary_qo_years text;
