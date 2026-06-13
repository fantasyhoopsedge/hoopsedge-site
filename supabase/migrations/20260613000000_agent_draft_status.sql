-- ============================================================================
-- FHE PREDICTION ARENA — Agent draft status
-- Run after 20260612000000_prediction_arena.sql.
--
-- The autonomous agent worker (src/app/api/agent/generate-pitch) inserts new
-- prediction games as `status = 'draft'` so they stay invisible to players
-- until a human analyst approves them in /admin/predictions. The original
-- migration's CHECK constraint only allowed active/locked/resolved, so we
-- widen it to include 'draft'.
--
-- Safe to re-run: drops the old constraint by its auto-generated name first.
-- ============================================================================

alter table public.prediction_games
  drop constraint if exists prediction_games_status_check;

alter table public.prediction_games
  add constraint prediction_games_status_check
  check (status in ('draft', 'active', 'locked', 'resolved'));

comment on column public.prediction_games.status is
  'draft = agent-proposed, awaiting analyst approval (hidden from players); '
  'active = live and predictable; locked = past deadline; resolved = scored. '
  'Drafts are never predictable: user_predictions inserts require status = ''active''.';
