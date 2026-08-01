import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadForEditor, saveDraft, discardDraft, publishBoard, resetToConsensus, isRbAdmin, DB_SUPABASE_ENABLED,
} from "@/lib/dynasty-board-store";
import { ROLE_TAGS, type DynastyBoardPlayer } from "@/lib/dynasty-board";

/**
 * Authoring API for the Dynasty Board editor (/admin/dynasty-board).
 *
 *   GET    — editor bootstrap: draft if present, else published, else a fresh
 *            consensus seed built on the fly.
 *   POST   — { players, draft:true } saves a WIP draft; { players } (no
 *            draft flag) publishes; { reset:true } discards the current
 *            edits and reseeds a draft from the hashtag consensus.
 *   DELETE — discards the WIP draft, falling back to published (or a fresh
 *            seed if nothing has ever been published).
 *
 * Access: open on localhost (dev convenience); in production the signed-in
 * user's email must be in rb_admins (reused from the rookie board editor).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IS_DEV = process.env.NODE_ENV !== "production";

async function authorize(): Promise<NextResponse | null> {
  if (IS_DEV) return null; // localhost is trusted
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!(await isRbAdmin(user.email))) {
    return NextResponse.json({ error: "Your account isn't an authorized board editor." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const data = await loadForEditor();
    return NextResponse.json({ ...data, canWrite: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const { doc, isSeed } = await discardDraft();
    return NextResponse.json({ ok: true, doc, isDraft: false, isSeed });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── validation ──────────────────────────────────────────────────────────────
const MAX_PLAYERS = 700; // generous headroom over DYNASTY_RANKINGS' ~500 rows

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizePlayers(raw: unknown): { players: DynastyBoardPlayer[]; error?: string } {
  if (!Array.isArray(raw)) return { players: [], error: "players must be an array" };
  if (raw.length === 0) return { players: [], error: "board has no players" };
  if (raw.length > MAX_PLAYERS) return { players: [], error: `board exceeds ${MAX_PLAYERS} players` };

  const players: DynastyBoardPlayer[] = raw.map((p, i) => {
    const rec = p as Record<string, unknown>;
    const roleTag = String(rec.roleTag ?? "").trim();
    return {
      customRank: i + 1,
      name: String(rec.name ?? "").trim(),
      team: String(rec.team ?? "").trim(),
      position: String(rec.position ?? "").trim(),
      age: num(rec.age),
      // null is a valid, real value here — a player added later from the
      // ecosystem pool has no FHE/FBI Baseline rank to fall back to.
      consensusRank: num(rec.consensusRank),
      consensusAvgRank: num(rec.consensusAvgRank),
      isRookie: Boolean(rec.isRookie),
      isSophomore: Boolean(rec.isSophomore),
      contract: String(rec.contract ?? "").trim(),
      contractStatus: rec.contractStatus ? String(rec.contractStatus).trim() : null,
      minus1vRank: num(rec.minus1vRank),
      mpg: num(rec.mpg),
      gp: num(rec.gp),
      usg: num(rec.usg),
      roleTag: (ROLE_TAGS as readonly string[]).includes(roleTag) || roleTag === "cut"
        ? (roleTag as DynastyBoardPlayer["roleTag"])
        : null,
      note: String(rec.note ?? "").trim().slice(0, 500),
    };
  });

  const missing = players.find((p) => !p.name);
  if (missing) return { players: [], error: `player at rank ${missing.customRank} is missing a name` };
  return { players };
}

export async function POST(request: Request) {
  const denied = await authorize();
  if (denied) return denied;

  let body: { players?: unknown; draft?: boolean; reset?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.reset) {
      const doc = await resetToConsensus();
      return NextResponse.json({ ok: true, draft: true, doc });
    }

    const { players, error } = sanitizePlayers(body.players);
    if (error) return NextResponse.json({ error }, { status: 400 });

    if (body.draft) {
      const doc = await saveDraft(players);
      return NextResponse.json({ ok: true, draft: true, doc });
    }
    const doc = await publishBoard(players);
    return NextResponse.json({ ok: true, players: players.length, doc, supabase: DB_SUPABASE_ENABLED });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
