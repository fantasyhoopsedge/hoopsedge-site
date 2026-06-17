/**
 * Draft Night Challenge — participation stats (read-only).
 *
 * Reports "users and picks to date" for the MVP: profile count, how many users
 * have made at least one pick, total pick rows, per-mini-game breakdown, and a
 * completion funnel (a full entry is 4 mini-games). Read-only — it never writes.
 *
 *   npx tsx scripts/draft-night-stats.ts            # stats for draft-night-2026
 *   npx tsx scripts/draft-night-stats.ts <gameSlug> # stats for another game
 *
 * Uses the service role so it sees every user's predictions (RLS would otherwise
 * scope dn_predictions to the caller). Needs NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY in the environment — see scripts/DRAFT_NIGHT_APPLY.md.
 */
import { createAdminClient } from "../src/utils/supabase/admin";
import { GAME_SLUG } from "../src/lib/draftNight/config";
import type { DnMiniGameKey } from "../src/types/database";

// Friction-ascending display order (matches scripts/seed-draft-night.ts).
const MINI_GAME_ORDER: DnMiniGameKey[] = [
  "drafted_higher",
  "first_round",
  "guard_order",
  "mock_lottery",
];
const FULL_ENTRY_MINIS = MINI_GAME_ORDER.length;

async function main() {
  const slug = process.argv[2] ?? GAME_SLUG;
  const admin = createAdminClient();

  const { data: game, error: gameErr } = await admin
    .from("dn_games")
    .select("id, title, status, lock_at, resolved_at")
    .eq("slug", slug)
    .single();
  if (gameErr || !game) throw gameErr ?? new Error(`game not found: ${slug}`);

  const { data: minis, error: miniErr } = await admin
    .from("dn_mini_games")
    .select("id, key")
    .eq("game_id", game.id);
  if (miniErr || !minis) throw miniErr ?? new Error("no mini games for game");

  const keyByMiniId = new Map(minis.map((m) => [m.id, m.key as DnMiniGameKey]));

  // Total registered profiles (site-wide; not all will have a pick).
  const { count: profileCount, error: profErr } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (profErr) throw profErr;

  // Every prediction row for this game's mini-games.
  const { data: preds, error: predErr } = await admin
    .from("dn_predictions")
    .select("user_id, mini_game_id, locked, score, submitted_at")
    .in("mini_game_id", minis.map((m) => m.id));
  if (predErr) throw predErr;
  const rows = preds ?? [];

  // Aggregate in TS (MVP volume; supabase-js has no GROUP BY).
  const minisByUser = new Map<string, number>();
  const perMini = new Map<DnMiniGameKey, { picks: number; users: Set<string> }>();
  for (const key of MINI_GAME_ORDER) perMini.set(key, { picks: 0, users: new Set() });

  let lockedRows = 0;
  let gradedRows = 0;
  let latest: string | null = null;
  for (const r of rows) {
    minisByUser.set(r.user_id, (minisByUser.get(r.user_id) ?? 0) + 1);
    const key = keyByMiniId.get(r.mini_game_id);
    if (key) {
      const bucket = perMini.get(key)!;
      bucket.picks += 1;
      bucket.users.add(r.user_id);
    }
    if (r.locked) lockedRows += 1;
    if (r.score !== null) gradedRows += 1;
    if (!latest || r.submitted_at > latest) latest = r.submitted_at;
  }

  const usersWithAnyPick = minisByUser.size;
  const fullEntries = [...minisByUser.values()].filter((n) => n >= FULL_ENTRY_MINIS).length;

  // Completion funnel: how many users completed exactly N mini-games.
  const funnel = new Map<number, number>();
  for (const n of minisByUser.values()) funnel.set(n, (funnel.get(n) ?? 0) + 1);

  const lines: string[] = [];
  lines.push(`Draft Night stats — ${game.title} (${slug})`);
  lines.push(
    `  status=${game.status}  lock_at=${game.lock_at}` +
      (game.resolved_at ? `  resolved_at=${game.resolved_at}` : ""),
  );
  lines.push("");
  lines.push(`  Registered profiles (site-wide): ${profileCount ?? 0}`);
  lines.push(`  Users with >=1 pick:             ${usersWithAnyPick}`);
  lines.push(`  Users with a full entry (4/4):   ${fullEntries}`);
  lines.push(`  Total pick rows:                 ${rows.length}`);
  lines.push(`  Locked pick rows:                ${lockedRows}`);
  lines.push(`  Graded pick rows (score set):    ${gradedRows}`);
  lines.push(`  Most recent submission:          ${latest ?? "—"}`);
  lines.push("");
  lines.push("  Picks by mini-game:");
  for (const key of MINI_GAME_ORDER) {
    const b = perMini.get(key)!;
    lines.push(`    ${key.padEnd(16)} ${String(b.picks).padStart(4)} picks  ${b.users.size} users`);
  }
  lines.push("");
  lines.push("  Completion funnel (mini-games done → users):");
  for (let n = FULL_ENTRY_MINIS; n >= 1; n--) {
    if (funnel.has(n)) lines.push(`    ${n}/${FULL_ENTRY_MINIS}  ${funnel.get(n)} users`);
  }

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
