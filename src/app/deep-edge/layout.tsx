import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isDeepEdgeAdmin } from "@/lib/deep-edge/admin-cache";

// Deep Edge is genuinely multi-route (Welcome/Home/Settings/Category
// Edge/Power Rankings all read naturally as distinct URLs), so the gate
// lives once here rather than copy-pasted into every page.tsx the way
// admin/fantrax's single-page shell does it. Admin-gated for now — Ash is
// testing everything through this gate; the real one-free-league-then-pay
// entitlement replaces it once billing exists (see src/lib/deep-edge/guard.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Deep Edge · Fantasy Hoops Edge",
  robots: { index: false, follow: false },
};

export default async function DeepEdgeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "production") {
    return <>{children}</>; // localhost is trusted
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/prediction-arena?next=/deep-edge");

  if (!(await isDeepEdgeAdmin(user.email))) {
    return (
      <main style={{ padding: "80px 32px", textAlign: "center", color: "#94a3b8", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#fff" }}>Restricted</h1>
        <p>The Deep Edge is in limited testing.</p>
      </main>
    );
  }

  return <>{children}</>;
}
