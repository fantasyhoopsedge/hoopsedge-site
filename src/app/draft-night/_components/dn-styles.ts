export const dnStyles = `
.dn-wrap {
  max-width: 1040px; margin: 0 auto; padding: 104px 24px 96px;
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

/* ── Landing cards ── */
.dn-card-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px;
}
.dn-card {
  text-align: left; cursor: pointer; appearance: none;
  background: var(--bg-card); border: 1px solid var(--border-main);
  border-radius: 16px; padding: 24px; display: flex; flex-direction: column;
  gap: 10px; transition: transform .25s, box-shadow .25s, background .25s;
  color: inherit;
}
.dn-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-card); background: var(--bg-card-hover); }
.dn-card-marquee { grid-column: 1 / -1; background: linear-gradient(135deg, rgba(240,192,64,0.10), var(--bg-card)); }
.dn-card-done { opacity: 0.78; }
.dn-card-head { display: flex; align-items: center; justify-content: space-between; }
.dn-chip {
  font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700;
  letter-spacing: 1px;
}
.dn-card-icon { font-size: 24px; }
.dn-card-title {
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: 22px;
  text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-primary);
}
.dn-card-blurb { font-size: 14px; line-height: 1.5; color: var(--text-secondary); }
.dn-card-foot {
  font-family: 'Oswald', sans-serif; font-size: 13px; font-weight: 600;
  letter-spacing: 1.5px; text-transform: uppercase; color: var(--text-muted); margin-top: 6px;
}

/* ── Active panel ── */
.dn-panel {
  margin-top: 24px; background: var(--bg-card); border: 1px solid var(--border-main);
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
.dn-panel-blurb, .dn-locked-note { font-size: 14px; color: var(--text-secondary); margin-bottom: 18px; }
.dn-locked-note { color: var(--green-elite); }

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

/* ── results sign-in button (shared sign-up modal handles the gate) ── */
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

@media (max-width: 720px) {
  .dn-h1 { font-size: 34px; }
  .dn-card-grid { grid-template-columns: 1fr; }
  .dn-chips { grid-template-columns: 1fr; }
  .dn-lottery { grid-template-columns: 1fr; }
  .dn-score-big { font-size: 56px; }
}
`;
