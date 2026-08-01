-- ============================================================================
-- FHE REAL SALARY RANKINGS — Phase 1 single-year Surplus Value (/real-salary-rankings)
--
-- One precomputed row per player per season: projected Minus1V (from
-- season_player_values @ season=2027/'projection' — drop-worst-category, NOT
-- the raw 9-cat sum; see build-real-salary-values.ts's docstring for why),
-- discounted for durability
-- (confidenceTier, sourced from the projections artifact — not yet persisted
-- anywhere else in Supabase), converted into an expected cap-dollar price
-- calibrated against the league's real-salary hard cap, minus the player's
-- actual current-season salary. See docs/real-salary-dynasty-rankings-brief.md
-- §3.1-3.2 for the full methodology and worked examples.
--
-- No FK to nba_players: some resolved player ids are the summer-league
-- fallback scheme (sl-<nbaComId>), same reason season_player_stats itself
-- carries no such FK (see build-projection-values.ts's docstring).
--
-- Populated by:  npm run realsalary:build
-- Idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.real_salary_values (
  player_id         text not null,
  season            integer not null,
  league_size       integer not null,        -- baseline pool size used to calibrate this row
  salary            numeric not null,        -- actual current-season cap hit used
  salary_source     text not null,           -- 'nba_roster' | 'nba_contracts'
  confidence_tier   text,                    -- 'High' | 'Medium' | 'Low' | null (unresolved)
  raw_value         numeric not null,        -- projected Minus1V, pre-discount
  discounted_value  numeric not null,        -- raw_value * confidence-tier multiplier
  expected_cap_hit  numeric not null,        -- discounted_value priced in cap dollars
  surplus_value     numeric not null,        -- expected_cap_hit - salary
  surplus_rank      integer,                 -- 1-based rank by surplus_value desc
  updated_at        timestamptz not null default now(),
  primary key (player_id, season)
);

create index if not exists idx_rsv_season_surplus
  on public.real_salary_values(season, surplus_value desc);

-- ── RLS: public read, service-role write (mirrors season_player_values) ──────
alter table public.real_salary_values enable row level security;

drop policy if exists "r real salary values" on public.real_salary_values;
create policy "r real salary values" on public.real_salary_values for select using (true);

revoke insert, update, delete on public.real_salary_values from anon, authenticated;
grant select on public.real_salary_values to anon, authenticated;
