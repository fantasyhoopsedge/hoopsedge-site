-- ============================================================================
-- FHE ROOKIE BOARD — live, admin-editable rankings
--
-- Moves the 2026 Rookie Board off the static repo file and into Supabase so
-- admins can update rankings on the fly through the off-season (a living list),
-- with the public board refreshed instantly on publish.
--
--   rb_admins   — email allowlist; only these users may edit.
--   rb_docs     — singleton documents: the published 'live' board + a 'draft'
--                 (WIP) board. Each holds the full board as JSONB.
--   rb_versions — published version archive (1.0, 1.1, 1.2 …) for history.
--
-- Security:
--   * Public (anon) can read ONLY the live doc + version list (for the public
--     board and history). Drafts and the admin list are never anon-readable.
--   * All writes happen server-side via the service-role key AFTER the Route
--     Handler verifies the caller's email is in rb_admins. No anon write paths.
-- ============================================================================

-- ── Admin allowlist ─────────────────────────────────────────────────────────
create table if not exists public.rb_admins (
  email    text primary key,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.rb_admins enable row level security;
-- No policies: anon/authenticated get nothing. The service role bypasses RLS,
-- and is_rb_admin() (security definer) answers "am I an admin?" without
-- exposing the list.

-- ── Board documents (live + draft) ──────────────────────────────────────────
create table if not exists public.rb_docs (
  slug       text primary key check (slug in ('live', 'draft')),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.rb_docs enable row level security;

drop policy if exists "rb_docs anon reads live" on public.rb_docs;
create policy "rb_docs anon reads live"
  on public.rb_docs for select
  using (slug = 'live');
-- Drafts + all writes: service role only (bypasses RLS). No other policies.

-- ── Published version archive ───────────────────────────────────────────────
create table if not exists public.rb_versions (
  version    text primary key,
  label      text,
  saved_at   date not null default current_date,
  players    int,
  note       text,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.rb_versions enable row level security;

drop policy if exists "rb_versions public read" on public.rb_versions;
create policy "rb_versions public read"
  on public.rb_versions for select
  using (true);
-- Writes: service role only.

-- ── Grants (RLS still filters rows; these just allow the roles to try) ───────
grant select on public.rb_docs     to anon, authenticated;
grant select on public.rb_versions to anon, authenticated;
-- rb_admins: no grants to anon/authenticated.

-- ── is_rb_admin(): does the current JWT's email belong to an admin? ─────────
-- Callable by the browser (nav link visibility) without reading the table.
create or replace function public.is_rb_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.rb_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_rb_admin() to anon, authenticated;

-- ── Seed admins here (edit to your address, or add rows via the dashboard) ───
-- insert into public.rb_admins (email, note) values
--   ('ash.huggins@me.com', 'owner')
-- on conflict (email) do nothing;
