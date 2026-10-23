-- ── seed the funder validation checklist ────────────────────────────────────
--
-- Idempotent: `on conflict (key) do update` so re-running refreshes labels,
-- help, ordering and required-ness without touching answers already collected
-- under those keys. Change a label here; never change a key.
--
-- `sort` is banded by section (100s, 200s, …) so a new question can be slotted
-- into the middle of a section without renumbering the rest.
--
-- ⚠️ `submission_email_confirmed` and `portal_url_confirmed` capture what the
-- funder SAID on the phone. They are claims recorded against a validation —
-- they do not write `lenders.submission_email` or any `lenders` column, now or
-- by a later backfill. Merchants' bank statements go to that address.

insert into public.funder_validation_items
  (key, section, label, help, answer_type, choices, product, is_required, sort)
values
  -- ── Reaching them ────────────────────────────────────────────────────────
  ('main_phone_connects',        'Reaching them', 'Main phone connects',                       'Dial the number on file. Record the number that actually worked.', 'phone',    null, null, true,  100),
  ('main_line_who_answers',      'Reaching them', 'Who answers the main line',                 null, 'text',     null, null, false, 110),
  ('listed_contacts_still_there','Reaching them', 'Each listed contact still works there',     'Check every name we hold, not just the first one.', 'bool',     null, null, true,  120),
  ('direct_dial_our_rep',        'Reaching them', 'Direct dial for our rep',                   null, 'phone',    null, null, false, 130),
  ('best_hours_timezone',        'Reaching them', 'Best hours / timezone',                     null, 'text',     null, null, false, 140),

  -- ── Submitting ───────────────────────────────────────────────────────────
  ('submit_channel',             'Submitting',    'Where do we submit',                        null, 'choice',   array['email','portal','both','unknown'], null, true,  200),
  ('submission_email_confirmed', 'Submitting',    'Submission email address confirmed',        'What they said on the call. A claim — someone promotes it to the funder record later, never automatically.', 'email', null, null, true, 210),
  ('portal_url_confirmed',       'Submitting',    'Portal URL confirmed',                      null, 'url',      null, null, false, 220),
  ('address_on_file_current',    'Submitting',    'They confirm the address we have on file is current', 'Read them the address we hold and have them confirm it.', 'bool', null, null, false, 230),
  ('iso_agreement_status',       'Submitting',    'Are we an approved ISO / is our agreement executed', null, 'choice', array['yes','no','pending','unknown'], null, true, 240),
  ('iso_account_number',         'Submitting',    'Our ISO or account number with them',       null, 'text',     null, null, false, 250),

  -- ── Our account contact ──────────────────────────────────────────────────
  ('account_contact_name',       'Our account contact', 'Account contact name',                null, 'text',     null, null, true,  300),
  ('account_contact_title',      'Our account contact', 'Title',                               null, 'text',     null, null, false, 310),
  ('account_contact_phone',      'Our account contact', 'Direct phone',                        null, 'phone',    null, null, false, 320),
  ('account_contact_email',      'Our account contact', 'Direct email',                        null, 'email',    null, null, false, 330),
  ('account_contact_backup',     'Our account contact', 'Who covers when they are out',        null, 'text',     null, null, false, 340),

  -- ── Submission requirements ──────────────────────────────────────────────
  ('guidelines_emailed',         'Submission requirements', 'Will they EMAIL us their written submission guidelines', 'Ask for it in writing — then we are not relying on notes from a call.', 'bool', null, null, false, 400),
  ('req_mca',                    'Submission requirements', 'MCA requirements',                null, 'longtext', null, 'mca',            false, 410),
  ('req_term_loan',              'Submission requirements', 'Term loan requirements',          null, 'longtext', null, 'term_loan',      false, 420),
  ('req_line_of_credit',         'Submission requirements', 'Line of credit requirements',     null, 'longtext', null, 'line_of_credit', false, 430),
  ('req_sba',                    'Submission requirements', 'SBA requirements',                null, 'longtext', null, 'sba',            false, 440),
  ('req_equipment',              'Submission requirements', 'Equipment requirements',          null, 'longtext', null, 'equipment',      false, 450),
  ('bank_statement_months',      'Submission requirements', 'How many months of bank statements', null, 'number', null, null, false, 460),
  ('signed_app_own_form',        'Submission requirements', 'Do they need a signed application on their own form', null, 'bool', null, null, false, 470),
  ('extra_stips_we_miss',        'Submission requirements', 'Any extra stips we routinely miss', null, 'longtext', null, null, false, 480),

  -- ── Their box ────────────────────────────────────────────────────────────
  ('box_min_monthly_revenue',    'Their box',     'Min monthly revenue',                       null, 'money',    null, null, false, 500),
  ('box_min_time_in_business',   'Their box',     'Min time in business (months)',             null, 'number',   null, null, false, 510),
  ('box_min_fico',               'Their box',     'Min FICO',                                  null, 'number',   null, null, false, 520),
  ('box_min_funding_amount',     'Their box',     'Min funding amount',                        null, 'money',    null, null, false, 530),
  ('box_max_funding_amount',     'Their box',     'Max funding amount',                        null, 'money',    null, null, false, 540),
  ('box_max_positions',          'Their box',     'Max positions accepted',                    null, 'number',   null, null, false, 550),
  ('box_first_position_only',    'Their box',     'First position only',                       null, 'bool',     null, null, false, 560),
  ('box_restricted_states',      'Their box',     'Restricted states',                         null, 'text',     null, null, false, 570),
  ('box_restricted_industries',  'Their box',     'Restricted industries',                     null, 'longtext', null, null, false, 580),

  -- ── Commercials ──────────────────────────────────────────────────────────
  ('commission_points',          'Commercials',   'Commission points or buy rate',             null, 'text',     null, null, false, 600),
  ('renewal_owner',              'Commercials',   'Who owns the renewal',                      null, 'choice',   array['iso','funder','shared','unknown'], null, false, 610),
  ('renewal_commission',         'Commercials',   'Renewal commission',                        null, 'text',     null, null, false, 620),
  ('clawback_policy',            'Commercials',   'Clawback policy',                           null, 'longtext', null, null, false, 630),
  ('payment_timing',             'Commercials',   'How soon after funding do they pay us',     null, 'text',     null, null, false, 640),

  -- ── Speed and process ────────────────────────────────────────────────────
  ('time_to_decision',           'Speed and process', 'Time to decision',                      null, 'text',     null, null, false, 700),
  ('funding_speed',              'Speed and process', 'Funding speed once signed',             null, 'text',     null, null, false, 710),
  ('how_offers_returned',        'Speed and process', 'How do they send offers back',          null, 'text',     null, null, false, 720),
  ('stop_doing',                 'Speed and process', 'Anything they want us to stop doing',   'The question nobody asks. Cheapest decline-rate fix on the call.', 'longtext', null, null, false, 730)
on conflict (key) do update set
  section     = excluded.section,
  label       = excluded.label,
  help        = excluded.help,
  answer_type = excluded.answer_type,
  choices     = excluded.choices,
  product     = excluded.product,
  is_required = excluded.is_required,
  sort        = excluded.sort,
  is_active   = true;
