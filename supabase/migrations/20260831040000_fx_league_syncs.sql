-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Fantrax league sync timestamps (src/lib/fantrax/league-cache.ts)           ║
-- ║                                                                            ║
-- ║ One row per Fantrax league id — NOT per (owner, league) like fx_leagues.   ║
-- ║ Every league-scoped Fantrax endpoint is key-less (api.ts's own header:     ║
-- ║ "leagueId alone is a capability"), so a sync of one league's live data is  ║
-- ║ the same event no matter which FHE user's page triggered it — the shared  ║
-- ║ 60s getCachedLeagueAnalysis() cache already treats it that way. Keying    ║
-- ║ this by league_id alone means one write per REAL Fantrax fetch (a cache   ║
-- ║ hit never re-runs fetchAndAnalyze(), so it never re-writes this row       ║
-- ║ either — the timestamp genuinely means "last time we asked Fantrax", not  ║
-- ║ "last time someone loaded a page").                                      ║
-- ║                                                                            ║
-- ║ Read by Home (deep-edge/home/page.tsx) to show "Synced Xm ago" for the    ║
-- ║ active league — a small, separate lookup rather than folding this into    ║
-- ║ fx_leagues, since that table is an OWNER's saved-connection row and this  ║
-- ║ is a property of the LEAGUE DATA itself, shared across every owner who    ║
-- ║ happens to have the same league saved.                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.fx_league_syncs (
  league_id       text        primary key,
  last_synced_at  timestamptz not null default now()
);

alter table public.fx_league_syncs enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing)
-- touches this table, same convention as fx_leagues/fx_custom_valuations.

comment on table public.fx_league_syncs is
  'Last time we successfully fetched live data from Fantrax for a league (keyed by league id '
  'alone — sync freshness is a property of the shared league data, not any one owner''s saved '
  'connection). Written by league-cache.ts''s fetchAndAnalyze() after a real Fantrax fetch, '
  'never on a cache hit. Service-role access only.';
