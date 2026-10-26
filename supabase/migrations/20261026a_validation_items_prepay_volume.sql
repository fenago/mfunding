-- ── Two more confirm rows: prepayment discount, volume minimum ─────────────
--
-- `funder_validation_items` is the checklist TEMPLATE and is data-driven on
-- purpose. A `confirm` row renders only where we actually hold a value for
-- that key, so adding an item costs nothing on the funders it does not apply
-- to — and a fact with no item to render in is INVISIBLE, which is the failure
-- that put 125 of 395 extracted doc facts out of sight once already.
--
-- Both keys arrived with Bitty's partner overview (2026-10-26) and neither had
-- a home in the canonical field_key set:
--
--   prepayment_discount — a merchant-side early-payoff discount. Bitty's is
--     30% off at 30 days / 20% at 60. This is a SELLING point, not a credit-box
--     figure: it is the answer to "why would the merchant come back to us",
--     which is the renewal flywheel the whole book depends on. It belongs next
--     to factor rate, not buried in a note.
--
--   volume_minimum — a floor we must keep funding to stay an active partner.
--     Bitty's is 2 files/month and it is SIGNED on the intake form, not raised
--     later. A quota we agreed to and then forgot is a relationship that dies
--     quietly, so it gets a row somebody has to look at.
--
-- Idempotent: on conflict do nothing, matching 20261023b/f.
insert into public.funder_validation_items (key, section, label, help, answer_type, product, sort, is_active, kind)
values
  ('prepayment_discount', 'The box',
   'Early payoff / pay-in-full discount',
   'What the MERCHANT saves by paying early. A real one is a renewal argument, not a footnote.',
   'text', null, 548, true, 'confirm'),
  ('volume_minimum', 'Submitting',
   'Minimum volume to stay an active partner',
   'Files per month we have to keep funding. If we signed up to one, somebody has to be watching it.',
   'text', null, 245, true, 'confirm')
on conflict (key) do nothing;
