-- Closer roster repair — DATA ONLY.
--
-- The Revenue Playbook's "Assigned closer" dropdown reads
--   closers where status='active' and user_id is not null
-- (PlaybooksPage.tsx). Two real role='closer' profiles had no closers row at all,
-- so the dropdown showed Carlos + Ernesto and nobody else — deals could not be
-- assigned to half the floor.
--
-- ⚠️ closers has NO unique constraint on user_id or email (only closers_pkey on
-- id), so every insert here is guarded by NOT EXISTS. Without that guard a re-run
-- silently DOUBLES the dropdown.
--
-- Names come from profiles (the app's own identity record), not from GHL.
-- Splits per CLAUDE.md: company lead 35 / self-gen 65 / renewal 30. Note the
-- column default for company_lead_split is 30, so 35 must be written explicitly.
--
-- Deliberately NOT added: the 11 test accounts (setter.test@mfunding.net,
-- test-setter-01..10@mfunding.net) must stay out of the dropdown; and Diego De La
-- Vega + Khalil Lyons, who have GHL users but are not role='closer' profiles.

insert into public.closers (user_id, first_name, last_name, email, status,
                            company_lead_split, self_gen_split, renewal_split, ghl_user_id)
select p.id, p.first_name, p.last_name, p.email, 'active', 35, 65, 30, p.ghl_user_id
  from public.profiles p
 where p.id in (
         '23941f5b-1978-4830-8863-2dddb20a68ed',  -- Catherine Zaragosa
         'c91425ac-0c33-4c20-a447-650c4ca9fd8f'   -- Paolo Taruc (GHL calls them "Paola")
       )
   and not exists (select 1 from public.closers c where c.user_id = p.id);

-- Ernesto's real GHL id + nulling Stephanie Decker's dead 3la07qMrf2aTMcyz8gks
-- were already applied by 20260826_deal_appointments.sql; these are idempotent
-- re-statements so this file stands on its own.
update public.closers c
   set ghl_user_id = p.ghl_user_id
  from public.profiles p
 where p.id = c.user_id
   and p.ghl_user_id is not null
   and c.ghl_user_id is distinct from p.ghl_user_id;

update public.closers
   set ghl_user_id = null
 where ghl_user_id = '3la07qMrf2aTMcyz8gks';
