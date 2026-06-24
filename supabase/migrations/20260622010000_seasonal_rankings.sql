-- ============================================================================
-- FHE SEASONAL RANKINGS — precomputed 9-cat value store (/seasonal-rankings)
--
-- Values are industry-standard z-scores standardized against a baseline pool = the
-- top-N players by value, where N = league roster capacity. The league size IS
-- the baseline, so values are precomputed ONCE PER LEAGUE SIZE by
-- scripts/build-seasonal-values.ts and stored here. Per-game/totals and
-- min-games/min-minutes are DISPLAY-ONLY and never enter this math.
--
-- TWO TABLES:
--   • season_player_stats  — one row per player, stable across league sizes
--     (identity + raw per-game stats + consensus rank).
--   • season_player_values — one row per (player, league_size): the 9 category
--     V-scores plus value / minus1v / value_rank.
--
-- SECURITY MODEL mirrors the nba_pipeline tables: RLS on, public SELECT policy,
-- explicit SELECT-only grants for anon/authenticated, writes revoked (the build
-- script uses the service role, which bypasses RLS + grants).
--
-- After applying, populate with:  npm run seasonal:build
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. season_player_stats ────────────────────────────────────────────────────
-- headshot_id holds the ESPN athlete id (= player_id); the page builds the ESPN
-- headshot URL from it. All per-game stats are stored at display precision.
create table if not exists public.season_player_stats (
  player_id      text primary key,
  name           text not null,
  team           text,
  position       text,                       -- normalized to G | F | C | G/F | F/C
  headshot_id    text,
  g              integer,
  mpg            numeric,
  pts            numeric,
  fg3m           numeric,
  reb            numeric,
  ast            numeric,
  stl            numeric,
  blk            numeric,
  tov            numeric,
  fga            numeric,
  fta            numeric,
  fg_pct         numeric,
  ft_pct         numeric,
  consensus_rank integer,                    -- dynasty consensus; null = N/R
  updated_at     timestamptz not null default now()
);

-- ── 2. season_player_values ───────────────────────────────────────────────────
-- Column names are the Postgres-safe forms of the canonical V-score keys:
--   v_pts=pV, v_fg3=3V, v_reb=rV, v_ast=aV, v_stl=sV, v_blk=bV,
--   v_fg=fg%V, v_ft=ft%V, v_to=toV (already sign-flipped: fewer TO = positive).
create table if not exists public.season_player_values (
  player_id   text not null references public.season_player_stats(player_id) on delete cascade,
  league_size integer not null,
  v_pts       numeric,
  v_fg3       numeric,
  v_reb       numeric,
  v_ast       numeric,
  v_stl       numeric,
  v_blk       numeric,
  v_fg        numeric,
  v_ft        numeric,
  v_to        numeric,
  value       numeric,
  minus1v     numeric,
  value_rank  integer,
  updated_at  timestamptz not null default now(),
  primary key (player_id, league_size)
);
create index if not exists idx_spv_size_value
  on public.season_player_values(league_size, value desc);

-- ── 3. RLS: public read, service-role write ───────────────────────────────────
alter table public.season_player_stats  enable row level security;
alter table public.season_player_values enable row level security;

drop policy if exists "r season stats"  on public.season_player_stats;
drop policy if exists "r season values" on public.season_player_values;
create policy "r season stats"  on public.season_player_stats  for select using (true);
create policy "r season values" on public.season_player_values for select using (true);

-- ── 4. Explicit privilege grants (defense in depth) ───────────────────────────
revoke insert, update, delete on public.season_player_stats  from anon, authenticated;
revoke insert, update, delete on public.season_player_values from anon, authenticated;
grant select on public.season_player_stats  to anon, authenticated;
grant select on public.season_player_values to anon, authenticated;
