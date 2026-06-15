import { notFound } from 'next/navigation';
import { getAllProspectSlugs, getProspectBySlug } from '@/lib/prospects';
import { generateProspectSchema } from '@/lib/schemas';
import { SiteNav } from '@/components/site-nav';
import ProspectHeadshot from './_components/ProspectHeadshot';

export async function generateStaticParams() {
  return getAllProspectSlugs();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prospect = getProspectBySlug(slug);
  if (!prospect) return {};
  return {
    title: `${prospect.name} Dynasty Fantasy Basketball | FHE 2026 Rookie Board`,
    description: `${prospect.name} ranked #${prospect.pickNumber} on the FHE 2026 Dynasty Rookie Board. ${prospect.pos} from ${prospect.school}. Full 9-category dynasty analysis.`,
    openGraph: {
      title: `${prospect.name} | FHE Dynasty Board #${prospect.pickNumber}`,
      description: prospect.dynastyVerdict.slice(0, 155),
      url: `https://fantasyhoopsedge.com/prospects/${prospect.slug}`,
      siteName: 'FantasyHoopsEdge',
      type: 'profile',
    },
    alternates: {
      canonical: `https://fantasyhoopsedge.com/prospects/${prospect.slug}`,
    },
  };
}

function starStyle(value: number): { color: string; fontWeight: number } {
  if (value === 5) return { color: 'var(--green-elite)', fontWeight: 700 };
  if (value === 4) return { color: '#15803d', fontWeight: 400 };
  if (value === 3) return { color: 'var(--dynasty-gold)', fontWeight: 400 };
  if (value === 2) return { color: 'var(--text-muted)', fontWeight: 400 };
  return { color: 'var(--red-severe)', fontWeight: 700 };
}

function pickTierColor(n: number): string {
  if (n === 1) return 'var(--dynasty-gold)';
  if (n <= 4) return 'var(--green-elite)';
  if (n <= 8) return 'var(--blueprint-glow)';
  if (n <= 15) return '#9b5de5';
  if (n <= 20) return 'var(--edge-orange)';
  if (n <= 30) return '#f72585';
  if (n <= 38) return '#00c8e0';
  return '#64748b';
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "'Oswald', sans-serif", fontSize: 11,
      letterSpacing: 3, textTransform: 'uppercase' as const,
      color: 'var(--edge-orange)', marginBottom: 16,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border-main)' }} />
      {children}
      <div style={{ flex: 1, height: 1, background: 'var(--border-main)' }} />
    </div>
  );
}

export default async function ProspectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const prospect = getProspectBySlug(slug);
  if (!prospect) notFound();

  const schema = generateProspectSchema(prospect, 'https://fantasyhoopsedge.com');
  const tierColor = pickTierColor(prospect.pickNumber);

  const categories = [
    { key: 'pts', label: 'PTS', value: prospect.starPts },
    { key: 'reb', label: 'REB', value: prospect.starReb },
    { key: 'ast', label: 'AST', value: prospect.starAst },
    { key: 'stl', label: 'STL', value: prospect.starStl },
    { key: 'blk', label: 'BLK', value: prospect.starBlk },
    { key: 'fg',  label: 'FG%', value: prospect.starFg  },
    { key: 'ft',  label: 'FT%', value: prospect.starFt  },
    { key: 'tpm', label: '3PM', value: prospect.star3pm  },
    { key: 'to',  label: 'TO',  value: prospect.starTo   },
  ];

  const statCells = [
    prospect.ppg   !== null ? { label: 'PPG', value: String(prospect.ppg)   } : null,
    prospect.rpg   !== null ? { label: 'RPG', value: String(prospect.rpg)   } : null,
    prospect.apg   !== null ? { label: 'APG', value: String(prospect.apg)   } : null,
    prospect.fgPct !== null ? { label: 'FG%', value: `${prospect.fgPct}%`   } : null,
  ].filter((x): x is { label: string; value: string } => x !== null);

  return (
    <div className="draft-board-shell">
      <SiteNav active="draft" />

      {/* JSON-LD — invisible to users, crawled by Google */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <div style={{ paddingTop: 64 }}>

        {/* ── HERO ─────────────────────────────────────────── */}
        <div style={{
          background: 'var(--blueprint)', position: 'relative',
          overflow: 'hidden', padding: '36px 60px 32px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          {/* Background watermark */}
          <div aria-hidden style={{
            position: 'absolute', right: -10, top: -16,
            fontFamily: "'Oswald', sans-serif", fontSize: 130,
            fontWeight: 800, color: 'rgba(255,255,255,0.04)',
            userSelect: 'none', letterSpacing: 8, pointerEvents: 'none',
          }}>ROOKIE</div>

          <div style={{ maxWidth: 860, margin: '0 auto', position: 'relative' }}>
            {/* Breadcrumb */}
            <div style={{
              fontFamily: "'Oswald', sans-serif", fontSize: 10,
              letterSpacing: 3, textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.4)', marginBottom: 20,
            }}>
              <a href="/draft-board" style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none' }}>
                2026 Dynasty Rookie Board
              </a>
              {' · Pick '}{prospect.dynastyPick}
            </div>

            {/* Player identity row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              {/* Rank number */}
              <div style={{
                fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                fontSize: 56, lineHeight: 1, color: tierColor,
                minWidth: 60, textAlign: 'center', flexShrink: 0,
              }}>
                {prospect.pickNumber}
              </div>

              <ProspectHeadshot name={prospect.name} size={72} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{
                  fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                  fontSize: 32, textTransform: 'uppercase',
                  letterSpacing: 0.5, color: 'white', lineHeight: 1.1,
                  marginBottom: 10, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {prospect.name}
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                    fontSize: 11, letterSpacing: 1, color: 'white',
                    background: 'rgba(255,255,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.25)',
                    padding: '3px 10px', borderRadius: 4,
                  }}>
                    {prospect.pos}
                  </span>
                  <span style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: 12,
                    letterSpacing: 2, textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.65)',
                  }}>
                    {prospect.school}
                  </span>
                  {prospect.age !== null && (
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10, color: 'rgba(255,255,255,0.35)',
                    }}>
                      Age {prospect.age}
                    </span>
                  )}
                </div>
              </div>

              {/* Pick badge */}
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                fontWeight: 700, color: tierColor,
                border: `1px solid ${tierColor}`,
                padding: '6px 14px', borderRadius: 6,
                letterSpacing: 0.5, flexShrink: 0,
                background: `color-mix(in srgb, ${tierColor} 10%, transparent)`,
              }}>
                #{prospect.pickNumber} OVERALL
              </div>
            </div>
          </div>
        </div>

        {/* ── MAIN CONTENT ─────────────────────────────────── */}
        <div
          className="db-board-wrap"
          style={{ padding: '40px 60px 80px', maxWidth: 860, width: '100%', margin: '0 auto' }}
        >

          {/* Season Stats */}
          {statCells.length > 0 && (
            <>
              <SectionLabel>Season Stats</SectionLabel>
              <div className="db-expanded-panel" style={{ marginBottom: 36 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${statCells.length}, 1fr)`,
                  gap: 16,
                }}>
                  {statCells.map(({ label, value }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <div style={{
                        fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                        fontSize: 28, color: 'var(--edge-orange)', marginBottom: 6,
                      }}>
                        {value}
                      </div>
                      <div style={{
                        fontFamily: "'Oswald', sans-serif", fontSize: 11,
                        letterSpacing: 2, textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}>
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 9-Category Ratings */}
          <SectionLabel>Category Ratings</SectionLabel>
          <div className="db-expanded-panel" style={{ marginBottom: 36 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 8 }}>
              {categories.map(({ key, label, value }) => {
                const style = starStyle(value);
                return (
                  <div key={key} style={{ textAlign: 'center' }}>
                    <div style={{
                      fontFamily: "'Oswald', sans-serif", fontSize: 12,
                      fontWeight: 600, letterSpacing: 1,
                      color: 'var(--text-muted)', marginBottom: 6,
                    }}>
                      {label}
                    </div>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13, ...style,
                    }}>
                      {value}★
                    </div>
                    <div style={{
                      height: 3, borderRadius: 2,
                      background: style.color,
                      marginTop: 6, opacity: 0.6,
                    }} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dynasty Verdict */}
          <SectionLabel>Dynasty Verdict</SectionLabel>
          <div className="db-expanded-panel" style={{ marginBottom: 36 }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {prospect.dynastyVerdict}
            </p>
          </div>

          {/* Back link */}
          <a href="/draft-board" style={{
            fontFamily: "'Oswald', sans-serif", fontSize: 12,
            letterSpacing: 2, textTransform: 'uppercase',
            color: 'var(--blueprint-glow)', textDecoration: 'none',
            fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            ← Back to 2026 Dynasty Rookie Board
          </a>
        </div>
      </div>

    </div>
  );
}
