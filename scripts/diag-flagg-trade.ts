import { loadEnv } from "./nba-data/client";
loadEnv();
import { createAdminClient } from "../src/utils/supabase/admin";
import { playerIdentity } from "../src/lib/player-identity/bundled";

async function main() {
  const idx = playerIdentity();
  const admin = createAdminClient();
  const names = ["Cooper Flagg", "VJ Edgecombe", "Ajay Mitchell", "Hugo Gonzalez"];
  const ids: Record<string, string> = {};
  for (const n of names) {
    const r = idx.resolve({ name: n });
    if (r.kind === "matched") ids[n] = r.identity.fheId;
    else console.log(n, "UNRESOLVED", r.kind);
  }
  const { data, error } = await admin
    .from("real_salary_values")
    .select("fhe_id,salary,consensus_z,production_z,salary_z,market_value_score,expected_cap_hit,surplus_value,surplus_rank")
    .eq("season", 2027)
    .in("fhe_id", Object.values(ids));
  if (error) throw error;
  for (const [name, fid] of Object.entries(ids)) {
    const row = data?.find((r) => r.fhe_id === fid);
    console.log(name, JSON.stringify(row, null, 1));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
