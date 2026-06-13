-- ============================================================================
-- FHE PREDICTION ARENA — Security hardening (column-level write grants)
-- Run after 20260612000000_prediction_arena.sql, in the live SQL editor too.
--
-- WHY THIS EXISTS — the deployed schema's RLS controls which ROWS a user can
-- touch, but NOT which COLUMNS. Without the grants below, two holes are open:
--
--   1. "Users can edit their own profile" (UPDATE, no column restriction) lets
--      a signed-in user set their OWN  analyst_badge = true  and
--      edge_points = anything — i.e. self-promote to analyst (which is the
--      admin gate for /admin/predictions) and self-award points.
--   2. The user_predictions INSERT policy doesn't restrict columns, so a user
--      can insert a prediction with points_awarded / is_correct pre-filled and
--      award themselves points.
--
-- These grants make the privileged columns server-managed (service_role only),
-- which is what the app already assumes. Idempotent — safe to re-run.
-- ============================================================================

-- Clean up a redundant CHECK constraint accidentally added during the
-- column-rename reconcile (the game_status enum already enforces the values).
alter table public.prediction_games
  drop constraint if exists prediction_games_status_check;

-- profiles: clients may only write username / avatar_url. edge_points and
-- analyst_badge become server-managed (service_role bypasses these grants).
revoke insert, update on public.profiles from anon, authenticated;
grant  insert (id, username, avatar_url) on public.profiles to authenticated;
grant  update (username, avatar_url)     on public.profiles to authenticated;

-- user_predictions: clients may only supply the prediction itself. is_correct /
-- points_awarded / submitted_at are server-managed.
revoke insert, update on public.user_predictions from anon, authenticated;
grant  insert (user_id, game_id, prediction_selection)
  on public.user_predictions to authenticated;

-- prediction_games: defense in depth — clients never write games (there are no
-- write policies anyway; only service_role inserts drafts / flips to active).
revoke insert, update, delete on public.prediction_games from anon, authenticated;
