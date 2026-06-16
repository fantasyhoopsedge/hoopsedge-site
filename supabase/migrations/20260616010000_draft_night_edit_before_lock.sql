-- ============================================================================
-- FHE Draft Night Challenge — allow editing picks before lock
--
-- The original draft_night migration (20260614010000) shipped dn_predictions
-- with INSERT + SELECT policies only — predictions were immutable once written.
-- The launch UI changed to "come back and change your picks until lock" and
-- saves via upsert, so a second submit becomes INSERT ... ON CONFLICT DO UPDATE,
-- which RLS rejected (no UPDATE policy) — surfacing a false "picks are locked"
-- error to anyone revising a pick while the game is still live.
--
-- This adds the missing UPDATE policy, mirroring the insert gate so the
-- server-side auto-lock at lock_at still holds for edits: the owner may update
-- their own row only while the game is 'live' and now() < lock_at.
-- ============================================================================

drop policy if exists "dn_predictions update before lock" on public.dn_predictions;
create policy "dn_predictions update before lock" on public.dn_predictions
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.dn_mini_games mg
      join public.dn_games g on g.id = mg.game_id
      where mg.id = mini_game_id
        and g.status = 'live'
        and now() < g.lock_at
    )
  );
