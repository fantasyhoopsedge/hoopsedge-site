import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isRbAdmin } from "@/lib/rookie-board-store";
import {
  loadForEditor, saveDraft, publish, discardDraft, TIER_OPTIONS, INJURY_OPTIONS, INJURY_REDUCTION,
  STATUS_LABEL, type TierEdit,
} from "@/lib/depth-chart-store";
// Role-context usage FLAGS — a committed snapshot from
// models/usage-redistribution/flag_role_changes.py --emit-json (foundation parquet is
// gitignored / local-only, so the Vercel app reads this bundle rather than recomputing).
// Overlaid as inline badges + a per-team net-usage line so the usage signal sits right
// where minutes and tiers are set. Refresh: re-run the script with --emit-json + redeploy.
import roleFlags from "@/data/role-flags-2026-27.json";

/**
 * Authoring API for the standalone depth-chart tool.
 *
 *   GET    — editor bootstrap: every roster row (position, projected minutes, contract
 *            status) + the tier menu + isDraft flag.
 *   POST   — { edits:[{team,player,tier}], mode:"wip"|"publish" }. wip saves the draft;
 *            publish commits it (in prod → Supabase; in dev → the canonical CSV).
 *   DELETE — discard the WIP draft.
 *
 * Access mirrors the rookie board / role-context tool: open on localhost (dev
 * convenience); in production the signed-in user's email must be in rb_admins.
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
    return NextResponse.json({
      ...data, tiers: TIER_OPTIONS, injuries: INJURY_OPTIONS, injuryReduction: INJURY_REDUCTION,
      statusLabels: STATUS_LABEL, roleFlags,
    });
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

  const toNum = (v: unknown): number | null =>
    v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null);

  const raw = Array.isArray(body.edits) ? body.edits : [];
  const edits: TierEdit[] = raw.map((e) => {
    const r = e as Record<string, unknown>;
    return {
      team: String(r.team ?? ""), player: String(r.player ?? ""),
      tier: String(r.tier ?? ""), injury: String(r.injury ?? "none"),
      overrideGames: toNum(r.overrideGames), overrideMpg: toNum(r.overrideMpg),
    };
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
