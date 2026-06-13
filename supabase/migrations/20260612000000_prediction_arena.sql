-- ============================================================================
-- FHE PREDICTION ARENA — Foundation schema
--
-- This migration mirrors the schema actually deployed in the live Supabase
-- project (originally applied by hand via the SQL editor). It is the source of
-- truth; keep it in sync with production. Tables use native ENUM types, and
-- prediction_games.status defaults to 'draft' so agent-proposed games stay
-- hidden until an analyst approves them.
--
-- NOTE: this baseline reproduces production AS-IS, including the fact that it
-- has NO column-level write grants. Those grants (which stop users from
-- self-awarding edge_points / analyst_badge / prediction points) are added in
-- 20260613000000_harden_column_grants.sql — run that too.
-- ============================================================================

-- ── 1. Extensions & enums ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

do $$ begin
  create type game_tier     as enum ('nightly', 'monthly', 'seasonal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_type as enum ('boolean', 'single_choice', 'multi_choice', 'ranking');
exception when duplicate_object then null; end $$;

do $$ begin
  create type game_status   as enum ('draft', 'active', 'locked', 'resolved');
exception when duplicate_object then null; end $$;

-- ── 2. profiles ──────────────────────────────────────────────────────────────
-- One row per auth user, created automatically by the trigger below.
-- analyst_badge is the sole privileged flag (admin gate); there is no is_admin.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique,
  avatar_url    text,
  edge_points   integer not null default 0,
  analyst_badge boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ── 3. prediction_games ──────────────────────────────────────────────────────
-- `question_type` is a column of the enum type `question_type` (same name).
create table if not exists public.prediction_games (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  tier          game_tier not null,
  question_type question_type not null,
  options       jsonb not null,                 -- array of choice strings
  deadline      timestamptz not null,
  outcome       jsonb,                           -- result matrix when resolved
  status        game_status not null default 'draft',
  created_at    timestamptz not null default now()
);

-- ── 4. user_predictions ──────────────────────────────────────────────────────
create table if not exists public.user_predictions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  game_id              uuid not null references public.prediction_games (id) on delete cascade,
  prediction_selection jsonb not null,
  is_correct           boolean,
  points_awarded       integer not null default 0,
  submitted_at         timestamptz not null default now(),
  constraint unique_user_game_prediction unique (user_id, game_id)
);

-- ── 5. Indexes ───────────────────────────────────────────────────────────────
create index if not exists idx_prediction_games_status_deadline
  on public.prediction_games (status, deadline);
create index if not exists idx_profiles_leaderboard
  on public.profiles (edge_points desc);
create index if not exists idx_user_predictions_lookup
  on public.user_predictions (user_id, game_id);

-- ── 6. Auto-provision profile on signup ──────────────────────────────────────
create or replace function public.handle_new_user_signup()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, username, avatar_url, edge_points, analyst_badge)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    0,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_signup();

-- ── 7. Row-Level Security ─────────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.prediction_games enable row level security;
alter table public.user_predictions enable row level security;

-- profiles: world-readable; users may update only their own row.
drop policy if exists "Public Profiles are viewable by anyone" on public.profiles;
drop policy if exists "Users can edit their own profile"       on public.profiles;

create policy "Public Profiles are viewable by anyone" on public.profiles
  for select using (true);
create policy "Users can edit their own profile" on public.profiles
  for update using (auth.uid() = id);

-- prediction_games: non-draft games are world-readable; drafts are visible
-- only to analysts. No write policies exist, so only service_role can write
-- (RLS bypass) — the agent worker and approve action both use the service key.
drop policy if exists "Active games are readable by everyone" on public.prediction_games;

create policy "Active games are readable by everyone" on public.prediction_games
  for select using (
    status != 'draft'
    or auth.uid() in (select id from public.profiles where analyst_badge = true)
  );

-- user_predictions: users see only their own; inserts allowed only for their
-- own user_id, only while the game is active and before the deadline (server
-- clock). No update/delete policies → predictions are immutable once made.
drop policy if exists "Users can review their own predictions"        on public.user_predictions;
drop policy if exists "Users can input predictions before game lockout" on public.user_predictions;

create policy "Users can review their own predictions" on public.user_predictions
  for select using (auth.uid() = user_id);
create policy "Users can input predictions before game lockout" on public.user_predictions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.prediction_games
      where id = game_id and status = 'active' and now() < deadline
    )
  );
