-- ============================================================================
-- FHE NBA DATA PIPELINE — add FG/FT attempt volumes to season averages
--
-- The 9-cat value engine (/seasonal-rankings) standardizes FG% and FT% as
-- VOLUME-WEIGHTED impact: a player's percentage deviation
-- from the baseline is scaled by how many attempts they take. That requires
-- per-game attempts, which the original nba_season_averages view did not carry.
--
-- The raw fga/fta columns already live in nba_player_game_logs, so this just
-- surfaces their per-game averages. A materialized view can't be altered in
-- place, so we DROP + recreate it, restore the unique index that enables
-- REFRESH … CONCURRENTLY, and re-grant SELECT. The plpgsql refresh function
-- public.refresh_nba_season_averages() resolves the view by name at runtime
-- and needs no change.
--
-- After applying, run a refresh so the new columns populate:
--   select public.refresh_nba_season_averages();
--
-- Idempotent — safe to re-run.
-- ============================================================================

drop materialized view if exists public.nba_season_averages;

create materialized view public.nba_season_averages as
select
  player_id, season, season_type,
  count(*)                                  as gp,
  round(avg(min), 1)                        as min,
  round(avg(pts), 1)                        as pts,
  round(avg(reb), 1)                        as reb,
  round(avg(ast), 1)                        as ast,
  round(avg(stl), 1)                        as stl,
  round(avg(blk), 1)                        as blk,
  round(avg(tov), 1)                        as tov,
  round(avg(fg3m), 1)                       as fg3m,
  round(avg(fga), 1)                        as fga,
  round(avg(fta), 1)                        as fta,
  round(sum(fgm) / nullif(sum(fga), 0), 3)  as fg_pct,
  round(sum(ftm) / nullif(sum(fta), 0), 3)  as ft_pct
from public.nba_player_game_logs
group by player_id, season, season_type;

create unique index if not exists idx_sa
  on public.nba_season_averages(player_id, season, season_type);

grant select on public.nba_season_averages to anon, authenticated;
