/**
 * One-time repair for depth_chart_docs rows written BEFORE the "bake live MPG into
 * Publish" fix (src/app/admin/depth-chart/_editor.tsx's send()) existed.
 *
 * Before that fix, Save WIP/Publish only wrote players with an EXPLICIT typed
 * override. A teammate's manual override still rippled every other free player's
 * MPG live on screen (the same tilted-proportional allocator as minutes.py, ported
 * to src/lib/allocate-team.ts) but that recalculated number was never captured into
 * the published doc — it silently reverted to the un-redistributed base MPG. Once
 * published, there is no "unsaved change" for the admin to re-save: Publish is
 * disabled with 0 dirty edits, so simply reopening the tool can't self-heal this.
 *
 * This script replays that exact same allocateTeam() pass over each team's CURRENT
 * published overrides and, wherever the recomputed live MPG differs from what's
 * stored, writes it in as an explicit overrideMpg — bringing already-published data
 * in line with what a fresh Save/Publish would produce today. overrideGames is never
 * touched (availability isn't part of the zero-sum minutes redistribution).
 *
 *   npm run depth-chart:repair-live-mpg -- --dry-run
 *   npm run depth-chart:repair-live-mpg
 */
import { loadEnv, getServiceClient } from "./nba-data/client";
import { allocateTeam, impliedRawLoad, type AllocateInput } from "../src/lib/allocate-team";
import bundledRoster from "../src/data/depth-chart-2026-27.json";

const SEASON = "2026-27";
type EditValue = { tier: string; injury: string; overrideGames: number | null; overrideMpg: number | null };
type RosterRow = {
  team: string; player: string; tier: string; injury: string;
  projMpg: number | null; projGames: number | null;
  overrideGames: number | null; overrideMpg: number | null;
};
const keyOf = (r: { team: string; player: string }) => `${r.team}||${r.player}`;

async function main(): Promise<void> {
  loadEnv();
  const dry = process.argv.includes("--dry-run");
  const roster = bundledRoster as RosterRow[];

  const { data, error } = await getServiceClient()
    .from("depth_chart_docs").select("published").eq("season", SEASON).maybeSingle();
  if (error) throw error;
  const published = (data?.published as Record<string, EditValue>) ?? {};

  const byTeam = new Map<string, RosterRow[]>();
  for (const r of roster) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team)!.push(r);
  }

  const nextPublished: Record<string, EditValue> = { ...published };
  let totalFixed = 0;
  for (const [team, rows] of byTeam) {
    const inputs: AllocateInput[] = [];
    const edits = new Map<string, EditValue>();
    for (const r of rows) {
      const k = keyOf(r);
      const e = published[k] ?? { tier: r.tier, injury: r.injury, overrideGames: r.overrideGames, overrideMpg: r.overrideMpg };
      edits.set(k, e);
      if (e.tier === "cut") continue;
      const baseMpg = r.projMpg ?? 0;
      const baseGames = r.projGames ?? 0;
      const hasOverride = e.overrideGames != null || e.overrideMpg != null;
      const availability = (e.overrideGames ?? baseGames) / 82;
      const rawLoad = impliedRawLoad(baseMpg, baseGames);
      const locked = hasOverride ? (e.overrideMpg ?? baseMpg) * availability : undefined;
      inputs.push({ key: k, rawLoad, availability, locked });
    }
    const anyOverride = [...edits.values()].some((e) => e.tier !== "cut" && (e.overrideGames != null || e.overrideMpg != null));
    if (!anyOverride) continue;

    for (const res of allocateTeam(inputs)) {
      const liveMpg = Math.round(res.projMpg * 10) / 10;
      const cur = edits.get(res.key)!;
      if (cur.overrideMpg === liveMpg) continue;
      const fixed: EditValue = { ...cur, overrideMpg: liveMpg };
      nextPublished[res.key] = fixed;
      totalFixed += 1;
      console.log(`  ${res.key}: overrideMpg ${cur.overrideMpg ?? "—"} -> ${liveMpg}`);
    }
  }

  console.log(`\n${totalFixed} player(s) need their published overrideMpg corrected to match live redistribution.`);
  if (dry) return console.log("(dry run — Supabase not written)");
  if (totalFixed === 0) return;
  const { error: writeError } = await getServiceClient().from("depth_chart_docs").upsert({
    season: SEASON, published: nextPublished, updated_at: new Date().toISOString(),
  });
  if (writeError) throw writeError;
  console.log("upserted depth_chart_docs");
}

main().catch((e) => { console.error(e); process.exit(1); });
