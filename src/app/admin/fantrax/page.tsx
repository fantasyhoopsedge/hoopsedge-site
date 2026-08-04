import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isRbAdmin } from "@/lib/rookie-board-store";
import { FantraxShell } from "./_shell";

// Live admin tool. Open on localhost (dev convenience); in production the
// signed-in user's email must be in rb_admins. Never prerender, never index.
// The gate is temporary — this is a user feature in limited testing, not an
// authoring tool. See src/lib/fantrax/guard.ts for how to graduate it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fantrax League Connector · FHE Admin",
  robots: { index: false, follow: false },
};

export default async function FantraxAdminPage() {
  if (process.env.NODE_ENV !== "production") {
    return <FantraxShell />; // localhost is trusted
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/prediction-arena?next=/admin/fantrax");

  if (!(await isRbAdmin(user.email))) {
    return (
      <main style={{ padding: "80px 32px", textAlign: "center", color: "#94a3b8", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#fff" }}>Restricted</h1>
        <p>The Fantrax league connector is in limited testing.</p>
      </main>
    );
  }

  return <FantraxShell />;
}
