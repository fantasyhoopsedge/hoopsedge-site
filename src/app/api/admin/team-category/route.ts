import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isRbAdmin } from "@/lib/rookie-board-store";
import {
  loadForEditor, saveDraft, publish, discardDraft, CATEGORY_OPTIONS, type CategoryEdit,
} from "@/lib/team-category-store";

/**
 * Authoring API for the team-category selector inside /admin/depth-chart.
 *
 *   GET    — every team + its category + the category menu + isDraft flag.
 *   POST   — { edits:[{team,category}], mode:"wip"|"publish" }.
 *   DELETE — discard the WIP draft.
 *
 * Same access gate as depth-chart/role-context/rookie-board: open on localhost;
 * in production the signed-in user's email must be in rb_admins.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IS_DEV = process.env.NODE_ENV !== "production";

async function authorize(): Promise<NextResponse | null> {
  if (IS_DEV) return null;
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
    return NextResponse.json({ ...data, categories: CATEGORY_OPTIONS });
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
  const edits: CategoryEdit[] = raw.map((e) => {
    const r = e as Record<string, unknown>;
    return { team: String(r.team ?? ""), category: String(r.category ?? "") };
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
