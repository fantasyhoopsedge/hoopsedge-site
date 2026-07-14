import { redirect } from "next/navigation";

// Bare /team-rosters always redirects to a default team; the real page lives
// at /team-rosters/[team] (see [team]/page.tsx) so every team gets its own
// fetch + URL.
export default function TeamRostersPage() {
  redirect("/team-rosters/OKC");
}
