// Scoped styles for the Prediction Arena (pa- prefix), shared by the arena
// page and its subroutes. Built on the rt- design system tokens from
// globals.css (Geist font, single Edge Orange accent, pill/24px shape
// language) so this page matches the rest of the rebranded site.
export const paStyles = `
.pa-wrap { max-width: 1100px; margin: 0 auto; padding: 56px 24px 96px; text-align: center; font-family: var(--rt-font-sans); }
.pa-eyebrow { display: inline-block; font-family: var(--rt-font-sans); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--rt-primary); background: var(--rt-surface-strong); border-radius: 999px; padding: 5px 14px; margin-bottom: 18px; }
.pa-h1 { font-family: var(--rt-font-sans); font-weight: 400; letter-spacing: -1px; font-size: clamp(2rem, 5vw, 3rem); line-height: 1.1; margin: 0 0 16px; color: var(--rt-ink); }
.pa-lede { color: var(--rt-body); font-size: 1.05rem; line-height: 1.6; max-width: 640px; margin: 0 auto 48px; }

/* ── Game stack (two stacked full-width cards) ─────────────────────────────── */
.pa-game-stack { display: flex; flex-direction: column; gap: 16px; text-align: left; margin-bottom: 48px; }

/* Base game tile */
.pa-game-tile { display: block; text-decoration: none; border-radius: 24px; border: 1px solid var(--rt-hairline); background: var(--rt-canvas); transition: transform 0.15s ease, box-shadow 0.15s ease; }
.pa-game-tile--live { background: linear-gradient(135deg, rgba(240,165,0,0.10) 0%, var(--rt-canvas) 60%); border-color: #f0a500; border-width: 2px; }
.pa-game-tile--live:hover { transform: translateY(-3px); box-shadow: 0 8px 36px rgba(240,165,0,0.16); }
.pa-game-tile--soon { opacity: 0.6; cursor: default; }
.pa-game-tile--resolved { border-color: var(--rt-hairline); }
.pa-game-tile--resolved:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.1); }
.pa-game-tile-cta--resolved { background: var(--rt-surface-strong); color: var(--rt-ink); letter-spacing: 0.04em; }

.pa-game-tile-inner { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 26px 30px; flex-wrap: wrap; }
.pa-game-tile-body { flex: 1; min-width: 0; }
.pa-game-tile-title { font-family: var(--rt-font-sans); font-weight: 600; font-size: 1.4rem; margin: 10px 0 6px; color: var(--rt-ink); }
.pa-game-tile-blurb { color: var(--rt-body); font-size: 0.95rem; line-height: 1.55; margin: 0; max-width: 580px; }

.pa-game-tile-cta { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: var(--rt-primary); color: var(--rt-on-primary); font-family: var(--rt-font-sans); font-weight: 600; font-size: 14px; padding: 14px 26px; border-radius: 100px; white-space: nowrap; }
.pa-game-tile-cta--locked { background: var(--rt-surface-strong); color: var(--rt-muted); letter-spacing: 0.04em; font-size: 13px; }

/* Chips */
.pa-chip { display: inline-block; font-family: var(--rt-font-sans); font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; border-radius: 999px; padding: 4px 10px; }
.pa-chip--gold { background: rgba(240,165,0,0.14); color: #b5790a; }
.pa-chip--muted { background: var(--rt-surface-strong); color: var(--rt-muted); }

/* ── Mobile ── */
@media (max-width: 680px) {
  .pa-wrap { padding: 44px 16px 64px; }
  .pa-h1 { font-size: clamp(1.7rem, 8vw, 2.4rem); }
  .pa-lede { font-size: 0.98rem; margin-bottom: 32px; }
  .pa-game-stack { gap: 12px; margin-bottom: 36px; }
  .pa-game-tile-inner { padding: 20px 18px; gap: 14px; flex-direction: column; align-items: flex-start; }
  .pa-game-tile-title { font-size: 1.2rem; margin: 8px 0 4px; }
  .pa-game-tile-blurb { font-size: 0.88rem; }
  .pa-game-tile-cta { width: 100%; text-align: center; padding: 13px; font-size: 13px; }
  .pa-google-btn { width: 100%; max-width: 340px; justify-content: center; }
  .pa-welcome { padding: 16px 18px; flex-direction: column; align-items: flex-start; gap: 16px; }
  .pa-stats { width: 100%; justify-content: space-between; }
  .pa-stat { align-items: flex-start; }
}

.pa-cta-zone { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.pa-google-btn { display: inline-flex; align-items: center; gap: 12px; background: #ffffff; color: #1f1f1f; font-family: var(--rt-font-sans); font-size: 1rem; font-weight: 600; border: 1px solid var(--rt-hairline); border-radius: 100px; padding: 14px 28px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.08); transition: transform 0.12s ease, box-shadow 0.12s ease; }
.pa-google-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
.pa-cta-note { color: var(--rt-muted); font-size: 0.82rem; margin: 0; }
.pa-error { color: var(--rt-down); font-size: 0.85rem; margin: 0; }
.pa-message { color: var(--rt-primary); font-size: 0.85rem; margin: 0; text-align: center; }

.pa-form { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 340px; }
.pa-input { width: 100%; background: var(--rt-canvas); color: var(--rt-ink); border: 1px solid var(--rt-hairline); border-radius: 12px; padding: 12px 14px; font-size: 0.95rem; font-family: var(--rt-font-sans); }
.pa-input:focus { outline: none; border-color: var(--rt-primary); border-width: 2px; padding: 11px 13px; }
.pa-submit { width: 100%; background: var(--rt-primary); color: var(--rt-on-primary); font-family: var(--rt-font-sans); font-size: 0.98rem; font-weight: 600; border: none; border-radius: 100px; padding: 13px; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease; }
.pa-submit:hover:not(:disabled) { transform: translateY(-2px); }
.pa-submit:disabled { opacity: 0.5; cursor: progress; }
.pa-toggle { font-size: 0.85rem; color: var(--rt-muted); margin: 2px 0 0; text-align: center; }
.pa-link { background: none; border: none; color: var(--rt-primary); font-weight: 600; cursor: pointer; font-size: 0.85rem; padding: 0; }
.pa-divider { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 340px; color: var(--rt-muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
.pa-divider::before, .pa-divider::after { content: ""; flex: 1; height: 1px; background: var(--rt-hairline); }

.pa-welcome { display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; text-align: left; background: var(--rt-canvas); border: 1px solid var(--rt-hairline); border-radius: 24px; padding: 24px 28px; margin-bottom: 28px; }
.pa-welcome-id { display: flex; align-items: center; gap: 16px; }
.pa-avatar { width: 52px; height: 52px; border-radius: 50%; border: 2px solid var(--rt-hairline); object-fit: cover; }
.pa-avatar-fallback { display: flex; align-items: center; justify-content: center; background: var(--rt-surface-strong); color: var(--rt-ink); font-weight: 600; font-size: 1.3rem; }
.pa-stats { display: flex; align-items: center; gap: 28px; }
.pa-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.pa-stat-value { font-family: var(--rt-font-mono); font-size: 1.4rem; font-weight: 500; line-height: 1; }
.pa-stat-label { font-family: var(--rt-font-sans); font-size: 0.62rem; font-weight: 600; letter-spacing: 0.08em; color: var(--rt-muted); }
.pa-signout { background: none; border: 1px solid var(--rt-hairline); color: var(--rt-body); border-radius: 100px; padding: 8px 14px; font-family: var(--rt-font-sans); font-size: 0.8rem; cursor: pointer; }
.pa-signout:hover { color: var(--rt-ink); border-color: var(--rt-muted); }

.pa-placeholder { background: var(--rt-surface-soft); border: 1px dashed var(--rt-hairline); border-radius: 24px; padding: 56px 24px; }

.pa-feed { display: flex; flex-direction: column; gap: 16px; text-align: left; }

/* Prediction card (individual game inside the signed-in feed) */
.pa-card { text-align: left; border-radius: 24px; border: 1px solid var(--rt-hairline); background: var(--rt-canvas); padding: 24px 26px; }
.pa-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.pa-card-title { font-family: var(--rt-font-sans); font-weight: 600; font-size: 1.1rem; margin: 10px 0 4px; color: var(--rt-ink); }
.pa-card-blurb { color: var(--rt-body); font-size: 0.9rem; line-height: 1.5; margin: 0 0 4px; }
.pa-reward-detail { color: var(--rt-muted); font-size: 0.82rem; margin: 4px 0 0; }
.pa-game-card:hover { transform: none; }
.pa-deadline { font-family: var(--rt-font-sans); font-size: 0.78rem; font-weight: 600; }
.pa-options { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 16px; }
.pa-option-btn { background: var(--rt-surface-strong); border: 1px solid transparent; color: var(--rt-body); border-radius: 100px; padding: 10px 18px; font-family: var(--rt-font-sans); font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: border-color 0.12s ease, color 0.12s ease; }
.pa-option-btn:hover:not(:disabled) { border-color: var(--rt-primary); color: var(--rt-ink); }
.pa-option-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pa-option-active { border-color: var(--rt-primary); color: var(--rt-primary); background: var(--rt-surface-strong); }
.pa-ranking { list-style: none; margin: 4px 0 16px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pa-rank-row { display: flex; align-items: center; gap: 12px; background: var(--rt-surface-strong); border-radius: 12px; padding: 8px 12px; }
.pa-rank-num { width: 22px; height: 22px; border-radius: 50%; background: var(--rt-primary); color: var(--rt-on-primary); font-family: var(--rt-font-mono); font-size: 0.72rem; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pa-rank-name { flex: 1; font-size: 0.9rem; color: var(--rt-ink); }
.pa-rank-controls { display: flex; gap: 6px; }
.pa-rank-controls button { background: none; border: 1px solid var(--rt-hairline); color: var(--rt-body); border-radius: 999px; padding: 2px 8px; font-size: 0.7rem; cursor: pointer; }
.pa-rank-controls button:disabled { opacity: 0.3; cursor: not-allowed; }
.pa-submit-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.pa-submit-btn { background: var(--rt-primary); color: var(--rt-on-primary); border: none; border-radius: 100px; padding: 11px 24px; font-family: var(--rt-font-sans); font-size: 0.92rem; font-weight: 600; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease; }
.pa-submit-btn:hover:not(:disabled) { transform: translateY(-1px); }
.pa-submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pa-submitted { border-top: 1px solid var(--rt-hairline); padding-top: 14px; }
.pa-submitted-echo { font-size: 0.95rem; font-weight: 600; color: var(--rt-ink); margin: 10px 0 4px; }

.pa-skel { background: linear-gradient(90deg, var(--rt-surface-soft) 25%, var(--rt-surface-strong) 50%, var(--rt-surface-soft) 75%); background-size: 200% 100%; animation: pa-shimmer 1.4s ease-in-out infinite; border-radius: 8px; }
.pa-skel-badge { width: 180px; height: 26px; margin: 0 auto 20px; border-radius: 999px; }
.pa-skel-title { width: min(420px, 80%); height: 44px; margin: 0 auto 14px; }
.pa-skel-sub { width: min(560px, 90%); height: 18px; margin: 0 auto 48px; }
.pa-skel-chip { width: 110px; height: 22px; margin-bottom: 16px; border-radius: 999px; }
.pa-skel-line-lg { width: 60%; height: 24px; margin-bottom: 12px; }
.pa-skel-line { width: 100%; height: 13px; margin-bottom: 9px; }
.pa-skel-pill { width: 45%; height: 18px; margin-top: 16px; }
@keyframes pa-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;
