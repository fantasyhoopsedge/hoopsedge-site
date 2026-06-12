import FantraxLeague from "@/components/fantrax/FantraxLeague";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My League | Fantasy Hoops Edge",
  description:
    "Connect your Fantrax dynasty basketball league and get the FHE dynasty rank overlay on every roster.",
};

export default function FantraxPage() {
  return <FantraxLeague />;
}
