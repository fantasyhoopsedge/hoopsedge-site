# Draft Night Challenge — apply & operate

The dedicated Draft Night MVP schema is **separate** from the Prediction Arena.
Nothing here touches `edge_points`, analyst badges, or the agent review queue.

All `npx tsx` commands need these in the environment (e.g. `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (only for `--execute` / resolution — never expose with `NEXT_PUBLIC_`)

---

## 1. Create the schema

Apply the migration to Supabase (SQL editor or `supabase db push`):

```
supabase/migrations/20260614010000_draft_night.sql
```

It creates `dn_games`, `dn_mini_games`, `dn_predictions`, `dn_results`, the
`dn_leaderboard` view, enums, indexes, and RLS. It reuses `public.profiles`
(already created by the prediction-arena migration).

## 2. Seed the game + 4 mini-games

The `mock_lottery` pool (49 slugs = top 50 minus Suigo) is built from the master
CSV so it can't drift. **Don't hand-enter it.**

**Option A — paste generated SQL** (you're already in the SQL editor):

```bash
npx tsx scripts/seed-draft-night.ts > draft-night-seed.sql
# paste draft-night-seed.sql into the Supabase SQL editor and run
```

**Option B — write directly via the service role:**

```bash
npx tsx scripts/seed-draft-night.ts --execute
```

Both are idempotent (upsert on `slug` / `(game_id, key)`), so re-running is safe.
The game is seeded with `status = 'live'` and `lock_at = 2026-06-24T00:00:00Z`
(8 PM ET, Jun 23). Picks auto-stop accepting at `lock_at` via RLS.

## 3. Draft night — enter results & resolve

1. As picks come in, fill the **`dn_results`** row for the game:
   - `game_id` = the `dn_games.id`
   - `picks` = `{ "<slug>": <actual_pick_int> }` for every pool prospect **plus
     the 4 bubble names**, covering **picks 1–60** (so round-2 slips grade
     correctly). Any pool slug absent from the map is treated as undrafted.
   - Slugs are the `src/lib/prospects.ts` keys, e.g. `cameron-boozer`,
     `darryn-peterson`, `labaron-philon`.
2. Run the grader (this also flips the game to `resolved`):

   ```bash
   npx tsx scripts/resolve-draft-night.ts
   ```

   It grades every prediction with `src/lib/draftNight/grader.ts` and writes
   `dn_predictions.score` back. Results stay hidden in the UI until
   `status = 'resolved'`.

## Verifying the grader

The scoring rules (handoff §2) are covered by a dry-run with hand-computed
expected scores:

```bash
npm run test:grader
```

Run it before draft night. A mis-scored launch permanently poisons trust — this
is the one check that cannot be skipped.
