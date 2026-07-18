import { NextResponse } from "next/server";
import {
  loadForEditor, saveDraft, publish, discardDraft, TIER_OPTIONS, type TierEdit,
} from "@/lib/role-context-store";

/**
 * Authoring API for the Stage 1 role-context tier pass (dev-only).
 *
 *   GET    — editor bootstrap: every roster row + the tier menu + isDraft flag.
 *   POST   — { edits:[{team,player,tier}], mode:"wip"|"publish" }. wip writes the draft;
 *            publish writes the canonical CSV (what the model reads) and clears the draft.
 *   DELETE — discard the WIP draft.
 *
 * Writes the repo working tree, so it is localhost-only: production has a read-only
 * filesystem and no use for it. Guarded to 403 in prod.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IS_DEV = process.env.NODE_ENV !== "production";

function denyIfProd(): NextResponse | null {
  return IS_DEV ? null : NextResponse.json({ error: "Dev-only tool." }, { status: 403 });
}

export async function GET() {
  const denied = denyIfProd();
  if (denied) return denied;
  try {
    const { rows, isDraft } = loadForEditor();
    return NextResponse.json({ rows, isDraft, tiers: TIER_OPTIONS });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const denied = denyIfProd();
  if (denied) return denied;
  try {
    discardDraft();
    const { rows, isDraft } = loadForEditor();
    return NextResponse.json({ ok: true, rows, isDraft });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = denyIfProd();
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
    const { changed } = mode === "publish" ? publish(edits) : saveDraft(edits);
    const { rows, isDraft } = loadForEditor();
    return NextResponse.json({ ok: true, mode, changed, rows, isDraft });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
