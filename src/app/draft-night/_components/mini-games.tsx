"use client";

import type { ProspectLite } from "@/lib/prospects";
import type {
  DraftedHigherConfig,
  FirstRoundConfig,
  GuardOrderConfig,
  MockLotteryConfig,
} from "@/lib/draftNight/grader";
import { Headshot } from "./headshot";

type ProspectMap = Record<string, ProspectLite>;

function lite(prospects: ProspectMap, slug: string): ProspectLite {
  return prospects[slug] ?? { slug, name: slug, pos: "", school: "", rank: 0 };
}

interface MiniProps<C> {
  config: C;
  prospects: ProspectMap;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// ── drafted_higher: 5 tap-one-of-two ────────────────────────────────────────
export function DraftedHigher({
  config,
  prospects,
  value,
  onChange,
  disabled,
}: MiniProps<DraftedHigherConfig>) {
  const pick = (i: number, slug: string) => {
    const next = [...value];
    next[i] = slug;
    onChange(next);
  };
  return (
    <div className="dn-pairs">
      {config.pairs.map(([a, b], i) => (
        <div className="dn-pair" key={i}>
          {[a, b].map((slug, side) => {
            const p = lite(prospects, slug);
            const active = value[i] === slug;
            return (
              <span className="dn-pair-cell" key={slug}>
                {side === 1 ? <span className="dn-vs" aria-hidden>vs</span> : null}
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  className={`dn-pick${active ? " dn-pick-active" : ""}`}
                  onClick={() => pick(i, slug)}
                >
                  <Headshot name={p.name} size={44} />
                  <span className="dn-pick-body">
                    <span className="dn-pick-name">{p.name}</span>
                    <span className="dn-pick-meta">{p.pos} · {p.school}</span>
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── first_round: 4 toggle chips ─────────────────────────────────────────────
export function FirstRound({
  config,
  prospects,
  value,
  onChange,
  disabled,
}: MiniProps<FirstRoundConfig>) {
  const toggle = (slug: string) =>
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);
  return (
    <div className="dn-chips">
      {config.pool.map((slug) => {
        const p = lite(prospects, slug);
        const on = value.includes(slug);
        return (
          <button
            type="button"
            key={slug}
            disabled={disabled}
            aria-pressed={on}
            className={`dn-toggle${on ? " dn-toggle-on" : ""}`}
            onClick={() => toggle(slug)}
          >
            <Headshot name={p.name} size={40} />
            <span className="dn-toggle-body">
              <span className="dn-toggle-name">{p.name}</span>
              <span className="dn-toggle-meta">{p.pos} · {p.school}</span>
              <span className="dn-toggle-state">{on ? "✓ FIRST ROUND" : "TAP TO TAG"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── guard_order: reorder 5 with ↑/↓ ─────────────────────────────────────────
export function GuardOrder({
  prospects,
  value,
  onChange,
  disabled,
}: MiniProps<GuardOrderConfig>) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <ol className="dn-rank-list" aria-label="Rank the guards by draft slot">
      {value.map((slug, i) => {
        const p = lite(prospects, slug);
        return (
          <li className="dn-rank-row" key={slug}>
            <span className="dn-rank-num">{i + 1}</span>
            <Headshot name={p.name} size={36} />
            <span className="dn-rank-id">
              <span className="dn-rank-name">{p.name}</span>
              <span className="dn-rank-meta">{p.pos} · {p.school}</span>
            </span>
            <span className="dn-rank-ctrls">
              <button type="button" aria-label={`Move ${p.name} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>▲</button>
              <button type="button" aria-label={`Move ${p.name} down`} disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}>▼</button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── mock_lottery: assign top-14 from the 49-prospect pool ────────────────────
export function MockLottery({
  config,
  prospects,
  value,
  onChange,
  disabled,
}: MiniProps<MockLotteryConfig>) {
  const placed = new Set(value);
  const available = config.pool.filter((slug) => !placed.has(slug));

  const place = (slug: string) => {
    if (value.length >= config.slots) return;
    onChange([...value, slug]);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="dn-lottery">
      <div className="dn-slots">
        <p className="dn-col-label">YOUR LOTTERY · {value.length}/{config.slots}</p>
        <ol className="dn-slot-list">
          {Array.from({ length: config.slots }).map((_, i) => {
            const slug = value[i];
            const p = slug ? lite(prospects, slug) : null;
            const team = config.slotTeams?.[i];
            return (
              <li className={`dn-slot${p ? " dn-slot-filled" : ""}`} key={i}>
                <span className="dn-slot-pick">
                  <span className="dn-slot-num">{i + 1}</span>
                  {team ? <span className="dn-slot-team">{team}</span> : null}
                </span>
                {p ? (
                  <>
                    <Headshot name={p.name} size={34} />
                    <span className="dn-rank-id">
                      <span className="dn-rank-name">{p.name}</span>
                      <span className="dn-rank-meta">{p.pos} · {p.school}</span>
                    </span>
                    <span className="dn-rank-ctrls">
                      <button type="button" aria-label={`Move ${p.name} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>▲</button>
                      <button type="button" aria-label={`Move ${p.name} down`} disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}>▼</button>
                      <button type="button" aria-label={`Remove ${p.name}`} disabled={disabled} onClick={() => remove(i)}>✕</button>
                    </span>
                  </>
                ) : (
                  <span className="dn-slot-empty">Tap a prospect →</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="dn-pool">
        <p className="dn-col-label">PROSPECT POOL · {available.length} LEFT</p>
        <ul className="dn-pool-list">
          {available.map((slug) => {
            const p = lite(prospects, slug);
            return (
              <li key={slug}>
                <button
                  type="button"
                  className="dn-pool-item"
                  disabled={disabled || value.length >= config.slots}
                  onClick={() => place(slug)}
                >
                  <Headshot name={p.name} size={34} />
                  <span className="dn-rank-id">
                    <span className="dn-rank-name">{p.name}</span>
                    <span className="dn-rank-meta">{p.pos} · {p.school}</span>
                  </span>
                  <span className="dn-pool-add" aria-hidden>＋</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
