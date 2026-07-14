-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ NBA roster data layer                                                      ║
-- ║                                                                            ║
-- ║ 1. Extends nba_contracts with a 5th salary year (2029-30) plus estimate    ║
-- ║    bookkeeping, so multi-year deals reaching 2029-30 can be stored.        ║
-- ║ 2. Adds nba_roster: one enriched row per active roster player per season   ║
-- ║    (bio + draft + contract status + prior team), transcribed from the      ║
-- ║    owner's gated cap sheet via scripts/nba-data/roster_ingest.ts reading   ║
-- ║    data/nba-rosters/<season>.csv. This is the spine the per-team roster     ║
-- ║    analysis (dynasty value + category value + contract) reads from.         ║
-- ║                                                                            ║
-- ║ AUTHORITATIVE SALARY-YEAR MAPPING (do not relabel — seasonal-rankings and  ║
-- ║ /api/nba/rosters read these columns by name):                              ║
-- ║   salary_current = 2025-26  (in the rearview as of 2026-27)                 ║
-- ║   salary_y2      = 2026-27  (CURRENT / upcoming season)                     ║
-- ║   salary_y3      = 2027-28                                                  ║
-- ║   salary_y4      = 2028-29                                                  ║
-- ║   salary_y5      = 2029-30  (new)                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 1. Extend nba_contracts ──────────────────────────────────────────────────
alter table public.nba_contracts
  add column if not exists salary_y5        bigint,                       -- 2029-30
  add column if not exists salary_estimated boolean not null default false, -- any year derived (even-split of a screenshot contract total)
  add column if not exists salary_note      text;                         -- e.g. "y5 est. from 4yr/$60.6M even-split"

-- Re-labelled, season-explicit view of the wide salary columns, so downstream
-- consumers never have to remember the y2=2026-27 offset again.
create or replace view public.nba_contract_seasons as
select
  c.player_id,
  c.salary_player_name as player,
  c.team,
  c.salary_current as salary_2025_26,
  c.salary_y2      as salary_2026_27,
  c.salary_y3      as salary_2027_28,
  c.salary_y4      as salary_2028_29,
  c.salary_y5      as salary_2029_30,
  c.contract_note,
  c.free_agent_year,
  c.free_agent_status,
  c.is_two_way,
  c.salary_estimated,
  c.salary_note
from public.nba_contracts c;

-- ── 2. nba_roster ────────────────────────────────────────────────────────────
-- season is an explicit label (e.g. '2026-27') so the table is reusable each
-- year. age_at_ingest is a point-in-time snapshot; compute live age from dob.
create table if not exists public.nba_roster (
  season            text    not null,                  -- '2026-27'
  team              text    not null,                  -- current-season team abbrev (ATL, BOS, ...)
  player_id         text    references public.nba_players(id),
  norm_name         text    not null,
  full_name         text    not null,
  jersey            text,                               -- '0', '00', or null
  position          text,                               -- G / F / C
  height            text,                               -- 6'08"
  weight            integer,
  dob               date,
  age_at_ingest     numeric(5,2),                       -- snapshot; derive live age from dob
  years_of_service  text,                               -- integer-as-text, or 'R' for rookie
  draft_raw         text,                               -- '2021-20', '2026-ND'
  draft_year        integer,
  draft_pick        integer,                            -- null if undrafted
  is_undrafted      boolean not null default false,
  nationality       text,                               -- may be multi: 'USA, BIH'
  birthplace        text,
  pre_draft         text,                               -- college / prior pro org
  prior_team        text,                               -- 2025-26 team
  contract_raw      text,                               -- '4 yr / $60.6M', 'Two-Way', 'RFA', 'Exhibit 10'
  contract_years    integer,
  contract_total    bigint,
  contract_status   text,                               -- Standard | Rookie Scale | Two-Way | Exhibit 10 | RFA | UFA | Draftee
  fa_year           integer,
  fa_option_years   integer not null default 0,         -- the '+N' suffix on FA Year
  -- Resolved per-year salary, yr1 = `season`. RULE: nba_contracts (from the
  -- human current.csv) is authoritative and wins; where it has a GAP (player or
  -- year missing) the value is an even-split of contract_total over
  -- contract_years starting yr1, flagged in salary_estimated_years.
  salary_yr1        bigint,                              -- = season        (2026-27)
  salary_yr2        bigint,                              -- = season + 1    (2027-28)
  salary_yr3        bigint,                              -- = season + 2    (2028-29)
  salary_yr4        bigint,                              -- = season + 3    (2029-30)
  salary_estimated  boolean not null default false,      -- any yr was even-split estimated
  salary_estimated_years text,                           -- e.g. '2029-30' or '2026-27..2029-30'
  salary_source     text,                                -- 'current.csv' | 'even_split' | 'blend'
  is_incoming_rookie boolean not null default false,    -- 2026 draft class
  is_sophomore       boolean not null default false,    -- 2025 draft class, 2nd year
  new_to_team        boolean not null default false,    -- prior_team is a different NBA team
  source            text    not null default 'cap_sheet_screenshot',
  updated_at        timestamptz not null default now(),
  primary key (season, norm_name)
);
create index if not exists idx_roster_team    on public.nba_roster(season, team);
create index if not exists idx_roster_player  on public.nba_roster(player_id);
create index if not exists idx_roster_norm    on public.nba_roster(norm_name);

-- ── 3. RLS + grants (read-only public, mirrors nba_contracts) ─────────────────
alter table public.nba_roster enable row level security;

drop policy if exists "r roster" on public.nba_roster;
create policy "r roster" on public.nba_roster for select using (true);

revoke insert, update, delete on public.nba_roster from anon, authenticated;
grant select on public.nba_roster          to anon, authenticated;
grant select on public.nba_contract_seasons to anon, authenticated;
