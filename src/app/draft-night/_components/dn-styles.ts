export const dnStyles = `
/* Offset for the fixed-left AppSidebar rail on desktop (PlatformSidebarNav);
   mobile falls back to the top SiteNav, which needs no offset. Same simple
   pattern as .draft-board-shell / .pa-shell. */
.dn-page-shell { padding-left: 236px; }
@media (max-width: 767px) { .dn-page-shell { padding-left: 0; } }

.dn-wrap {
  max-width: 1100px; margin: 0 auto; padding: 104px 24px 96px;
}
.dn-eyebrow {
  font-family: 'Oswald', sans-serif; font-size: 12px; font-weight: 600;
  letter-spacing: 4px; text-transform: uppercase; color: var(--edge-orange);
  display: block; margin-bottom: 14px;
}
.dn-h1 {
  font-family: 'Oswald', sans-serif; font-weight: 800; font-size: 48px;
  line-height: 1.05; text-transform: uppercase; letter-spacing: -0.5px;
  color: var(--text-primary); margin-bottom: 18px;
}
.dn-lede {
  font-size: 17px; line-height: 1.6; color: var(--text-secondary);
  max-width: 620px; margin-bottom: 40px;
}

/* ── Two-column shell (desktop only) ── */
.dn-shell {
  display: grid;
  grid-template-columns: 256px 1fr;
  gap: 20px;
  align-items: start;
}
/* Wizard hidden on desktop */
.dn-wizard { display: none; }

/* ── Left sidebar ── */
.dn-sidebar { display: flex; flex-direction: column; gap: 10px; }

.dn-scard {
  all: unset;
  box-sizing: border-box;
  display: flex; align-items: center; gap: 13px;
  width: 100%; text-align: left; cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-main);
  border-left: 4px solid transparent;
  border-radius: 12px;
  padding: 14px 16px;
  color: inherit;
  transition: transform .18s, background .18s, box-shadow .18s;
}
.dn-scard:hover { transform: translateX(3px); background: var(--bg-card-hover); }
.dn-scard--active {
  transform: translateX(3px);
  background: var(--bg-card-hover);
  box-shadow: 0 4px 20px rgba(0,0,0,0.18);
}
.dn-scard--done { opacity: 0.85; }

.dn-scard-icon { font-size: 22px; flex-shrink: 0; }
.dn-scard-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dn-scard-title {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 15px;
  text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dn-scard-sub { font-size: 11px; color: var(--text-muted); }
.dn-scard-status {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 18px;
  flex-shrink: 0;
}

/* ── Right panel column ── */
.dn-panel-col { position: sticky; top: 84px; }

/* ── Rules pane (default right-col state) ── */
.dn-rules-pane {
  background: var(--bg-card); border: 1px solid var(--border-main);
  border-radius: 16px; padding: 28px 30px;
}
.dn-rules-eyebrow {
  font-family: 'Oswald', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 3px; text-transform: uppercase; color: var(--text-muted);
  display: block; margin-bottom: 18px;
}
.dn-rules-list {
  list-style: none; margin: 0 0 24px; padding: 0;
  display: flex; flex-direction: column; gap: 14px;
}
.dn-rules-list li {
  display: flex; align-items: flex-start; gap: 14px;
  font-size: 14px; line-height: 1.6; color: var(--text-secondary);
}
.dn-rules-list li strong { color: var(--text-primary); }
.dn-rule-n {
  flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
  background: var(--bg-surface); border: 1px solid var(--border-main);
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 13px;
  color: var(--text-muted); display: flex; align-items: center; justify-content: center;
  margin-top: 1px;
}

.dn-lock-callout {
  display: flex; flex-direction: column; gap: 4px;
  background: rgba(255,107,43,0.08); border: 1px solid rgba(255,107,43,0.3);
  border-radius: 12px; padding: 16px 20px;
}
.dn-lock-callout-label {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
  letter-spacing: 1px; color: var(--edge-orange);
}
.dn-lock-callout-time {
  font-family: 'Oswald', sans-serif; font-weight: 800; font-size: 22px;
  color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;
}
.dn-lock-callout-note { font-size: 12px; color: var(--text-muted); }

/* ── Active panel ── */
.dn-panel {
  background: var(--bg-card); border: 1px solid var(--border-main);
  border-radius: 16px; padding: 24px;
}
.dn-panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.dn-panel-title {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 22px;
  text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-primary);
}
.dn-panel-close {
  background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer;
}
.dn-panel-blurb { font-size: 14px; color: var(--text-secondary); margin-bottom: 18px; }
.dn-locked-note { font-size: 14px; color: var(--green-elite); margin-bottom: 18px; }
.dn-edit-note {
  font-size: 13px; color: var(--dynasty-gold);
  background: rgba(240,192,64,0.08); border: 1px solid rgba(240,192,64,0.25);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 18px;
}

/* ── drafted_higher ── */
.dn-pairs { display: flex; flex-direction: column; gap: 12px; }
.dn-pair { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6px; }
.dn-pair-cell { display: contents; }
.dn-vs {
  font-family: 'Oswald', sans-serif; font-size: 12px; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 1px; text-align: center;
}
.dn-pick {
  width: 100%; text-align: left; cursor: pointer; background: var(--bg-surface);
  border: 1.5px solid var(--border-main); border-radius: 12px; padding: 12px 14px;
  display: flex; align-items: center; gap: 12px; transition: border-color .2s, background .2s;
  color: inherit;
}
.dn-pick-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dn-pick:hover:not(:disabled) { border-color: var(--blueprint-glow); }
.dn-pick-active { border-color: var(--edge-orange); background: rgba(255,107,43,0.10); }
.dn-pick-name { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 16px; color: var(--text-primary); }
.dn-pick-meta { font-size: 12px; color: var(--text-muted); }

/* ── first_round chips ── */
.dn-chips { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.dn-toggle {
  text-align: left; cursor: pointer; background: var(--bg-surface);
  border: 1.5px solid var(--border-main); border-radius: 12px; padding: 12px 14px;
  display: flex; align-items: center; gap: 12px; transition: border-color .2s, background .2s; color: inherit;
}
.dn-toggle-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dn-toggle:hover:not(:disabled) { border-color: var(--blueprint-glow); }
.dn-toggle-on { border-color: var(--blueprint); background: rgba(37,99,235,0.12); }
.dn-toggle-name { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 16px; color: var(--text-primary); }
.dn-toggle-meta { font-size: 12px; color: var(--text-muted); }
.dn-toggle-state {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
  letter-spacing: 1px; margin-top: 4px; color: var(--text-secondary);
}
.dn-toggle-on .dn-toggle-state { color: var(--blueprint-glow); }

/* ── ranking rows (guard_order + lottery slots) ── */
.dn-rank-list, .dn-slot-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
.dn-rank-row, .dn-slot {
  display: flex; align-items: center; gap: 12px; background: var(--bg-surface);
  border: 1px solid var(--border-main); border-radius: 10px; padding: 10px 12px;
}
.dn-rank-num, .dn-slot-num {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 18px;
  color: var(--blueprint-glow); min-width: 28px; text-align: center;
}
.dn-rank-id { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dn-rank-name { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 15px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dn-rank-meta { font-size: 11px; color: var(--text-muted); }
.dn-rank-ctrls { display: flex; gap: 4px; }
.dn-rank-ctrls button {
  width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--border-main);
  background: var(--bg-card); color: var(--text-secondary); cursor: pointer; font-size: 12px;
}
.dn-rank-ctrls button:disabled { opacity: 0.35; cursor: default; }
.dn-rank-ctrls button:hover:not(:disabled) { border-color: var(--blueprint-glow); color: var(--text-primary); }

/* ── mock lottery ── */
.dn-lottery { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.dn-col-label {
  font-family: 'Oswald', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 2px; color: var(--text-muted); margin-bottom: 10px;
}
.dn-slot-empty { flex: 1; color: var(--text-muted); font-size: 13px; font-style: italic; }
.dn-slot-filled { border-color: var(--dynasty-gold); }
.dn-slot-pick { display: flex; flex-direction: column; align-items: center; min-width: 40px; gap: 1px; }
.dn-slot-team { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; color: var(--dynasty-gold); }
.dn-pool-list { list-style: none; display: flex; flex-direction: column; gap: 6px; max-height: 540px; overflow-y: auto; padding-right: 4px; }
.dn-pool-item {
  width: 100%; display: flex; align-items: center; gap: 10px; cursor: pointer;
  background: var(--bg-surface); border: 1px solid var(--border-main); border-radius: 10px;
  padding: 9px 11px; color: inherit; transition: border-color .2s;
}
.dn-pool-item:hover:not(:disabled) { border-color: var(--dynasty-gold); }
.dn-pool-item:disabled { opacity: 0.4; cursor: default; }
.dn-pool-add { font-size: 18px; color: var(--dynasty-gold); }

/* ── lock row ── */
.dn-lock-row { display: flex; align-items: center; gap: 16px; margin-top: 20px; flex-wrap: wrap; }
.dn-lock-btn {
  display: inline-block; background: var(--edge-orange); color: #fff; border: none;
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 15px;
  letter-spacing: 1.5px; text-transform: uppercase; padding: 14px 30px; border-radius: 10px;
  cursor: pointer; transition: background .2s, transform .2s; text-decoration: none;
}
.dn-lock-btn:hover:not(:disabled) { background: var(--edge-orange-dark); transform: translateY(-2px); }
.dn-lock-btn:disabled { opacity: 0.5; cursor: default; }
.dn-error { color: var(--red-severe); font-size: 13px; }

/* ── results sign-in button ── */
.dn-google-btn {
  width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--modal-google-bg); border: 1px solid var(--modal-google-border);
  color: var(--modal-google-text); font-family: 'Source Sans 3', sans-serif; font-size: 15px;
  font-weight: 600; padding: 14px; border-radius: 10px; cursor: pointer; transition: background .2s;
}
.dn-google-btn:hover { background: var(--modal-google-hover); }

/* ── results ── */
.dn-results { display: flex; flex-direction: column; }
.dn-score-hero {
  display: flex; align-items: center; gap: 28px; flex-wrap: wrap;
  background: var(--bg-card); border: 1px solid var(--border-main);
  border-radius: 18px; padding: 28px 32px; margin: 8px 0 28px;
}
.dn-score-big {
  font-family: 'Oswald', sans-serif; font-weight: 800; font-size: 72px; line-height: 1;
  color: var(--dynasty-gold);
}
.dn-score-side { display: flex; flex-direction: column; gap: 6px; }
.dn-score-rank { font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 22px; text-transform: uppercase; color: var(--text-primary); }
.dn-score-pct { font-size: 14px; color: var(--green-elite); font-weight: 600; }
.dn-card-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
.dn-share-btn {
  background: var(--bg-card); border: 1px solid var(--border-main); color: var(--text-primary);
  font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 14px; letter-spacing: 1px;
  text-transform: uppercase; padding: 14px 24px; border-radius: 10px; cursor: pointer;
}
.dn-share-btn:hover { border-color: var(--blueprint-glow); }
.dn-section-h {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 18px; letter-spacing: 1px;
  text-transform: uppercase; color: var(--text-primary); margin: 12px 0 14px;
}
.dn-breakdown { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
.dn-break-row {
  display: flex; align-items: center; gap: 14px; background: var(--bg-card);
  border: 1px solid var(--border-main); border-radius: 12px; padding: 14px 18px;
}
.dn-break-icon { font-size: 22px; }
.dn-break-id { flex: 1; display: flex; flex-direction: column; }
.dn-break-title { font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 16px; text-transform: uppercase; color: var(--text-primary); }
.dn-break-sub { font-size: 12px; color: var(--text-muted); }
.dn-break-score { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 22px; }
.dn-leaderboard { list-style: none; display: flex; flex-direction: column; gap: 4px; }
.dn-lb-row {
  display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-radius: 10px;
  background: var(--bg-card); border: 1px solid transparent;
}
.dn-lb-me { border-color: var(--edge-orange); background: rgba(255,107,43,0.08); }
.dn-lb-rank { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--text-muted); min-width: 36px; }
.dn-lb-name { flex: 1; font-family: 'Oswald', sans-serif; font-weight: 600; color: var(--text-primary); }
.dn-lb-score { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--dynasty-gold); }
.dn-lb-empty { color: var(--text-muted); padding: 16px; text-align: center; }

/* ── Called It cards ── */
.dn-ci-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px; margin-bottom: 14px;
}
.dn-ci-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-card); border: 1px solid var(--border-main);
  border-left: 4px solid transparent; border-radius: 12px; padding: 14px 16px;
}
.dn-ci-icon { font-size: 24px; flex-shrink: 0; }
.dn-ci-body { display: flex; flex-direction: column; gap: 2px; }
.dn-ci-name {
  font-family: 'Oswald', sans-serif; font-weight: 600; font-size: 14px;
  text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-primary);
}
.dn-ci-sub { font-size: 11px; color: var(--green-elite); font-weight: 600; }
.dn-ci-bonus {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(240,192,64,0.10); border: 1px solid rgba(240,192,64,0.30);
  border-radius: 10px; padding: 10px 16px; font-size: 13px;
  font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--dynasty-gold);
}
.dn-ci-hint { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
.dn-called-it-badge {
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700;
  letter-spacing: 1px; padding: 3px 8px; border-radius: 5px;
  background: rgba(240,192,64,0.12); color: var(--dynasty-gold); white-space: nowrap;
}
.dn-bonus-row {
  display: flex; align-items: center; gap: 14px;
  background: rgba(240,192,64,0.07); border: 1px solid rgba(240,192,64,0.25);
  border-radius: 12px; padding: 14px 18px;
}
.dn-bonus-score {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 22px; color: var(--dynasty-gold);
}
.dn-back-btn {
  display: inline-flex; align-items: center; gap: 6px; background: none; border: none;
  color: var(--text-muted); font-family: 'Oswald', sans-serif; font-weight: 600;
  font-size: 13px; letter-spacing: 1px; text-transform: uppercase;
  cursor: pointer; padding: 0 0 20px; transition: color 0.15s;
}
.dn-back-btn:hover { color: var(--text-primary); }
.dn-break-row--btn {
  width: 100%; text-align: left; cursor: pointer; transition: border-color 0.15s;
}
.dn-break-row--btn:hover { border-color: var(--blueprint-glow); }

/* ─────────────────────────────────────────────────────────────────────────────
   MOBILE WIZARD (≤820px)
   ─────────────────────────────────────────────────────────────────────────── */
@media (max-width: 820px) {
  .dn-wrap { padding: 80px 16px 64px; }
  .dn-h1 { font-size: 28px; letter-spacing: -0.3px; }
  .dn-lede { font-size: 15px; margin-bottom: 24px; }

  /* Hide desktop shell, show wizard */
  .dn-shell { display: none; }
  .dn-wizard { display: block; }

  /* Wizard: progress dots */
  .dn-wiz-dots {
    display: flex; gap: 10px; justify-content: center; margin-bottom: 6px;
  }
  .dn-wdot {
    all: unset; cursor: pointer; width: 44px; height: 44px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; border: 2px solid var(--border-main);
    background: var(--bg-card); transition: border-color .2s, transform .2s;
  }
  .dn-wdot:hover { transform: scale(1.1); }
  .dn-wdot--active { background: var(--bg-card-hover); transform: scale(1.12); }
  .dn-wdot--done { font-size: 17px; font-weight: 700; color: var(--green-elite); }

  /* Progress meta line */
  .dn-wiz-meta {
    text-align: center; font-size: 12px; color: var(--text-muted);
    letter-spacing: 0.06em; margin-bottom: 20px;
  }

  /* Panel inside wizard (no close btn needed) */
  .dn-wizard .dn-panel { border-radius: 14px; padding: 18px 16px; }
  .dn-wizard .dn-panel-head { margin-bottom: 4px; }
  .dn-wizard .dn-panel-title { font-size: 20px; }
  .dn-wizard .dn-lock-btn { width: 100%; text-align: center; padding: 14px; }
  .dn-wizard .dn-lock-row { flex-direction: column; align-items: stretch; }

  /* Post-lock advance button */
  .dn-wiz-advance { margin-top: 14px; }
  .dn-wiz-advance-btn {
    all: unset; box-sizing: border-box; display: block; width: 100%;
    text-align: center; background: var(--edge-orange); color: #fff;
    font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 15px;
    letter-spacing: 1.5px; text-transform: uppercase; padding: 15px;
    border-radius: 10px; cursor: pointer; transition: background .2s;
  }
  .dn-wiz-advance-btn--done {
    background: var(--dynasty-gold); color: #000;
  }
  .dn-wiz-advance-btn:active { opacity: 0.88; }

  /* Back / Skip nav row */
  .dn-wiz-footer {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-main);
  }
  .dn-wiz-nav {
    all: unset; cursor: pointer; font-size: 13px; color: var(--text-muted);
    font-weight: 600; padding: 6px 0;
  }
  .dn-wiz-nav:active { color: var(--text-primary); }

  /* Completion state */
  .dn-wiz-done { text-align: center; }
  .dn-wiz-done-trophy { font-size: 52px; margin-bottom: 12px; }
  .dn-wiz-done-h {
    font-family: 'Oswald', sans-serif; font-weight: 800; font-size: 26px;
    text-transform: uppercase; color: var(--text-primary); margin: 0 0 8px;
  }
  .dn-wiz-done-sub {
    font-size: 14px; color: var(--text-secondary); line-height: 1.55;
    margin-bottom: 22px;
  }
  .dn-wiz-done-list { display: flex; flex-direction: column; gap: 8px; text-align: left; }
  .dn-wiz-done-row {
    all: unset; box-sizing: border-box; display: flex; align-items: center;
    justify-content: space-between; cursor: pointer; width: 100%;
    background: var(--bg-card); border: 1px solid var(--border-main);
    border-left: 4px solid transparent; border-radius: 12px; padding: 14px 16px;
    font-size: 15px; color: var(--text-primary); transition: background .15s;
  }
  .dn-wiz-done-row:active { background: var(--bg-card-hover); }
  .dn-wiz-done-name { font-family: 'Oswald', sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .dn-wiz-done-edit { font-size: 13px; color: var(--edge-orange); font-weight: 600; }

  /* Mini-game specific adjustments */
  .dn-pool-list { max-height: 280px; }
  .dn-chips { grid-template-columns: 1fr; }
  .dn-lottery { grid-template-columns: 1fr; }
  .dn-score-big { font-size: 56px; }
  .dn-score-hero { padding: 20px; }
}

@media (max-width: 480px) {
  .dn-h1 { font-size: 24px; }
  .dn-wdot { width: 40px; height: 40px; font-size: 18px; }
}

/* drafted_higher pairs stack on very narrow screens */
@media (max-width: 420px) {
  .dn-pair { grid-template-columns: 1fr; }
  .dn-vs { padding: 0; font-size: 10px; }
}

/* ── Resolved results layout ─────────────────────────────────────────────── */
.dn-results-grid {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 28px;
  align-items: start;
  margin-top: 8px;
}
.dn-results-left { display: flex; flex-direction: column; gap: 10px; }
.dn-results-right { position: sticky; top: 84px; }

/* Per-mini-game result card */
.dn-mini-rc {
  background: var(--bg-card);
  border: 1px solid var(--border-main);
  border-left: 4px solid transparent;
  border-radius: 14px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dn-mini-rc-header {
  display: flex; align-items: center; gap: 12px; margin-bottom: 2px;
}
.dn-mini-rc-title {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 15px;
  text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-primary);
  flex: 1;
}
.dn-mini-rc-badges { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.dn-mini-rc-score {
  font-size: 14px; color: var(--text-secondary); line-height: 1.4;
}
.dn-mini-rc-score strong {
  font-family: 'JetBrains Mono', monospace; font-weight: 700;
  font-size: 17px; color: var(--text-primary);
}
.dn-mini-rc-rank { font-size: 13px; color: var(--text-muted); }
.dn-mini-rc-rank strong { color: var(--text-primary); font-weight: 700; }

/* Placement badges (1st / 2nd / 3rd) */
.dn-place-badge {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
  letter-spacing: 0.5px; padding: 3px 9px; border-radius: 6px; white-space: nowrap;
}
.dn-place-gold   { background: rgba(240,192,64,0.15);   color: var(--dynasty-gold);  border: 1px solid rgba(240,192,64,0.4); }
.dn-place-silver { background: rgba(192,192,192,0.12);  color: #c0c0c0;              border: 1px solid rgba(192,192,192,0.35); }
.dn-place-bronze { background: rgba(205,127,50,0.12);   color: #cd7f32;              border: 1px solid rgba(205,127,50,0.35); }

@media (max-width: 820px) {
  .dn-results-grid { grid-template-columns: 1fr; }
  .dn-results-right { position: static; }
}
`;
