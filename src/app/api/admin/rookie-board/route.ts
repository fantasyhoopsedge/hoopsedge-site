import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadForEditor, saveDraft, discardDraft, publishBoard, isRbAdmin,
  RB_SUPABASE_ENABLED,
} from "@/lib/rookie-board-store";
import { MAX_BOARD_SIZE, type BoardPlayer, type BoardTier } from "@/lib/rookie-board";

/**
 * Authoring API for the 2026 Rookie Board (Supabase-backed in production).
 *
 *   GET    — editor bootstrap: board (draft if any) + version history.
 *   POST   — { draft:true } saves a WIP draft; otherwise publishes a new
 *            version and refreshes the public board instantly.
 *   DELETE — discards the WIP draft.
 *
 * Access: open on localhost (dev convenience); in production the signed-in
 * user's email must be in rb_admins.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IS_DEV = process.env.NODE_ENV !== "production";

/** Returns null when authorized, or an error response when not. */
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
    return NextResponse.json({ ...data, canWrite: true, supabase: RB_SUPABASE_ENABLED });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const board = await discardDraft();
    return NextResponse.json({ ok: true, board, isDraft: false });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ── validation ──────────────────────────────────────────────────────────────
function normStar(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? "" : `${Math.min(5, Math.max(1, n))}★`;
}

function sanitizePlayers(raw: unknown): { players: BoardPlayer[]; error?: string } {
  if (!Array.isArray(raw)) return { players: [], error: "players must be an array" };
  if (raw.length === 0) return { players: [], error: "board has no players" };
  if (raw.length > MAX_BOARD_SIZE) return { players: [], error: `board exceeds ${MAX_BOARD_SIZE} players` };

  const players: BoardPlayer[] = raw.map((p, i) => {
    const rec = p as Record<string, unknown>;
    const rank = i + 1;
    const player: BoardPlayer = {
      rank,
      pick: `1.${String(rank).padStart(2, "0")}`,
      name: String(rec.name ?? "").trim(),
      school: String(rec.school ?? "").trim(),
      pos: String(rec.pos ?? "").trim(),
      tier: Number(rec.tier) || 1,
      age: rec.age == null || rec.age === "" ? null : Number(rec.age),
      ht: String(rec.ht ?? "").trim(),
      pts: normStar(rec.pts), reb: normStar(rec.reb), ast: normStar(rec.ast),
      stl: normStar(rec.stl), blk: normStar(rec.blk), fg: normStar(rec.fg),
      ft: normStar(rec.ft), tpm: normStar(rec.tpm), to: normStar(rec.to),
      verdict: String(rec.verdict ?? "").trim(),
    };
    if (rec.birthdate) player.birthdate = String(rec.birthdate).slice(0, 10);
    return player;
  });

  const missing = players.find((p) => !p.name);
  if (missing) return { players: [], error: `player at rank ${missing.rank} is missing a name` };
  return { players };
}

function sanitizeTiers(raw: unknown): BoardTier[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const rec = t as Record<string, unknown>;
    return {
      id: Number(rec.id),
      label: String(rec.label ?? "").trim() || `TIER_${rec.id}`,
      color: String(rec.color ?? "#64748b").trim(),
    };
  });
}

export async function POST(request: Request) {
  const denied = await authorize();
  if (denied) return denied;

  let body: { players?: unknown; tiers?: unknown; draft?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { players, error } = sanitizePlayers(body.players);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const tiers = sanitizeTiers(body.tiers);
  if (tiers.length === 0) return NextResponse.json({ error: "tiers are required" }, { status: 400 });

  try {
    if (body.draft) {
      const board = await saveDraft(players, tiers);
      return NextResponse.json({ ok: true, draft: true, board });
    }
    const { version, previousVersion, board } = await publishBoard(players, tiers);
    return NextResponse.json({ ok: true, version, previousVersion, players: players.length, board });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
