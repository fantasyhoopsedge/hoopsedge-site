/**
 * Draft Night launch snapshot — signup → activation funnel.
 *
 * Prints, for the live `draft-night-2026` game:
 *   • total signups (profiles), split real vs. your own test/admin accounts
 *   • auth provider + email-confirmation status per user
 *   • how many users actually submitted picks (any mini-game)
 *   • the signup → played conversion rate
 *
 * Read-only. Uses the service-role key from .env.local (never commit output).
 *
 * Run:  node scripts/launch-snapshot.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── tiny .env.local parser (no dotenv dependency) ───────────────────────────
function loadEnv() {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    throw new Error("Could not read .env.local — run from the repo root.");
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv();
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error("Missing SUPABASE_URL / SERVICE_ROLE_KEY in .env.local");

const GAME_SLUG = process.argv[2] ?? "draft-night-2026";

// Accounts that belong to you / testing — excluded from "real" signup counts.
// Match on email; extend this list as you add test logins.
const TEST_EMAILS = new Set([
  "fantasybballai@gmail.com", // HBB analyst/admin
  "ash.huggy@gmail.com",      // HUGGY test
  "ash.huggins@me.com",       // personal
]);

const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: h });
  if (!r.ok) throw new Error(`REST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  // Auth users (provider + confirmation), keyed by id.
  const au = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: h }).then((r) => r.json());
  const authUsers = au.users ?? au;
  const byId = new Map(authUsers.map((u) => [u.id, u]));

  // The game + everyone who submitted at least one pick for it.
  const [game] = await rest(`dn_games?slug=eq.${GAME_SLUG}&select=id,title,status,lock_at`);
  if (!game) throw new Error(`No dn_games row for slug "${GAME_SLUG}"`);

  const minis = await rest(`dn_mini_games?game_id=eq.${game.id}&select=id`);
  const miniIds = minis.map((m) => m.id);
  const preds = miniIds.length
    ? await rest(`dn_predictions?mini_game_id=in.(${miniIds.join(",")})&select=user_id`)
    : [];
  const playedIds = new Set(preds.map((p) => p.user_id));

  const profiles = await rest("profiles?select=id,username,created_at&order=created_at.asc");

  // ── Report ────────────────────────────────────────────────────────────────
  const now = new Date();
  const lock = new Date(game.lock_at);
  console.log(`\n  ${game.title} — status: ${game.status}`);
  console.log(`  Picks lock: ${lock.toISOString()} (${lock > now ? "OPEN" : "CLOSED"})`);
  console.log(`  Snapshot:   ${now.toISOString()}\n`);

  let real = 0, realPlayed = 0;
  const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  console.log(
    `  ${pad("user", 22)} ${pad("provider", 9)} ${pad("confirmed", 10)} ${pad("played", 7)} kind`,
  );
  console.log("  " + "─".repeat(62));
  for (const p of profiles) {
    const a = byId.get(p.id) ?? {};
    const email = a.email ?? p.username ?? p.id;
    const provider = a.app_metadata?.provider ?? "?";
    const confirmed = a.email_confirmed_at ? "yes" : "NO";
    const played = playedIds.has(p.id);
    const isTest = TEST_EMAILS.has(email);
    if (!isTest) {
      real++;
      if (played) realPlayed++;
    }
    console.log(
      `  ${pad(email, 22)} ${pad(provider, 9)} ${pad(confirmed, 10)} ${pad(played ? "yes" : "—", 7)} ${isTest ? "test" : "REAL"}`,
    );
  }

  const pct = real ? Math.round((realPlayed / real) * 100) : 0;
  console.log("\n  ── Real signups (test/admin excluded) ──");
  console.log(`  Signed up:        ${real}`);
  console.log(`  Submitted picks:  ${realPlayed}`);
  console.log(`  Conversion:       ${pct}%  (signup → played)\n`);
}

main().catch((e) => {
  console.error("snapshot failed:", e.message);
  process.exit(1);
});
