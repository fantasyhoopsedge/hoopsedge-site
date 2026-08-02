import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Terms and Conditions | FantasyHoopsEdge',
    description: 'Terms governing use of fantasyhoopsedge.com and FantasyHoopsEdge services.',
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
    marginBottom: '20px',
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

export default function TermsPage() {
  return (
    <main style={S.page}>
      <div style={S.container}>

        {/* Header block */}
        <div style={S.headerBlock}>
          <h1 style={S.h1}>Terms and Conditions</h1>
          <p style={S.subtitle}>Last updated: 15 June 2026</p>
          <p style={S.summary}>
            These Terms and Conditions govern your use of fantasyhoopsedge.com and the services operated by FantasyHoopsEdge.
          </p>
        </div>

        {/* 1. Agreement to These Terms */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>1.</span> Agreement to These Terms</h2>
          <p style={S.p}>
            By accessing or using fantasyhoopsedge.com, you confirm that you have read, understood, and agree to be bound by these Terms and Conditions. If you do not agree, do not use the platform.
          </p>
          <p style={S.pLast}>
            You must be 18 years of age or older to register for any account or feature on this platform. No exceptions. By registering, you confirm that you meet this age requirement.
          </p>
        </section>

        {/* 2. About FantasyHoopsEdge */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>2.</span> About FantasyHoopsEdge</h2>
          <p style={S.p}>
            FantasyHoopsEdge is an independently operated fantasy basketball analytics platform providing dynasty rankings, player projections, prospect analysis, and related content. All content is provided for informational and entertainment purposes only.
          </p>
          <p style={S.pLast}>
            Nothing on this platform constitutes financial advice, sports betting advice, gambling guidance, or a guarantee of any fantasy sports outcome. FantasyHoopsEdge does not recommend or endorse any specific fantasy sports decision, trade, or wager.
          </p>
        </section>

        {/* 3. Predictions Arena and Edge Points */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>3.</span> Predictions Arena and Edge Points</h2>
          <p style={S.p}>
            The Predictions Arena is a free-to-play, skill-based prediction game. Participation is entirely free of charge.
          </p>
          <p style={S.p}>
            The following terms govern Edge Points and the Predictions Arena without exception:
          </p>
          <ul style={{ ...S.ul, marginBottom: '16px' }}>
            <li style={S.li}>Edge Points have no monetary value whatsoever.</li>
            <li style={S.li}>Edge Points cannot be redeemed for cash or any cash equivalent, converted into any currency (digital or otherwise), exchanged for goods or services, sold to any third party, or transferred to any other person or account.</li>
            <li style={S.li}>Accumulating Edge Points creates no legal entitlement to any monetary reward, material reward, prize, or benefit of any kind.</li>
            <li style={S.li}>The Predictions Arena does not constitute a prize pool, lottery, sweepstake, raffle, or any form of gambling or wagering.</li>
            <li style={S.li}>FantasyHoopsEdge does not operate, host, or facilitate any form of prize competition or gambling activity.</li>
            <li style={S.li}>The Predictions Arena and Edge Points are provided solely for entertainment purposes.</li>
          </ul>
          <p style={S.pLast}>
            Any interpretation of Edge Points or Predictions Arena participation as conferring monetary value or a right to financial reward is expressly excluded.
          </p>
        </section>

        {/* 4. Accuracy of Information */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>4.</span> Accuracy of Information</h2>
          <p style={S.p}>
            Statistics, rankings, projections, and analytical content on this platform are sourced from third parties including Basketball Monster (via paid subscriber API, with documented authorisation) and Fantrax, and are compiled and presented by FantasyHoopsEdge for informational and entertainment purposes only.
          </p>
          <p style={S.pLast}>
            FantasyHoopsEdge makes no warranty, express or implied, as to the accuracy, completeness, timeliness, or fitness for any particular purpose of any content on this platform. Data may contain errors or become outdated. Users should not make fantasy sports decisions — including but not limited to trades, waiver claims, draft selections, or lineup choices — based solely on content published on fantasyhoopsedge.com.
          </p>
        </section>

        {/* 5. Intellectual Property and Anti-Scraping */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>5.</span> Intellectual Property and Anti-Scraping</h2>

          <div style={S.subsection}>
            <p style={S.subsectionLabel}>(a) Ownership and Expert Rankings</p>
            <p style={S.p}>
              All content on fantasyhoopsedge.com — including dynasty rankings, prospect cards, projections, analysis, written content, platform design, and branding — is owned by or licensed to FantasyHoopsEdge. All rights are reserved.
            </p>
            <p style={S.p}>
              You are permitted to access and use this content for personal, non-commercial purposes only. Reproduction, redistribution, republication, or any commercial use of FHE content — in whole or in part — without prior written permission from FantasyHoopsEdge is strictly prohibited.
            </p>
            <p style={{ ...S.pLast }}>
              The FHE Consensus Rankings incorporate individual dynasty rankings published by FBI-HE, Dynatyze, Angle Fantasy Basketball, Moneyballers, and Dizzle Dynasty. Each of these experts has provided prior written consent to the inclusion of their rankings in the FHE consensus methodology. Their rankings remain the intellectual property of their respective creators. FantasyHoopsEdge does not claim ownership of any individual expert&apos;s rankings. Reproduction or redistribution of any individual expert&apos;s rankings from this platform without that expert&apos;s own permission is prohibited.
            </p>
          </div>

          <div style={S.subsectionLast}>
            <p style={S.subsectionLabel}>(b) Anti-Scraping</p>
            <p style={S.p}>
              Automated data extraction, web scraping, spidering, crawling, or any systematic or programmatic downloading of content from fantasyhoopsedge.com is strictly prohibited. This prohibition applies regardless of the method used, the purpose stated, or whether the content scraped is otherwise publicly viewable.
            </p>
            <p style={{ ...S.pLast }}>
              Because the proprietary value of dynasty rankings, analytical data, and related content is inherently difficult to quantify in damages, you agree that any breach of this clause will give rise to liquidated damages of $5,000 AUD per individual occurrence, and that this amount represents a genuine pre-estimate of loss and not a penalty. FantasyHoopsEdge reserves the right to immediately terminate your access to the platform upon detection of any scraping or automated extraction activity, without prior notice.
            </p>
          </div>
        </section>

        {/* 6. User Conduct */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>6.</span> User Conduct</h2>
          <p style={S.p}>You agree not to:</p>
          <ul style={S.ul}>
            <li style={S.li}>Use this platform for any unlawful purpose or in violation of any applicable law or regulation</li>
            <li style={S.li}>Share login credentials with any other person</li>
            <li style={S.li}>Circumvent, disable, or interfere with any authentication, access control, or security feature of the platform</li>
            <li style={S.li}>Reproduce, resell, or commercially exploit any FHE content, data, rankings, or analysis without written permission</li>
            <li style={S.li}>Engage in any conduct that disrupts or impairs the platform&apos;s operation or the experience of other users</li>
          </ul>
        </section>

        {/* 7. Third-Party Services */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>7.</span> Third-Party Services</h2>
          <p style={S.pLast}>
            FantasyHoopsEdge integrates with the Fantrax platform and references statistical data provided by Basketball Monster via paid subscriber API with documented authorisation. FantasyHoopsEdge is not responsible for the availability, accuracy, reliability, or privacy practices of any third-party platform or data provider. Third-party services may be subject to outages, changes, or discontinuation without notice. You should review the terms and privacy policies of any third-party platform independently before using it.
          </p>
        </section>

        {/* 8. Future Paid Subscriptions */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>8.</span> Future Paid Subscriptions</h2>
          <p style={S.p}>
            FantasyHoopsEdge does not currently offer any paid subscription or paid feature. No charge of any kind is currently made to users.
          </p>
          <p style={S.p}>
            If and when a paid subscription tier is introduced, the following terms will apply:
          </p>
          <ul style={{ ...S.ul, marginBottom: '16px' }}>
            <li style={S.li}>The paid subscription will provide access to premium analytics content only. It does not and will not confer any right to prize pools, gambling products, or monetary rewards.</li>
            <li style={S.li}>All payments will be processed entirely by Whop. FantasyHoopsEdge will never directly handle, receive, store, or have access to your payment card data or financial information.</li>
            <li style={S.li}>A 3-day satisfaction refund will be available on a user&apos;s first subscription purchase. After 72 hours from the date of first purchase, subscriptions will be non-refundable except where a refund is required by Australian Consumer Law statutory guarantees.</li>
            <li style={S.li}>Subscriptions will renew automatically at the end of each billing period. To avoid renewal charges, you must cancel your subscription at least 24 hours before the renewal date.</li>
            <li style={S.li}>Full subscription terms, pricing, and billing details will be presented to you and will require your fresh, affirmative acceptance before any charge is made. No charge will be made without such consent.</li>
          </ul>
          <p style={S.pLast}>
            Nothing in these terms excludes, restricts, or modifies any right or remedy you may have under the Australian Consumer Law that cannot lawfully be excluded. Australian Consumer Law provides statutory guarantees for digital services, and those guarantees apply to this platform to the extent required by law.
          </p>
        </section>

        {/* 9. Disclaimer and Limitation of Liability */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>9.</span> Disclaimer and Limitation of Liability</h2>
          <p style={S.p}>
            To the maximum extent permitted by applicable Australian law, FantasyHoopsEdge and its operator expressly disclaim liability for:
          </p>
          <ul style={{ ...S.ul, marginBottom: '16px' }}>
            <li style={S.li}>Any inaccuracy, error, or omission in any data, statistic, ranking, projection, or analysis published on the platform</li>
            <li style={S.li}>Any decision made by a user in reliance on content published on fantasyhoopsedge.com</li>
            <li style={S.li}>Any fantasy sports losses, missed opportunities, or adverse outcomes connected to use of this platform</li>
            <li style={S.li}>Any outage, interruption, data loss, or failure of any third-party service, including Fantrax, Basketball Monster, Vercel, and Supabase</li>
          </ul>
          <p style={S.p}>
            Once a paid subscription tier is active, the total liability of FantasyHoopsEdge to any individual user for any claim arising under or in connection with these terms shall not exceed the total subscription fees paid by that user to FantasyHoopsEdge in the 12 months immediately preceding the claim.
          </p>
          <p style={S.pLast}>
            Nothing in these terms excludes or limits liability for death or personal injury caused by negligence, or any other liability that cannot lawfully be excluded or limited under Australian Consumer Law or any other applicable law.
          </p>
        </section>

        {/* 10. Marketing Communications */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>10.</span> Marketing Communications</h2>
          <p style={S.p}>
            If you register for an account or subscribe to a paid tier, you will receive transactional emails necessary to the operation of your account (including game confirmations, score notifications, and, when applicable, subscription receipts). These cannot be opted out of while your account is active.
          </p>
          <p style={S.p}>
            If you opt in to marketing communications at the time of registration or subsequently, you may receive product updates, analysis newsletters, and other non-transactional communications from FantasyHoopsEdge. We do not share your contact details with third-party marketers, and no affiliated individual or third-party brand will use your contact information for marketing purposes as a result of your registration with this platform.
          </p>
          <p style={S.pLast}>
            You may opt out of non-transactional marketing emails at any time by using the unsubscribe link included in every such email, or by contacting us at the address in Section 15.
          </p>
        </section>

        {/* 11. Force Majeure */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>11.</span> Force Majeure</h2>
          <p style={S.pLast}>
            Neither FantasyHoopsEdge nor you will be liable for any failure or delay in performing obligations under these terms where that failure or delay results from events beyond the reasonable control of the affected party, including natural disasters, acts of government, infrastructure or internet outages, or the failure of third-party services outside that party&apos;s control.
          </p>
        </section>

        {/* 12. Severability */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>12.</span> Severability</h2>
          <p style={S.pLast}>
            If any provision of these Terms and Conditions is found by a court of competent jurisdiction to be invalid, illegal, or unenforceable, that provision will be modified to the minimum extent necessary to make it enforceable, or severed if modification is not possible. All remaining provisions will continue in full force and effect.
          </p>
        </section>

        {/* 13. Changes to These Terms */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>13.</span> Changes to These Terms</h2>
          <p style={S.pLast}>
            FantasyHoopsEdge may update these Terms and Conditions at any time. When changes are made, the updated terms will be posted on the website with a revised effective date. Material changes will be notified on the platform. Continued use of fantasyhoopsedge.com after the effective date of any changes constitutes your acceptance of the revised terms. If you do not agree to revised terms, you should stop using the platform.
          </p>
        </section>

        {/* 14. Governing Law */}
        <section style={S.section}>
          <h2 style={S.h2}><span style={S.num}>14.</span> Governing Law</h2>
          <p style={S.pLast}>
            These terms are governed by and construed in accordance with the laws of New South Wales, Australia, without regard to conflict of law principles. You consent to the non-exclusive jurisdiction of the courts of New South Wales, Australia for the resolution of any dispute arising out of or in connection with these terms or your use of the platform.
          </p>
        </section>

        {/* 15. Contact */}
        <section style={S.sectionLast}>
          <h2 style={S.h2}><span style={S.num}>15.</span> Contact</h2>
          <p style={S.p}>For any queries relating to these Terms and Conditions:</p>
          <p style={S.p}>fantasybballai@gmail.com</p>
          <p style={S.pLast}>Last updated: 15 June 2026</p>
        </section>

      </div>
    </main>
  )
}
