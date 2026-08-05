// Scoped styles for the player-identity review panel (pid- prefix), reusing the
// global theme variables from globals.css — same approach as the Prediction
// Arena review panel's adm- styles.
export const panelStyles = `
.pid-main { min-height: 100vh; background: var(--bg-body); color: var(--text-primary); }
/* padding-left offsets the fixed-position left sidebar (PlatformSidebarNav
   desktop rail, 236px) — same convention as .rb-shell / .dyb-shell and
   .dr-rankings-shell in globals.css. Reverts under the sidebar's own 1023px
   breakpoint, where it falls back to the top SiteNav instead and 80px of top
   padding clears it. */
.pid-wrap { max-width: 1180px; padding: 48px 32px 96px; padding-left: 268px; }
@media (max-width: 1023px) {
  .pid-wrap { padding-left: 32px; padding-top: 80px; }
}
.pid-eyebrow { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; color: var(--hero-badge-text); background: var(--hero-badge-bg); border: 1px solid var(--hero-badge-border); border-radius: 999px; padding: 5px 14px; margin-bottom: 16px; }
.pid-h1 { font-size: clamp(1.7rem, 4vw, 2.4rem); font-weight: 800; line-height: 1.1; margin: 0 0 10px; }
.pid-lede { color: var(--text-secondary); font-size: 1rem; line-height: 1.6; max-width: 720px; margin: 0 0 12px; }
.pid-note { color: var(--text-muted); font-size: 0.86rem; line-height: 1.6; max-width: 720px; margin: 0 0 36px; }
.pid-note code, .pid-lede code { background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 5px; padding: 1px 5px; font-size: 0.85em; }

.pid-h2 { font-size: 1.15rem; font-weight: 700; margin: 44px 0 6px; display: flex; align-items: center; gap: 10px; }
.pid-h2-sub { display: block; color: var(--text-muted); font-size: 0.86rem; font-weight: 400; line-height: 1.55; margin: 0 0 16px; max-width: 760px; }

/* status pill on a section heading */
.pid-status { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.1em; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
.pid-ok { background: rgba(22, 163, 74, 0.14); color: #16a34a; }
.pid-warn { background: rgba(255, 107, 43, 0.14); color: var(--edge-orange); }
.pid-info { background: rgba(37, 99, 235, 0.12); color: var(--blueprint); }

/* summary tiles */
.pid-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 12px; margin-bottom: 8px; }
.pid-tile { background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 12px; padding: 14px 16px; }
.pid-tile-n { font-size: 1.5rem; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
.pid-tile-l { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); margin-top: 4px; }
.pid-tile-s { font-size: 0.76rem; color: var(--text-secondary); margin-top: 6px; line-height: 1.45; }

/* tables */
.pid-scroll { overflow-x: auto; border: 1px solid var(--border-main); border-radius: 12px; background: var(--bg-card); }
.pid-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; min-width: 560px; }
.pid-table th { text-align: left; font-size: 0.64rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); padding: 11px 14px; border-bottom: 1px solid var(--border-main); white-space: nowrap; }
.pid-table td { padding: 11px 14px; border-bottom: 1px solid var(--border-main); vertical-align: top; line-height: 1.5; }
.pid-table tr:last-child td { border-bottom: none; }
.pid-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; font-size: 0.84em; }
.pid-name { font-weight: 600; white-space: nowrap; }
.pid-muted { color: var(--text-muted); }
.pid-bad { color: var(--edge-orange); font-weight: 600; }
.pid-good { color: #16a34a; font-weight: 600; }

/* a reason group chip in the queue table */
.pid-reason { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em; border-radius: 5px; padding: 3px 7px; background: rgba(255, 107, 43, 0.12); color: var(--edge-orange); white-space: nowrap; }

.pid-empty { background: var(--bg-card); border: 1px dashed var(--border-main); border-radius: 12px; padding: 28px; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

/* the "what to do" callout under a section */
.pid-do { border-left: 3px solid var(--edge-orange); background: var(--bg-card); border-radius: 0 10px 10px 0; padding: 12px 16px; margin-top: 14px; font-size: 0.86rem; line-height: 1.6; color: var(--text-secondary); }
.pid-do strong { color: var(--text-primary); }
.pid-do code { background: var(--bg-body); border: 1px solid var(--border-main); border-radius: 5px; padding: 1px 5px; font-size: 0.9em; }
`;
