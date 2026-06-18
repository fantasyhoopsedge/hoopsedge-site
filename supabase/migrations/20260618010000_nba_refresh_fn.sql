-- ============================================================================
-- FHE NBA DATA PIPELINE — season-averages refresh function
--
-- PostgREST/supabase-js can't issue REFRESH MATERIALIZED VIEW (it's DDL), so
-- the ingest scripts call this function via rpc('refresh_nba_season_averages').
--
-- It tries a CONCURRENT refresh (non-blocking for readers, enabled by the
-- unique index idx_sa) and falls back to a plain refresh on the very first run,
-- when the matview has never been populated and CONCURRENTLY is not allowed.
--
-- SECURITY DEFINER + locked search_path so it runs with owner rights; execute
-- is granted ONLY to service_role (the anon/authenticated keys can't call it).
-- Idempotent.
-- ============================================================================

create or replace function public.refresh_nba_season_averages()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.nba_season_averages;
exception
  when others then
    -- first refresh (matview not yet populated) can't be concurrent
    refresh materialized view public.nba_season_averages;
end;
$$;

revoke all on function public.refresh_nba_season_averages() from public, anon, authenticated;
grant execute on function public.refresh_nba_season_averages() to service_role;
