-- ============================================================================
-- FHE Draft Night — per-mini-game leaderboard view (post-resolution scoring)
--
-- Exposes each user's score, rank, total player count, and tied_at_rank
-- for every mini-game so the results UI can show:
--   "You ranked Eq3rd / 6 players" (tied_at_rank > 1 → prefix with "Eq")
--
-- Runs with view-owner rights (no SECURITY INVOKER), bypassing the
-- dn_predictions SELECT RLS (which limits users to their own rows).
-- This is intentional — it's a public leaderboard, same pattern as
-- dn_leaderboard. No individual payload data is exposed.
-- ============================================================================

create or replace view public.dn_mini_leaderboard as
with ranked as (
  select
    p.mini_game_id,
    mg.key                                          as mini_game_key,
    mg.game_id,
    p.user_id,
    coalesce(p.score, 0)::int                       as score,
    rank()   over (partition by p.mini_game_id order by p.score desc) as rank,
    count(*) over (partition by p.mini_game_id)                        as total_players
  from public.dn_predictions p
  join public.dn_mini_games mg on mg.id = p.mini_game_id
  where p.score is not null
)
select
  r.mini_game_id,
  r.mini_game_key,
  r.game_id,
  r.user_id,
  r.score,
  r.rank,
  r.total_players,
  count(*) over (partition by r.mini_game_id, r.rank)::int as tied_at_rank
from ranked r;

grant select on public.dn_mini_leaderboard to anon, authenticated;
