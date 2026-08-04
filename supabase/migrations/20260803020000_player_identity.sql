-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Player identity registry — Phase 1 of docs/player-identity-layer.md        ║
-- ║                                                                            ║
-- ║ One row per human being, carrying every provider id FHE knows for them.     ║
-- ║ Built by scripts/build-player-identity.ts; service-role only.              ║
-- ║                                                                            ║
-- ║ ── Why a surrogate key ─────────────────────────────────────────────────── ║
-- ║ FHE already has FOUR disjoint id spaces in play:                           ║
-- ║   • ESPN athlete ids   — nba_players.id, season_player_stats.player_id     ║
-- ║   • NBA Stats ids      — src/lib/nba-player-ids.json, Basketball Monster's  ║
-- ║                          "NBA ID" column, and the digits inside the        ║
-- ║                          `sl-<nbaComId>` placeholders                      ║
-- ║   • Basketball Monster ids                                                 ║
-- ║   • Fantrax ids (+ the Rotowire/SportRadar/StatsInc ids Fantrax relays)     ║
-- ║ Measured 2026-08-03: the ESPN and NBA Stats id sets have ZERO overlap       ║
-- ║ (882 vs 587 rows) and were bridged only by normalized name.                ║
-- ║                                                                            ║
-- ║ `fhe_id` is an opaque surrogate rather than any vendor's id because no     ║
-- ║ vendor covers everyone: ESPN misses ~4% of prospects (near-all             ║
-- ║ international), BBM has no id for 332 of its own 1,005 players until they  ║
-- ║ have NBA service, and vendors carry duplicate records for the same human   ║
-- ║ (ESPN indexes two Cameron Boozers). A surrogate also survives a vendor     ║
-- ║ re-keying or being dropped.                                                ║
-- ║                                                                            ║
-- ║ ── Rollout ──────────────────────────────────────────────────────────────── ║
-- ║ Phase 1 (this migration) is ADDITIVE and read by nothing. No existing      ║
-- ║ table changes, no foreign keys pointing in. Consumers migrate one at a     ║
-- ║ time in Phase 3, verified against the name join before switching.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.player_identity (
  -- Opaque, zero-padded serial ("fhe_000412"). Deliberately NOT readable: a
  -- readable id invites hand-editing and rots when a player changes name.
  fhe_id         text primary key,
  display_name   text not null,
  norm_name      text not null,
  -- Readable handle for URLs/debugging. Not a key — may change with a rename.
  slug           text not null,
  -- 'prospect' (no NBA service yet) | 'nba' | 'former'
  status         text not null default 'nba',

  -- Disambiguators. dob is the strongest and is why it is carried here at all:
  -- it is what separates two athletes sharing a common name.
  dob            date,
  draft_year     int,
  draft_pick     int,
  current_team   text,

  -- Provider ids. All nullable — a prospect has none, a retiree may lack newer
  -- ones. UNIQUE (Postgres permits many NULLs) so a provider id can never be
  -- claimed by two different humans.
  espn_id        text unique,
  nba_stats_id   text unique,
  bbm_id         text unique,
  fantrax_id     text unique,
  rotowire_id    text unique,
  sportradar_id  text unique,
  statsinc_id    text unique,

  -- How this row's strongest link was made: 'provider_id' | 'name_exact'
  -- | 'name_alias' | 'dob_tiebreak' | 'manual'
  confidence     text not null default 'name_exact',
  -- Which inputs contributed, e.g. {nba_players,bbm,nba_player_ids_json}.
  sources        text[] not null default '{}',
  updated_at     timestamptz not null default now()
);

create index if not exists player_identity_norm_name_idx on public.player_identity (norm_name);
create index if not exists player_identity_status_idx on public.player_identity (status);

-- Every name form that has ever referred to that human. This REPLACES the three
-- hand-maintained alias maps that cannot share code across the TS/Python
-- boundary (src/lib/player-name-aliases.ts, and DRAFT_NAME_TO_HOOPR /
-- ROSTER_NAME_TO_HOOPR in models/rookie-translation/common.py).
create table if not exists public.player_name_alias (
  norm_name   text primary key,
  fhe_id      text not null references public.player_identity(fhe_id) on update cascade,
  raw_name    text not null,
  -- Which dataset writes the name this way: 'hoopr' | 'bbm' | 'fantrax' |
  -- 'nba_stats' | 'dynasty' | 'roster' | 'manual'
  source      text not null,
  -- 'legal' | 'nickname' | 'ordering' | 'typo' | 'diacritic'
  kind        text not null default 'legal',
  note        text,
  added_at    timestamptz not null default now()
);

create index if not exists player_name_alias_fhe_id_idx on public.player_name_alias (fhe_id);

-- Names the build could not attach to exactly one human. This is the review
-- queue, and it is a FEATURE: a wrong id silently attaches a real stat line to
-- the wrong person, which is strictly worse than no id. Nothing auto-merges.
create table if not exists public.player_identity_unresolved (
  norm_name    text primary key,
  raw_name     text not null,
  source       text not null,
  -- 'ambiguous' (several candidates) | 'no_match' | 'id_conflict' | 'dob_conflict'
  reason       text not null,
  -- Candidate fhe_ids / provider ids, for a human to choose between.
  candidates   jsonb not null default '[]'::jsonb,
  detail       text,
  seen_at      timestamptz not null default now()
);

alter table public.player_identity enable row level security;
alter table public.player_name_alias enable row level security;
alter table public.player_identity_unresolved enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing)
-- touches these, exactly like rb_* / dynasty_board_docs / fx_leagues.

comment on table public.player_identity is
  'Canonical player registry: one row per human, holding every provider id FHE knows '
  '(ESPN, NBA Stats, Basketball Monster, Fantrax, Rotowire, SportRadar, StatsInc). '
  'fhe_id is an opaque surrogate because no single vendor covers every player and '
  'vendors carry duplicate records. Built by scripts/build-player-identity.ts; '
  'service-role only. See docs/player-identity-layer.md.';

comment on table public.player_name_alias is
  'Every normalized name form that refers to a player. Replaces the three hand-maintained '
  'alias maps (src/lib/player-name-aliases.ts plus DRAFT_NAME_TO_HOOPR and '
  'ROSTER_NAME_TO_HOOPR in models/rookie-translation/common.py), which could not share '
  'code across the TypeScript/Python boundary and so drifted apart.';

comment on table public.player_identity_unresolved is
  'Review queue for names the build refused to attach to a single player. Never '
  'auto-merge from here: a confidently wrong id is worse than a missing one.';
