-- ============================================================================
-- FHE PREDICTION ARENA — 'skipped' game status
-- Run after the earlier migrations, in the live SQL editor too.
--
-- Lets an analyst archive an agent-proposed game (instead of deleting it) when
-- they don't want to post it. Skipped games leave the review queue but stay on
-- record. ALTER TYPE ... ADD VALUE must run on its own (not inside a multi-
-- statement transaction that then uses the value) — running this file alone is
-- fine.
-- ============================================================================

alter type public.game_status add value if not exists 'skipped';
