-- CALLBACK PROVENANCE — the fix for "you promised" cards nobody promised.
--
-- Two different things were wearing the same red badge:
--   closer_promised  — a human told the merchant "I'll call you at 2". A real
--                      commitment; overdue = a broken promise; stays red until a
--                      human deals with it.
--   merchant_stated  — a machine booked the vendor form's "best time to reach you".
--                      A WINDOW, not a promise. Due = "good time to try them";
--                      missed = quietly downgrade; end of day = clear itself.
-- The asymmetry is the whole point: promises never expire on their own,
-- inferences do.
alter table public.deals
  add column if not exists callback_source text
    check (callback_source in ('merchant_stated','closer_promised'))
    default 'closer_promised';

comment on column public.deals.callback_source is
  'Who scheduled the callback. merchant_stated = auto-booked from the vendor''s best-time field (a window, downgrades + expires on its own). closer_promised = a human commitment (never auto-clears). Copy and urgency differ by source — see MyDayQueue.';

update public.deals
   set callback_source = 'merchant_stated'
 where callback_at is not null;

update public.deals
   set callback_at = null
 where callback_at is not null
   and status in ('nurture','declined','dead','funded','renewal_eligible',
                  'restructure_executed','servicing');
