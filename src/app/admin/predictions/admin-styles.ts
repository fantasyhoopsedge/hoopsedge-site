// Scoped styles for the agent review panel (adm- prefix). Reuses the global
// theme variables from globals.css, matching the Prediction Arena look.
export const adminStyles = `
.adm-main { min-height: 100vh; background: var(--bg-body); color: var(--text-primary); }
.adm-wrap { max-width: 1100px; margin: 0 auto; padding: 56px 24px 96px; }
.adm-eyebrow { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; color: var(--hero-badge-text); background: var(--hero-badge-bg); border: 1px solid var(--hero-badge-border); border-radius: 999px; padding: 5px 14px; margin-bottom: 18px; }
.adm-h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 800; line-height: 1.1; margin: 0 0 12px; display: flex; align-items: center; gap: 12px; }
.adm-count { font-size: 1rem; font-weight: 700; color: var(--edge-orange); background: rgba(255, 107, 43, 0.12); border-radius: 999px; padding: 2px 12px; }
.adm-lede { color: var(--text-secondary); font-size: 1.02rem; line-height: 1.6; max-width: 660px; margin: 0 0 40px; }

.adm-empty { background: var(--bg-card); border: 1px dashed var(--border-main); border-radius: 14px; padding: 40px; text-align: center; color: var(--text-muted); }

.adm-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
@media (max-width: 820px) { .adm-grid { grid-template-columns: 1fr; } }

.adm-card { background: var(--bg-card); border: 1px solid var(--border-main); border-top: 3px solid var(--edge-orange); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.adm-card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.adm-chip { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.1em; border-radius: 999px; padding: 4px 10px; background: rgba(37, 99, 235, 0.12); color: var(--blueprint); }
.adm-qtype { font-size: 0.72rem; font-weight: 600; color: var(--text-muted); }
.adm-card-title { font-size: 1.25rem; font-weight: 700; margin: 0; color: var(--text-primary); line-height: 1.3; }

.adm-pitch { position: relative; font-size: 0.9rem; line-height: 1.55; color: var(--text-secondary); background: var(--bg-body); border: 1px solid var(--border-main); border-radius: 10px; padding: 14px 14px 14px; margin: 0; }
.adm-pitch-label { display: block; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.14em; color: var(--edge-orange); margin-bottom: 6px; }

.adm-analysis { display: flex; flex-direction: column; gap: 8px; }
.adm-analysis-label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.14em; color: var(--text-muted); }
.adm-options { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--text-primary); font-size: 0.92rem; }

.adm-meta { display: flex; align-items: baseline; gap: 8px; border-top: 1px solid var(--border-main); padding-top: 12px; }
.adm-meta-label { font-size: 0.6rem; font-weight: 700; letter-spacing: 0.14em; color: var(--text-muted); }
.adm-meta time { font-size: 0.85rem; color: var(--text-secondary); }

.adm-approve { margin-top: 4px; align-self: flex-start; background: var(--edge-orange); color: #fff; font-size: 0.92rem; font-weight: 700; border: none; border-radius: 10px; padding: 11px 22px; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease; }
.adm-approve:hover:not(:disabled) { transform: translateY(-2px); }
.adm-approve:disabled { opacity: 0.6; cursor: progress; }
.adm-error { color: var(--red-severe); font-size: 0.82rem; margin: 8px 0 0; }
`;
