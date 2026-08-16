-- ============================================================================
-- FHE POINTS LEAGUE VALUES — precomputed "Universal Standard Matrix" fantasy
-- points store, sitting alongside season_player_values (the 9-cat z-score store).
--
-- Unlike season_player_values, this is NOT a z-scored, baseline-pool-dependent
-- system -- a points-league score is a flat weighted sum of six per-game
-- counting stats already present on season_player_stats, so there is no
-- per-league-size fan-out and no compute-values.ts involvement. One row per
-- (player_id, season, season_type) -- same natural key as season_player_stats,
-- which this table's FK targets directly.
--
-- WEIGHTS ("Universal Standard Matrix", Ash 2026-08-16):
--   PTS +1.0   REB +1.2   AST +1.5   STL +3.0   BLK +3.0   TOV -1.0
-- FG%/FT%/3PM are NOT scored in this standard format (see
-- scripts/build-points-league-values.ts for the exact formula + citation).
--
-- Populated by scripts/build-points-league-values.ts across every
-- season_player_stats dataset EXCEPT season_type='summer' (regular + postseason
-- for all historic seasons, plus the 2027 projection) -- summer league is
-- deliberately excluded per Ash's instruction (exhibition ball, not meant to
-- carry a standard-format fantasy value).
--
-- SECURITY MODEL mirrors season_player_values: RLS on, public SELECT, writes
-- revoked from anon/authenticated (the build script uses the service role).
--
-- After applying, populate with:  npm run points-league:build
-- Idempotent -- safe to re-run.
-- ============================================================================

create table if not exists public.points_league_values (
  player_id   text not null,
  season      integer not null,
  season_type text not null,
  fpts        numeric,                      -- per-game, the Universal Standard Matrix score
  fpts_total  numeric,                      -- season total = fpts * g
  fpts_rank   integer,                      -- 1-based rank by fpts desc, within (season, season_type)
  updated_at  timestamptz not null default now(),
  primary key (player_id, season, season_type),
  foreign key (player_id, season, season_type)
    references public.season_player_stats(player_id, season, season_type)
    on delete cascade
);

create index if not exists idx_plv_season_type_fpts
  on public.points_league_values(season, season_type, fpts desc);

-- ── RLS: public read, service-role write ──────────────────────────────────────
alter table public.points_league_values enable row level security;

drop policy if exists "r points league values" on public.points_league_values;
create policy "r points league values" on public.points_league_values for select using (true);

revoke insert, update, delete on public.points_league_values from anon, authenticated;
grant select on public.points_league_values to anon, authenticated;
