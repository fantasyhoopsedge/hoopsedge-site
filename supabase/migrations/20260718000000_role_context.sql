-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Role-context tier store (Stage 1 projection input)                         ║
-- ║                                                                            ║
-- ║ Backs the /admin/role-context editor in production. The season projection  ║
-- ║ model reads per-player role TIERS from data/nba-rosters/role-context-*.csv;║
-- ║ this table lets the owner edit those tiers from anywhere (Vercel's FS is    ║
-- ║ read-only), then scripts/sync-role-context.ts pulls the published tiers    ║
-- ║ back into the CSV before a local model run.                                ║
-- ║                                                                            ║
-- ║ One row per season. `published` and `draft` are tier-override maps keyed   ║
-- ║ "TEAM||Player" -> tier value (won_job|expanded|no_change|reduced|          ║
-- ║ clear_backup). draft is NULL when there is no work-in-progress. The roster ║
-- ║ itself (class, dynasty rank, notes) is NOT stored here -- it ships as a     ║
-- ║ bundled JSON (src/data/role-context-2026-27.json); only the tier decisions ║
-- ║ live in the DB.                                                            ║
-- ║                                                                            ║
-- ║ Access: admin-only, same allowlist as the rookie board (rb_admins). All    ║
-- ║ reads/writes go through the service-role client server-side, so RLS is     ║
-- ║ enabled with NO public policies -- anon/authenticated clients get nothing. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.role_context_docs (
  season      text primary key,
  published   jsonb not null default '{}'::jsonb,
  draft       jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.role_context_docs enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing) touches
-- this table, and the app gates writes on rb_admins before it ever calls in. Adding an
-- anon/authenticated policy would expose the owner's unpublished projection inputs.

comment on table public.role_context_docs is
  'Per-season role-context tier overrides for the projection model. published/draft are '
  '"TEAM||Player"->tier maps. Service-role access only; admin-gated via rb_admins.';
