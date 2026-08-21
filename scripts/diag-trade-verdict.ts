/**
 * Direct sanity check for trade-verdict.ts: does the new adjustment correctly
 * flip the Cooper Flagg case (the backtest's worst miss)?
 *
 * Not a permanent build script — run once via `npx tsx scripts/diag-trade-verdict.ts`.
 */
import { loadEnv } from "./nba-data/client";
loadEnv();
import { createAdminClient } from "../src/utils/supabase/admin";
import { playerIdentity } from "../src/lib/player-identity/bundled";
import { computeTradeVerdict } from "../src/lib/fantrax/trade-verdict";
import type { ResolvedPlayer } from "../src/lib/fantrax/analyze";

async function main() {
  const idx = playerIdentity();
  const admin = createAdminClient();

  const names = ["Cooper Flagg", "VJ Edgecombe", "Ajay Mitchell", "Hugo Gonzalez"];
  const espnIdByName = new Map<string, string>();
  for (const n of names) {
    const r = idx.resolve({ name: n });
    if (r.kind === "matched" && r.identity.espnId) espnIdByName.set(n, r.identity.espnId);
    else console.log(n, "UNRESOLVED", r.kind);
  }

  const { data: svRows, error: svErr } = await admin
    .from("season_player_values")
    .select("player_id,minus1v")
    .eq("season", 2027)
    .eq("season_type", "projection")
    .eq("league_size", 450)
    .in("player_id", [...espnIdByName.values()]);
  if (svErr) throw svErr;

  // Build minimal fake ResolvedPlayer stand-ins carrying just enough for
  // valueOf("minus1V", ...) + catVRank to work.
  const byFhe = new Map((svRows ?? []).map((r) => [r.player_id as string, r]));
  const sorted = [...byFhe.entries()].sort((a, b) => (b[1].minus1v ?? -Infinity) - (a[1].minus1v ?? -Infinity));
  const rankByFhe = new Map(sorted.map(([fhe], i) => [fhe, i + 1]));

  function fakePlayer(name: string): ResolvedPlayer {
    const fhe = espnIdByName.get(name)!;
    const row = byFhe.get(fhe)!;
    return {
      fantraxId: name,
      name,
      slot: "Bench",
      eligible: [],
      nbaTeam: "",
      status: "",
      salary: null,
      contract: null,
      playerId: null,
      fheId: fhe,
      source: "projection",
      cats: {},
      catsTotals: {},
      leagueV: null,
      pointsValue: null,
      nineCatV: null,
      consensusRank: null,
      gamesPlayed: null,
      minutesPerGame: null,
      usgPct: null,
      statLine: null,
      catV: { perGame: { nineCatV: null, minus1V: row.minus1v, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      catVRank: { perGame: { nineCatV: null, minus1V: rankByFhe.get(fhe) ?? null, eightCatV: null }, totals: { nineCatV: null, minus1V: null, eightCatV: null } },
      trendTags: null,
      ambiguousName: false,
      smallSample: false,
      isRookie: false,
    } as unknown as ResolvedPlayer;
  }

  const flagg = fakePlayer("Cooper Flagg");
  const vj = fakePlayer("VJ Edgecombe");
  const ajay = fakePlayer("Ajay Mitchell");
  const hugo = fakePlayer("Hugo Gonzalez");
  const pool = [flagg, vj, ajay, hugo];

  const verdict = computeTradeVerdict(
    [{ label: "VJ Edgecombe", player: vj }, { label: "Ajay Mitchell", player: ajay }, { label: "Hugo Gonzalez", player: hugo }],
    [{ label: "Cooper Flagg", player: flagg }],
    pool,
    "minus1V",
    undefined,
  );

  console.log("Side A (VJ+Ajay+Hugo):", JSON.stringify(verdict.sideA, null, 1));
  console.log("Side B (Flagg alone):", JSON.stringify(verdict.sideB, null, 1));
  console.log("Winner:", verdict.winner, "variance:", (verdict.variancePct * 100).toFixed(1) + "%");
  console.log(verdict.winner === "B" ? "PASS: correctly favors Flagg's side" : "FAIL: does not favor Flagg's side");
}

main().catch((e) => { console.error(e); process.exit(1); });
