-- ============================================================================
-- FHE DRAFT NIGHT CHALLENGE — dedicated MVP schema (handoff §1)
--
-- A self-contained game for the brand launch (`draft-night-2026`). Intentionally
-- SEPARATE from the Prediction Arena (prediction_games / user_predictions): this
-- is a test game shipped to production; a later iteration merges the learning
-- back into the Arena. It deliberately reuses NONE of the Arena's edge_points
-- economy, analyst badges, or agent review queue (handoff §7 forbids exactly
-- that machinery).
--
-- Reuses only `public.profiles` (one row per auth user, auto-provisioned by the
-- existing on_auth_user_created trigger from the prediction_arena migration).
--
-- Prospects are referenced by `slug` (the stable key from src/lib/prospects.ts;
-- the master CSV has no prospect_id). Grading is done in TypeScript by
-- src/lib/draftNight/grader.ts and written back via the service role — the SQL
-- here only stores config, picks, payloads, and scores.
-- ============================================================================

-- ── 1. Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type dn_game_status   as enum ('draft', 'live', 'locked', 'resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dn_mini_game_key  as enum ('mock_lottery', 'guard_order', 'drafted_higher', 'first_round');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dn_mini_game_type as enum ('rank_order', 'single_pick', 'multi_select');
exception when duplicate_object then null; end $$;

-- ── 2. dn_games ──────────────────────────────────────────────────────────────
create table if not exists public.dn_games (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  status      dn_game_status not null default 'draft',
  lock_at     timestamptz not null,          -- first-round tip; auto-locks picks
  resolved_at timestamptz,                    -- set when official order entered
  created_at  timestamptz not null default now()
);

-- ── 3. dn_mini_games (4 rows under the game) ─────────────────────────────────
create table if not exists public.dn_mini_games (
  id      uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.dn_games (id) on delete cascade,
  key     dn_mini_game_key not null,
  type    dn_mini_game_type not null,
  sort    int not null default 0,            -- friction-ascending display order
  config  jsonb not null,                     -- pool of slugs / pairs / slots
  constraint dn_mini_games_game_key_uniq unique (game_id, key)
);

-- ── 4. dn_predictions (one row per user per mini-game) ───────────────────────
create table if not exists public.dn_predictions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  mini_game_id uuid not null references public.dn_mini_games (id) on delete cascade,
  payload      jsonb not null,                -- ordered slug[] / per-pair pick / selected slug[]
  score        int,                           -- null until resolved; grader writes back
  locked       boolean not null default false,
  submitted_at timestamptz not null default now(),
  constraint dn_predictions_user_mini_uniq unique (user_id, mini_game_id)
);

-- ── 5. dn_results (one row per game — the official draft) ─────────────────────
create table if not exists public.dn_results (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null unique references public.dn_games (id) on delete cascade,
  picks       jsonb not null,                 -- { "<slug>": <actual_pick_int> } for picks 1..60
  resolved_at timestamptz not null default now()
);

-- ── 6. Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_dn_mini_games_game on public.dn_mini_games (game_id, sort);
create index if not exists idx_dn_predictions_user on public.dn_predictions (user_id);
create index if not exists idx_dn_predictions_mini on public.dn_predictions (mini_game_id);

-- ── 7. Leaderboard view (handoff §1) ─────────────────────────────────────────
-- Combined Draft Night Score per user per game: sum of mini-game scores floored
-- at 0, ordered desc, with a percentile (1.0 = top). Runs with the view owner's
-- rights (not security_invoker), so the public leaderboard is readable by all
-- without exposing other users' individual prediction rows.
create or replace view public.dn_leaderboard as
with totals as (
  select
    mg.game_id                                   as game_id,
    p.user_id                                    as user_id,
    greatest(0, coalesce(sum(p.score), 0))::int  as score
  from public.dn_predictions p
  join public.dn_mini_games mg on mg.id = p.mini_game_id
  where p.score is not null
  group by mg.game_id, p.user_id
)
select
  t.game_id,
  t.user_id,
  pr.username,
  pr.avatar_url,
  t.score,
  rank()         over (partition by t.game_id order by t.score desc) as rank,
  percent_rank() over (partition by t.game_id order by t.score)      as percentile
from totals t
join public.profiles pr on pr.id = t.user_id;

-- ── 8. Row-Level Security ─────────────────────────────────────────────────────
alter table public.dn_games       enable row level security;
alter table public.dn_mini_games  enable row level security;
alter table public.dn_predictions enable row level security;
alter table public.dn_results     enable row level security;

-- dn_games: non-draft games world-readable; drafts only to analysts.
drop policy if exists "dn_games readable" on public.dn_games;
create policy "dn_games readable" on public.dn_games
  for select using (
    status != 'draft'
    or auth.uid() in (select id from public.profiles where analyst_badge = true)
  );

-- dn_mini_games: readable whenever the parent game is readable (config has no
-- secrets — pools are visible in the UI anyway).
drop policy if exists "dn_mini_games readable" on public.dn_mini_games;
create policy "dn_mini_games readable" on public.dn_mini_games
  for select using (
    exists (
      select 1 from public.dn_games g
      where g.id = game_id
        and (g.status != 'draft'
             or auth.uid() in (select id from public.profiles where analyst_badge = true))
    )
  );

-- dn_results: world-readable (the results screen shows the official picks).
drop policy if exists "dn_results readable" on public.dn_results;
create policy "dn_results readable" on public.dn_results
  for select using (true);

-- dn_predictions: users see only their own; may insert their own only while the
-- game is live and before lock_at (gate-at-submit). No update/delete policy, so
-- predictions are immutable once submitted; the grader writes scores via the
-- service role (RLS bypass).
drop policy if exists "dn_predictions select own"   on public.dn_predictions;
drop policy if exists "dn_predictions insert before lock" on public.dn_predictions;

create policy "dn_predictions select own" on public.dn_predictions
  for select using (auth.uid() = user_id);

create policy "dn_predictions insert before lock" on public.dn_predictions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.dn_mini_games mg
      join public.dn_games g on g.id = mg.game_id
      where mg.id = mini_game_id
        and g.status = 'live'
        and now() < g.lock_at
    )
  );

-- Expose the leaderboard view to the API roles.
grant select on public.dn_leaderboard to anon, authenticated;
