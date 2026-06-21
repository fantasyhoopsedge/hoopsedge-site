import { promises as fs } from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { createClient as createSb, type SupabaseClient } from "@supabase/supabase-js";
import localBoard from "@/data/rookie-board.json";
import type { RookieBoard, BoardPlayer, BoardTier } from "@/lib/rookie-board";

/**
 * Storage layer for the rookie board.
 *
 * Source of truth is Supabase when configured (NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY); otherwise it falls back to the repo's local JSON
 * files so dev works offline and the public board survives a Supabase outage.
 *
 *   live  → published board (public)        draft → WIP (admin only)
 *   rb_versions → published version archive  rb_admins → editor allowlist
 */

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB_CONFIGURED = Boolean(SB_URL && SB_ANON && SB_SERVICE);
// Supabase is the source of truth in production. Locally we stay on the file
// path (the tested dev workflow) unless RB_USE_SUPABASE=1 is set to exercise
// the DB path against a migrated project.
export const RB_SUPABASE_ENABLED =
  SB_CONFIGURED && (process.env.NODE_ENV === "production" || process.env.RB_USE_SUPABASE === "1");
const PUBLIC_BOARD_PATH = "/draft-board";

// Untyped clients — the rb_* tables aren't in the generated Database types.
function serviceClient(): SupabaseClient {
  return createSb(SB_URL!, SB_SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── local-file fallback paths ───────────────────────────────────────────────
const LIVE_PATH = path.join(process.cwd(), "src", "data", "rookie-board.json");
const DRAFT_PATH = path.join(process.cwd(), "src", "data", "rookie-board.draft.json");
const VERSIONS_DIR = path.join(process.cwd(), "public", "data", "rookie-board-versions");
const INDEX_PATH = path.join(VERSIONS_DIR, "index.json");

export interface VersionEntry { version: string; label: string; savedAt: string; players: number; note?: string }
interface VersionIndex { current: string; versions: VersionEntry[] }

const FALLBACK = localBoard as RookieBoard;

/** 1.0 → 1.1, 1.9 → 1.10. Bumps the minor component. */
export function bumpVersion(v: string): string {
  const [major, minor] = (v || "1.0").split(".");
  return `${major || "1"}.${(parseInt(minor || "0", 10) || 0) + 1}`;
}

// ── PUBLIC READ ─────────────────────────────────────────────────────────────
// The /draft-board page is ISR-cached (see its `revalidate` export) and busted
// on publish via revalidateLiveBoard(), so reads here are infrequent.
export async function getLiveBoard(): Promise<RookieBoard> {
  if (RB_SUPABASE_ENABLED) {
    try {
      const sb = createSb(SB_URL!, SB_ANON!, { auth: { persistSession: false } });
      const { data } = await sb.from("rb_docs").select("data").eq("slug", "live").maybeSingle();
      if (data?.data) return data.data as RookieBoard;
    } catch {
      /* fall through to bundled board */
    }
  }
  return FALLBACK;
}

/** Invalidate the public board so the next visit re-renders with fresh data. */
export function revalidateLiveBoard() {
  revalidatePath(PUBLIC_BOARD_PATH);
}

// ── ADMIN-SIDE READS/WRITES (service role, or local files) ──────────────────
async function readLiveRaw(): Promise<RookieBoard> {
  if (RB_SUPABASE_ENABLED) {
    const { data } = await serviceClient().from("rb_docs").select("data").eq("slug", "live").maybeSingle();
    return (data?.data as RookieBoard) ?? FALLBACK;
  }
  try {
    return JSON.parse(await fs.readFile(LIVE_PATH, "utf8"));
  } catch {
    return FALLBACK;
  }
}

async function readDraftRaw(): Promise<RookieBoard | null> {
  if (RB_SUPABASE_ENABLED) {
    const { data } = await serviceClient().from("rb_docs").select("data").eq("slug", "draft").maybeSingle();
    return (data?.data as RookieBoard) ?? null;
  }
  try {
    return JSON.parse(await fs.readFile(DRAFT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function readVersions(): Promise<VersionEntry[]> {
  if (RB_SUPABASE_ENABLED) {
    const { data } = await serviceClient()
      .from("rb_versions")
      .select("version,label,saved_at,players,note")
      .order("created_at", { ascending: true });
    return (data ?? []).map((r: Record<string, unknown>) => ({
      version: String(r.version),
      label: String(r.label ?? `Rookie Board ${r.version}`),
      savedAt: String(r.saved_at ?? ""),
      players: Number(r.players ?? 0),
      note: r.note ? String(r.note) : undefined,
    }));
  }
  try {
    const idx = JSON.parse(await fs.readFile(INDEX_PATH, "utf8")) as VersionIndex;
    return idx.versions;
  } catch {
    return [];
  }
}

/** Editor bootstrap: the board to edit (draft if present, else live) + meta. */
export async function loadForEditor() {
  const [live, draft, versions] = await Promise.all([readLiveRaw(), readDraftRaw(), readVersions()]);
  return {
    board: draft ?? live,
    isDraft: Boolean(draft),
    liveVersion: live.version,
    versions,
  };
}

/** Persist a WIP draft — not published, no version bump. */
export async function saveDraft(players: BoardPlayer[], tiers: BoardTier[]): Promise<RookieBoard> {
  const live = await readLiveRaw();
  const draft: RookieBoard = {
    version: live.version,
    label: `Rookie Board ${live.version} · WIP`,
    updatedAt: new Date().toISOString().slice(0, 10),
    tiers,
    players,
  };
  if (RB_SUPABASE_ENABLED) {
    await serviceClient().from("rb_docs").upsert({ slug: "draft", data: draft, updated_at: new Date().toISOString() });
  } else {
    await fs.writeFile(DRAFT_PATH, JSON.stringify(draft, null, 2) + "\n");
  }
  return draft;
}

/** Discard the WIP draft; returns the live board. */
export async function discardDraft(): Promise<RookieBoard> {
  if (RB_SUPABASE_ENABLED) {
    await serviceClient().from("rb_docs").delete().eq("slug", "draft");
  } else {
    await fs.rm(DRAFT_PATH, { force: true });
  }
  return readLiveRaw();
}

/** Publish: write the live board, archive a new version, clear the draft,
 * and revalidate the public board so it updates instantly. */
export async function publishBoard(players: BoardPlayer[], tiers: BoardTier[]) {
  const prevLive = await readLiveRaw();
  const nextVersion = bumpVersion(prevLive.version);
  const savedAt = new Date().toISOString().slice(0, 10);
  const newBoard: RookieBoard = {
    version: nextVersion,
    label: `Rookie Board ${nextVersion}`,
    updatedAt: savedAt,
    tiers,
    players,
  };

  if (RB_SUPABASE_ENABLED) {
    const sb = serviceClient();
    await sb.from("rb_versions").insert({
      version: nextVersion,
      label: newBoard.label,
      saved_at: savedAt,
      players: players.length,
      data: newBoard,
    });
    await sb.from("rb_docs").upsert({ slug: "live", data: newBoard, updated_at: new Date().toISOString() });
    await sb.from("rb_docs").delete().eq("slug", "draft");
  } else {
    await fs.mkdir(VERSIONS_DIR, { recursive: true });
    await fs.writeFile(path.join(VERSIONS_DIR, `v${nextVersion}.json`), JSON.stringify(newBoard, null, 2) + "\n");
    await fs.writeFile(LIVE_PATH, JSON.stringify(newBoard, null, 2) + "\n");
    const idx = JSON.parse(await fs.readFile(INDEX_PATH, "utf8").catch(() => '{"current":"1.0","versions":[]}')) as VersionIndex;
    idx.current = nextVersion;
    idx.versions.push({ version: nextVersion, label: newBoard.label, savedAt, players: players.length });
    await fs.writeFile(INDEX_PATH, JSON.stringify(idx, null, 2) + "\n");
    await fs.rm(DRAFT_PATH, { force: true });
  }

  revalidateLiveBoard();
  return { version: nextVersion, previousVersion: prevLive.version, board: newBoard };
}

/** Is this email an authorized editor? (Service-role lookup; bypasses RLS.) */
export async function isRbAdmin(email: string | null | undefined): Promise<boolean> {
  if (!RB_SUPABASE_ENABLED) return false; // file mode has no allowlist; callers gate on dev
  if (!email) return false;
  const { data } = await serviceClient().from("rb_admins").select("email").ilike("email", email).maybeSingle();
  return Boolean(data);
}
