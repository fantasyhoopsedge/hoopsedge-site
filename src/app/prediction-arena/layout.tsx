import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "Prediction Arena — Fantasy Hoops Edge",
  description:
    "Make nightly, monthly, and season-long NBA predictions. Earn FHE Edge Points, Analyst Badges, and Called It cards.",
};

export default function PredictionArenaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AuthProvider>{children}</AuthProvider>;
}
