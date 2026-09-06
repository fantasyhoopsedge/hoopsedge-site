/**
 * Grant the founding-price discount to every EXISTING Fantasy Hoops Edge
 * account, so people who signed up before The Deep Edge existed don't have to
 * come back and fill in a form to be eligible.
 *
 *   npm run deepedge:backfill              # report only (default — writes nothing)
 *   npm run deepedge:backfill -- --apply   # insert the rows
 *
 * Safe to re-run. Rows are inserted with ignoreDuplicates, so an address
 * already on the list — whether it registered through the Launching soon
 * screen or a previous run of this script — keeps its ORIGINAL row and its
 * original promised discount. Nothing here ever updates or deletes.
 *
 * ── Where the emails come from ──────────────────────────────────────────────
 * public.profiles has no email column (see src/types/database.ts) — the
 * address lives in auth.users, which is only reachable through the Admin API
 * with the service-role key. So this reads auth.admin.listUsers() rather than
 * joining profiles, and that is also why it can attribute every row to a real
 * user_id: unlike a typed-in address, an account id can be matched at checkout
 * even if the person later pays under a different email.
 *
 * ── source = 'existing-account' ─────────────────────────────────────────────
 * Tagged distinctly from the form's 'launching-soon' on purpose. These people
 * were opted IN by us rather than opting in themselves, so any launch email
 * has to treat them as a separate audience — they never asked to be on a
 * waiting list, and lumping them in with people who did is how a launch
 * announcement turns into a spam complaint.
 */
import { getServiceClient, loadEnv } from "./nba-data/client";
import { FOUNDING_DISCOUNT_PCT } from "../src/lib/deep-edge/offer";

loadEnv();

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");

/** Supabase's Admin API caps a page at 1000; this is its maximum. */
const PAGE_SIZE = 1000;

interface AuthUserLite {
  id: string;
  email: string | null;
}

async function listAllUsers(): Promise<AuthUserLite[]> {
  const supabase = getServiceClient();
  const out: AuthUserLite[] = [];

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`auth.admin.listUsers failed: ${error.message}`);

    const batch = data?.users ?? [];
    for (const u of batch) out.push({ id: u.id, email: u.email ?? null });

    if (batch.length < PAGE_SIZE) break;
  }

  return out;
}

async function main() {
  const supabase = getServiceClient();

  const { error: probeError } = await supabase.from("deep_edge_waitlist").select("email").limit(1);
  if (probeError) {
    throw new Error(
      `Cannot read deep_edge_waitlist (${probeError.message}).\n` +
        "Apply supabase/migrations/20260906000000_deep_edge_waitlist.sql first.",
    );
  }

  const users = await listAllUsers();
  const withEmail = users.filter((u): u is AuthUserLite & { email: string } => Boolean(u.email));

  // One row per address. Two accounts can't share an email in Supabase auth,
  // but normalizing before de-duping keeps this honest if that ever changes.
  const byEmail = new Map<string, AuthUserLite & { email: string }>();
  for (const u of withEmail) {
    const key = u.email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, u);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("deep_edge_waitlist")
    .select("email");
  if (existingError) throw new Error(existingError.message);
  const alreadyListed = new Set((existingRows ?? []).map((r) => String(r.email).toLowerCase()));

  const toInsert = [...byEmail.entries()]
    .filter(([email]) => !alreadyListed.has(email))
    .map(([email, u]) => ({
      email,
      user_id: u.id,
      discount_pct: FOUNDING_DISCOUNT_PCT,
      source: "existing-account",
    }));

  console.log(`accounts                 ${users.length}`);
  console.log(`  with an email address  ${withEmail.length}`);
  console.log(`  distinct addresses     ${byEmail.size}`);
  console.log(`already on the waitlist  ${alreadyListed.size}`);
  console.log(`would insert             ${toInsert.length} @ ${FOUNDING_DISCOUNT_PCT}% off`);

  if (users.length !== withEmail.length) {
    console.log(
      `\nNote: ${users.length - withEmail.length} account(s) have no email address ` +
        "(OAuth identities can omit it) and are skipped — there is nothing to attach a discount to.",
    );
  }

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to insert.");
    return;
  }

  if (toInsert.length === 0) {
    console.log("\nNothing to insert.");
    return;
  }

  // Chunked so one oversized request can't fail the whole run, and so a
  // partial failure leaves the earlier chunks committed rather than rolling
  // back work that was already correct. Re-running picks up the remainder.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("deep_edge_waitlist")
      .upsert(chunk, { onConflict: "email", ignoreDuplicates: true });
    if (error) throw new Error(`insert failed at row ${i}: ${error.message}`);
    inserted += chunk.length;
    console.log(`  inserted ${inserted}/${toInsert.length}`);
  }

  console.log(`\nDone. ${inserted} existing account(s) are now eligible for ${FOUNDING_DISCOUNT_PCT}% off.`);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  // exitCode rather than process.exit(): the latter tears the process down
  // while the Supabase client still holds open handles, which trips a libuv
  // assertion on Windows and buries the error message above it.
  process.exitCode = 1;
});
