-- ============================================================================
-- FHE REAL SALARY RANKINGS — admit unsigned free agents (/real-salary-rankings)
--
-- The dynasty board ranks players the projection model never sees. The Python
-- model's Stage 1 universe is the "roster of record" — it projects minutes ONTO
-- a team — so a player without a 2026-27 roster spot never enters the pipeline
-- and was therefore invisible on this page despite carrying real dynasty value.
-- Measured 2026-08-03: 37 board-ranked players missing, including Jonathan
-- Kuminga (consensus 182) and DeMar DeRozan (205).
--
-- They are admitted now with last COMPLETED season's ACTUAL Minus1V standing in
-- for the missing projection (see build-real-salary-values.ts's
-- loadCarryForward). But an unsigned player has NO cap hit: the figure sitting
-- in nba_contracts is a cap hold or a last-known contract, not money anyone is
-- paying him this season. Pricing him off it would invent a large phantom
-- negative surplus; giving him the league minimum instead would hand the single
-- biggest cheapness credit in the model to a player with no team at all — the
-- exact artifact CHEAPNESS_CREDIT already fixes for two-ways.
--
-- So: salary and surplus_value become NULLABLE. A null salary means unsigned —
-- no cheapness credit, no surplus, and excluded from the quantile salary curve
-- entirely so it cannot distort anyone else's Market Salary. salary_source
-- gains 'unsigned' alongside 'nba_roster' | 'nba_contracts'.
--
-- Populated by:  npm run realsalary:build
-- Idempotent — safe to re-run.
-- ============================================================================

alter table public.real_salary_values
  alter column salary        drop not null,
  alter column surplus_value drop not null;

comment on column public.real_salary_values.salary is
  'Actual 2026-27 cap hit, or NULL for an unsigned free agent (no roster row, therefore no cap hit). A NULL here is what marks the row unsigned.';
comment on column public.real_salary_values.salary_source is
  '''nba_roster'' | ''nba_contracts'' | ''unsigned''';
comment on column public.real_salary_values.surplus_value is
  'expected_cap_hit - salary, or NULL when salary is NULL (unsigned free agent).';

-- The surplus index already tolerates nulls (they sort last under DESC), but
-- recreate it with NULLS LAST made explicit so the intent survives a future
-- reader wondering where the unsigned rows went.
drop index if exists idx_rsv_season_surplus;
create index if not exists idx_rsv_season_surplus
  on public.real_salary_values(season, surplus_value desc nulls last);
