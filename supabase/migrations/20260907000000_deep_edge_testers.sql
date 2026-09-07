-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ The Deep Edge tester allowlist (src/lib/deep-edge/testers.ts)              ║
-- ║                                                                           ║
-- ║ A SECOND, DELIBERATELY NARROWER allowlist than rb_admins.                 ║
-- ║                                                                           ║
-- ║ Deep Edge originally gated on rb_admins because Ash was its only user     ║
-- ║ (src/app/deep-edge/layout.tsx). That stops being safe the moment a real   ║
-- ║ tester cohort exists: rb_admins is ONE shared list that also gates        ║
-- ║ /admin/dynasty-board and /admin/rookie-board — i.e. publish rights over   ║
-- ║ the LIVE PUBLIC rankings — plus depth-chart, role-context, team-category, ║
-- ║ player-identity and /admin/fantrax. Adding a pre-launch tester there to   ║
-- ║ hand them one product would also hand them the publish button on the      ║
-- ║ public dynasty board.                                                     ║
-- ║                                                                           ║
-- ║ So: this table grants Deep Edge and NOTHING else. Only the three Deep     ║
-- ║ Edge gates consult it (deep-edge/layout.tsx, lib/deep-edge/guard.ts,      ║
-- ║ lib/fantrax/guard.ts, all via lib/deep-edge/admin-cache.ts). Every        ║
-- ║ /admin/* surface still requires rb_admins and is unaffected by any row    ║
-- ║ added here. Do not widen this table's reach — if a tester needs an admin  ║
-- ║ tool, that is an rb_admins decision, made separately and on purpose.      ║
-- ║                                                                           ║
-- ║ Revocation is a DELETE. It takes effect within 300s — the allowlist       ║
-- ║ check is wrapped in unstable_cache(revalidate: 300) — not instantly.      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.de_testers (
  email    text primary key,
  note     text,
  added_at timestamptz not null default now()
);

alter table public.de_testers enable row level security;

-- No policies, and no grants to anon/authenticated: only the service role
-- (server-side, RLS-bypassing) reads this, same convention as rb_admins,
-- fx_leagues and deep_edge_waitlist. Note there is deliberately no
-- is_de_tester() SQL counterpart to rb_admins' is_rb_admin(): that function
-- exists so the BROWSER can toggle admin nav links, whereas nothing in the
-- UI branches on tester status — the gate is server-side only. An anon read
-- here returns zero rows SILENTLY rather than erroring, so never reach for
-- the browser client.

comment on table public.de_testers is
  'Pre-launch tester allowlist for The Deep Edge. Grants access to /deep-edge and the Fantrax '
  'connector ONLY — it confers no admin rights of any kind; /admin/* still requires rb_admins. '
  'Service-role access only. Remove a row to revoke (takes up to 300s to expire from cache).';

-- ── Seed testers ────────────────────────────────────────────────────────────
-- Left commented on purpose, following rb_admins' precedent: these rows are
-- real people's personal email addresses and do not belong in version
-- control. Add them from the Supabase SQL editor / Table Editor instead.
--
-- insert into public.de_testers (email, note) values
--   ('someone@example.com', 'beta tester — cohort 1')
-- on conflict (email) do nothing;
