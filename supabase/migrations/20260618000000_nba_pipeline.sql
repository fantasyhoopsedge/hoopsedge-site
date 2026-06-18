-- ============================================================================
-- FHE NBA DATA PIPELINE — Foundation schema (Option 4: fully free)
--
-- A free, automated NBA reference layer:
--   • rosters + per-game box scores (sportsdataverse hoopR release parquet)
--   • season averages (AGGREGATED from the game logs, not a provider feed)
--   • contracts/salary (fed ONLY by a human-committed CSV — never scraped)
--   • derived free-agent + trade-candidate views
--
-- TWO DATA PATHS:
--   1. Stats  → public.nba_player_game_logs  (source of truth for averages),
--      filled by scripts/nba-data/stats_*.ts from GitHub-hosted parquet files.
--   2. Salary → public.nba_contracts, filled ONLY by scripts/nba-data/
--      salary_ingest.ts reading data/nba-salaries/current.csv. No salary
--      website is ever fetched. This is the entire legal premise of the design.
--
-- SECURITY MODEL (mirrors the prediction-arena pattern in this repo):
--   • RLS on every table, public SELECT policy → anyone can read.
--   • Explicit grants: anon/authenticated get SELECT only; writes are revoked.
--   • Ingest scripts use the service role, which bypasses RLS + these grants.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. nba_teams ─────────────────────────────────────────────────────────────
-- id = ESPN team id; abbreviation is the join/tiebreak key used elsewhere.
create table if not exists public.nba_teams (
  id           text primary key,          -- espn team id
  abbreviation text not null,
  full_name    text,
  conference   text,
  division     text,
  updated_at   timestamptz not null default now()
);

-- ── 2. nba_players ───────────────────────────────────────────────────────────
-- id = ESPN athlete id. norm_name mirrors the dynasty-rankings normalization
-- (lowercase → strip diacritics/punctuation → strip jr/sr/ii.. → collapse
-- spaces) so the salary CSV and the stats feed normalize to the SAME key.
create table if not exists public.nba_players (
  id         text primary key,            -- espn athlete id
  full_name  text not null,
  norm_name  text not null,               -- aggressive-normalized join key
  team       text,                        -- team_abbreviation
  position   text,                        -- athlete_position_abbreviation
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists idx_players_norm on public.nba_players(norm_name);

-- ── 3. nba_player_game_logs ──────────────────────────────────────────────────
-- Raw per-game box scores = the source of truth for season averages.
-- season_type stored as a label: 'regular' | 'postseason' (the ESPN integer
-- 2/3 is mapped at ingest; preseason/off-season rows are dropped).
create table if not exists public.nba_player_game_logs (
  game_id     text not null,
  player_id   text not null references public.nba_players(id),
  game_date   date,
  season      integer not null,
  season_type text not null default 'regular',
  team        text,
  min         numeric,
  pts numeric, reb numeric, oreb numeric, dreb numeric,
  ast numeric, stl numeric, blk numeric, tov numeric,
  fgm numeric, fga numeric, fg3m numeric, fg3a numeric, ftm numeric, fta numeric,
  updated_at  timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index if not exists idx_logs_player_season
  on public.nba_player_game_logs(player_id, season);

-- ── 4. nba_season_averages (materialized view) ───────────────────────────────
-- Per-game averages aggregated from the logs. Refreshed by the ingest scripts.
-- The unique index permits REFRESH MATERIALIZED VIEW CONCURRENTLY.
create materialized view if not exists public.nba_season_averages as
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
  round(sum(fgm) / nullif(sum(fga), 0), 3)  as fg_pct,
  round(sum(ftm) / nullif(sum(fta), 0), 3)  as ft_pct
from public.nba_player_game_logs
group by player_id, season, season_type;
create unique index if not exists idx_sa
  on public.nba_season_averages(player_id, season, season_type);

-- ── 5. nba_contracts ─────────────────────────────────────────────────────────
-- Fed ONLY by the human-committed CSV. salary_player_name keeps the raw CSV
-- name even when it can't be matched to a player (so unmatched rows survive for
-- review). free_agent_* and is_two_way are DERIVED at ingest, not sourced.
create table if not exists public.nba_contracts (
  player_id          text references public.nba_players(id),
  salary_player_name text not null,       -- raw name from CSV
  norm_name          text not null,
  team               text,
  salary_current     bigint,
  salary_y2          bigint,
  salary_y3          bigint,
  salary_y4          bigint,
  contract_note      text,
  free_agent_year    integer,             -- DERIVED
  free_agent_status  text,                -- DERIVED: 'UFA' | 'RFA' | null
  is_two_way         boolean default false,  -- DERIVED
  source             text not null default 'hoopshype_manual_csv',
  updated_at         timestamptz not null default now(),
  primary key (norm_name)
);

-- ── 6. Derived read views ─────────────────────────────────────────────────────
create or replace view public.nba_free_agents as
select c.player_id, c.salary_player_name as player, c.team,
       c.free_agent_status, c.free_agent_year, c.salary_current
from public.nba_contracts c
where c.free_agent_status is not null;

create or replace view public.nba_trade_candidates as
select c.player_id, c.salary_player_name as player, c.team,
       c.free_agent_status, c.free_agent_year, c.salary_current,
       'expiring_or_option' as fhe_signal,
       'FHE-derived heuristic from committed salary data; not a provider feed'
         as disclaimer
from public.nba_contracts c
where c.free_agent_status in ('UFA', 'RFA') or c.is_two_way = true;

-- ── 7. RLS: public read, service-role write ───────────────────────────────────
alter table public.nba_teams            enable row level security;
alter table public.nba_players          enable row level security;
alter table public.nba_player_game_logs enable row level security;
alter table public.nba_contracts        enable row level security;

drop policy if exists "r teams"     on public.nba_teams;
drop policy if exists "r players"   on public.nba_players;
drop policy if exists "r logs"      on public.nba_player_game_logs;
drop policy if exists "r contracts" on public.nba_contracts;
create policy "r teams"     on public.nba_teams            for select using (true);
create policy "r players"   on public.nba_players          for select using (true);
create policy "r logs"      on public.nba_player_game_logs for select using (true);
create policy "r contracts" on public.nba_contracts        for select using (true);

-- ── 8. Explicit privilege grants (defense in depth) ───────────────────────────
-- anon/authenticated may ONLY read. No write grants → the anon key is
-- read-only; all writes go through the service role (which bypasses RLS).
-- Matviews and views can't carry RLS, so the SELECT grant is their only gate.
revoke insert, update, delete on public.nba_teams            from anon, authenticated;
revoke insert, update, delete on public.nba_players          from anon, authenticated;
revoke insert, update, delete on public.nba_player_game_logs from anon, authenticated;
revoke insert, update, delete on public.nba_contracts        from anon, authenticated;

grant select on public.nba_teams            to anon, authenticated;
grant select on public.nba_players          to anon, authenticated;
grant select on public.nba_player_game_logs to anon, authenticated;
grant select on public.nba_contracts        to anon, authenticated;
grant select on public.nba_season_averages  to anon, authenticated;
grant select on public.nba_free_agents      to anon, authenticated;
grant select on public.nba_trade_candidates to anon, authenticated;
