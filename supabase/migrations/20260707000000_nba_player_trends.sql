-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ NBA player trends                                                          ║
-- ║                                                                            ║
-- ║ One row per (season, season_type, player_id): the full per-player trend    ║
-- ║ object built by scripts/build-player-trends.ts (12 two-week blocks of      ║
-- ║ 9CatV/Minus1V/8CatV + rolling windows + seasonHistory) as jsonb.           ║
-- ║                                                                            ║
-- ║ Replaces the committed output/player-trends/{season}-{type}.json artifact  ║
-- ║ that api/player-trends/route.ts and roster-live-data.ts used to read off   ║
-- ║ the filesystem — trends now update daily without a redeploy. The payload   ║
-- ║ column is byte-identical to one element of that file's `players` array,    ║
-- ║ so the /api/player-trends response shape is unchanged.                     ║
-- ║                                                                            ║
-- ║ Writes go through the service-role build script only (like every nba_*     ║
-- ║ table) — Insert/Update are `never` in src/types/database.ts.               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.nba_player_trends (
  season       integer     not null,                  -- hoopR-style: 2026 = the 2025-26 season
  season_type  text        not null,                  -- 'regular' | 'postseason'
  player_id    text        not null references public.nba_players(id),
  player_name  text        not null,                  -- denormalized, for debugging/inspection only
  generated_at timestamptz not null,                  -- build timestamp (same across one build's rows)
  payload      jsonb       not null,                  -- PlayerTrendOut: blocks[12] + seasonHistory + bio
  updated_at   timestamptz not null default now(),
  primary key (season, season_type, player_id)
);

create index if not exists idx_trends_dataset on public.nba_player_trends(season, season_type);

-- ── RLS + grants (read-only public, mirrors nba_roster) ──────────────────────
alter table public.nba_player_trends enable row level security;

drop policy if exists "r trends" on public.nba_player_trends;
create policy "r trends" on public.nba_player_trends for select using (true);

revoke insert, update, delete on public.nba_player_trends from anon, authenticated;
grant select on public.nba_player_trends to anon, authenticated;
