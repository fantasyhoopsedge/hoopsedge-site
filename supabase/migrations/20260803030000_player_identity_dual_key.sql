-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Phase 2 — dual-key: fhe_id alongside every existing player key             ║
-- ║                                                                            ║
-- ║ Adds a nullable fhe_id column beside each table's current key. Every        ║
-- ║ existing key stays exactly as it is and every existing query keeps working: ║
-- ║ this is purely additive, and NOTHING reads the new column yet.             ║
-- ║                                                                            ║
-- ║ Cleared by `npm run identity:reconcile`, which compared an fhe_id join      ║
-- ║ against each table's current join across 9,211 rows and six sources and     ║
-- ║ found ZERO disagreements — no row resolves to a different human by identity ║
-- ║ than it does today. It also found (and we fixed) the only two integrity     ║
-- ║ problems in the way: three duplicated nba_contracts rows a season apart,    ║
-- ║ and Dain Dainja duplicated across two NBA.com person ids.                  ║
-- ║                                                                            ║
-- ║ ── Deliberately NOT a foreign key ─────────────────────────────────────────  ║
-- ║ No `references player_identity(fhe_id)` here, and definitely no ON DELETE   ║
-- ║ CASCADE. During Phase 2 the registry is still being reshaped by each        ║
-- ║ `identity:build`, and a bad merge that removed an identity row must never   ║
-- ║ be able to take stat lines, contracts or trends with it. The constraint     ║
-- ║ belongs in Phase 3, once consumers actually read the column and the         ║
-- ║ registry has stopped moving.                                               ║
-- ║                                                                            ║
-- ║ Backfilled by `npm run identity:backfill`. Reversible: drop the columns.   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.season_player_stats add column if not exists fhe_id text;
alter table public.nba_player_trends   add column if not exists fhe_id text;
alter table public.real_salary_values  add column if not exists fhe_id text;
alter table public.nba_roster          add column if not exists fhe_id text;
alter table public.nba_contracts       add column if not exists fhe_id text;

create index if not exists season_player_stats_fhe_id_idx on public.season_player_stats (fhe_id);
create index if not exists nba_player_trends_fhe_id_idx   on public.nba_player_trends (fhe_id);
create index if not exists real_salary_values_fhe_id_idx  on public.real_salary_values (fhe_id);
create index if not exists nba_roster_fhe_id_idx          on public.nba_roster (fhe_id);
create index if not exists nba_contracts_fhe_id_idx       on public.nba_contracts (fhe_id);

comment on column public.season_player_stats.fhe_id is
  'Canonical player identity (player_identity.fhe_id). Phase 2 dual-key: written by '
  'identity:backfill, read by nothing yet. player_id remains the key. Not a FK on purpose '
  '- see supabase/migrations/20260803030000_player_identity_dual_key.sql.';
comment on column public.nba_player_trends.fhe_id is 'Canonical player identity. Phase 2 dual-key; read by nothing yet.';
comment on column public.real_salary_values.fhe_id is 'Canonical player identity. Phase 2 dual-key; read by nothing yet.';
comment on column public.nba_roster.fhe_id is 'Canonical player identity. Phase 2 dual-key; read by nothing yet.';
comment on column public.nba_contracts.fhe_id is 'Canonical player identity. Phase 2 dual-key; read by nothing yet.';
