-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ The Deep Edge season pass (src/lib/deep-edge/season-pass.ts)              ║
-- ║                                                                           ║
-- ║ A ONE-OFF payment, not a subscription. Access to /deep-edge/* is granted  ║
-- ║ iff the user holds an ACTIVE pass whose season equals the season in       ║
-- ║ season_pass_config — never by a stored expiry date. Rolling over to next  ║
-- ║ season is one UPDATE of the config row; every old pass stops matching.    ║
-- ║                                                                           ║
-- ║ One row PER PAYMENT, keyed by the provider's payment id:                  ║
-- ║   • A redelivered "payment completed" webhook finds its payment already   ║
-- ║     recorded and does nothing. Upserting on (user, season) instead lets   ║
-- ║     that replay, arriving after a refund, flip the row back to active —   ║
-- ║     and lets a second payment OVERWRITE the first, leaving two charges    ║
-- ║     and one row, with the first charge untraceable.                       ║
-- ║   • A refund marks that one payment refunded; its history survives a      ║
-- ║     later re-purchase.                                                    ║
-- ║                                                                           ║
-- ║ At most ONE ACTIVE pass per user per season, in three layers — none of    ║
-- ║ which is a database constraint alone, because by the time a row is        ║
-- ║ written Paddle has already taken the money:                               ║
-- ║   1. Checkout refuses to start while an active pass exists.               ║
-- ║   2. Checkout reuses ONE open Paddle transaction per user + season        ║
-- ║      (season_pass_checkouts). A transaction is paid at most once, so two  ║
-- ║      tabs racing through checkout get the same transaction, not two.      ║
-- ║   3. A partial unique index allows one 'active' row per (user, season,    ║
-- ║      environment). A payment that still gets past 1 and 2 is recorded     ║
-- ║      as 'duplicate' — kept, NEVER refunded by code — for a person to      ║
-- ║      refund by hand in the Paddle dashboard. Find them with:              ║
-- ║        select * from public.season_passes where status = 'duplicate';     ║
-- ║                                                                           ║
-- ║ environment: there is ONE Supabase project behind localhost, previews and ║
-- ║ production. A Paddle sandbox test purchase writes here like a real one,   ║
-- ║ so every pass records which Paddle environment took the payment, and the  ║
-- ║ access check only counts passes from the environment the deployment is    ║
-- ║ configured for (NEXT_PUBLIC_PADDLE_ENV). Without it a sandbox test card   ║
-- ║ would unlock production.                                                  ║
-- ║                                                                           ║
-- ║ The founding discount's eligibility is NOT modelled here. It already      ║
-- ║ lives in deep_edge_waitlist (a per-row discount_pct promise, spent once   ║
-- ║ via redeemed_at), which is exactly what the site promises: register by    ║
-- ║ the deadline in src/lib/deep-edge/offer.ts and the discount comes off     ║
-- ║ your first pass. season_passes.discount_pct records what was applied.     ║
-- ║                                                                           ║
-- ║ No amount is stored in config: the amount charged is the Paddle price     ║
-- ║ itself, and the amount DISPLAYED is offer.ts. A third copy in the         ║
-- ║ database would be a third thing to drift.                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── Config: the currently active season (singleton) ─────────────────────────

create table if not exists public.season_pass_config (
  id                              smallint    primary key default 1 check (id = 1),
  season                          text        not null,
  -- Paddle Price ids for this season's pass, one per Paddle environment. Null
  -- until the catalog exists; checkout refuses to start while its own
  -- environment's id is null.
  sandbox_price_id                text,
  production_price_id             text,
  -- Paddle percentage discount applied to a waitlist registrant's first pass.
  -- Checkout refuses a registrant rather than charge full price while their
  -- environment's id is null, or when the discount's percentage doesn't match
  -- the discount_pct their waitlist row promised.
  sandbox_founding_discount_id    text,
  production_founding_discount_id text,
  updated_at                      timestamptz not null default now()
);

alter table public.season_pass_config enable row level security;
-- No policies: service role only, same convention as the other Deep Edge tables.

comment on table public.season_pass_config is
  'Singleton: the season The Deep Edge season pass currently sells and honours, plus its Paddle '
  'Price and founding-discount ids per environment. Updating season is the rollover — every pass '
  'for the old season stops granting access. Service-role access only.';

insert into public.season_pass_config (id, season)
values (1, '2026-27')
on conflict (id) do nothing;

-- ── Passes: one row per payment ─────────────────────────────────────────────

create table if not exists public.season_passes (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  season              text        not null,
  environment         text        not null check (environment in ('sandbox', 'production')),
  -- active    — grants access. At most one per (user, season, environment).
  -- duplicate — a second payment while an active pass existed. Grants nothing;
  --             flagged for a MANUAL refund. Code never refunds it.
  -- refunded  — money returned (by whatever route); grants nothing.
  status              text        not null default 'active'
                                  check (status in ('active', 'duplicate', 'refunded')),
  -- Lowest currency unit, as the provider reports it (2800 = US$28.00).
  amount_paid_cents   integer     check (amount_paid_cents >= 0),
  currency            text,
  -- The founding discount actually applied to this payment, or null for none.
  discount_pct        integer     check (discount_pct between 1 and 100),
  payment_provider    text        not null default 'paddle',
  -- Paddle transaction id (txn_…). The idempotency key for the webhook.
  provider_payment_id text        not null,
  purchased_at        timestamptz not null default now(),
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint season_passes_payment_unique unique (payment_provider, provider_payment_id),
  constraint season_passes_refund_consistent check ((status = 'refunded') = (refunded_at is not null))
);

-- Layer 3, and the index behind the only hot question ("does this user have an
-- active pass for this season in this environment?"). Partial, so duplicate and
-- refunded rows neither collide with it nor bloat it.
create unique index if not exists season_passes_one_active_idx
  on public.season_passes (user_id, season, environment)
  where status = 'active';

alter table public.season_passes enable row level security;

-- A signed-in user may read their own passes (e.g. a future "your pass" line
-- on /profile). No insert/update/delete policy for anyone: only the webhook,
-- running with the service role, writes here.
create policy "season_passes_select_own"
  on public.season_passes for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.season_passes is
  'The Deep Edge season passes, one row per payment (unique on provider + payment id, so webhook '
  'replays are no-ops). Access = an active row whose season matches season_pass_config.season and '
  'whose environment matches the deployment''s Paddle environment. status = duplicate marks a second '
  'payment awaiting a MANUAL refund. Written only by the service role.';

-- ── Open checkouts: one Paddle transaction per user + season (layer 2) ──────

create table if not exists public.season_pass_checkouts (
  user_id               uuid        not null references auth.users (id) on delete cascade,
  season                text        not null,
  environment           text        not null check (environment in ('sandbox', 'production')),
  -- The transaction every checkout attempt for this user + season reopens,
  -- until it is paid or has to be replaced (canceled, or its price/discount no
  -- longer matches). Replaced by compare-and-set on this column, so two
  -- requests can never both install a transaction.
  paddle_transaction_id text        not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (user_id, season, environment)
);

alter table public.season_pass_checkouts enable row level security;
-- No policies: service role only.

comment on table public.season_pass_checkouts is
  'The one open Paddle checkout transaction per (user, season, environment) for The Deep Edge '
  'season pass. Reused across checkout attempts so parallel tabs cannot produce two payable '
  'transactions. Service-role access only.';

-- ── Access check ────────────────────────────────────────────────────────────

-- Called server-side with the service role, from src/lib/deep-edge/season-pass.ts.
-- EXECUTE is revoked from anon/authenticated: as an RPC anyone could otherwise
-- pass another user's id and learn whether that person bought a pass.
create or replace function public.has_active_season_pass(p_user_id uuid, p_environment text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.season_passes sp
    join public.season_pass_config c on c.id = 1 and c.season = sp.season
    where sp.user_id = p_user_id
      and sp.environment = p_environment
      and sp.status = 'active'
  );
$$;

revoke execute on function public.has_active_season_pass(uuid, text) from public, anon, authenticated;
grant execute on function public.has_active_season_pass(uuid, text) to service_role;

-- ── Recording a payment (for the webhook) ───────────────────────────────────

-- Returns what happened, so the webhook can log and alert on it:
--   'active'           — recorded, grants access.
--   'duplicate'        — the user already held an active pass for this season;
--                        recorded for a MANUAL refund. Nothing is refunded here.
--   'already_recorded' — this payment was seen before (a redelivery). No change.
create or replace function public.record_season_pass_payment(
  p_user_id           uuid,
  p_season            text,
  p_environment       text,
  p_payment_provider  text,
  p_payment_id        text,
  p_amount_paid_cents integer,
  p_currency          text,
  p_discount_pct      integer,
  p_purchased_at      timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.season_passes
    where payment_provider = p_payment_provider and provider_payment_id = p_payment_id
  ) then
    return 'already_recorded';
  end if;

  begin
    insert into public.season_passes
      (user_id, season, environment, status, amount_paid_cents, currency, discount_pct,
       payment_provider, provider_payment_id, purchased_at)
    values
      (p_user_id, p_season, p_environment, 'active', p_amount_paid_cents, p_currency, p_discount_pct,
       p_payment_provider, p_payment_id, coalesce(p_purchased_at, now()));
    return 'active';
  exception when unique_violation then
    -- Either an active pass already exists for this user + season (a duplicate
    -- payment), or a concurrent delivery of THIS payment inserted first.
    if exists (
      select 1 from public.season_passes
      where payment_provider = p_payment_provider and provider_payment_id = p_payment_id
    ) then
      return 'already_recorded';
    end if;
  end;

  -- If a concurrent delivery of this same payment lands between the check above
  -- and this insert, the payment-id constraint raises. That fails the webhook,
  -- the provider retries, and the retry returns 'already_recorded'.
  insert into public.season_passes
    (user_id, season, environment, status, amount_paid_cents, currency, discount_pct,
     payment_provider, provider_payment_id, purchased_at)
  values
    (p_user_id, p_season, p_environment, 'duplicate', p_amount_paid_cents, p_currency, p_discount_pct,
     p_payment_provider, p_payment_id, coalesce(p_purchased_at, now()));
  return 'duplicate';
end;
$$;

revoke execute on function public.record_season_pass_payment(uuid, text, text, text, text, integer, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_season_pass_payment(uuid, text, text, text, text, integer, text, integer, timestamptz)
  to service_role;

-- ── Recording a refund (for the webhook) ────────────────────────────────────

-- Marks one payment refunded. Records a refund; never initiates one.
--   'refunded'         — marked refunded now.
--   'already_refunded' — seen before. No change.
--   'not_found'        — no such payment recorded yet (the refund event beat the
--                        payment event); the webhook should fail so it is retried.
--
-- If the ACTIVE row is refunded while an unrefunded duplicate exists — the wrong
-- one of a double payment was refunded by hand — the oldest duplicate becomes
-- active, because that person has still paid once.
create or replace function public.refund_season_pass_payment(
  p_payment_provider text,
  p_payment_id       text,
  p_refunded_at      timestamptz
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pass public.season_passes%rowtype;
begin
  select * into v_pass
  from public.season_passes
  where payment_provider = p_payment_provider and provider_payment_id = p_payment_id
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_pass.status = 'refunded' then
    return 'already_refunded';
  end if;

  update public.season_passes
  set status = 'refunded', refunded_at = coalesce(p_refunded_at, now())
  where id = v_pass.id;

  if v_pass.status = 'active' then
    update public.season_passes
    set status = 'active'
    where id = (
      select id from public.season_passes
      where user_id = v_pass.user_id
        and season = v_pass.season
        and environment = v_pass.environment
        and status = 'duplicate'
      order by purchased_at
      limit 1
    );
  end if;

  return 'refunded';
end;
$$;

revoke execute on function public.refund_season_pass_payment(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refund_season_pass_payment(text, text, timestamptz)
  to service_role;
