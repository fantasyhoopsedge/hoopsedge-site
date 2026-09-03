-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Custom league asset valuations (src/lib/fantrax/custom-valuations-store.ts)║
-- ║                                                                            ║
-- ║ One cached ranked ledger per (owner, league) — free agents pulled in       ║
-- ║ alongside rostered players, 2026 rookie picks mapped to real dynasty       ║
-- ║ consensus rank, house contract-label rules applied, future picks decayed   ║
-- ║ from that corrected baseline. Computed on demand ("Regenerate") by         ║
-- ║ src/lib/fantrax/custom-valuations.ts's computeCustomLedger() — this table  ║
-- ║ only ever stores the LATEST snapshot, no version history (unlike           ║
-- ║ rb_docs/rb_versions — nothing here is collaboratively edited, so there's   ║
-- ║ nothing to reconcile between versions of).                                 ║
-- ║                                                                            ║
-- ║ Same (owner, league_id) keying and service-role-only access convention as  ║
-- ║ fx_leagues (20260803010000_fantrax_leagues.sql) — mirrored deliberately,   ║
-- ║ not reinvented.                                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.fx_custom_valuations (
  owner        text        not null,
  league_id    text        not null,
  data         jsonb       not null,
  generated_at timestamptz not null default now(),
  primary key (owner, league_id)
);

create index if not exists fx_custom_valuations_owner_idx on public.fx_custom_valuations (owner, generated_at desc);

alter table public.fx_custom_valuations enable row level security;

-- No policies on purpose, same reasoning as fx_leagues: only the service
-- role (server-side, RLS-bypassing) touches this table, gated by
-- authorizeFantrax() before the API ever calls in.

comment on table public.fx_custom_valuations is
  'Cached custom asset-valuation ledger for a linked Fantrax league. Keyed by (owner email, league id). '
  'Latest snapshot only, overwritten on every Regenerate. Service-role access only.';
