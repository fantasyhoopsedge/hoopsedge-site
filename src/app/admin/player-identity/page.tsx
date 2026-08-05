import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { PlatformSidebarNav } from "@/components/platform-sidebar-nav";
import { isRbAdmin } from "@/lib/rookie-board-store";
import { DYNASTY_RANKINGS } from "@/lib/dynasty-rankings";
import { playerIdentity, REGISTRY_GENERATED_AT } from "@/lib/player-identity/bundled";
import { NICKNAME_TO_LEGAL_NAME } from "@/lib/player-name-aliases";
import { panelStyles } from "./_styles";

/**
 * /admin/player-identity — the review panel docs/player-identity-layer.md
 * promised in Phase 1 and that never got built until now.
 *
 * ── Why it is a REPORT and not a merge tool ─────────────────────────────────
 * `player_identity_unresolved` is a QUEUE, not a ledger: `identity:build`
 * upserts it from scratch on every run, so a decision recorded there would be
 * overwritten by the next build. Giving this page a "resolve" button therefore
 * means first choosing where a decision lives durably — and the answer is not
 * obvious, because the right fix differs per reason:
 *
 *   dob_conflict → verify against a THIRD source and fix the roster CSV. ESPN
 *                  is not authoritative here; it has real DOB errors (Zach
 *                  Edey), so "trust ESPN" is not a safe one-click action.
 *   no_match     → usually a new spelling; the fix is an alias pair in
 *                  src/lib/player-name-aliases.ts, which is committed and
 *                  reviewable in a way a database row would not be.
 *   ambiguous /  → a genuine two-humans-one-name call, and docs §5 is explicit
 *   id_conflict    that the merge path must never auto-resolve.
 *
 * Every one of those actions is a repo edit followed by `npm run
 * identity:build`. So the useful thing this page can do today is what the
 * proposal actually asked for — "a standing report of every identity hole" —
 * and it says, per section, exactly which edit to make.
 *
 * ── Everything here is server-side ──────────────────────────────────────────
 * `player_identity_unresolved` has RLS enabled with NO policies, so it must be
 * read with the service-role client; an anon read returns zero rows SILENTLY,
 * which presents as "queue is empty" rather than as an error. That already cost
 * one debugging cycle on the Fantrax connector.
 *
 * The registry snapshot is read from the bundle rather than the database on
 * purpose: comparing the two is itself one of the checks below.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Player Identity · FHE Admin",
  robots: { index: false, follow: false },
};

const CONSUMER_TABLES = [
  "season_player_stats",
  "nba_player_trends",
  "real_salary_values",
  "nba_roster",
  "nba_contracts",
] as const;

interface UnresolvedRow {
  norm_name: string;
  raw_name: string;
  source: string;
  reason: string;
  detail: string | null;
  candidates: unknown;
  seen_at: string;
}

interface Coverage {
  table: string;
  total: number;
  filled: number;
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`;
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function loadData() {
  const supabase = createAdminClient();

  const [{ data: unresolved }, { count: registryRows }] = await Promise.all([
    supabase.from("player_identity_unresolved").select("*").order("reason").order("raw_name"),
    supabase.from("player_identity").select("*", { count: "exact", head: true }),
  ]);

  const coverage: Coverage[] = await Promise.all(
    CONSUMER_TABLES.map(async (table) => {
      const [{ count: total }, { count: filled }] = await Promise.all([
        supabase.from(table).select("*", { count: "exact", head: true }),
        supabase.from(table).select("*", { count: "exact", head: true }).not("fhe_id", "is", null),
      ]);
      return { table, total: total ?? 0, filled: filled ?? 0 };
    }),
  );

  // Rows a consumer table can't attribute to a human. Named, because "11 rows"
  // is not actionable and "J. Quaintance, M. Johnson" is.
  const [{ data: rosterGaps }, { data: contractGaps }] = await Promise.all([
    supabase.from("nba_roster").select("full_name,team").is("fhe_id", null).eq("season", "2026-27").limit(50),
    supabase.from("nba_contracts").select("salary_player_name,team").is("fhe_id", null).limit(50),
  ]);

  return {
    unresolved: (unresolved ?? []) as UnresolvedRow[],
    registryRows: registryRows ?? 0,
    coverage,
    rosterGaps: (rosterGaps ?? []) as { full_name: string; team: string | null }[],
    contractGaps: (contractGaps ?? []) as { salary_player_name: string; team: string | null }[],
  };
}

export default async function PlayerIdentityAdminPage() {
  // Same gate as the other admin tools: localhost is trusted; in production the
  // signed-in user's email must be in rb_admins.
  if (process.env.NODE_ENV === "production") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/prediction-arena?next=/admin/player-identity");
    if (!(await isRbAdmin(user.email))) {
      return (
        <main style={{ padding: "80px 32px", textAlign: "center", color: "#94a3b8", fontFamily: "system-ui" }}>
          <h1 style={{ color: "#fff" }}>Restricted</h1>
          <p>Your account isn&apos;t an authorized admin.</p>
        </main>
      );
    }
  }

  const { unresolved, registryRows, coverage, rosterGaps, contractGaps } = await loadData();
  const index = playerIdentity();
  const all = index.all();

  // Snapshot vs database. These are written by the same `identity:build` run, so
  // a difference means the deployed bundle and the live table are from different
  // generations — usually "rebuilt but not redeployed".
  const snapshotDrift = registryRows !== all.length;

  // The dynasty board is the id-less source everything else resolves against, so
  // a name here that the registry can't place is the highest-signal gap on the
  // page. Bundled, so this costs no query.
  const boardMisses = DYNASTY_RANKINGS
    .map((p) => ({ player: p.player, rank: p.consensusRank, res: index.resolve({ name: p.player }) }))
    .filter((r) => r.res.kind !== "matched");

  const byReason = new Map<string, UnresolvedRow[]>();
  for (const r of unresolved) {
    const list = byReason.get(r.reason) ?? [];
    list.push(r);
    byReason.set(r.reason, list);
  }

  const providerCounts = [
    { label: "ESPN", n: all.filter((r) => r.espnId).length },
    { label: "NBA Stats", n: all.filter((r) => r.nbaStatsId).length },
    { label: "Basketball Monster", n: all.filter((r) => r.bbmId).length },
    { label: "Fantrax", n: all.filter((r) => r.fantraxId).length },
    { label: "date of birth", n: all.filter((r) => r.dob).length },
  ];

  const totalRows = coverage.reduce((a, c) => a + c.total, 0);
  const totalFilled = coverage.reduce((a, c) => a + c.filled, 0);

  return (
    <main className="pid-main">
      <style dangerouslySetInnerHTML={{ __html: panelStyles }} />
      <PlatformSidebarNav active="player-identity" />
      <div className="pid-wrap">
        <span className="pid-eyebrow">FHE ADMIN</span>
        <h1 className="pid-h1">Player identity</h1>
        <p className="pid-lede">
          Every place the registry could not attach a name to exactly one human, and every
          consumer row still missing an <code>fhe_id</code>. Read-only by design — every fix
          below is a repo edit followed by <code>npm run identity:build</code>.
        </p>
        <p className="pid-note">
          Nothing here auto-merges. A confidently wrong id attaches a real stat line to the
          wrong player, which is strictly worse than a missing one, so the build refuses to
          guess and leaves the call to you. Full reasoning in{" "}
          <code>docs/player-identity-layer.md</code>.
        </p>

        {/* ── registry ─────────────────────────────────────────────────── */}
        <h2 className="pid-h2">
          Registry
          <span className={`pid-status ${snapshotDrift ? "pid-warn" : "pid-ok"}`}>
            {snapshotDrift ? "SNAPSHOT DRIFT" : "IN SYNC"}
          </span>
        </h2>
        <span className="pid-h2-sub">
          The bundled snapshot and the <code>player_identity</code> table are written by the
          same build, so they should always agree. If they don&apos;t, the deployed bundle and
          the database are from different generations.
        </span>
        <div className="pid-tiles">
          <div className="pid-tile">
            <div className="pid-tile-n">{all.length.toLocaleString()}</div>
            <div className="pid-tile-l">IDENTITIES (BUNDLE)</div>
            <div className="pid-tile-s">generated {ago(REGISTRY_GENERATED_AT)}</div>
          </div>
          <div className="pid-tile">
            <div className={`pid-tile-n ${snapshotDrift ? "pid-bad" : ""}`}>
              {registryRows.toLocaleString()}
            </div>
            <div className="pid-tile-l">IDENTITIES (DATABASE)</div>
            <div className="pid-tile-s">
              {snapshotDrift ? "differs from the bundle — re-run identity:build, then redeploy" : "matches the bundle"}
            </div>
          </div>
          {providerCounts.map((p) => (
            <div className="pid-tile" key={p.label}>
              <div className="pid-tile-n">{p.n.toLocaleString()}</div>
              <div className="pid-tile-l">WITH {p.label.toUpperCase()}</div>
              <div className="pid-tile-s">{pct(p.n, all.length)} of the registry</div>
            </div>
          ))}
        </div>
        <div className="pid-do">
          <strong>Date of birth is the first disambiguator</strong> when a name matches two
          people, so the {all.length - providerCounts[4].n} identities without one are a
          ceiling on how well that ever works. Not a bug — most are prospects — but it is why
          an ambiguous name sometimes cannot be settled automatically.
        </div>

        {/* ── review queue ─────────────────────────────────────────────── */}
        <h2 className="pid-h2">
          Review queue
          <span className={`pid-status ${unresolved.length ? "pid-warn" : "pid-ok"}`}>
            {unresolved.length ? `${unresolved.length} WAITING` : "EMPTY"}
          </span>
        </h2>
        <span className="pid-h2-sub">
          Names the build refused to attach to a single player. This is the whole point of the
          layer: it would rather stop here than guess.
        </span>
        {unresolved.length === 0 ? (
          <div className="pid-empty">Nothing waiting. Every name the build saw resolved to exactly one human.</div>
        ) : (
          <>
            <div className="pid-scroll">
              <table className="pid-table">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Player</th>
                    <th>Source</th>
                    <th>Detail</th>
                    <th>Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byReason.entries()].flatMap(([reason, rows]) =>
                    rows.map((r) => (
                      <tr key={`${reason}-${r.norm_name}`}>
                        <td><span className="pid-reason">{reason}</span></td>
                        <td className="pid-name">{r.raw_name}</td>
                        <td className="pid-muted pid-mono">{r.source}</td>
                        <td>{r.detail ?? "—"}</td>
                        <td className="pid-muted pid-mono">{ago(r.seen_at)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            <div className="pid-do">
              <strong>How to clear these.</strong>{" "}
              <code>dob_conflict</code> — check a third source and fix{" "}
              <code>data/nba-rosters/2026-27.csv</code> if the roster is the one that&apos;s
              wrong; ESPN is <em>not</em> authoritative, it has real DOB errors, so don&apos;t
              take its word by default. <code>no_match</code> — usually a new spelling: add the
              pair to <code>src/lib/player-name-aliases.ts</code>.{" "}
              <code>ambiguous</code> / <code>id_conflict</code> — two humans one name; settle it
              by hand and never in bulk. Then re-run <code>npm run identity:build</code>.
            </div>
          </>
        )}

        {/* ── dynasty board ────────────────────────────────────────────── */}
        <h2 className="pid-h2">
          Dynasty board
          <span className={`pid-status ${boardMisses.length ? "pid-warn" : "pid-ok"}`}>
            {boardMisses.length ? `${boardMisses.length} UNRESOLVED` : `${DYNASTY_RANKINGS.length} / ${DYNASTY_RANKINGS.length}`}
          </span>
        </h2>
        <span className="pid-h2-sub">
          The board is a hand-published list of names with no id column, and it is what
          real-salary, seasonal and team-rosters all resolve against. A name here the registry
          can&apos;t place loses that player his consensus rank everywhere at once.
        </span>
        {boardMisses.length === 0 ? (
          <div className="pid-empty">Every board player resolves to exactly one identity.</div>
        ) : (
          <div className="pid-scroll">
            <table className="pid-table">
              <thead><tr><th>Rank</th><th>Player</th><th>Why</th></tr></thead>
              <tbody>
                {boardMisses.map((m) => (
                  <tr key={m.player}>
                    <td className="pid-mono">{m.rank}</td>
                    <td className="pid-name">{m.player}</td>
                    <td className="pid-bad">
                      {m.res.kind === "ambiguous"
                        ? `matches ${m.res.candidates.length} identities — needs a manual call`
                        : "unknown to the registry — likely a new spelling"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── dual-key coverage ────────────────────────────────────────── */}
        <h2 className="pid-h2">
          Consumer coverage
          <span className="pid-status pid-info">{pct(totalFilled, totalRows)} OF {totalRows.toLocaleString()} ROWS</span>
        </h2>
        <span className="pid-h2-sub">
          Rows carrying an <code>fhe_id</code>. Anything short of 100% is a row no consumer can
          join by identity — though some gaps are expected and listed underneath.
        </span>
        <div className="pid-scroll">
          <table className="pid-table">
            <thead><tr><th>Table</th><th>With fhe_id</th><th>Total</th><th>Coverage</th></tr></thead>
            <tbody>
              {coverage.map((c) => {
                const full = c.filled === c.total;
                return (
                  <tr key={c.table}>
                    <td className="pid-mono">{c.table}</td>
                    <td className="pid-mono">{c.filled.toLocaleString()}</td>
                    <td className="pid-mono pid-muted">{c.total.toLocaleString()}</td>
                    <td className={full ? "pid-good" : "pid-bad"}>{pct(c.filled, c.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pid-do">
          <strong>Known-and-expected gaps.</strong> <code>season_player_stats</code> sits below
          100% because the historical Summer League datasets are built by{" "}
          <code>build-summer-league-values.ts</code>, which does not write{" "}
          <code>fhe_id</code> yet — every dataset the app actually reads is at 100%.{" "}
          <code>nba_contracts</code> gaps are rows whose name is an abbreviation
          (&ldquo;M. Johnson&rdquo;), which never joined by name either.
        </div>

        {/* ── named gaps ───────────────────────────────────────────────── */}
        {(rosterGaps.length > 0 || contractGaps.length > 0) && (
          <>
            <h2 className="pid-h2">
              Unattributed rows
              <span className="pid-status pid-warn">{rosterGaps.length + contractGaps.length} NAMED</span>
            </h2>
            <span className="pid-h2-sub">
              The same gaps as above, but by name — because &ldquo;11 rows&rdquo; is not
              actionable and a list of names is.
            </span>
            <div className="pid-scroll">
              <table className="pid-table">
                <thead><tr><th>Table</th><th>Name as stored</th><th>Team</th></tr></thead>
                <tbody>
                  {rosterGaps.map((r) => (
                    <tr key={`roster-${r.full_name}`}>
                      <td className="pid-mono pid-muted">nba_roster</td>
                      <td className="pid-name">{r.full_name}</td>
                      <td className="pid-mono">{r.team ?? "—"}</td>
                    </tr>
                  ))}
                  {contractGaps.map((r) => (
                    <tr key={`contract-${r.salary_player_name}`}>
                      <td className="pid-mono pid-muted">nba_contracts</td>
                      <td className="pid-name">{r.salary_player_name}</td>
                      <td className="pid-mono">{r.team ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── aliases ──────────────────────────────────────────────────── */}
        <h2 className="pid-h2">
          Name aliases
          <span className="pid-status pid-info">{Object.keys(NICKNAME_TO_LEGAL_NAME).length} PAIRS</span>
        </h2>
        <span className="pid-h2-sub">
          The one authored list, in <code>src/lib/player-name-aliases.ts</code>. The build copies
          it into the registry snapshot, so a pair added there reaches the TypeScript app and
          the Python models both.
        </span>
        <div className="pid-scroll">
          <table className="pid-table">
            <thead><tr><th>As some sources spell it</th><th>Canonical</th></tr></thead>
            <tbody>
              {Object.entries(NICKNAME_TO_LEGAL_NAME).map(([from, to]) => (
                <tr key={from}>
                  <td className="pid-mono">{from}</td>
                  <td className="pid-mono">{to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pid-do">
          <strong>This is the lever you reach for most.</strong> The recurring failure here has
          never been a wrong id — it is a refresh quietly introducing a new spelling, which
          nothing surfaces until a join silently returns nothing.{" "}
          <code>npm run identity:verify</code> catches it in about a second; run it after every
          roster, salary or board refresh.
        </div>
      </div>
    </main>
  );
}
