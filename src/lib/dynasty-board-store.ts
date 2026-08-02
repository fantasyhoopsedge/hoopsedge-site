import { promises as fs } from "fs";
import path from "path";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import { refreshBaselineRanks, renumber, type DynastyBoardDoc, type DynastyBoardPlayer } from "@/lib/dynasty-board";
import { buildDynastyBoardSeed } from "@/lib/dynasty-board-seed";
import { isRbAdmin } from "@/lib/rookie-board-store";

/**
 * Storage layer for the Dynasty Board editor (/admin/dynasty-board).
 *
 * Same two-mode shape as rookie-board-store.ts / depth-chart-store.ts:
 *   • Supabase (production, or dev with DB_USE_SUPABASE=1) — the only mode
 *     that works in prod, since Vercel's filesystem is read-only.
 *   • Local JSON files (dev default) — src/data/dynasty-board.json (published)
 *     and src/data/dynasty-board.draft.json (WIP).
 *
 * Unlike the rookie board there's no version archive: this tool is a personal
 * ranking workspace, not a publicly versioned document, so "publish" simply
 * promotes the draft to `published` in place. CSV export (see
 * src/lib/csv-export.ts) is how a snapshot leaves the tool.
 *
 * Reuses the rookie board's admin allowlist (rb_admins) rather than adding a
 * second one, per the same convention depth-chart-store.ts documents.
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB_CONFIGURED = Boolean(SB_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && SB_SERVICE);

export const DB_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.DB_USE_SUPABASE === "1");

function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

const PUBLISHED_PATH = path.join(process.cwd(), "src", "data", "dynasty-board.json");
const DRAFT_PATH = path.join(process.cwd(), "src", "data", "dynasty-board.draft.json");

async function readJsonFile(p: string): Promise<DynastyBoardDoc | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function readPublishedRaw(): Promise<DynastyBoardDoc | null> {
  if (DB_SUPABASE_ENABLED) {
    const { data } = await serviceClient()
      .from("dynasty_board_docs")
      .select("published")
      .eq("id", "dynasty_board")
      .maybeSingle();
    return (data?.published as DynastyBoardDoc) ?? null;
  }
  return readJsonFile(PUBLISHED_PATH);
}

async function readDraftRaw(): Promise<DynastyBoardDoc | null> {
  if (DB_SUPABASE_ENABLED) {
    const { data } = await serviceClient()
      .from("dynasty_board_docs")
      .select("draft")
      .eq("id", "dynasty_board")
      .maybeSingle();
    return (data?.draft as DynastyBoardDoc) ?? null;
  }
  return readJsonFile(DRAFT_PATH);
}

function docFrom(players: DynastyBoardPlayer[]): DynastyBoardDoc {
  return { updatedAt: new Date().toISOString(), players: renumber(players) };
}

/** Re-derives consensusRank/consensusAvgRank from the CURRENT dynasty-rankings.json
 * on every load — see refreshBaselineRanks() for why a stored doc can't be trusted
 * to have current (or even present) values for these two fields. */
function withFreshBaseline(doc: DynastyBoardDoc): DynastyBoardDoc {
  return { ...doc, players: refreshBaselineRanks(doc.players) };
}

/** Editor bootstrap: draft if present, else published, else a fresh consensus seed. */
export async function loadForEditor(): Promise<{
  doc: DynastyBoardDoc;
  isDraft: boolean;
  isSeed: boolean;
  supabase: boolean;
}> {
  const [published, draft] = await Promise.all([readPublishedRaw(), readDraftRaw()]);
  if (draft) return { doc: withFreshBaseline(draft), isDraft: true, isSeed: false, supabase: DB_SUPABASE_ENABLED };
  if (published) {
    return { doc: withFreshBaseline(published), isDraft: false, isSeed: false, supabase: DB_SUPABASE_ENABLED };
  }
  const seed = docFrom(await buildDynastyBoardSeed());
  return { doc: seed, isDraft: false, isSeed: true, supabase: DB_SUPABASE_ENABLED };
}

/** Persist a WIP draft — does not touch the published board. */
export async function saveDraft(players: DynastyBoardPlayer[]): Promise<DynastyBoardDoc> {
  const doc = docFrom(players);
  if (DB_SUPABASE_ENABLED) {
    await serviceClient()
      .from("dynasty_board_docs")
      .upsert({ id: "dynasty_board", draft: doc, updated_at: new Date().toISOString() });
  } else {
    await fs.mkdir(path.dirname(DRAFT_PATH), { recursive: true });
    await fs.writeFile(DRAFT_PATH, JSON.stringify(doc, null, 2) + "\n");
  }
  return doc;
}

/** Promote the given order to `published` and clear the draft. */
export async function publishBoard(players: DynastyBoardPlayer[]): Promise<DynastyBoardDoc> {
  const doc = docFrom(players);
  if (DB_SUPABASE_ENABLED) {
    await serviceClient()
      .from("dynasty_board_docs")
      .upsert({ id: "dynasty_board", published: doc, draft: null, updated_at: new Date().toISOString() });
  } else {
    await fs.mkdir(path.dirname(PUBLISHED_PATH), { recursive: true });
    await fs.writeFile(PUBLISHED_PATH, JSON.stringify(doc, null, 2) + "\n");
    await fs.rm(DRAFT_PATH, { force: true });
  }
  return doc;
}

/** Discard the WIP draft; returns the published board (or a fresh seed if none exists yet). */
export async function discardDraft(): Promise<{ doc: DynastyBoardDoc; isSeed: boolean }> {
  if (DB_SUPABASE_ENABLED) {
    await serviceClient().from("dynasty_board_docs").update({ draft: null }).eq("id", "dynasty_board");
  } else {
    await fs.rm(DRAFT_PATH, { force: true });
  }
  const published = await readPublishedRaw();
  if (published) return { doc: withFreshBaseline(published), isSeed: false };
  return { doc: docFrom(await buildDynastyBoardSeed()), isSeed: true };
}

/** Reset the CURRENT draft back to the FBI-HE baseline order, discarding any custom order. */
export async function resetToConsensus(): Promise<DynastyBoardDoc> {
  return saveDraft(await buildDynastyBoardSeed());
}

export { isRbAdmin };
