-- ============================================================================
-- FHE SEASONAL RANKINGS — add usg_pct to season_player_stats (/seasonal-rankings)
--
-- Standard NBA usage rate:
--   USG% = 100 * (FGA + 0.44*FTA + TOV) * (TeamMP/5) / (MP * (TeamFGA + 0.44*TeamFTA + TeamTOV))
-- Requires TEAM totals (TeamMP/TeamFGA/TeamFTA/TeamTOV), computed per
-- season+season_type+team by scripts/build-seasonal-values.ts for every
-- dataset (regular season, playoffs, summer league, all seasons) and by
-- scripts/build-projection-values.ts for the projections dataset.
--
-- Additive only — no PK/FK/index changes, no truncate. Idempotent.
-- After applying:  npm run seasonal:build
-- ============================================================================
alter table public.season_player_stats
  add column if not exists usg_pct numeric;
