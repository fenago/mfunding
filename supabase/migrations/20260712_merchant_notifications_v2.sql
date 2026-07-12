-- Wave 4 — Merchant notifications v2 (additive follow-up to
-- 20260712_merchant_notifications_and_remittance.sql).
--
-- Changes, all additive / backward-compatible:
--  * messages: + kind, + action_path (nullable) — power the portal notification
--    center (icon + deep link) instead of string-sniffing. Person-to-person
--    messages (send_message_to_advisor, staff sends) leave both NULL.
--  * notify_merchant(): store kind + action_path in the new columns; stop
--    appending the deep link into the body (the UI renders it from action_path).
--  * merchant_notice_copy(): milestone-specific renewal copy (40/60/75/100) with
--    the locked language. Compliance: no "loan"; "may qualify" hedged.
--  * triggers: emit canonical producer kinds + deep-link paths.
--  * get_my_portal_deals(): + renewal_interest_expressed (so the UI shows the
--    "already expressed" state on load without localStorage).

-- ---------------------------------------------------------------------------
-- 1) messages: notification metadata columns
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists kind text,
  add column if not exists action_path text;

comment on column public.messages.kind is 'Notification producer kind (stage, doc_requested, doc_approved, doc_rejected, submission_created, offer_received, signature_requested, signature_completed, renewal_milestone). NULL for person-to-person messages.';
comment on column public.messages.action_path is 'Portal deep-link path the notification opens (e.g. /portal/documents). NULL for person-to-person messages.';

-- ---------------------------------------------------------------------------
-- 2) notify_merchant: persist kind + action_path; keep body clean
-- ---------------------------------------------------------------------------
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
  v_msg uuid;
begin
  select user_id into v_to from public.customers where id = p_customer_id;
  if v_to is null then
    return null;  -- merchant has no portal profile yet; nothing to deliver
  end if;

  if p_deal_id is not null then
    select assigned_closer_id into v_from from public.deals where id = p_deal_id;
  end if;
  if v_from is null then
    select id into v_from from public.profiles
      where role in ('super_admin','admin')
      order by (role = 'super_admin') desc, created_at asc nulls last limit 1;
  end if;
  if v_from is null then
    return null;
  end if;

  insert into public.messages(from_user_id, to_user_id, subject, body, related_customer_id, status, kind, action_path)
    values (v_from, v_to, p_title, p_body, p_customer_id, 'unread', p_kind, p_action_path)
    returning id into v_msg;
  return v_msg;
end $$;

-- ---------------------------------------------------------------------------
-- 3) merchant_notice_copy: milestone-specific renewal copy (locked language)
-- ---------------------------------------------------------------------------
create or replace function public.merchant_notice_copy(
  p_kind text, p_deal_type text, p_arg1 text default null, p_arg2 text default null
) returns table(title text, body text) language sql immutable as $$
  select * from (values (
    case p_kind
      when 'stage' then (case p_arg1
        when 'application' then 'Your application is ready'
        when 'documents'   then 'Time to upload your documents'
        when 'in_review'   then 'Your file is with our funding partners'
        when 'funded'      then E'You’re funded \U0001F389'
        when 'positions'    then 'We’re reviewing your positions'
        when 'relief_plan'  then 'Your relief plan is underway'
        when 'agreement'    then 'Your agreement is ready to sign'
        when 'in_process'   then 'We’re working your file'
        when 'restructured' then 'Your positions have been restructured'
        else 'An update on your file'
      end)
      when 'doc_requested'       then 'A document was requested'
      when 'doc_approved'        then 'A document was approved'
      when 'doc_rejected'        then 'A document needs another look'
      when 'offer'               then 'You have an offer to review'
      when 'signature_requested' then 'A document is ready to sign'
      when 'signature_signed'    then 'Thanks for signing'
      when 'renewal' then (case p_arg1
        when '40'  then 'You may qualify for additional capital'
        when '60'  then 'Renewal options typically improve from here'
        when '75'  then 'Often the best time to renew'
        when '100' then E'You’re paid in full — congratulations'
        else 'You may qualify for additional capital'
      end)
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
      when 'renewal' then (case p_arg1
        when '40'  then 'You have paid down a good portion of your current advance. You may qualify for additional working capital, often on more favorable terms. Reply here or ask your advisor to explore your options.'
        when '60'  then 'You are well into paying down your advance. Around this point, renewal options typically improve. If more working capital would help your business, your advisor can walk you through what may be available.'
        when '75'  then 'You have paid down most of your advance — for many businesses this is the most favorable point to consider additional capital. Reply here or ask your advisor to review your options.'
        when '100' then 'You have fully paid off your advance. Thank you for your business. When you are planning your next move, you may qualify for fresh working capital — your advisor is ready whenever you are.'
        else 'You have paid down a good portion of your current advance. You may qualify for additional working capital, often on more favorable terms. Reply here or ask your advisor to explore your options.'
      end)
      else 'There is a new update on your file. Sign in to your portal to see the latest.'
    end
  )) as t(title, body);
$$;

-- ---------------------------------------------------------------------------
-- 4) triggers: canonical producer kinds + deep-link paths
-- ---------------------------------------------------------------------------
create or replace function public.deals_merchant_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_step text;
  v_new_step text;
  nm int;
  c record;
begin
  begin
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

    if NEW.paydown_percentage is distinct from OLD.paydown_percentage then
      nm := public.renewal_milestone_for(NEW.paydown_percentage);
      if nm is not null and nm > coalesce(OLD.last_renewal_milestone, 0) then
        NEW.last_renewal_milestone := nm;
        select * into c from public.merchant_notice_copy('renewal', NEW.deal_type, nm::text);
        perform public.notify_merchant(NEW.customer_id, NEW.id, 'renewal_milestone', c.title, c.body, '/portal');
      end if;
    end if;
  exception when others then
    raise warning 'deals_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

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
        perform public.notify_merchant(d.customer_id, NEW.deal_id, 'offer_received', c.title, c.body, '/portal/offers');
      end if;
    end if;
  exception when others then
    raise warning 'submission_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

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
      perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'signature_requested', c.title, c.body, '/portal/sign/' || NEW.id);
    elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status and NEW.status = 'signed' then
      select * into c from public.merchant_notice_copy('signature_signed', v_type, NEW.name);
      perform public.notify_merchant(NEW.customer_id, NEW.deal_id, 'signature_completed', c.title, c.body, '/portal/documents');
    end if;
  exception when others then
    raise warning 'merchant_doc_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $$;

-- ---------------------------------------------------------------------------
-- 5) get_my_portal_deals: + renewal_interest_expressed
-- ---------------------------------------------------------------------------
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
  payback_amount numeric, remittance_amount numeric, remittance_frequency text,
  first_remittance_date date, balance_override numeric, balance_as_of timestamptz,
  renewal_eligible boolean, estimated_paydown_pct numeric, renewal_interest_expressed boolean
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
    public.estimate_paydown(d.id) as estimated_paydown_pct,
    exists (
      select 1 from public.activity_log a
      where a.entity_type = 'deal' and a.entity_id = d.id
        and a.interaction_type = 'note' and a.subject like 'renewal:interest%'
    ) as renewal_interest_expressed
  from public.deals d
  where d.customer_id in (
    select c.id from public.customers c where c.user_id = auth.uid()
  )
  order by d.created_at desc;
$$;

grant execute on function public.get_my_portal_deals() to authenticated;
