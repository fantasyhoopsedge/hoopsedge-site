/**
 * Seed Supabase with the current rookie board so production reads from the DB.
 *
 * Run ONCE after applying supabase/migrations/20260620000000_rookie_board.sql:
 *
 *   npx tsx scripts/seed-rookie-board-supabase.ts                       # board + versions
 *   npx tsx scripts/seed-rookie-board-supabase.ts --admin you@email.com # also add an admin
 *
 * Idempotent: upserts the live doc + versions; safe to re-run.
 * Reads creds from .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */
import { promises as fs } from "fs";
import path from "path";
import { loadEnv, getServiceClient } from "./nba-data/client";

const ROOT = process.cwd();
const LIVE = path.join(ROOT, "src", "data", "rookie-board.json");
const VERSIONS_DIR = path.join(ROOT, "public", "data", "rookie-board-versions");
const INDEX = path.join(VERSIONS_DIR, "index.json");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] ?? null : null;
}

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, "utf8")) as T; } catch { return null; }
}

async function main() {
  loadEnv();
  const sb = getServiceClient();

  const live = await readJson<{ version: string; label?: string; players: unknown[] }>(LIVE);
  if (!live) throw new Error(`Could not read ${LIVE}`);

  // 1. live board doc
  const { error: docErr } = await sb
    .from("rb_docs")
    .upsert({ slug: "live", data: live, updated_at: new Date().toISOString() });
  if (docErr) throw new Error(`rb_docs upsert failed: ${docErr.message}`);
  console.log(`✓ live board → v${live.version} (${live.players.length} players)`);

  // 2. version archive (from the local versions dir, if present)
  const index = await readJson<{ versions: { version: string; label: string; savedAt: string; players: number; note?: string }[] }>(INDEX);
  let seeded = 0;
  for (const v of index?.versions ?? []) {
    const data = await readJson(path.join(VERSIONS_DIR, `v${v.version}.json`));
    if (!data) continue;
    const { error } = await sb.from("rb_versions").upsert({
      version: v.version, label: v.label, saved_at: v.savedAt,
      players: v.players, note: v.note ?? null, data,
    });
    if (error) { console.warn(`  ! version ${v.version}: ${error.message}`); continue; }
    seeded++;
  }
  console.log(`✓ ${seeded} version(s) archived`);

  // 3. optional admin
  const admin = arg("admin");
  if (admin) {
    const { error } = await sb.from("rb_admins").upsert({ email: admin.toLowerCase(), note: "seeded" });
    if (error) throw new Error(`rb_admins upsert failed: ${error.message}`);
    console.log(`✓ admin added: ${admin}`);
  }

  console.log("\nDone. The public board now reads from Supabase; the editor is live for admins.");
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
