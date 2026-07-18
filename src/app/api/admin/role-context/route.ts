import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isRbAdmin } from "@/lib/rookie-board-store";
import {
  loadForEditor, saveDraft, publish, discardDraft, TIER_OPTIONS, type TierEdit,
} from "@/lib/role-context-store";

/**
 * Authoring API for the Stage 1 role-context tier pass.
 *
 *   GET    — editor bootstrap: every roster row + the tier menu + isDraft flag.
 *   POST   — { edits:[{team,player,tier}], mode:"wip"|"publish" }. wip saves the draft;
 *            publish commits it (in prod → Supabase; in dev → the canonical CSV).
 *   DELETE — discard the WIP draft.
 *
 * Access mirrors the rookie board: open on localhost (dev convenience); in production
 * the signed-in user's email must be in rb_admins.
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
    return NextResponse.json({ error: "Your account isn't an authorized editor." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    const data = await loadForEditor();
    return NextResponse.json({ ...data, tiers: TIER_OPTIONS });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const denied = await authorize();
  if (denied) return denied;
  try {
    await discardDraft();
    const data = await loadForEditor();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await authorize();
  if (denied) return denied;

  let body: { edits?: unknown; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const raw = Array.isArray(body.edits) ? body.edits : [];
  const edits: TierEdit[] = raw.map((e) => {
    const r = e as Record<string, unknown>;
    return { team: String(r.team ?? ""), player: String(r.player ?? ""), tier: String(r.tier ?? "") };
  });
  const mode = body.mode === "publish" ? "publish" : "wip";

  try {
    const { changed } = mode === "publish" ? await publish(edits) : await saveDraft(edits);
    const data = await loadForEditor();
    return NextResponse.json({ ok: true, mode, changed, ...data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
