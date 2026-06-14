import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "Draft Night Challenge — Fantasy Hoops Edge",
  description:
    "Four fast mini-games. Mock the lottery, call the head-to-heads, tag the first-rounders. Lock your picks before tip-off and climb the Draft Night leaderboard.",
};

export default function DraftNightLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
