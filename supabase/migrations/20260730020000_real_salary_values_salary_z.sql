-- ============================================================================
-- FHE REAL SALARY RANKINGS — reintroduce salary_z (5th revision)
-- (/real-salary-rankings)
--
-- Ash's 2026-07-30 fix: the Efficiency adjuster (previously production
-- alone) under-credits a player like Cameron Boozer, whose box-score
-- production is still developing as a rookie but who's locked into 4 years
-- of cheap rookie-scale salary — the real asset in a real-salary format.
-- Efficiency is now a weighted blend of CHEAPNESS (salary_z, rank-to-z of
-- salary rank ascending — a LOW salary scores well) and production_z,
-- weighted 60/40 toward salary by default (EFFICIENCY_SUBWEIGHTS in
-- src/lib/value/real-salary-model.ts). This is a DIFFERENT column from the
-- salary_z dropped in migration 20260730010000 (that revision used salary_z
-- as an independent THIRD weighted factor, priced in dollars — dropped for
-- a self-reference bug; this revision's salary_z only ever influences RANK
-- POSITION in z-space, never a dollar computation directly, so it's safe).
--
-- Populated by:  npm run realsalary:build
-- Idempotent — safe to re-run.
-- ============================================================================

alter table public.real_salary_values
  add column if not exists salary_z numeric;

-- Backfilled by the next realsalary:build run — not not-null yet so this
-- migration doesn't fail against existing rows.
