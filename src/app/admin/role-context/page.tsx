import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { isRbAdmin } from "@/lib/rookie-board-store";
import { RoleContextEditor } from "./_editor";

// Live admin tool. Open on localhost (dev convenience); in production the signed-in
// user's email must be in rb_admins (same allowlist as the rookie board). Never
// prerender, never index.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Role Context · Tier Pass",
  robots: { index: false, follow: false },
};

export default async function RoleContextAdminPage() {
  if (process.env.NODE_ENV !== "production") return <RoleContextEditor />; // localhost trusted

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/prediction-arena?next=/admin/role-context");

  if (!(await isRbAdmin(user.email))) {
    return (
      <main style={{ padding: "80px 32px", textAlign: "center", color: "#94a3b8", fontFamily: "system-ui" }}>
        <h1 style={{ color: "#fff" }}>Restricted</h1>
        <p>Your account isn&apos;t an authorized editor.</p>
      </main>
    );
  }
  return <RoleContextEditor />;
}
