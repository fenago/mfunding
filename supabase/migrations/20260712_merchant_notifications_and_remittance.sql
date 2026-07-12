-- Wave 4 — Merchant Experience: notification producers, two-way inbox,
-- remittance-schedule projection, one-tap renewal interest, milestone crossings.
--
-- Everything here is ADDITIVE. Wave 1–3 objects are untouched.
--
-- COMPLIANCE: every merchant-facing string in merchant_notice_copy() below is
-- reviewed as a set. MCA = purchase of future receivables / "funding" / "advance"
-- / "working capital" / "funding partners" — NEVER "loan". VCF = debt-relief
-- vocabulary. "may qualify" never guarantees. Neutral copy where product-agnostic.

-- ===========================================================================
-- 1) deals: remittance-schedule projection fields + milestone bookkeeping
-- ===========================================================================
alter table public.deals
  add column if not exists payback_amount        numeric,
  add column if not exists remittance_amount     numeric,
  add column if not exists remittance_frequency  text,
  add column if not exists first_remittance_date date,
  add column if not exists balance_override      numeric,
  add column if not exists balance_as_of         timestamptz,
  add column if not exists last_renewal_milestone int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'deals_remittance_frequency_check'
  ) then
    alter table public.deals
      add constraint deals_remittance_frequency_check
      check (remittance_frequency is null or remittance_frequency in ('daily','weekly'));
  end if;
end $$;

comment on column public.deals.payback_amount is 'Total agreed payback (RTR) on the funded advance — basis for the merchant paydown projection.';
comment on column public.deals.remittance_amount is 'Per-remittance debit amount (daily or weekly per remittance_frequency).';
comment on column public.deals.remittance_frequency is 'daily | weekly — cadence of remittance_amount.';
comment on column public.deals.first_remittance_date is 'Date the first remittance debits — the projection clock starts here.';
comment on column public.deals.balance_override is 'Staff-entered current balance; when set (with payback_amount) drives a balance-based paydown estimate that beats the schedule projection.';
comment on column public.deals.balance_as_of is 'When balance_override was last confirmed.';
comment on column public.deals.last_renewal_milestone is 'Highest renewal paydown milestone (40/60/75/100) already notified — prevents re-firing.';

-- ===========================================================================
-- 2) Pure helpers (immutable): merchant-visible step + renewal milestone
-- ===========================================================================

-- Collapse an internal deal status into the merchant-visible journey step key.
-- Mirrors src/data/merchantJourney.ts (MCA_STEPS / VCF_STEPS). Returns null for
-- statuses that have no merchant-visible step (terminal / off-journey).
create or replace function public.merchant_step_key(p_deal_type text, p_status text)
returns text language sql immutable as $$
  select case
    when p_deal_type = 'vcf' then
      case p_status
        when 'new_distressed'       then 'getting_started'
        when 'hardship_consult'     then 'getting_started'
        when 'positions_analysis'   then 'positions'
        when 'strategy_proposal'    then 'relief_plan'
        when 'agreement_sent'       then 'agreement'
        when 'submitted_to_vcf'     then 'in_process'
        when 'restructure_executed' then 'restructured'
        when 'servicing'            then 'support'
        else null
      end
    else
      case p_status
        when 'new'                 then 'getting_started'
        when 'contacted'           then 'getting_started'
        when 'qualifying'          then 'getting_started'
        when 'application_sent'    then 'application'
        when 'docs_collected'      then 'documents'
        when 'bank_statements'     then 'documents'
        when 'submitted_to_funder' then 'in_review'
        when 'offer_received'      then 'offers'
        when 'offer_presented'     then 'offers'
        when 'offer_accepted'      then 'offers'
        when 'funded'              then 'funded'
        when 'renewal_eligible'    then 'growing'
        else null
      end
  end
$$;

-- Highest renewal milestone reached at a given paydown %, or null under 40%.
create or replace function public.renewal_milestone_for(p_paydown numeric)
returns int language sql immutable as $$
  select case
    when p_paydown is null then null
    when p_paydown >= 100 then 100
    when p_paydown >= 75  then 75
    when p_paydown >= 60  then 60
    when p_paydown >= 40  then 40
    else null
  end
$$;

-- ===========================================================================
-- 3) Centralized, compliance-reviewed merchant-facing notification copy.
--    ONE place for every portal-message string. Returns (title, body).
--    p_arg1/p_arg2 carry per-event context (step key, doc label, reason, name,
--    milestone). Body deep-link is appended by notify_merchant(), not here.
-- ===========================================================================
create or replace function public.merchant_notice_copy(
  p_kind text, p_deal_type text, p_arg1 text default null, p_arg2 text default null
) returns table(title text, body text) language sql immutable as $$
  select * from (values (
    case p_kind
      -- ---- Stage / journey-step crossings -------------------------------
      when 'stage' then (case p_arg1
        -- MCA / general funding steps
        when 'application' then 'Your application is ready'
        when 'documents'   then 'Time to upload your documents'
        when 'in_review'   then 'Your file is with our funding partners'
        when 'funded'      then E'You’re funded \U0001F389'
        -- VCF / debt-relief steps
        when 'positions'    then 'We’re reviewing your positions'
        when 'relief_plan'  then 'Your relief plan is underway'
        when 'agreement'    then 'Your agreement is ready to sign'
        when 'in_process'   then 'We’re working your file'
        when 'restructured' then 'Your positions have been restructured'
        else 'An update on your file'
      end)
      when 'doc_requested'        then 'A document was requested'
      when 'doc_approved'         then 'A document was approved'
      when 'doc_rejected'         then 'A document needs another look'
      when 'offer'                then 'You have an offer to review'
      when 'signature_requested'  then 'A document is ready to sign'
      when 'signature_signed'     then 'Thanks for signing'
      when 'renewal'              then 'You may qualify for additional capital'
      else 'An update on your file'
    end,
    case p_kind
      when 'stage' then (case p_arg1
        when 'application' then 'Please complete and sign your application so we can start matching you with funding partners. It only takes about 5 minutes.'
        when 'documents'   then 'Upload your most recent business bank statements and a few quick items so our funding partners can review your file. The sooner these come in, the sooner you can see offers.'
        when 'in_review'   then 'Your file is in front of our funding partners now. They typically respond within 24 to 48 hours, so a quiet day or two is completely normal.'
        when 'funded'      then 'Your funding is on the way to your account. Funds usually arrive within one business day. Congratulations!'
        when 'positions'    then 'We are tallying your current advances and balances so we understand your full picture. This usually takes a day or two.'
        when 'relief_plan'  then 'We are building a plan to ease your daily payments and give your business some breathing room. Your specialist will walk you through it.'
        when 'agreement'    then 'Please review and sign your engagement so we can begin working on your behalf. It takes just a few minutes.'
        when 'in_process'   then 'We are actively working your file and negotiating on your behalf. We will keep you posted at every step.'
        when 'restructured' then 'Your positions have been consolidated and your payments restructured. You will see the relief reflected in your payments.'
        else 'There is a new update on your file. Sign in to your portal to see where things stand.'
      end)
      when 'doc_requested' then 'Your funding specialist requested: ' || coalesce(p_arg1,'a document') || '. Upload it in your portal to keep your file moving.'
      when 'doc_approved'  then 'Your ' || coalesce(p_arg1,'document') || ' was reviewed and approved. Thank you — that is one less thing to worry about.'
      when 'doc_rejected'  then 'We were not able to use your ' || coalesce(p_arg1,'document') ||
        coalesce(': ' || nullif(p_arg2,''), '.') || ' Please re-upload it in your portal when you get a chance.'
      when 'offer' then 'An offer has come in on your file. Sign in to your portal to review the details, and your advisor will help you weigh your options.'
      when 'signature_requested' then 'Your ' || coalesce(p_arg1,'document') || ' is ready. Sign in to your portal to read it in full and sign — it only takes a minute.'
      when 'signature_signed' then 'We have recorded your signature on ' || coalesce(p_arg1,'your document') || '. Your signed copy is on file — no further action is needed right now.'
      when 'renewal' then 'You have paid down a good portion of your current advance. You may qualify for additional working capital, often on more favorable terms. Reply here or ask your advisor to explore your options.'
      else 'There is a new update on your file. Sign in to your portal to see the latest.'
    end
  )) as t(title, body);
$$;

-- ===========================================================================
-- 4) notify_merchant — the single portal-message producer. SECURITY DEFINER so
--    triggers and RPCs can write a messages row on the merchant's behalf.
--    No-ops (returns null) when the merchant has not claimed a portal profile.
-- ===========================================================================
create or replace function public.notify_merchant(
  p_customer_id uuid,
  p_deal_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_action_path text default '/portal'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_to uuid;
  v_from uuid;
  v_body text;
  v_msg uuid;
begin
  select user_id into v_to from public.customers where id = p_customer_id;
  if v_to is null then
    return null;  -- merchant has no portal profile yet; nothing to deliver
  end if;

  -- Sender: the deal's assigned closer, else the oldest super_admin/admin.
  if p_deal_id is not null then
    select assigned_closer_id into v_from from public.deals where id = p_deal_id;
  end if;
  if v_from is null then
    select id into v_from from public.profiles
      where role in ('super_admin','admin')
      order by (role = 'super_admin') desc, created_at asc nulls last limit 1;
  end if;
  if v_from is null then
    return null;  -- no valid sender profile (FK requires one)
  end if;

  v_body := p_body;
  if p_action_path is not null then
    v_body := v_body || E'\n\nOpen your portal: https://mfunding.net' || p_action_path;
  end if;

  insert into public.messages(from_user_id, to_user_id, subject, body, related_customer_id, status)
    values (v_from, v_to, p_title, v_body, p_customer_id, 'unread')
    returning id into v_msg;
  return v_msg;
end $$;

-- ===========================================================================
-- 5) Triggers — origin-independent portal messages (client writes, edge fns,
--    and the GHL webhook all funnel through the same table writes). Each trigger
--    is best-effort: a notification failure must NEVER break the primary write.
-- ===========================================================================

-- 5a) deals: stage-step crossings + renewal-milestone crossings.
create or replace function public.deals_merchant_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_step text;
  v_new_step text;
  nm int;
  c record;
begin
  begin
    -- Stage / journey-step crossing (skip entry + ongoing steps; offers handled
    -- by the deal_submissions trigger to avoid a duplicate message).
    if NEW.status is distinct from OLD.status then
      v_old_step := public.merchant_step_key(NEW.deal_type, OLD.status);
      v_new_step := public.merchant_step_key(NEW.deal_type, NEW.status);
      if v_new_step is not null
         and v_new_step is distinct from v_old_step
         and v_new_step not in ('getting_started','growing','support','offers') then
        select * into c from public.merchant_notice_copy('stage', NEW.deal_type, v_new_step);
        perform public.notify_merchant(NEW.customer_id, NEW.id, 'stage', c.title, c.body, '/portal');
      end if;
    end if;

    -- Renewal-milestone crossing on a staff / renewalService paydown update.
    if NEW.paydown_percentage is distinct from OLD.paydown_percentage then
      nm := public.renewal_milestone_for(NEW.paydown_percentage);
      if nm is not null and nm > coalesce(OLD.last_renewal_milestone, 0) then
        NEW.last_renewal_milestone := nm;
        select * into c from public.merchant_notice_copy('renewal', NEW.deal_type, nm::text);
        perform public.notify_merchant(NEW.customer_id, NEW.id, 'renewal', c.title, c.body, '/portal');
      end if;
    end if;
  exception when others then
    raise warning 'deals_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

drop trigger if exists trg_deals_merchant_notify on public.deals;
create trigger trg_deals_merchant_notify
  before update on public.deals
  for each row execute function public.deals_merchant_notify();

-- 5b) deal_doc_requests: requested / approved / rejected.
create or replace function public.doc_request_merchant_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_label text;
  c record;
begin
  begin
    select deal_type into v_type from public.deals where id = NEW.deal_id;
    v_label := coalesce(nullif(NEW.label,''), replace(NEW.doc_type::text, '_', ' '));

    if TG_OP = 'INSERT' then
      if NEW.status = 'requested' then
        select * into c from public.merchant_notice_copy('doc_requested', v_type, v_label);
        perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'doc_requested', c.title, c.body, '/portal/documents');
      end if;
    elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
      if NEW.status = 'approved' then
        select * into c from public.merchant_notice_copy('doc_approved', v_type, v_label);
        perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'doc_approved', c.title, c.body, '/portal/documents');
      elsif NEW.status = 'rejected' then
        select * into c from public.merchant_notice_copy('doc_rejected', v_type, v_label, NEW.rejection_reason);
        perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'doc_rejected', c.title, c.body, '/portal/documents');
      end if;
    end if;
  exception when others then
    raise warning 'doc_request_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

drop trigger if exists trg_doc_request_merchant_notify on public.deal_doc_requests;
create trigger trg_doc_request_merchant_notify
  after insert or update on public.deal_doc_requests
  for each row execute function public.doc_request_merchant_notify();

-- 5c) deal_submissions: an offer landing on a submission.
create or replace function public.submission_merchant_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d record;
  c record;
begin
  begin
    if TG_OP = 'UPDATE'
       and NEW.status is distinct from OLD.status
       and NEW.status in ('approved','offer_made') then
      select customer_id, deal_type into d from public.deals where id = NEW.deal_id;
      if d.customer_id is not null then
        select * into c from public.merchant_notice_copy('offer', d.deal_type);
        perform public.notify_merchant(d.customer_id, NEW.deal_id, 'offer', c.title, c.body, '/portal');
      end if;
    end if;
  exception when others then
    raise warning 'submission_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

drop trigger if exists trg_submission_merchant_notify on public.deal_submissions;
create trigger trg_submission_merchant_notify
  after insert or update on public.deal_submissions
  for each row execute function public.submission_merchant_notify();

-- 5d) merchant_documents: signature requested (sent) / completed (signed).
create or replace function public.merchant_doc_merchant_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  c record;
begin
  begin
    select deal_type into v_type from public.deals where id = NEW.deal_id;
    if TG_OP = 'INSERT' and NEW.status = 'sent' then
      select * into c from public.merchant_notice_copy('signature_requested', v_type, NEW.name);
      perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'signature_requested', c.title, c.body, '/portal/documents');
    elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status and NEW.status = 'signed' then
      select * into c from public.merchant_notice_copy('signature_signed', v_type, NEW.name);
      perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'signature_signed', c.title, c.body, '/portal/documents');
    end if;
  exception when others then
    raise warning 'merchant_doc_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

drop trigger if exists trg_merchant_doc_merchant_notify on public.merchant_documents;
create trigger trg_merchant_doc_merchant_notify
  after insert or update on public.merchant_documents
  for each row execute function public.merchant_doc_merchant_notify();

-- ===========================================================================
-- 6) estimate_paydown — projected paydown % from the remittance schedule, with
--    balance-override precedence. NULL when there is not enough data.
-- ===========================================================================
create or replace function public.estimate_paydown(p_deal_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  d record;
  elapsed numeric;
  est numeric;
begin
  select payback_amount, remittance_amount, remittance_frequency, first_remittance_date, balance_override
    into d from public.deals where id = p_deal_id;
  if not found then return null; end if;

  -- (1) Balance-based estimate beats the schedule projection when available.
  if d.balance_override is not null and d.payback_amount is not null and d.payback_amount > 0 then
    return round(greatest(0, least(100, (1 - d.balance_override / d.payback_amount) * 100)), 2);
  end if;

  -- (2) Schedule projection.
  if d.payback_amount is null or d.payback_amount <= 0
     or d.remittance_amount is null
     or d.remittance_frequency is null
     or d.first_remittance_date is null then
    return null;
  end if;
  if d.first_remittance_date > current_date then return 0; end if;

  if d.remittance_frequency = 'daily' then
    select count(*) into elapsed
      from generate_series(d.first_remittance_date::timestamp, current_date::timestamp, interval '1 day') g
      where extract(isodow from g) < 6;  -- Mon–Fri only
  else
    elapsed := floor((current_date - d.first_remittance_date) / 7.0) + 1;  -- weeks elapsed (inclusive)
  end if;

  est := (elapsed * d.remittance_amount) / d.payback_amount * 100;
  return round(greatest(0, least(100, est)), 2);
end $$;

-- ===========================================================================
-- 7) get_my_portal_deals — extend with remittance projection + renewal fields.
--    Additive: every Wave 1 column is preserved (name-keyed on the client).
-- ===========================================================================
drop function if exists public.get_my_portal_deals();
create function public.get_my_portal_deals()
returns table(
  id uuid, deal_number text, deal_type text, status text,
  amount_requested numeric, amount_funded numeric, created_at timestamptz,
  contacted_at timestamptz, qualified_at timestamptz, application_sent_at timestamptz,
  docs_collected_at timestamptz, bank_statements_at timestamptz, submitted_at timestamptz,
  offer_received_at timestamptz, offer_presented_at timestamptz, offer_accepted_at timestamptz,
  funded_at timestamptz, declined_at timestamptz, nurture_at timestamptz,
  stips_promised_by date, paydown_percentage numeric,
  -- Wave 4 additions:
  payback_amount numeric, remittance_amount numeric, remittance_frequency text,
  first_remittance_date date, balance_override numeric, balance_as_of timestamptz,
  renewal_eligible boolean, estimated_paydown_pct numeric
)
language sql stable security definer set search_path = public as $$
  select
    d.id, d.deal_number, d.deal_type, d.status,
    d.amount_requested, d.amount_funded, d.created_at,
    d.contacted_at, d.qualified_at, d.application_sent_at,
    d.docs_collected_at, d.bank_statements_at, d.submitted_at,
    d.offer_received_at, d.offer_presented_at, d.offer_accepted_at,
    d.funded_at, d.declined_at, d.nurture_at,
    d.stips_promised_by, d.paydown_percentage,
    d.payback_amount, d.remittance_amount, d.remittance_frequency,
    d.first_remittance_date, d.balance_override, d.balance_as_of,
    (d.status = 'renewal_eligible' or coalesce(d.paydown_percentage, 0) >= 40) as renewal_eligible,
    public.estimate_paydown(d.id) as estimated_paydown_pct
  from public.deals d
  where d.customer_id in (
    select c.id from public.customers c where c.user_id = auth.uid()
  )
  order by d.created_at desc;
$$;

-- ===========================================================================
-- 8) express_renewal_interest — one-tap "I'm interested in more capital".
--    Idempotent via an activity_log marker; closer-visible.
-- ===========================================================================
create or replace function public.express_renewal_interest(p_deal_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cust uuid;
  v_status text;
  v_biz text;
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select d.customer_id, d.status into v_cust, v_status
    from public.deals d where d.id = p_deal_id;
  if v_cust is null then
    raise exception 'Deal not found';
  end if;

  -- Ownership: the caller must own the deal's customer.
  if not exists (
    select 1 from public.customers c where c.id = v_cust and c.user_id = v_uid
  ) then
    raise exception 'This deal is not yours';
  end if;

  if v_status not in ('funded','renewal_eligible') then
    raise exception 'This deal is not eligible for a renewal request yet';
  end if;

  -- Idempotency: has interest already been recorded for this deal?
  select exists (
    select 1 from public.activity_log
    where entity_type = 'deal' and entity_id = p_deal_id
      and interaction_type = 'note' and subject like 'renewal:interest%'
  ) into v_exists;

  if v_exists then
    return jsonb_build_object('ok', true, 'already_expressed', true);
  end if;

  select business_name into v_biz from public.customers where id = v_cust;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
    values (
      'deal', p_deal_id, 'note',
      'renewal:interest',
      coalesce(v_biz,'The merchant') || ' tapped "I''m interested in additional capital" from the portal. Reach out to discuss a renewal.',
      v_uid
    );

  return jsonb_build_object('ok', true, 'already_expressed', false);
end $$;

-- ===========================================================================
-- 9) send_message_to_advisor — two-way inbox: merchant -> assigned closer.
--    Resolves the recipient and drops a staff-visible activity_log marker so the
--    reply is not lost (there is no dedicated admin inbox surface today).
-- ===========================================================================
create or replace function public.send_message_to_advisor(
  p_deal_id uuid, p_subject text, p_body text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cust uuid;
  v_closer uuid;
  v_to uuid;
  v_biz text;
  v_body text;
  v_msg uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'Message body is required'; end if;

  select d.customer_id, d.assigned_closer_id into v_cust, v_closer
    from public.deals d where d.id = p_deal_id;
  if v_cust is null then raise exception 'Deal not found'; end if;

  if not exists (
    select 1 from public.customers c where c.id = v_cust and c.user_id = v_uid
  ) then
    raise exception 'This deal is not yours';
  end if;

  -- Recipient: assigned closer, else the oldest super_admin/admin.
  v_to := v_closer;
  if v_to is null then
    select id into v_to from public.profiles
      where role in ('super_admin','admin')
      order by (role = 'super_admin') desc, created_at asc nulls last limit 1;
  end if;
  if v_to is null then raise exception 'No advisor is available to receive this message'; end if;

  insert into public.messages(from_user_id, to_user_id, subject, body, related_customer_id, status)
    values (v_uid, v_to, coalesce(nullif(trim(p_subject),''), 'Message from your portal'), v_body, v_cust, 'unread')
    returning id into v_msg;

  -- Staff-visible trail on the deal timeline (marker: merchant:reply).
  select business_name into v_biz from public.customers where id = v_cust;
  begin
    insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
      values (
        'deal', p_deal_id, 'note',
        'merchant:reply — portal',
        coalesce(v_biz,'The merchant') || ' sent a message from the portal: ' || left(v_body, 500),
        v_uid
      );
  exception when others then
    raise warning 'send_message_to_advisor activity_log skipped: %', sqlerrm;
  end;

  return v_msg;
end $$;

grant execute on function public.get_my_portal_deals() to authenticated;
grant execute on function public.estimate_paydown(uuid) to authenticated;
grant execute on function public.express_renewal_interest(uuid) to authenticated;
grant execute on function public.send_message_to_advisor(uuid, text, text) to authenticated;
