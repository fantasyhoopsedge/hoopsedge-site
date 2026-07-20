-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Depth-chart tier store (standalone tool, NOT a projection model input)     ║
-- ║                                                                            ║
-- ║ Backs the /admin/depth-chart editor in production. Unlike role_context_docs║
-- ║ (which IS read by the season projection model), this table is deliberately║
-- ║ NOT wired into project.py -- it exists so the owner can hand-classify each ║
-- ║ roster spot as starter/rotation/reserve/fringe and view that against      ║
-- ║ contract status and Stage 5's projected minutes, independent of the model.║
-- ║                                                                            ║
-- ║ One row per season. `published` and `draft` are tier-override maps keyed  ║
-- ║ "TEAM||Player" -> tier value (starter|rotation|reserve|fringe). draft is   ║
-- ║ NULL when there is no work-in-progress. The roster reference (position,   ║
-- ║ projected minutes, contract/salary status) is NOT stored here -- it ships ║
-- ║ as a bundled JSON (src/data/depth-chart-2026-27.json) built by            ║
-- ║ models/minutes-allocator/prep_depth_chart.py; only the tier decisions     ║
-- ║ live in the DB.                                                           ║
-- ║                                                                            ║
-- ║ Access: admin-only, same allowlist as the rookie board (rb_admins). All   ║
-- ║ reads/writes go through the service-role client server-side, so RLS is    ║
-- ║ enabled with NO public policies -- anon/authenticated clients get nothing.║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.depth_chart_docs (
  season      text primary key,
  published   jsonb not null default '{}'::jsonb,
  draft       jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.depth_chart_docs enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing) touches
-- this table, and the app gates writes on rb_admins before it ever calls in.

comment on table public.depth_chart_docs is
  'Per-season depth-chart tier assignments (starter/rotation/reserve/fringe), a '
  'standalone planning tool -- NOT read by the projection model. published/draft are '
  '"TEAM||Player"->tier maps. Service-role access only; admin-gated via rb_admins.';
