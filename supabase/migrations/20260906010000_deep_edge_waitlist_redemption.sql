-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Redemption tracking for the Deep Edge founding discount                   ║
-- ║                                                                           ║
-- ║ A separate migration from 20260906000000 on purpose: migrations are       ║
-- ║ append-only, and that one may already have been applied. Never edit an    ║
-- ║ applied migration in place.                                               ║
-- ║                                                                           ║
-- ║ Without these columns a waitlist row is an unlimited coupon — nothing     ║
-- ║ records that it was spent, so the same address could take 20% off every   ║
-- ║ season pass it ever buys. redeemed_at is the flag; redeemed_ref is        ║
-- ║ free-form (a Stripe payment intent, an invoice id, whatever billing       ║
-- ║ turns out to be) so a discount can always be traced to the payment that   ║
-- ║ consumed it.                                                              ║
-- ║                                                                           ║
-- ║ Deliberately NOT a boolean: "when" answers "was it?" as well, and a       ║
-- ║ timestamp is what a reconciliation or a dispute actually needs.           ║
-- ║                                                                           ║
-- ║ Claiming is a compare-and-set in src/lib/deep-edge/waitlist.ts —          ║
-- ║ UPDATE ... WHERE redeemed_at IS NULL, with a zero-row result meaning      ║
-- ║ "someone got there first". That is what makes double redemption          ║
-- ║ impossible without a transaction.                                        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table public.deep_edge_waitlist
  add column if not exists redeemed_at  timestamptz,
  add column if not exists redeemed_ref text;

-- Partial index: the only question ever asked of this column at checkout is
-- "is there an unredeemed row for this person", so index just those rows.
-- Stays small as redemptions accumulate, unlike a full index on redeemed_at.
create index if not exists deep_edge_waitlist_unredeemed_idx
  on public.deep_edge_waitlist (email)
  where redeemed_at is null;

comment on column public.deep_edge_waitlist.redeemed_at is
  'When this discount was spent on a season pass. NULL = still claimable. Set once, '
  'via a compare-and-set on NULL, so a row can never be redeemed twice.';

comment on column public.deep_edge_waitlist.redeemed_ref is
  'Free-form reference to the payment that consumed the discount (e.g. a Stripe payment '
  'intent id), so a redemption can be traced back to a real order.';
