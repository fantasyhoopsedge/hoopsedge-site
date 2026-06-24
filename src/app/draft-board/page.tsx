import { getAllProspects } from "@/lib/prospects";
import { getLiveBoard, getBoardMovement } from "@/lib/rookie-board-store";
import { DraftBoardClient } from "./_board-client";

// ISR: the board is cached and regenerated at most hourly as a safety net,
// and busted instantly when an admin publishes (revalidatePath('/draft-board')).
export const revalidate = 3600;

/**
 * Server wrapper: pulls the live board from the store (Supabase in production,
 * bundled JSON as fallback) and a name→age map from the master CSV, then hands
 * both to the client board. The board read is cached and revalidated the moment
 * an admin publishes, so this page is fast but never stale.
 */
export default async function DraftBoardPage() {
  const [board, movement] = await Promise.all([getLiveBoard(), getBoardMovement()]);

  const ageByName: Record<string, number> = {};
  for (const p of getAllProspects()) {
    if (p.age != null) ageByName[p.name] = p.age;
  }
  return <DraftBoardClient board={board} ageByName={ageByName} movement={movement} />;
}
