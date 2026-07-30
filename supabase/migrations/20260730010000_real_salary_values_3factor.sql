-- ============================================================================
-- FHE REAL SALARY RANKINGS — consensus-anchored Market Value model
-- (/real-salary-rankings)
--
-- Replaces Phase 1's single-factor (durability-discounted Minus1V) pricing.
-- Per Ash's 2026-07-30 design (second revision — "real salary rankings are a
-- variation to dynasty consensus"):
--   1. consensus_z  — dynasty consensus rank, converted to a z-score-
--                      equivalent. The DOMINANT term, not one of several
--                      equally-weighted factors.
--   2. production_z — blended per-game/totals Minus1V (totals bakes in
--                      projected games played, i.e. durability). Priced in
--                      cap dollars via value-over-replacement, salary-
--                      independent on purpose (self-reference — see
--                      src/lib/value/real-salary-model.ts), giving
--                      expected_cap_hit and surplus_value.
--   3. surplus_value is z-scored into an Efficiency adjuster and blended
--      with consensus_z (majority weight) for market_value_score — "you
--      can't stack max-salary max-production stars on one roster," so cap
--      efficiency nudges rank up/down from the consensus anchor.
-- There is no independent salary_z term — a player's own salary only enters
-- through the production-vs-salary efficiency adjuster, never as its own
-- weighted factor (an earlier revision of this migration had one; dropped
-- before ever being applied — see src/lib/value/real-salary-model.ts).
--
-- market_value_score/expected_cap_hit/surplus_value/surplus_rank store the
-- "Balanced" weight preset (see WEIGHT_PRESETS) for server-rendered default
-- display; other archetypes (Contending/Rebuilding/Tanking) are recomputed
-- CLIENT-SIDE from consensus_z/production_z — no extra rows needed.
--
-- raw_value/discounted_value (single-factor Phase 1 columns) are superseded
-- and dropped; consensus_z/production_z replace them.
--
-- Populated by:  npm run realsalary:build
-- Idempotent — safe to re-run.
-- ============================================================================

alter table public.real_salary_values
  drop column if exists raw_value,
  drop column if exists discounted_value,
  drop column if exists salary_z;

alter table public.real_salary_values
  add column if not exists consensus_z        numeric,
  add column if not exists production_z       numeric,
  add column if not exists market_value_score numeric;

-- Backfilled by the next realsalary:build run — not not-null yet so this
-- migration doesn't fail against existing Phase-1 rows.
