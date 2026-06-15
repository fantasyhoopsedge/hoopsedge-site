import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Privacy Policy | FantasyHoopsEdge',
    description: 'How FantasyHoopsEdge collects, uses, and protects your personal information.',
    robots: 'noindex',
  }
}

const S = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#ffffff',
  } as React.CSSProperties,
  container: {
    maxWidth: '768px',
    margin: '0 auto',
    padding: '96px 24px 48px',
  } as React.CSSProperties,
  headerBlock: {
    marginBottom: '40px',
  } as React.CSSProperties,
  h1: {
    fontFamily: "'Oswald', sans-serif",
    fontWeight: 700,
    fontSize: '2.25rem',
    color: '#FF6B2B',
    marginBottom: '8px',
    lineHeight: 1.1,
  } as React.CSSProperties,
  subtitle: {
    fontFamily: "'Source Sans 3', sans-serif",
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '12px',
  } as React.CSSProperties,
  summary: {
    fontFamily: "'Source Sans 3', sans-serif",
    fontSize: '1.125rem',
    color: '#4b5563',
    fontStyle: 'italic',
    lineHeight: 1.6,
  } as React.CSSProperties,
  section: {
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: '32px',
    marginBottom: '32px',
  } as React.CSSProperties,
  sectionLast: {
    paddingBottom: '32px',
  } as React.CSSProperties,
  h2: {
    fontFamily: "'Oswald', sans-serif",
    fontWeight: 600,
    fontSize: '1.25rem',
    color: '#0A0A0A',
    marginBottom: '16px',
  } as React.CSSProperties,
  num: {
    color: '#FF6B2B',
  } as React.CSSProperties,
  p: {
    fontFamily: "'Source Sans 3', sans-serif",
    fontSize: '1rem',
    lineHeight: 1.65,
    color: '#0A0A0A',
    marginBottom: '16px',
  } as React.CSSProperties,
  pLast: {
    fontFamily: "'Source Sans 3', sans-serif",
    fontSize: '1rem',
    lineHeight: 1.65,
    color: '#0A0A0A',
    marginBottom: 0,
  } as React.CSSProperties,
  subsection: {
    paddingLeft: '16px',
    borderLeft: '2px solid #e5e7eb',
    marginBottom: '16px',
  } as React.CSSProperties,
  subsectionLast: {
    paddingLeft: '16px',
    borderLeft: '2px solid #e5e7eb',
  } as React.CSSProperties,
  subsectionLabel: {
    fontFamily: "'Source Sans 3', sans-serif",
    fontSize: '1rem',
    fontWeight: 600,
    color: '#0A0A0A',
    marginBottom: '8px',
  } as React.CSSProperties,
  ul: {
    listStyleType: 'disc',
    paddingLeft: '20px',
    margin: 0,
  } as React.CSSProperties,
  li: {
    fontFamily: "'Source Sans 3', sans-serif",
    fontSize: '1rem',
    lineHeight: 1.65,
    color: '#0A0A0A',
    marginBottom: '4px',
  } as React.CSSProperties,
}

export default function PrivacyPage() {
  return (
    <main style={S.page}>
      <div style={S.container}>

        {/* Header block */}
        <div style={S.headerBlock}>
          <h1 style={S.h1}>Privacy Policy</h1>
          <p style={S.subtitle}>Last updated: 15 June 2026</p>
          <p style={S.summary}>
            This policy explains what personal information FantasyHoopsEdge collects from users of fantasyhoopsedge.com, how we use it, and what rights you have over it.
          </p>
        </div>

        {/* 1. What This Policy Covers */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>1.</span> What This Policy Covers</h2>
          <p style={S.pLast}>
            This policy applies solely to fantasyhoopsedge.com and the services operated directly by FantasyHoopsEdge. It does not extend to any third-party websites or services we link to. Those platforms operate under their own privacy policies, which you should review independently.
          </p>
        </section>

        {/* 2. Information We Collect */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>2.</span> Information We Collect</h2>

          <div style={S.subsection}>
            <p style={S.subsectionLabel}>(a) Information you provide</p>
            <ul style={S.ul}>
              <li style={S.li}>Your email address, provided when registering for the Predictions Arena or, when available, a paid subscription</li>
              <li style={S.li}>Predictions Arena game entries, scores, and leaderboard positions</li>
            </ul>
          </div>

          <div style={S.subsectionLast}>
            <p style={S.subsectionLabel}>(b) Collected automatically</p>
            <p style={{ ...S.pLast }}>
              When you use fantasyhoopsedge.com, our hosting and database infrastructure (Vercel and Supabase) automatically collects standard server log data, including your IP address, browser type and version, pages visited, and timestamps. This data is collected as a normal function of web infrastructure operation. We do not add additional tracking layers beyond what these services collect by default.
            </p>
          </div>
        </section>

        {/* 3. How We Use Your Information */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>3.</span> How We Use Your Information</h2>
          <p style={S.p}>We use the information collected to:</p>
          <ul style={{ ...S.ul, marginBottom: '16px' }}>
            <li style={S.li}>Create and manage your Predictions Arena account</li>
            <li style={S.li}>Record and display game entries, scores, and leaderboard standings</li>
            <li style={S.li}>Deliver transactional emails via SendGrid (account confirmations, game notifications)</li>
            <li style={S.li}>Monitor and maintain platform performance and security</li>
            <li style={S.li}>Manage subscription access if and when a paid tier is introduced</li>
            <li style={S.li}>Comply with applicable legal obligations</li>
          </ul>
          <p style={S.pLast}>
            We do not sell your personal data to any third party, and we do not use your data for behavioural advertising.
          </p>
        </section>

        {/* 4. Fantrax League Connector */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>4.</span> Fantrax League Connector</h2>
          <p style={S.p}>
            When you use the Fantrax League Connector feature, you provide a Fantrax username and Secret ID. These credentials are stored exclusively in your browser&apos;s sessionStorage — a temporary, client-side storage mechanism that exists only within your active browser tab or window.
          </p>
          <p style={S.pLast}>
            Your Fantrax credentials are never transmitted to, stored on, or logged by any FantasyHoopsEdge server at any point. FantasyHoopsEdge has zero server-side access to these credentials. The sessionStorage is cleared automatically when you close the browser tab or window. If you wish to revoke access before closing your browser, clear your browser&apos;s sessionStorage manually or close the relevant tab.
          </p>
        </section>

        {/* 5. Data Storage and Security */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>5.</span> Data Storage and Security</h2>
          <p style={S.p}>
            FantasyHoopsEdge uses Vercel for hosting and Supabase for authentication and database services. Both providers operate infrastructure based in the United States. By using this platform, you acknowledge that your data may be processed and stored in the United States.
          </p>
          <p style={S.pLast}>
            We apply industry-standard security measures appropriate to the nature of the data we hold. No method of transmission over the internet or electronic storage is completely secure. We cannot guarantee absolute security of your information.
          </p>
        </section>

        {/* 6. Cookies */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>6.</span> Cookies</h2>
          <p style={S.p}>
            FantasyHoopsEdge uses session cookies and Supabase authentication tokens to manage your login state and platform session. We do not use advertising cookies, tracking pixels, retargeting technologies, or any form of behavioural profiling.
          </p>
          <p style={S.pLast}>
            Most browsers allow you to refuse or delete cookies through their settings. Doing so may affect the functionality of certain platform features, including account authentication.
          </p>
        </section>

        {/* 7. Third-Party Services */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>7.</span> Third-Party Services</h2>
          <p style={S.p}>
            FantasyHoopsEdge relies on the following third-party services, each operating under its own privacy policy:
          </p>
          <ul style={{ ...S.ul, marginBottom: '16px' }}>
            <li style={S.li}>Supabase — authentication and database infrastructure (US-based)</li>
            <li style={S.li}>Vercel — hosting and server infrastructure (US-based)</li>
            <li style={S.li}>SendGrid — transactional email delivery; receives your email address for delivery purposes only; no other personal information is shared</li>
          </ul>
          <p style={S.p}>
            The following services are used for platform operations and receive no user personal information:
          </p>
          <ul style={{ ...S.ul, marginBottom: '16px' }}>
            <li style={S.li}>Basketball Monster — source of statistical projection data, accessed via paid subscriber API. API access is documented and authorised. No user personal information is shared with Basketball Monster.</li>
            <li style={S.li}>HCTI / htmlcsstoimage.com — image generation for projection cards</li>
          </ul>
          <p style={S.p}>
            The FHE Consensus Rankings incorporate dynasty rankings from Hashtag Basketball, Dynatyze, Angle Fantasy Basketball, Moneyballers, and Dizzle Dynasty, each of whom has provided prior written consent to this use. No user personal information is shared with any of these sources.
          </p>
          <p style={S.pLast}>
            Whop is a subscription payment platform we intend to use if and when a paid tier is introduced. It is not currently active. See Section 8 for details.
          </p>
        </section>

        {/* 8. Future Payment Processing */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>8.</span> Future Payment Processing</h2>
          <p style={S.pLast}>
            FantasyHoopsEdge does not currently offer paid subscriptions and does not collect any payment information. If a paid subscription tier is introduced, all payment processing will be handled entirely by Whop. FantasyHoopsEdge will never receive, store, or have access to your payment card details or financial data. Whop operates under its own privacy policy, which users will be directed to review before any subscription is activated.
          </p>
        </section>

        {/* 9. Your Privacy Rights */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>9.</span> Your Privacy Rights</h2>
          <p style={S.p}>
            All users may request access to, correction of, or deletion of any personal information we hold about you by contacting us at the address in Section 12. We will respond to all requests within a reasonable timeframe.
          </p>
          <p style={S.p}>
            EU and UK users have additional rights under applicable data protection law, including the right to access your personal data, the right to erasure, the right to data portability, the right to rectification, the right to restrict processing, and the right to object to processing. You also have the right to lodge a complaint with the data protection supervisory authority in your jurisdiction.
          </p>
          <p style={S.p}>
            California users have the right to know what personal information is collected about you, the right to request deletion of your personal information, and the right to opt out of the sale of your personal information. FantasyHoopsEdge does not sell personal data.
          </p>
          <p style={S.pLast}>
            To exercise any of these rights, contact us using the details in Section 12.
          </p>
        </section>

        {/* 10. Children's Privacy */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>10.</span> Children&apos;s Privacy</h2>
          <p style={S.pLast}>
            FantasyHoopsEdge is not directed at persons under 18 years of age. We do not knowingly collect personal information from anyone under 18. If we become aware that we have inadvertently collected data from a minor, we will delete that information promptly. If you believe a minor has provided us with personal information, please contact us immediately.
          </p>
        </section>

        {/* 11. Changes to This Policy */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>11.</span> Changes to This Policy</h2>
          <p style={S.pLast}>
            We may update this Privacy Policy from time to time. Where changes are material, we will post notice on the website. Where practicable, we will provide at least 30 days&apos; notice before material changes take effect. Continued use of the platform after changes become effective constitutes your acceptance of the revised policy.
          </p>
        </section>

        {/* 12. Contact */}
        <section style={S.sectionLast}>
          <h2 style={S.h2}><span style={S.num}>12.</span> Contact</h2>
          <p style={S.p}>For privacy-related queries, requests, or complaints:</p>
          <p style={S.p}>fantasybballai@gmail.com</p>
          <p style={S.pLast}>Last updated: 15 June 2026</p>
        </section>

      </div>
    </main>
  )
}
