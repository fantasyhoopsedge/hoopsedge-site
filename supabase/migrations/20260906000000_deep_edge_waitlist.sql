-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ The Deep Edge founding-price waitlist (src/lib/deep-edge/waitlist.ts)     ║
-- ║                                                                           ║
-- ║ Captured on the "Launching soon" screen a signed-in NON-admin gets when   ║
-- ║ they come through the launch gateway's Deep Edge door                     ║
-- ║ (src/app/deep-edge/layout.tsx renders it instead of the tool). One row    ║
-- ║ per email, so re-submitting is idempotent rather than duplicating.        ║
-- ║                                                                           ║
-- ║ Keyed by EMAIL, not user_id, on purpose: the discount is a promise made   ║
-- ║ to an address, and the address is what an eventual coupon/billing run     ║
-- ║ has to match on. user_id is carried alongside for attribution but is      ║
-- ║ deliberately nullable and ON DELETE SET NULL — deleting an account must   ║
-- ║ not silently void a discount that was already promised, and the screen    ║
-- ║ lets a user enter an address other than the one they signed up with.      ║
-- ║                                                                           ║
-- ║ discount_pct is stored per row rather than read from a constant at        ║
-- ║ redemption time because it is a PRICE PROMISE: whatever a person was      ║
-- ║ shown when they handed over their email is what they are owed, even if    ║
-- ║ the offer later changes. Never backfill or rewrite it site-wide.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.deep_edge_waitlist (
  email        text        primary key,
  user_id      uuid        references auth.users (id) on delete set null,
  discount_pct integer     not null default 20,
  source       text        not null default 'launching-soon',
  created_at   timestamptz not null default now()
);

create index if not exists deep_edge_waitlist_created_at_idx
  on public.deep_edge_waitlist (created_at desc);

alter table public.deep_edge_waitlist enable row level security;

-- No policies on purpose: only the service role (server-side, RLS-bypassing)
-- touches this table, same convention as fx_leagues / fx_league_syncs /
-- fx_custom_valuations. An anon read returns zero rows SILENTLY rather than
-- erroring, so never reach for the browser client here.

comment on table public.deep_edge_waitlist is
  'Emails captured on The Deep Edge "Launching soon" screen in exchange for a founding-price '
  'discount on the first season pass. One row per email; discount_pct is the promise made to '
  'that address at capture time and must not be rewritten. Service-role access only.';
