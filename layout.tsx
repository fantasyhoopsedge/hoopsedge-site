import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy Hoops Edge — Dynasty Intelligence for Category Leagues",
  description: "Dynasty rankings, rookie draft boards, and prospect analysis for serious dynasty managers. The only 9-cat dynasty tool built for deep leagues.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
