-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fantrax league connector — linked leagues (src/lib/fantrax/store.ts)       ║
-- ║                                                                            ║
-- ║ One row per (owner, league). `owner` is the user's email rather than an     ║
-- ║ auth.users FK because the connector ships admin-only and is gated on the    ║
-- ║ rb_admins email allowlist, the same list the rookie/dynasty board tools     ║
-- ║ use. When the feature graduates to all signed-in users, migrate this to a   ║
-- ║ user_id uuid referencing auth.users and add an owner-scoped RLS policy.     ║
-- ║                                                                            ║
-- ║ ── What is deliberately NOT here ───────────────────────────────────────── ║
-- ║ There is no column for a Fantrax Secret ID, and one must never be added.    ║
-- ║ /privacy §4 publishes the commitment that the Secret ID is never            ║
-- ║ transmitted to, stored on, or logged by any FantasyHoopsEdge server: it     ║
-- ║ lives in the browser's sessionStorage and the browser calls Fantrax with    ║
-- ║ it directly (fantrax.com serves the external API with                       ║
-- ║ access-control-allow-origin: *). The server only ever needs the league id,  ║
-- ║ because every league-scoped Fantrax endpoint is key-less.                   ║
-- ║                                                                            ║
-- ║ `settings` is the imported snapshot (scoring type, categories, roster       ║
-- ║ limits, baseline pool size) so the connector can list a saved league        ║
-- ║ without re-fetching Fantrax. It is display state, not a source of truth —   ║
-- ║ opening a league always re-imports.                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.fx_leagues (
  owner        text        not null,
  league_id    text        not null,
  league_name  text        not null,
  team_id      text,
  team_name    text,
  settings     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (owner, league_id)
);

create index if not exists fx_leagues_owner_idx on public.fx_leagues (owner, updated_at desc);

alter table public.fx_leagues enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing)
-- touches this table, and the API gates on rb_admins before it ever calls in.

comment on table public.fx_leagues is
  'Fantrax leagues a user has linked to FantasyHoopsEdge. Keyed by (owner email, league id). '
  'Holds NO Fantrax credentials — the Secret ID stays in the browser''s sessionStorage per '
  '/privacy section 4; the server only needs the key-less league id. Service-role access only.';
