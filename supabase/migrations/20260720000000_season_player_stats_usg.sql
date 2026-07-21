-- ============================================================================
-- FHE SEASONAL RANKINGS — add usg_pct to season_player_stats (/seasonal-rankings)
--
-- Standard NBA usage rate:
--   USG% = 100 * (FGA + 0.44*FTA + TOV) * (TeamMP/5) / (MP * (TeamFGA + 0.44*TeamFTA + TeamTOV))
-- Requires TEAM totals, which only the "2026-27 Projections" dataset currently
-- computes (scripts/build-projection-values.ts, mirroring the same formula
-- models/minutes-allocator/prep_depth_chart.py already uses for the depth-chart
-- tool). Real/summer-league datasets do not populate this column yet — it reads
-- NULL for them, same "no team-total source yet" reasoning, not a bug.
--
-- Additive only — no PK/FK/index changes, no truncate. Idempotent.
-- After applying:  npm run projections:build
-- ============================================================================
alter table public.season_player_stats
  add column if not exists usg_pct numeric;
