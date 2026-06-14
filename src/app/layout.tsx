import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { SignUpModal } from "@/components/sign-up-modal";

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
      <body>
        <Script
          id="fhe-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('fhe-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
        <AuthProvider>
          <SignUpModal />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
