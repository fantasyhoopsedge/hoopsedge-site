import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoleContextEditor } from "./_editor";

// Dev-only modeling tool: it writes the repo working tree (the Stage 1 role-context CSV),
// which only makes sense on localhost. Production has a read-only filesystem and no use
// for it, so it 404s there. Never prerender, never index.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Role Context · Tier Pass",
  robots: { index: false, follow: false },
};

export default function RoleContextAdminPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RoleContextEditor />;
}
