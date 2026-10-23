-- ── 43 checkboxes was the wrong shape ───────────────────────────────────────
--
-- Owner, 2026-10-23: "I don't really like all of those 43 checkboxes. It just
-- seems kind of ridiculous. The other thing I don't like either is that, in
-- all of those 43 checkboxes, you have stuff that's mandatory. That's not even
-- logical."
--
-- He is right on both, and the second is the real error. `is_required` is a
-- FORM-VALIDATION idea: it assumes the person filling the field owns the data.
-- Here she does not — the funder does. If Cobalt declines to discuss their
-- clawback policy, the setter has not failed, and a red asterisk saying she has
-- is simply false. `is_required` is dropped, not defaulted to false, so it
-- cannot quietly come back.
--
-- The volume problem has the same root. We were asking a setter to phone a
-- funder and ask their minimum monthly revenue when we already hold it for 51
-- of 76 — and when the answer is sitting in a guideline sheet in our own
-- bucket. 43 items x 76 funders is 3,268 ticks, most of them re-keying data we
-- have.
--
-- So an item now has a KIND:
--
--   ask     — only a human on the call can answer it, or it changes often
--             enough that the record cannot be trusted. Nine of these.
--   confirm — we already believe something. The panel shows our value and its
--             source and asks her to confirm or correct it. These render ONLY
--             when we actually hold a value, so a thin funder shows three rows
--             and Cashable shows fifteen. Nobody ticks an empty box.
--
-- The confirm set is not a fixed list of questions. It is whatever we know.

alter table public.funder_validation_items
  add column if not exists kind text not null default 'ask'
    check (kind in ('ask','confirm'));

-- Dropped, not defaulted. See above.
alter table public.funder_validation_items drop column if exists is_required;

-- Everything the record or a document should answer becomes a confirm item.
update public.funder_validation_items set kind = 'confirm'
where key in (
  'submit_channel','submission_email_confirmed','portal_url_confirmed','address_on_file_current',
  'req_mca','req_term_loan','req_line_of_credit','req_sba','req_equipment',
  'bank_statement_months','signed_app_own_form',
  'box_min_monthly_revenue','box_min_time_in_business','box_min_fico','box_min_funding_amount',
  'box_max_funding_amount','box_max_positions','box_first_position_only',
  'box_restricted_states','box_restricted_industries',
  'commission_points','renewal_owner','renewal_commission','clawback_policy','payment_timing',
  'time_to_decision','funding_speed','how_offers_returned'
);

-- Retired: the five separate account-contact fields collapse into one question
-- a human actually asks, and main_phone_connects is already answered better by
-- the works/dead buttons on each number.
update public.funder_validation_items set is_active = false
where key in ('main_phone_connects','account_contact_title','account_contact_phone','account_contact_email');

update public.funder_validation_items
set label = 'Who is our account contact now — name, title, direct line, email',
    help  = 'One answer. People move; this is the field that goes stale first.',
    answer_type = 'longtext', sort = 300
where key = 'account_contact_name';

update public.funder_validation_items
set label = 'Is everyone we have listed still there? Who left?',
    answer_type = 'longtext'
where key = 'listed_contacts_still_there';

insert into public.funder_validation_items (key, section, label, help, answer_type, kind, sort, is_active)
values
  ('box_changed_recently','Submitting','Has anything in your box changed recently?',
   'Catches the change nobody emailed us about.','longtext','ask',260,true)
on conflict (key) do update set label = excluded.label, help = excluded.help, kind = excluded.kind;

comment on column public.funder_validation_items.kind is
  'ask = only a human on the call knows it. confirm = we hold a value and want it confirmed or corrected; renders only when a value exists.';
