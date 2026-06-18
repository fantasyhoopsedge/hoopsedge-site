import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/**
 * Public read: derived free agents (nba_free_agents view — contracts whose
 * FHE-derived free_agent_status is non-null). Anon key, read-only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nba_free_agents")
    .select("*")
    .order("salary_current", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ free_agents: data });
}
