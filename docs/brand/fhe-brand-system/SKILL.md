---
name: fhe-brand-system
version: 2.0.0
description: Extracted-from-production design system for Fantasy Hoops Edge, sourced exclusively from the team-rosters page (the "rt-" token system) — the only page fully migrated to the rt-* neutral namespace.
---

# FHE Brand System — team-rosters ("rt-" design system)

## Scope

Every token and pattern in this file is extracted **only** from the `/team-rosters/[team]`
page and its supporting files:

- [team-rosters-shell.tsx](../../../src/app/team-rosters/_components/team-rosters-shell.tsx) — page shell, font wiring
- [roster-tokens.css](../../../src/app/team-rosters/_components/roster-tokens.css) — the `.rt-shell` token definitions (origin of the rt- namespace)
- [roster-app.tsx](../../../src/app/team-rosters/_components/roster-app.tsx) — main UI (topbar, summary cards, player grid/list, detail panel)
- [roster-headshot.tsx](../../../src/app/team-rosters/_components/roster-headshot.tsx) — avatar component
- [roster-helpers.ts](../../../src/app/team-rosters/_components/roster-helpers.ts) — badge/color helper functions
- [roster-data.ts](../../../src/app/team-rosters/_components/roster-data.ts) — semantic color constants (stat tiers, tags, dynasty tiers)
- [trend-insight.ts](../../../src/app/team-rosters/_components/trend-insight.ts) — tone/verdict color mapping
- [player-trend-chart.tsx](../../../src/app/team-rosters/_components/player-trend-chart.tsx) — trend sparkline widget
- [app-sidebar.tsx](../../../src/components/app-sidebar.tsx) — the left-rail nav rendered inside the team-rosters shell
- [layout.tsx](../../../src/app/layout.tsx) — root font loading (Geist/Geist Mono)

No other page (homepage, dynasty-rankings, seasonal-rankings, draft-board, prospects) was
used as a source, even where they reference the same `rt-*` CSS variables — this is
deliberately narrower than the codebase's full sitewide token surface, on the premise that
team-rosters is the one page where the rebrand is 100% complete and internally consistent.

## Brand identity summary

team-rosters renders as a neutral, high-contrast, dark-first UI: a near-black canvas
(`#111315`) with off-white ink (`#f2f2f0`) in dark mode, pure white canvas with near-black
ink in light mode, set entirely in Geist / Geist Mono. One accent color — a burnt orange,
`#fa4616` (`--rt-primary`) — carries every primary action, active state, and focus affordance
in the UI; there is no secondary or tertiary brand color. Shapes favor fully-rounded pills
(buttons, toggles, avatars) and 16px-radius cards with 1px hairline borders instead of drop
shadows. A small set of literal (non-`rt-`-namespaced) hex colors exists alongside this for
semantic meaning only — stat-tier diverging colors, rookie/sophomore tag colors, and an
8-color dynasty-tier badge scale — and those are documented separately below since they
don't follow the `--rt-*` variable convention.

## Color tokens

### Primary accent

| Name | Value | CSS variable | Theme | Source | Used for |
|---|---|---|---|---|---|
| rt-primary | `#fa4616` | `--rt-primary` | both | [roster-tokens.css:11](../../../src/app/team-rosters/_components/roster-tokens.css) | Primary buttons, active nav item, active toggle segment, selected-card border, focus/hover accents |
| rt-primary-active | `#d63a0c` | `--rt-primary-active` | both | roster-tokens.css:12 | Hover/pressed state (`.rt-hover-primary`, roster-tokens.css:139-141) |

### Neutral / surface tokens

Full set, scoped to `.rt-shell[data-rt-theme]` — [roster-tokens.css:10-82](../../../src/app/team-rosters/_components/roster-tokens.css):

| Name | Dark value | Light value | CSS variable | Used for |
|---|---|---|---|---|
| Canvas | `#111315` | `#ffffff` | `--rt-canvas` | Page/card background |
| Surface soft | `#181a1d` | `#f7f7f5` | `--rt-surface-soft` | Detail-panel column background, list header row |
| Surface strong | `#212327` | `#edeeea` | `--rt-surface-strong` | Active nav item, toggle-wrapper bg, avatar-plate fallback, "Soon" chip |
| Surface dark | `#1b1d20` | `#0c0d0e` | `--rt-surface-dark` | Hero-card background (dark mode) |
| Surface dark elevated | `#26282c` | `#17181b` | `--rt-surface-dark-elevated` | Hero-card elevated tooltip/chip |
| Hairline | `rgba(255,255,255,0.11)` | `#e3e3dd` | `--rt-hairline` | Card border, sidebar divider |
| Hairline soft | `rgba(255,255,255,0.06)` | `#edeeea` | `--rt-hairline-soft` | Subtle row divider |
| Ink (primary text) | `#f2f2f0` | `#0c0d0e` | `--rt-ink` | Primary text |
| Body text | `#b7bbc1` | `#5c5f66` | `--rt-body` | Secondary/body text |
| Body text strong | `#f2f2f0` | `#0c0d0e` | `--rt-body-strong` | Emphasized body text |
| Muted text | `#888d95` | `#7c8088` | `--rt-muted` | Caption/meta text |
| Muted soft | `#666b72` | `#a9adb3` | `--rt-muted-soft` | Faintest caption text |
| On-primary | `#ffffff` | `#ffffff` | `--rt-on-primary` | Text/icon on rt-primary fill |
| On-dark | `#ffffff` | `#ffffff` | `--rt-on-dark` | Text on forced-dark surfaces |
| On-dark soft | `#a9adb3` | `#a9adb3` | `--rt-on-dark-soft` | Secondary text on forced-dark surfaces |
| Up / positive | `#16a06a` | `#16a06a` | `--rt-up` | Positive stat delta, rank-improvement chip |
| Down / negative | `#db2b39` | `#db2b39` | `--rt-down` | Negative stat delta, rank-decline chip |
| Raised | `#2c2e32` | `#ffffff` | `--rt-raised` | Active segment in light/dark + grid/list toggles |
| Scrim | `rgba(12,13,14,0.8)` | `rgba(252,252,250,0.82)` | `--rt-scrim` | (defined; not observed rendered in current roster-app.tsx modal, which uses a literal `rgba(0,0,0,0.55)` instead — see Known Drift) |

Hero-card derivatives alias the above per theme: `--rt-hero-bg`, `--rt-hero-ink`, `--rt-hero-ink-soft`, `--rt-hero-hairline`, `--rt-hero-elevated`, `--rt-hero-elevated-border` — roster-tokens.css:41-46 (light), 76-81 (dark).

### Semantic colors (literal hex, not `rt-`-namespaced)

These exist specifically for status/tier meaning on this page and are **not** CSS custom properties — they're plain string constants in `roster-data.ts` and `trend-insight.ts`:

| Name | Value | Source | Used for |
|---|---|---|---|
| Stat-tier 5 (elite) | `#12a150` | [roster-data.ts:197](../../../src/app/team-rosters/_components/roster-data.ts) `STATSET_COLORS[5]` | Stat-set chip, best tier |
| Stat-tier 4 | `#62a046` | roster-data.ts:198 | Stat-set chip |
| Stat-tier 3 | `var(--rt-muted)` | roster-data.ts:199 | Stat-set chip (neutral — only tier that reuses an rt- token) |
| Stat-tier 2 / caution | `#dd7a2b` | roster-data.ts:200; also [trend-insight.ts](../../../src/app/team-rosters/_components/trend-insight.ts) `TAG_META.regressing.color` | Stat-set chip; "Regressing" trend tag |
| Stat-tier 1 (worst) | `#cf2230` | roster-data.ts:201 | Stat-set chip, worst tier |
| Rookie tag — dark text | `#f0bb4a` | [roster-data.ts:212](../../../src/app/team-rosters/_components/roster-data.ts) `TAG_THEME.rookie.darkText` | Rookie badge label (dark mode) |
| Rookie tag — light text | `#a8730a` | roster-data.ts:211 | Rookie badge label (light mode) |
| Rookie tag — border/bg | `rgba(240,165,0,0.55)` / `rgba(240,165,0,0.08)` | roster-data.ts:213,215 | Rookie badge border/fill (dark mode; light mode falls back to `var(--rt-canvas)`, see Known Drift) |
| Sophomore tag — dark text | `#9aa6ef` | roster-data.ts:220 | Sophomore badge label (dark mode) |
| Sophomore tag — light text | `#4c56c0` | roster-data.ts:219 | Sophomore badge label (light mode) |
| Sophomore tag — border/bg | `rgba(154,166,239,0.52)` / `rgba(154,166,239,0.09)` | roster-data.ts:222,224 | Sophomore badge border/fill (dark mode) |

**8-tier dynasty badge palette** (`DYNASTY_TIER_META`, [roster-data.ts:229-238](../../../src/app/team-rosters/_components/roster-data.ts)) — shown as the hero-header tier dot/label and the "Rookie draft · Tier N" chip:

| Tier | Name | Color |
|---|---|---|
| 1 | Fantasy-Altering Juggernauts | `#F0C040` |
| 2 | Dynasty Cornerstones | `#22c55e` |
| 3 | Proven Contributors | `#3b82f6` |
| 4 | Depth Tilters | `#9b5de5` |
| 5 | Developmental Assets | `#FF6B2B` |
| 6 | Speculative Holds | `#f72585` |
| 7 | Deep League Filler | `#00c8e0` |
| 8 | Lottery Tickets | `#64748b` |

## Typography

| Role | Family | Loaded via | Source |
|---|---|---|---|
| Sans (UI, headings, body) | Geist | `geist/font/sans` npm package → `GeistSans` | [layout.tsx:3](../../../src/app/layout.tsx), [team-rosters-shell.tsx:4](../../../src/app/team-rosters/_components/team-rosters-shell.tsx) |
| Mono (stats, tabular data, tags) | Geist Mono | `geist/font/mono` npm package → `GeistMono` | layout.tsx:4, team-rosters-shell.tsx:5 |

Exposed as CSS variables on the shell (`${GeistSans.variable} ${GeistMono.variable}`, [team-rosters-shell.tsx:47](../../../src/app/team-rosters/_components/team-rosters-shell.tsx)) and consumed through `--rt-font-sans` / `--rt-font-mono` ([roster-tokens.css:48-49](../../../src/app/team-rosters/_components/roster-tokens.css)), each with a system-font fallback chain (`-apple-system, system-ui, "Segoe UI", Roboto...` / `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas...`).

**Weights actually used** (observed in roster-app.tsx / app-sidebar.tsx inline styles, no formal weight scale defined): 400, 500, 600, 700, 800.

**No explicit responsive type-size scale is defined anywhere in config.** Sizes are set per-element as literal px values. Recurring sizes observed on this page: 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23, 26, 38px — listed for reference only, not a token system.

## Spacing / radius / shadow

**No explicit spacing/radius/shadow scale exists in any config file** (no `tailwind.config.*`, no `@theme` block). Values below are recurring literals observed directly in team-rosters component code:

- **Border radius:** `999px` (pills, toggles, avatars, sign-up CTA), `16px` (cards, player-grid cards), `14px` (team-switcher dropdown), `12px` (nav row items), `10px` (buttons, sidebar rows, sign-up CTA), `6px` (hover tooltip on trend chart)
- **Shadow:** `0 4px 12px rgba(0,0,0,0.06)` (`.rt-hover-shadow`, [roster-tokens.css:135-137](../../../src/app/team-rosters/_components/roster-tokens.css)); `0 12px 32px rgba(0,0,0,0.14)` (team-switcher dropdown, [roster-app.tsx:471](../../../src/app/team-rosters/_components/roster-app.tsx)); `0 24px 60px rgba(0,0,0,0.35)` (Edge Pro paywall modal, roster-app.tsx:1163)

## Component pattern reference

### Sidebar nav (`AppSidebar`)
Fixed 236px-wide left rail, `border-right: 1px solid var(--rt-hairline)`. Active item: `background: var(--rt-surface-strong); color: var(--rt-primary); font-weight: 600`. Inactive: `color: var(--rt-body)`. "Soon" chip: `background: var(--rt-surface-strong); color: var(--rt-muted); border-radius: 999px`. Sign-up CTA: full-width pill, `background: var(--rt-primary); color: var(--rt-on-primary); border-radius: 10px; font-weight: 700`. Light/dark segmented toggle at the bottom: `padding: 3px; background: var(--rt-surface-strong); border-radius: 999px`, active segment `background: var(--rt-raised); color: var(--rt-ink)`. — [app-sidebar.tsx](../../../src/components/app-sidebar.tsx)

### Primary button (pill CTA)
`border-radius: 999px; background: var(--rt-primary); color: var(--rt-on-primary); font-family: var(--rt-font-sans); font-weight: 600-700`, hover class `.rt-hover-primary { background: var(--rt-primary-active) !important; }` — Examples: "Start Pro · $9/mo" ([roster-app.tsx:77-83](../../../src/app/team-rosters/_components/roster-app.tsx)), "Add to watchlist" (roster-app.tsx:1139-1145), sidebar "Sign up / Log in" (app-sidebar.tsx:314-335)

### Secondary/ghost button
Same pill shape, `background: var(--rt-surface-strong)` (or `transparent`), `color: var(--rt-ink)` or `var(--rt-body)`, no border. Examples: "Maybe later", "Compare" — roster-app.tsx:84-90, 1146-1151

### Segmented toggle
Wrapper: `padding: 3px; background: var(--rt-surface-strong); border-radius: 999px`. Inner buttons: `border-radius: 999px`; active = `background: var(--rt-ink); color: var(--rt-canvas)` (main content toggles) or `background: var(--rt-raised); color: var(--rt-ink)` (sidebar theme toggle). Used for: grid/list view toggle, Current/Prior/Projection toggle, sidebar light/dark toggle — [roster-app.tsx:655-679, 963-990](../../../src/app/team-rosters/_components/roster-app.tsx), [app-sidebar.tsx:226-279](../../../src/components/app-sidebar.tsx)

### Position/pill filter button
`border-radius: 999px; font-weight: 600`; active = `background: var(--rt-ink); color: var(--rt-canvas)`, inactive = `background: var(--rt-surface-strong); color: var(--rt-body)` — [roster-app.tsx:628-651](../../../src/app/team-rosters/_components/roster-app.tsx) (position filters: All players / Guards / Forwards / Centers / Rookies / Sophomores)

### Card
`background: var(--rt-canvas); border: 1px solid var(--rt-hairline); border-radius: 16px; padding: 20px` (or `20px 22px`) — summary stat cards (active roster / total salaried / average age), "Build a trade" promo card, 9-category profile card, season stats card, salary & contract card, rookie draft card, player-grid card — [roster-app.tsx:590-624, 685-748, 994, 1045, 1078, 1117](../../../src/app/team-rosters/_components/roster-app.tsx)

### Badge / tag
- **Rookie/soph tag** — pill, `border: 1px solid {border}; background: {bg}; color: {color}`, values from `TAG_THEME` via `tagBadge()` — [roster-helpers.ts:133-141](../../../src/app/team-rosters/_components/roster-helpers.ts), rendered at roster-app.tsx:699-719 (grid) and 819-839 (list, compact single-letter "R"/"S" variant)
- **Dynasty tier chip** — `background: var(--rt-surface-strong); color: var(--rt-primary); border-radius: 999px; text-transform: uppercase` for the "Tier N" label in the Rookie Draft card ([roster-app.tsx:1117-1123](../../../src/app/team-rosters/_components/roster-app.tsx)); tier dot + name in the hero header use the literal `DYNASTY_TIER_META` color directly (roster-app.tsx:929-936)
- **Stat-set chip** — plain colored mono text (no background/border), color from `STATSET_COLORS[starTier(z)]` — roster-app.tsx:862-868, 214-218
- **8-tag trend verdict** (Surging/Climbing/Breaking out/Stable/Regressing/Plunging/Fading/Cratering, replacing the old BUY/SELL/HOLD verdict) — colored mono text + emoji, label/color/emoji from `TAG_META[tag]` (trend-insight.ts) — roster-app.tsx (card/list/mobile-row verdict badges)

### Trend sparkline (`TrendHero`)
SVG line chart on the hero-card background: `stroke` = tone color, `strokeWidth: 2.25`, points as circles (radius 2.25–4.5 depending on hover/last-point state), hover tooltip `background: var(--rt-hero-elevated); border: 1px solid var(--rt-hero-elevated-border); border-radius: 6px`. Insight callout: 7px dot + bold label in the tone color, detail text in `var(--rt-hero-ink-soft)`. — [player-trend-chart.tsx](../../../src/app/team-rosters/_components/player-trend-chart.tsx)

### Team-switcher dropdown
Absolute-positioned panel: `background: var(--rt-canvas); border: 1px solid var(--rt-hairline); border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,0.14)`, rows `border-radius: 10px`, selected row `background: var(--rt-surface-strong)` — [roster-app.tsx:459-538](../../../src/app/team-rosters/_components/roster-app.tsx)

## Known Drift (vs. the originally-briefed baseline: Blueprint Blue `#2563EB`, Edge Orange `#FF6B2B`, Dynasty Gold `#F0C040`, Hardwood Black `#0A0A0A`, Ice Grey `#F0F4FF`, White, Oswald / Source Sans 3 / JetBrains Mono)

1. **Blueprint Blue (`#2563EB`) is entirely absent.** No blue accent anywhere in team-rosters' code.
2. **Edge Orange (`#FF6B2B`) is not the primary/CTA color here** — that role belongs to `rt-primary` (`#fa4616`), a different hex. `#FF6B2B` survives only as the semantic "Tier 5 / Developmental Assets" dynasty-tier color ([roster-data.ts:234](../../../src/app/team-rosters/_components/roster-data.ts)), not as a button/brand color.
3. **Hardwood Black (`#0A0A0A`) does not appear literally.** The nearest dark neutrals are `--rt-canvas` (`#111315`) and `--rt-surface-dark`/light-mode `--rt-ink` (`#0c0d0e`) — close in spirit, different exact value.
4. **Ice Grey (`#F0F4FF`) does not appear anywhere.** Light-mode canvas is pure white with neutral (non-blue-tinted) off-white surfaces (`#f7f7f5`, `#edeeea`).
5. **Dynasty Gold (`#F0C040`) survives** only as the "Tier 1 / Fantasy-Altering Juggernauts" dynasty-tier color — not used as a general brand accent elsewhere on the page.
6. **Oswald, Source Sans 3, and JetBrains Mono are entirely absent from this page.** Fully replaced by Geist and Geist Mono — this page's font migration is complete.
7. **A parallel set of literal (non-`rt-`) hex colors exists for semantic meaning** — `STATSET_COLORS`, `TAG_THEME`, `DYNASTY_TIER_META` (all in [roster-data.ts](../../../src/app/team-rosters/_components/roster-data.ts)) — defined as plain string constants, not CSS custom properties, and not part of the `rt-*` variable namespace. Worth knowing these exist and are intentional, not oversights.
8. **`tagBadge()` mixes an `rt-` var with literal rgba values inconsistently**: the dark-mode badge background is a literal `rgba(240,165,0,0.08)` / `rgba(154,166,239,0.09)`, while the light-mode background falls back to `var(--rt-canvas)` instead of a parallel literal light tint — [roster-helpers.ts:133-141](../../../src/app/team-rosters/_components/roster-helpers.ts).
9. **`--rt-scrim` is defined in roster-tokens.css but not used by the one modal on this page** — the Edge Pro paywall overlay uses a literal `rgba(0,0,0,0.55)` instead ([roster-app.tsx:1159](../../../src/app/team-rosters/_components/roster-app.tsx)).

## How to use this in Claude Design

This file is the **authoritative, extracted-from-production reference** for Fantasy Hoops
Edge's brand going forward — sourced from the one page (team-rosters) where the rebrand is
fully and consistently implemented. It supersedes the original design-mockup brief where
they conflict (see Known Drift), since every value here traces to shipped code. Use the
`rt-primary` accent, the full `rt-*` neutral palette, and Geist/Geist Mono as the default
building blocks for any new mockup; treat the semantic literal-hex colors (stat tiers, tags,
dynasty tiers) as available but purpose-specific, not general brand colors.
