-- ============================================================================
-- FHE SEASONAL RANKINGS — add the SEASON dimension (/seasonal-rankings)
--
-- The value store originally held one dataset (the latest regular season). This
-- adds (season, season_type) so multiple seasons + playoffs coexist:
--   • season       — hoopR season int (2026 = 2025-26)
--   • season_type  — 'regular' | 'postseason'
--
-- Both tables are EMPTIED here and fully repopulated by `npm run seasonal:build`
-- (all datasets), so truncating first is the clean path — no stale league sizes
-- or orphaned rows survive. The build also switched the league-size menu to
-- 250..450, so old 144/256 rows must not linger.
--
-- Idempotent — safe to re-run. After applying:  npm run seasonal:build
-- ============================================================================

-- Empty both (child first via the cascade; explicit for clarity).
truncate table public.season_player_values, public.season_player_stats;

-- Drop the child→parent FK FIRST — it depends on the parent's PK, so the parent
-- PK can't be replaced while it exists.
alter table public.season_player_values drop constraint if exists season_player_values_player_id_fkey;
alter table public.season_player_values drop constraint if exists season_player_values_stats_fkey;

-- ── season_player_stats: composite PK (player_id, season, season_type) ─────────
alter table public.season_player_stats
  add column if not exists season       integer,
  add column if not exists season_type  text;
alter table public.season_player_stats
  alter column season      set not null,
  alter column season_type set not null;
alter table public.season_player_stats drop constraint if exists season_player_stats_pkey;
alter table public.season_player_stats add primary key (player_id, season, season_type);

-- ── season_player_values: add columns, recompose PK, re-add FK ─────────────────
alter table public.season_player_values
  add column if not exists season       integer,
  add column if not exists season_type  text;
alter table public.season_player_values
  alter column season      set not null,
  alter column season_type set not null;
alter table public.season_player_values drop constraint if exists season_player_values_pkey;
alter table public.season_player_values add primary key (player_id, season, season_type, league_size);
alter table public.season_player_values
  add constraint season_player_values_stats_fkey
  foreign key (player_id, season, season_type)
  references public.season_player_stats(player_id, season, season_type) on delete cascade;

-- ── lookup index for the common (season, type, size) → value desc path ─────────
drop index if exists idx_spv_size_value;
create index if not exists idx_spv_season_size_value
  on public.season_player_values(season, season_type, league_size, value desc);

-- RLS policies + grants from the prior migration still apply (table-level, not
-- column-level), so nothing to re-grant here.
