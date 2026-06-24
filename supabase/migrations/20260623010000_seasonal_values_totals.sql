-- ============================================================================
-- FHE SEASONAL RANKINGS — add TOTALS-mode value columns (/seasonal-rankings)
--
-- Per-game values standardize per-game stats against the pool. TOTALS values
-- standardize season TOTALS (per-game × games played) against the pool — this
-- rewards durability/volume, so a player's Value & Minus1V differ between the
-- Per Game and Totals views. Both are precomputed per
-- (player, season, season_type, league_size) by build-seasonal-values.ts and
-- live in the same row (one set of *_tot columns alongside the per-game ones).
--
-- Additive only — no PK/FK/index changes, no truncate. Idempotent.
-- After applying:  npm run seasonal:build
-- ============================================================================
alter table public.season_player_values
  add column if not exists v_pts_tot   numeric,
  add column if not exists v_fg3_tot   numeric,
  add column if not exists v_reb_tot   numeric,
  add column if not exists v_ast_tot   numeric,
  add column if not exists v_stl_tot   numeric,
  add column if not exists v_blk_tot   numeric,
  add column if not exists v_fg_tot    numeric,
  add column if not exists v_ft_tot    numeric,
  add column if not exists v_to_tot    numeric,
  add column if not exists value_tot   numeric,
  add column if not exists minus1v_tot numeric;
