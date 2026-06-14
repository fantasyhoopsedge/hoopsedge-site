import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prediction Arena — Fantasy Hoops Edge",
  description:
    "Make nightly, monthly, and season-long NBA predictions. Earn FHE Edge Points, Analyst Badges, and Called It cards.",
};

// AuthProvider is supplied once at the root layout (src/app/layout.tsx).
export default function PredictionArenaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
