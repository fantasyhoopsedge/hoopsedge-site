import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Public read: FHE trade candidates (nba_trade_candidates view). Each row
 * carries a `disclaimer` making clear this is an FHE-derived heuristic from
 * the committed salary data, not a provider feed. Anon key, read-only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nba_trade_candidates")
    .select("*")
    .order("salary_current", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    disclaimer:
      "FHE-derived heuristic from committed salary data; not a provider feed.",
    trade_candidates: data,
  });
}
