-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Team-category store (a Stage 1 projection input, unlike depth_chart_docs) ║
-- ║                                                                            ║
-- ║ Backs the team-category selector in the /admin/depth-chart tool. Unlike   ║
-- ║ the per-player tier/injury tags in depth_chart_docs (standalone, not read  ║
-- ║ by the model), THIS one IS read by project.py -- it is how a team gets    ║
-- ║ classified contending/playoff_bubble/bottom3_risk/safe_middle, which      ║
-- ║ selects which row of the (category x role) typical-games table            ║
-- ║ (team_category_baseline.py) an acute-dip player's availability gets       ║
-- ║ pulled toward. An "unset" team falls back to the plain MPG-bucket         ║
-- ║ baseline -- see project.py's apply_depth_chart_corrections().             ║
-- ║                                                                            ║
-- ║ One row per season. `published`/`draft` are "TEAM"->category maps (NOT    ║
-- ║ "TEAM||Player" -- this is a per-team assignment, not per-roster-spot).    ║
-- ║ draft is NULL when there is no work-in-progress. The team list/notes ship ║
-- ║ as a bundled JSON (src/data/team-category-2026-27.json) built by          ║
-- ║ models/projections-adjuster/team_category_baseline.py; only the category  ║
-- ║ decisions live in the DB.                                                 ║
-- ║                                                                            ║
-- ║ Access: admin-only, same allowlist as the rookie board (rb_admins). All   ║
-- ║ reads/writes go through the service-role client server-side, so RLS is    ║
-- ║ enabled with NO public policies -- anon/authenticated clients get nothing.║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.team_category_docs (
  season      text primary key,
  published   jsonb not null default '{}'::jsonb,
  draft       jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.team_category_docs enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing) touches
-- this table, and the app gates writes on rb_admins before it ever calls in.

comment on table public.team_category_docs is
  'Per-season team-category tags (contending/playoff_bubble/bottom3_risk/safe_middle), '
  'a REAL Stage 1 projection input read by project.py. published/draft are '
  '"TEAM"->category maps. Service-role access only; admin-gated via rb_admins.';
