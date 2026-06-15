-- ============================================================================
-- FHE Draft Night Challenge — Called It cards (§2.6)
--
-- Adds `called_it` to dn_predictions so the service-role grader can flag
-- perfect games. Recreates dn_leaderboard to bake the multi-card bonus into
-- the ranked score:
--   0–1 cards → +0  |  2 cards → +50  |  3 cards → +100  |  4 cards → +150
-- ============================================================================

alter table public.dn_predictions
  add column if not exists called_it boolean not null default false;

-- ── Leaderboard view (replaces 20260614010000 version) ───────────────────────
create or replace view public.dn_leaderboard as
with
ci_counts as (
  select
    mg.game_id,
    p.user_id,
    count(*) filter (where p.called_it and p.score is not null)::int as cards
  from public.dn_predictions p
  join public.dn_mini_games mg on mg.id = p.mini_game_id
  group by mg.game_id, p.user_id
),
base_totals as (
  select
    mg.game_id,
    p.user_id,
    coalesce(sum(p.score), 0) as base_score
  from public.dn_predictions p
  join public.dn_mini_games mg on mg.id = p.mini_game_id
  where p.score is not null
  group by mg.game_id, p.user_id
),
totals as (
  select
    bt.game_id,
    bt.user_id,
    greatest(0,
      bt.base_score + case coalesce(ci.cards, 0)
        when 2 then 50
        when 3 then 100
        when 4 then 150
        else 0
      end
    )::int                       as score,
    coalesce(ci.cards, 0)::int   as called_it_cards
  from base_totals bt
  left join ci_counts ci on ci.game_id = bt.game_id and ci.user_id = bt.user_id
)
select
  t.game_id,
  t.user_id,
  pr.username,
  pr.avatar_url,
  t.score,
  t.called_it_cards,
  rank()         over (partition by t.game_id order by t.score desc) as rank,
  percent_rank() over (partition by t.game_id order by t.score)      as percentile
from totals t
join public.profiles pr on pr.id = t.user_id;

grant select on public.dn_leaderboard to anon, authenticated;
