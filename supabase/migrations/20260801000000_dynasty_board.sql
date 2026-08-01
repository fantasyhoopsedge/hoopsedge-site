-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Dynasty Board store (personal ranking workspace, /admin/dynasty-board)     ║
-- ║                                                                            ║
-- ║ Backs the "slide players up/down, save WIP, publish, export CSV" editor    ║
-- ║ that lets the owner build a custom dynasty order starting from the         ║
-- ║ hashtag-basketball consensus (src/lib/dynasty-rankings.json). Same         ║
-- ║ singleton-doc shape as depth_chart_docs: one row, `published`/`draft`      ║
-- ║ jsonb columns holding the full { updatedAt, players[] } payload. `draft`   ║
-- ║ is NULL when there is no work-in-progress.                                ║
-- ║                                                                            ║
-- ║ Unlike the rookie board there is no version archive here — this is a      ║
-- ║ personal tool, not a publicly versioned document. "Publish" just promotes ║
-- ║ the draft to `published` in place; a CSV export is the artifact that      ║
-- ║ leaves the tool.                                                          ║
-- ║                                                                            ║
-- ║ Access: admin-only, reusing the rookie board's allowlist (rb_admins) so   ║
-- ║ there's a single editor list instead of a second one to maintain. All     ║
-- ║ reads/writes go through the service-role client server-side; RLS is       ║
-- ║ enabled with NO public policies.                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.dynasty_board_docs (
  id          text primary key default 'dynasty_board',
  published   jsonb,
  draft       jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.dynasty_board_docs enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing) touches
-- this table, and the app gates writes on rb_admins before it ever calls in.

comment on table public.dynasty_board_docs is
  'Singleton doc for the /admin/dynasty-board custom ranking editor. published/draft are '
  '{ updatedAt, players: DynastyBoardPlayer[] } payloads, seeded from the hashtag consensus '
  '(dynasty-rankings.json) plus contract/role/production enrichment when first created. '
  'Service-role access only; admin-gated via rb_admins.';
