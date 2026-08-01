import type { Metadata } from "next";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { SignUpModal } from "@/components/sign-up-modal";
import { Footer } from "@/components/footer";

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

const SITE_URL = "https://www.fantasyhoopsedge.com";
const SITE_NAME = "Fantasy Hoops Edge";
const DEFAULT_TITLE =
  "Fantasy Hoops Edge | Fantasy Basketball Analytics, Dynasty Rankings & NBA Stats";
const DEFAULT_DESCRIPTION =
  "Fantasy Hoops Edge is a fantasy basketball analytics platform: 9-category dynasty rankings, NBA player projections, rookie draft boards, and statistical tools for deep category leagues.";
const OG_IMAGE = `${SITE_URL}/icon-512.png`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    "fantasy basketball",
    "dynasty rankings",
    "NBA stats",
    "basketball analytics",
    "9-category",
    "fantasy basketball rankings",
    "NBA player projections",
    "dynasty fantasy basketball",
    "rookie draft board",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [{ url: OG_IMAGE, width: 512, height: 512, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@FantasyHoopEdge",
    creator: "@FantasyHoopEdge",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE],
  },
  other: {
    category: "Sports",
    classification: "Sports",
    subject: "Fantasy Basketball Analytics",
  },
};

const ROOT_SCHEMA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DEFAULT_DESCRIPTION,
      inLanguage: "en_US",
      about: { "@type": "Thing", name: "Basketball" },
      keywords:
        "fantasy basketball, dynasty rankings, NBA stats, basketball analytics, 9-category, NBA player projections",
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: OG_IMAGE,
        width: 512,
        height: 512,
      },
      sameAs: ["https://x.com/FantasyHoopEdge"],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ROOT_SCHEMA) }}
        />
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
          <Footer className="site-footer-global" />
        </AuthProvider>
        {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
      </body>
    </html>
  );
}
