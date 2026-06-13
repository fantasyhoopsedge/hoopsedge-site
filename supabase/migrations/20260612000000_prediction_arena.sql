-- ============================================================================
-- FHE PREDICTION ARENA — Foundation migration
-- Run this in the Supabase SQL editor (or via `supabase db push`).
--
-- Creates: profiles, prediction_games, user_predictions
-- Hardens: RLS on every table, column-level grants so clients can never
--          write points/outcome fields, and all time checks use the
--          database clock (now()) — never a client-supplied timestamp.
-- ============================================================================

-- ── 1. Extensions ───────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto"; -- provides gen_random_uuid()

-- ── 2. profiles ─────────────────────────────────────────────────────────────
-- One row per auth user. Created automatically by the trigger below.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique,
  avatar_url    text,
  edge_points   integer not null default 0 check (edge_points >= 0),
  analyst_badge boolean not null default false,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Public-facing player profile. edge_points / analyst_badge / is_admin are server-managed only (see column grants).';

-- Auto-provision a profile the moment a Google OAuth user is created.
-- security definer so it can insert past RLS; search_path pinned for safety.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3. prediction_games ─────────────────────────────────────────────────────
create table if not exists public.prediction_games (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  tier          text not null check (tier in ('nightly', 'monthly', 'seasonal')),
  question_type text not null check (question_type in ('boolean', 'single_choice', 'multi_choice', 'ranking')),
  options       jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  deadline      timestamptz not null,
  outcome       jsonb,
  status        text not null default 'active' check (status in ('active', 'locked', 'resolved')),
  created_at    timestamptz not null default now()
);

comment on table public.prediction_games is
  'Prediction questions across the three game tiers. Written only by service_role / admins.';

-- ── 4. user_predictions ─────────────────────────────────────────────────────
create table if not exists public.user_predictions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  game_id              uuid not null references public.prediction_games (id) on delete cascade,
  prediction_selection jsonb not null,
  is_correct           boolean,
  points_awarded       integer not null default 0,
  submitted_at         timestamptz not null default now()
);

comment on column public.user_predictions.submitted_at is
  'Always set by the database clock (default now()); clients cannot supply it — see column grants.';

-- ── 5. Constraints & indexes ────────────────────────────────────────────────
-- Strictly one prediction per user per game.
create unique index if not exists user_predictions_user_game_uniq
  on public.user_predictions (user_id, game_id);

create index if not exists user_predictions_game_idx
  on public.user_predictions (game_id);

create index if not exists prediction_games_deadline_idx
  on public.prediction_games (deadline);

create index if not exists prediction_games_status_idx
  on public.prediction_games (status);

-- Fast leaderboard sort.
create index if not exists profiles_edge_points_desc_idx
  on public.profiles (edge_points desc);

-- ── 6. Row-Level Security ───────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.prediction_games enable row level security;
alter table public.user_predictions enable row level security;

-- Admin check helper. security definer so the policy on prediction_games can
-- read profiles without recursing into profiles' own RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- profiles: anyone (incl. anon, for public leaderboards) can read;
-- users may insert/update only their own row.
drop policy if exists "profiles_select_all"  on public.profiles;
drop policy if exists "profiles_insert_own"  on public.profiles;
drop policy if exists "profiles_update_own"  on public.profiles;

create policy "profiles_select_all" on public.profiles
  for select using (true);

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- prediction_games: world-readable; writes only by admins (service_role
-- bypasses RLS entirely, so resolution jobs using the service key just work).
drop policy if exists "games_select_all"   on public.prediction_games;
drop policy if exists "games_admin_insert" on public.prediction_games;
drop policy if exists "games_admin_update" on public.prediction_games;
drop policy if exists "games_admin_delete" on public.prediction_games;

create policy "games_select_all" on public.prediction_games
  for select using (true);

create policy "games_admin_insert" on public.prediction_games
  for insert to authenticated
  with check (public.is_admin());

create policy "games_admin_update" on public.prediction_games
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "games_admin_delete" on public.prediction_games
  for delete to authenticated
  using (public.is_admin());

-- user_predictions: users see ONLY their own rows; inserts allowed only for
-- their own user_id, only while the game is still active AND the database
-- clock (now()) is before the deadline. No update/delete policies exist, so
-- predictions are immutable once submitted (lock-in by design).
drop policy if exists "predictions_select_own" on public.user_predictions;
drop policy if exists "predictions_insert_own_before_deadline" on public.user_predictions;

create policy "predictions_select_own" on public.user_predictions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "predictions_insert_own_before_deadline" on public.user_predictions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.prediction_games g
      where g.id = game_id
        and g.status = 'active'
        and now() < g.deadline   -- server clock; immune to device-time manipulation
    )
  );

-- ── 7. Column-level grants (defense in depth) ───────────────────────────────
-- RLS controls *rows*; these grants control *columns*. Without them a user
-- could UPDATE their own profile row and award themselves edge_points, or
-- INSERT a prediction with points_awarded/is_correct/submitted_at pre-filled.
revoke insert, update on public.profiles from anon, authenticated;
grant  insert (id, username, avatar_url) on public.profiles to authenticated;
grant  update (username, avatar_url)     on public.profiles to authenticated;

revoke insert, update on public.user_predictions from anon, authenticated;
grant  insert (user_id, game_id, prediction_selection)
  on public.user_predictions to authenticated;
-- (is_correct, points_awarded, submitted_at are service_role-only)

revoke insert, update, delete on public.prediction_games from anon;

-- ── 8. Realtime ─────────────────────────────────────────────────────────────
-- Broadcast game status changes + leaderboard movement to connected clients.
do $$
begin
  alter publication supabase_realtime add table public.prediction_games;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;
