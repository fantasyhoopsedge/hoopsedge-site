import { getAllProspects } from "@/lib/prospects";
import { DraftBoardClient } from "./_board-client";

/**
 * Server wrapper: pulls each prospect's age from the master CSV
 * (data/fhe_2026_prospects_master.csv via getAllProspects) and passes a
 * name→age map to the client board, so ages stay sourced from the master
 * rather than the board's hand-maintained array.
 */
export default function DraftBoardPage() {
  const ageByName: Record<string, number> = {};
  for (const p of getAllProspects()) {
    if (p.age != null) ageByName[p.name] = p.age;
  }
  return <DraftBoardClient ageByName={ageByName} />;
}
