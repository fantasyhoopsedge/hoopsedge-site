# Trade agent — Fantrax API review & gap analysis vs. "measures of success"

Research pass only — no code changed. Sources: `https://www.fantrax.com/developer`
(v1.8 Beta, read live 2026-08-21) and the "trade agent measures of success" Google
Sheet (11 requirement rows, read live 2026-08-21). Cross-checked against the
codebase as it stands after the Trade Edge valuation-cascade redesign
(`feat/the-deep-edge` → `main`, PR #62) and this branch's community-trade-signal
work.

## 1. Fantrax API — full inventory

Nine documented endpoints total, all under `fxea/general/`, all read-only. No
POST/write, no trade-execution, no trade-block, and no transaction-history
endpoint exists anywhere in the documented surface — the API cannot see past
trades made in a league, cannot see a trade block, and cannot execute a trade.
This is a hard platform limit, not a gap in our build: **the agent can only
advise, never act, and can never learn from a specific league's real trade
history** because Fantrax doesn't expose one.

| Endpoint | Used today (`src/lib/fantrax/api.ts`) | Notes |
|---|---|---|
| `getPlayerIds` | ✅ `fetchPlayerIds` | |
| `getLeagues` | ✅ `fetchUserLeagues` | browser-only, needs Secret ID |
| `getLeagueInfo` | ✅ `fetchLeagueInfo` | `excludePlayerInfo` param not used — minor perf opportunity, not a capability gap |
| `getTeamRosters` | ✅ `fetchTeamRosters` | `period` param exists (any period, not just current) but every call site omits it — always current-period only |
| `getStandings` | ✅ `fetchStandings` | real, in-season standings — see §3.6 for why this isn't reaching Trade Edge |
| `getDraftResults` | ✅ `fetchDraftResults` | |
| `getDraftPicks` | ✅ `fetchDraftPicks` | future pick ownership — see §3.2, picks are fetched but never valued |
| `getAdp` | ❌ unused | sport-wide ADP, position-filterable — redraft-flavored signal, weak fit for dynasty but a real cross-check for `leagueType: "redraft"` |
| `getMatchupScores` | ❌ unused | **biggest opportunity** — real per-period H2H results with category-level win/loss breakdowns per matchup. See §3.6/§4. |

## 2. Sheet requirements → current coverage

| # | Requirement (verbatim intent) | Status | Where |
|---|---|---|---|
| 1 | Trade calculator: fair / winning / losing within a ±% margin | **Partial** | Trade Edge computes before/after Power Rankings, Category Edge, net category impact, Surplus $ — but never synthesizes a single fairness verdict or margin. This is squarely the future agent's job (narrate a verdict from these already-computed numbers), not a new math layer. |
| 2 | Value every asset: players, future picks, incoming rookies | **Gap — picks** | Players fully valued (8-Cat/9-Cat/Minus1V/FPTS/Surplus $). **Draft picks carry zero value in any trade math** — confirmed: `draftPicks`/`DraftPick` has no hits in `trade-edge.ts`. `DraftPickCardsGrid` renders picks as cards but they never enter `valueOf`/`summarizeAssets`/net-impact totals. Nothing values an undrafted incoming rookie either — no pick-value-by-slot curve exists anywhere in the repo. |
| 3 | Two-fold valuation: dynasty value (by format) + projected/current/prior production | **Partial, split not fused** | DYN RK (consensus) and VAL RK/Surplus (production) already sit side by side on every Trade Edge card — but as two separate numbers for a human to eyeball, not fused into one score. That's arguably correct for transparency (an agent citing two numbers is more trustworthy than one opaque blend), but worth an explicit design call before the agent's system prompt is written. |
| 4 | Production priority: projection > current year > prior year > prior years | **Likely already inside the projection, not exposed separately** | The 6-stage projection model already weights recent performance into the projection number itself (per the season-projections-model design). Trade Edge pulls exactly one dataset (`defaultDataset ?? "2027:projection"`) — there's no cascade/fallback across seasons surfaced to the tool or a future agent tool-call. |
| 5 | League settings: distinguish what matters for the user's league | **Strong** | This is what the just-shipped valuation-cascade redesign directly built. |
| 6 | League standings: projected power rankings + current in-season standings + projected | **Gap** | Power Rankings' simulator is solid for "projected." **Real current standings are fetched (`getStandings`) but never reach Trade Edge** — confirmed zero references to `analysis.standings` anywhere in `trade-edge/page.tsx`; its "Your team is strong/weak in…" panel reads only the simulated `leagueProfiles`. An agent reasoning about "where do I actually stand right now" has no real data to call. |
| 7 | Dynasty context: contending / 1-2yr / 3-4yr / rebuild window | **Not built** | Nothing in the codebase classifies a team's competitive window. Hardest requirement on the list to reduce to a formula — needs real standings position + roster age curve + near-term draft capital, likely a heuristic rather than a clean computation. |
| 8 | Injured players: who, which team, expected sidelined duration | **Not possible today without a new data source** | Fantrax's roster status (ACTIVE/RESERVE/MINORS/INJURED) is a roster **slot**, not real injury/recovery-timeline data — confirmed not in any of the 9 documented endpoints. Nothing in FHE's own NBA pipeline (`nba_roster`, `nba_player_game_logs`) carries injury/recovery data either, per CLAUDE.md's documented schema. This needs an external injury-report feed; neither existing source covers it. |
| 9 | Age curve: rookie/contract status, peak window, cliffs, breakout windows, retirement horizon | **Engine has it, UI doesn't surface it here** | The projection model already prices age arcs into its output, and the 14-tag trend system (AGEING/GROWING/SINKING/etc., `nba_player_trends`) already exists and is live on `/team-rosters` — but it's rendered by `roster-table.tsx`'s row component, which Trade Edge doesn't reuse (`PlayerMiniCard`/`TradePreviewTable` are separate, trend-tag-free components). Cheapest real win on this list: wire the existing trend badge into Trade Edge's cards. |
| 10 | Change in player opportunity: roster moves, backup/fill-usage | **Partial, hand-curated, not real-time** | `role-context-2026-27.csv` + the TGFSL breakout signal already feed this into the projection number, but per its own doc it's hand-maintained, not automated — a same-week opportunity shift (a starter's injury opening a backup's role) won't show until the CSV is next updated. `getTeamRosters`' unused `period` param could let the agent detect an actual usage/role shift directly from Fantrax roster snapshots over time, faster than FHE's own refresh cadence — a real, currently-untapped opportunity. |
| 11 | Consensus broadly agrees on the trade | **In progress, this branch** | Exactly what `data/community-trade-signal.csv` is building toward (35 rows as of this analysis). Not yet resolved to `fhe_id`, no defined consumption model. Given n=35 from one Discord community, the honest framing for now is a **sanity-check signal** ("does our verdict clash with what this community voted on similar trades?"), not something that drives the value model directly — sample's too small and single-source to trust as ground truth yet. |

## 3. Prioritized gaps & opportunities

Ordered by leverage (impact vs. how much is already half-built):

1. **Wire the existing trend-tag badge into Trade Edge.** Data and component already exist elsewhere; this is UI wiring, not new modeling. Closes most of requirement #9.
2. **Value draft picks.** Currently a hard zero in every trade total — the single largest correctness gap for a dynasty tool where picks are half the currency. Needs a pick-value-by-slot curve (standard dynasty-theory territory: expected value by round/pick position, likely anchored to the rookie board's own consensus ranks) — real design work, not a small patch.
3. **Surface real current standings (`getStandings`) in Trade Edge**, alongside the existing simulated projection, so both a future agent and a human reader can distinguish "where you actually are" from "where the model thinks you'd finish." Data's already fetched — this is plumbing, not new integration.
4. **Pull in `getMatchupScores`.** Two uses: (a) recent-form/hot-streak context for the dynasty-window judgment in requirement #7, (b) a genuine backtest opportunity — checking `simulateH2HCategoryStandings`'s draw-epsilon/z-score model against real matchup outcomes to see how well it actually predicts.
5. **Dynasty-window classification (req #7).** Not started. Define the heuristic (standings percentile + roster age-weighted-by-minutes + near-term pick capital) before the agent needs to reason about "should this team sell or buy" — this is load-bearing for the whole agent's advice quality.
6. **Injury data.** Flag as out of scope until a real feed is sourced — neither Fantrax nor FHE's pipeline covers it today.
7. **Community consensus.** Keep collecting (manual drops fine for now), then decide the consumption model — most likely a "does this clash with community sentiment" flag surfaced in the agent's answer, not a silent input to the value number.

## 4. Read against the trade-agent architecture already discussed

The tool-use, deterministic-engine-grounded design (agent calls tools that wrap
existing `analyze.ts`/`trade-edge.ts`/`power-rankings.ts` functions, never
invents a number itself) still holds — none of the above changes that
architecture. What it changes is **the tool list the agent will eventually get**:
today the only real building blocks are player-value and lineup/standings
simulation tools. Before the agent can honestly speak to the sheet's fairness
verdict, pick value, current-standings, and dynasty-window requirements, those
need to exist as real functions first — the agent can't narrate data that was
never computed. Recommended build order for the next phase, if picking up from
here: **items 1 → 3 → 4 → 2 → 5** above (cheapest/most-already-built first),
with picks (#2) and dynasty-window (#5) as the two genuinely new modeling
efforts worth their own design pass before implementation.

## 5. Follow-up references gathered (2026-08-21)

**OneNumberHoops (`onenumberhoops.com/rankings`)** — a public dynasty tool that
directly addresses gap #2 (pick valuation). Picks sit as ordinary rows in the
same ranked list as players on one unified 0–9999ish value scale (e.g. "2027
Early 1st Round Pick" = 7,501, slotted directly between two real players by
value) — exactly the mechanism missing from Trade Edge today. Their rankings
explicitly "assume a 12 team league" (fixed, not adjustable), so it's a
calibration reference for building our own pick-value curve, not a live
dependency — a fixed 12-team assumption would misprice a pick in a 30-team,
17-man-roster league.

**Downtown Fantasy Sports — Angle Dynasty League (real league, league id 23)**
— pulled 50 real trade-analysis polls into
[data/downtown-fantasy-trade-analysis.csv](../data/downtown-fantasy-trade-analysis.csv):
every trade's real players (name/position/actual salary $), picks, and FAAB on
both sides, plus the league's real 3-way vote (Team A wins / Team B wins /
Fair Trade, with %/counts). This is a stronger version of the
`community-trade-signal.csv` idea — no name ambiguity (full real names), real
dollar figures instead of estimates, and a **direct backtest set for the
Surplus $ model just shipped** (does FHE's surplus math agree with what this
real league actually voted was fair?).

League settings, confirmed with Ash: 30 teams, real salary, **6 starters + 6
reserves + 2 IR + 3 Minors = 17-man roster → a 510-player pool** (30 × 17).
H2H categories with **daily lineup moves and no stated games cap** — per
`depthWeight()` in `power-rankings.ts`, that combination is exactly the case
where bench depth carries real weight (close to full credit, not the ~0.22
weekly-lineup discount) rather than being a minor "+1/+2" nicety. Any backtest
against this league's trade votes should assess with roster depth turned on
(not just starters), or it'll be comparing a starters-only read against a
community that's actually valuing bench-deep assets.
Worth remembering this is bigger than the `Old But Gold` Fantrax test league
used elsewhere in this repo's manual QA (30 teams × 16-man roster → 450) —
don't assume the two are interchangeable when using either as a reference
pool size.
