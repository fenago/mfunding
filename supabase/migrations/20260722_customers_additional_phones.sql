-- Extra cell numbers for a merchant (the owner's second cell, a partner). Mirrors
-- customers.additional_phones's sibling column additional_emails: the primary
-- stays customers.phone (the canonical dial + phone-identity key), these ride
-- alongside as dialable numbers the closer can reach the merchant on. Stored in
-- the same canonical +1XXXXXXXXXX form as phone (normalizePhoneForStorage).
ALTER TABLE public.customers
  ADD COLUMN additional_phones text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.customers.additional_phones IS
  'Additional dialable cell numbers for the merchant (E.164 +1XXXXXXXXXX). Primary stays customers.phone.';
