// Scoped styles for the Prediction Arena (pa- prefix), shared by the arena
// page and its subroutes. Uses the global theme variables from globals.css.
export const paStyles = `
.pa-wrap { max-width: 1100px; margin: 0 auto; padding: 56px 24px 96px; text-align: center; }
.pa-eyebrow { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; color: var(--hero-badge-text); background: var(--hero-badge-bg); border: 1px solid var(--hero-badge-border); border-radius: 999px; padding: 5px 14px; margin-bottom: 18px; }
.pa-h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; line-height: 1.1; margin: 0 0 16px; }
.pa-lede { color: var(--text-secondary); font-size: 1.05rem; line-height: 1.6; max-width: 640px; margin: 0 auto 48px; }

.pa-tier-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; text-align: left; margin-bottom: 48px; }
@media (max-width: 820px) { .pa-tier-grid { grid-template-columns: 1fr; } }

.pa-card { background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 14px; padding: 24px; transition: transform 0.15s ease, background 0.15s ease; }
.pa-card:hover { transform: translateY(-3px); background: var(--bg-card-hover); }
.pa-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.pa-chip { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em; border-radius: 999px; padding: 4px 10px; }
.pa-icon { font-size: 1.3rem; }
.pa-card-title { font-size: 1.25rem; font-weight: 700; margin: 0 0 8px; color: var(--text-primary); }
.pa-card-blurb { color: var(--text-secondary); font-size: 0.92rem; line-height: 1.55; margin: 0 0 18px; }
.pa-reward { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--border-main); padding-top: 14px; }
.pa-reward-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em; color: var(--text-muted); }
.pa-reward-name { font-size: 1rem; font-weight: 700; }
.pa-reward-detail { font-size: 0.8rem; color: var(--text-muted); }

.pa-cta-zone { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.pa-google-btn { display: inline-flex; align-items: center; gap: 12px; background: #ffffff; color: #1f1f1f; font-size: 1rem; font-weight: 600; border: none; border-radius: 10px; padding: 14px 28px; cursor: pointer; box-shadow: 0 4px 24px rgba(37, 99, 235, 0.25); transition: transform 0.12s ease, box-shadow 0.12s ease; }
.pa-google-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 32px rgba(37, 99, 235, 0.4); }
.pa-cta-note { color: var(--text-muted); font-size: 0.82rem; margin: 0; }
.pa-error { color: var(--red-severe); font-size: 0.85rem; margin: 0; }
.pa-message { color: var(--blueprint); font-size: 0.85rem; margin: 0; text-align: center; }

.pa-form { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 340px; }
.pa-input { width: 100%; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-main); border-radius: 10px; padding: 12px 14px; font-size: 0.95rem; font-family: inherit; }
.pa-input:focus { outline: none; border-color: var(--edge-orange); }
.pa-submit { width: 100%; background: var(--edge-orange); color: #fff; font-size: 0.98rem; font-weight: 700; border: none; border-radius: 10px; padding: 13px; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease; }
.pa-submit:hover:not(:disabled) { transform: translateY(-2px); }
.pa-submit:disabled { opacity: 0.6; cursor: progress; }
.pa-toggle { font-size: 0.85rem; color: var(--text-muted); margin: 2px 0 0; text-align: center; }
.pa-link { background: none; border: none; color: var(--edge-orange); font-weight: 600; cursor: pointer; font-size: 0.85rem; padding: 0; }
.pa-divider { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 340px; color: var(--text-muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; }
.pa-divider::before, .pa-divider::after { content: ""; flex: 1; height: 1px; background: var(--border-main); }

.pa-welcome { display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; text-align: left; background: var(--bg-card); border: 1px solid var(--border-main); border-radius: 14px; padding: 24px 28px; margin-bottom: 28px; }
.pa-welcome-id { display: flex; align-items: center; gap: 16px; }
.pa-avatar { width: 52px; height: 52px; border-radius: 50%; border: 2px solid var(--border-main); object-fit: cover; }
.pa-avatar-fallback { display: flex; align-items: center; justify-content: center; background: var(--blueprint); color: #fff; font-weight: 700; font-size: 1.3rem; }
.pa-stats { display: flex; align-items: center; gap: 28px; }
.pa-stat { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.pa-stat-value { font-size: 1.4rem; font-weight: 800; line-height: 1; }
.pa-stat-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; color: var(--text-muted); }
.pa-signout { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 8px; padding: 8px 14px; font-size: 0.8rem; cursor: pointer; }
.pa-signout:hover { color: var(--text-primary); border-color: var(--text-muted); }

.pa-placeholder { background: var(--bg-surface); border: 1px dashed var(--border-main); border-radius: 14px; padding: 56px 24px; }

.pa-feed { display: flex; flex-direction: column; gap: 16px; text-align: left; }
.pa-game-card { text-align: left; }
.pa-game-card:hover { transform: none; }
.pa-deadline { font-size: 0.78rem; font-weight: 600; }
.pa-options { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 16px; }
.pa-option-btn { background: var(--bg-surface); border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 10px; padding: 10px 18px; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: border-color 0.12s ease, color 0.12s ease; }
.pa-option-btn:hover:not(:disabled) { border-color: var(--blueprint-glow); color: var(--text-primary); }
.pa-option-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pa-option-active { border-color: var(--blueprint); color: #fff; background: rgba(37, 99, 235, 0.18); }
.pa-ranking { list-style: none; margin: 4px 0 16px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pa-rank-row { display: flex; align-items: center; gap: 12px; background: var(--bg-surface); border: 1px solid var(--border-main); border-radius: 10px; padding: 8px 12px; }
.pa-rank-num { width: 22px; height: 22px; border-radius: 50%; background: var(--blueprint); color: #fff; font-size: 0.72rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pa-rank-name { flex: 1; font-size: 0.9rem; color: var(--text-primary); }
.pa-rank-controls { display: flex; gap: 6px; }
.pa-rank-controls button { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 6px; padding: 2px 8px; font-size: 0.7rem; cursor: pointer; }
.pa-rank-controls button:disabled { opacity: 0.3; cursor: not-allowed; }
.pa-submit-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.pa-submit-btn { background: var(--edge-orange); color: #fff; border: none; border-radius: 10px; padding: 11px 24px; font-size: 0.92rem; font-weight: 700; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease; }
.pa-submit-btn:hover:not(:disabled) { transform: translateY(-1px); }
.pa-submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pa-submitted { border-top: 1px solid var(--border-main); padding-top: 14px; }
.pa-submitted-echo { font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin: 10px 0 4px; }

.pa-skel { background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%); background-size: 200% 100%; animation: pa-shimmer 1.4s ease-in-out infinite; border-radius: 8px; }
.pa-skel-badge { width: 180px; height: 26px; margin: 0 auto 20px; border-radius: 999px; }
.pa-skel-title { width: min(420px, 80%); height: 44px; margin: 0 auto 14px; }
.pa-skel-sub { width: min(560px, 90%); height: 18px; margin: 0 auto 48px; }
.pa-skel-chip { width: 110px; height: 22px; margin-bottom: 16px; border-radius: 999px; }
.pa-skel-line-lg { width: 60%; height: 24px; margin-bottom: 12px; }
.pa-skel-line { width: 100%; height: 13px; margin-bottom: 9px; }
.pa-skel-pill { width: 45%; height: 18px; margin-top: 16px; }
@keyframes pa-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;
