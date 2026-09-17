-- The phantom flag must not depend on state a processor can change.
--
-- is_phantom_application_send() took p_has_draft and required it to be FALSE.
-- That condition is evaluated LIVE on every read, so the flag was only stable
-- while nobody worked the deal. The moment a processor opened MF-2026-0324 —
-- the one phantom still sitting at status application_sent, i.e. precisely the
-- row someone is most likely to open next — and began filling in the
-- application, an mca_applications row would exist, p_has_draft would flip true,
-- and the deal would SILENTLY STOP BEING FLAGGED. It would go straight back to
-- reading "sent by Carlos Marquez (assumed)": a fabricated sender on an event
-- that never happened, reappearing with no error and no migration.
--
-- Measured: the draft condition does no work anyway. Across every deal carrying
-- a stamp, "application_sent_at within 2s of created_at" alone selects the same
-- 4 rows; adding "created_by is null" changes nothing, and adding the draft test
-- changes nothing. The timestamp coincidence is decisive on its own.
--
-- So the rule now rests only on facts about how the row was CREATED, which
-- cannot change afterwards. This is the same distinction that put rung 4 in the
-- readers and rungs 1-3 on the row: freeze what is a fact about a past moment,
-- derive what is a statement about the present. Phantom-ness is the former, and
-- the draft test had quietly made it the latter.
--
-- p_has_draft is removed rather than ignored: a parameter that cannot affect the
-- answer is a trap for whoever reads this next.

begin;

create or replace function public.is_phantom_application_send(
  p_application_sent_at timestamptz,
  p_created_at          timestamptz,
  p_created_by          uuid
)
returns boolean
language sql
immutable
parallel safe
as $function$
  select p_application_sent_at is not null
     -- Stamped inside the transaction that created the deal. Live: the four
     -- known rows land 12-15 ms BEFORE created_at. 2 s is generous; no other
     -- deal with a stamp is within 5 s of its own creation.
     and abs(extract(epoch from (p_application_sent_at - p_created_at))) <= 2
     -- A human send always carries the sending user. These are service_role
     -- writes from the GHL opportunity mirror.
     and p_created_by is null;
$function$;

comment on function public.is_phantom_application_send(timestamptz, timestamptz, uuid) is
  'True when application_sent_at was stamped by the GHL opportunity mirror during deal creation rather than by a send WE made. Depends only on immutable creation facts, so working the deal cannot make the flag disappear. Says nothing about whether the merchant received an application - MF-2026-0273 is flagged and signed.';

drop function if exists public.processor_application_queue();
CREATE OR REPLACE FUNCTION public.processor_application_queue()
 RETURNS TABLE(deal_id uuid, deal_number text, merchant_name text, deal_status text, deal_type text, customer_id uuid, ghl_contact_id text, do_not_contact boolean, assigned_closer_id uuid, assigned_closer_name text, app_sent_at timestamp with time zone, app_sent_by uuid, app_sent_by_name text, app_sent_attribution text, app_sent_attribution_basis text, born_at_application_sent boolean, app_signed_at timestamp with time zone, app_signed_state text, app_signed_checked_at timestamp with time zone, disclosure_signed_at timestamp with time zone, disclosure_state text, statements_count integer, statements_last_at timestamp with time zone, qa_decision text, qa_decided_at timestamp with time zone, qa_decision_reason text, days_since_app_sent integer, first_call_due_at timestamp with time zone, attempts_since_sent integer, last_attempt_at timestamp with time zone, last_conversation_at timestamp with time zone, app_row_exists boolean, app_fields jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  c_max constant int := 500;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select array_agg(d.id order by d.application_sent_at desc nulls last, d.created_at desc)
    into v_ids
    from public.deals d
   where d.deal_type = 'mca'
     and (
       d.application_sent_at is not null
       or exists (select 1 from public.mca_applications a where a.deal_id = d.id)
       or coalesce(public.deals_stage_rank(d.status), -1) >= 2
       -- A SIGNED application with no sent stamp and an early stage would
       -- otherwise be invisible to the one queue meant to catch it. Live proof:
       -- Express Redemption (MF-2026-0113) signed on 2026-07-22 and sat at
       -- 'contacted' for two months because nothing recorded a send.
       or exists (
         select 1 from public.customer_application_signatures s
          where s.customer_id = d.customer_id and s.app_signed_at is not null
       )
     );

  if v_ids is null then
    return;
  end if;
  if array_length(v_ids, 1) > c_max then
    v_ids := v_ids[1:c_max];
  end if;

  return query
  with calls as (
    -- REUSE the canonical call definition. Do not hand-roll a phone match here:
    -- deal_call_events already reconciles wavv / ghl / activity_log and dedupes
    -- the mirrors (see 20260916h).
    select e.deal_id, e.at, e.is_conversation
      from public.deal_call_events(v_ids) e
  ),
  agg as (
    select d.id,
           (select count(*)::int from calls k
             where k.deal_id = d.id
               and d.application_sent_at is not null
               and k.at >= d.application_sent_at)                       as attempts_since_sent,
           (select max(k.at) from calls k where k.deal_id = d.id)        as last_attempt_at,
           (select max(k.at) from calls k
             where k.deal_id = d.id and k.is_conversation)               as last_conversation_at
      from public.deals d
     where d.id = any (v_ids)
  )
  select
    d.id,
    d.deal_number,
    coalesce(nullif(btrim(c.business_name), ''),
             nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
    d.status,
    d.deal_type,
    d.customer_id,
    -- Returned so the UI's on-demand "check signature" action does not need a
    -- second batched read of customers just to find the contact id.
    c.ghl_contact_id,
    coalesce(c.do_not_contact, false),
    d.assigned_closer_id,
    nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), ''),
    d.application_sent_at,
    -- Rung 4: no evidence, so the honest answer is whoever owns the deal. NULL
    -- only when the application was never sent — nothing to attribute.
    -- A phantom stamp is not a send, so it has no sender. This is the rule the
    -- readers already apply to a deal that was never sent — nothing to
    -- attribute, so NULL. Without it MF-2026-0324 reads "sent by Carlos Marquez".
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(d.application_sent_by, d.assigned_closer_id) end,
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(
           nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
           nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), '')
         ) end,
    case
      when d.application_sent_at is null or ph.yes then null
      when d.application_sent_attribution is not null then d.application_sent_attribution
      when d.assigned_closer_id is not null then 'assumed_owner'
      else 'unknown'
    end,
    case
      when ph.yes then
        'no send recorded here — the GHL opportunity mirror stamped this stage when the deal was created; any send happened inside GHL'
      when d.application_sent_at is null then null
      when d.application_sent_attribution is not null then d.application_sent_attribution_basis
      when d.assigned_closer_id is not null then
        'assumed: nobody recorded who sent it — this is the closer the deal is assigned to'
      else 'no record of who sent it, and the deal has no assigned closer'
    end,
    ph.yes,
    sig.app_signed_at,
    case
      when sig.app_signed_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disclosure_signed_at,
    case
      when sig.disclosure_signed_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    bs.n,
    bs.last_at,
    q.decision,
    q.decision_at,
    q.decision_reason,
    case when d.application_sent_at is null then null
         else floor(extract(epoch from (now() - d.application_sent_at)) / 86400.0)::int
    end,
    d.first_call_due_at,
    a.attempts_since_sent,
    a.last_attempt_at,
    a.last_conversation_at,
    (app.id is not null),
    jsonb_build_object(
      -- The saved draft, verbatim, or null when none exists. The TS helper
      -- switches on exactly this: a row means "hydrate", null means "seed".
      'application', case when app.id is null then null else to_jsonb(app) end,
      -- What the helper's SEED branch reads off the deal + customer + lead payload.
      'deal', jsonb_build_object(
        'id', d.id,
        'deal_type', d.deal_type,
        'status', d.status,
        'amount_requested', d.amount_requested,
        'use_of_funds', d.use_of_funds,
        'lead_qual', coalesce(d.lead_qual, '{}'::jsonb)
      ),
      'customer', jsonb_build_object(
        'id', c.id,
        'business_name', c.business_name,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email,
        'phone', c.phone,
        'industry', c.industry,
        'monthly_revenue', c.monthly_revenue,
        'address_street', c.address_street,
        'address_city', c.address_city,
        'address_state', c.address_state,
        'address_zip', c.address_zip
      )
    )
  from public.deals d
  join public.customers c on c.id = d.customer_id
  join agg a on a.id = d.id
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join lateral (
    select * from public.mca_applications ma where ma.deal_id = d.id
     order by ma.updated_at desc nulls last limit 1
  ) app on true
  left join lateral (
    -- customer_documents is a LOCAL table: an empty result is a real zero, not
    -- an unreadable one, so no third state is invented here.
    select count(*)::int as n, max(cd.created_at) as last_at
      from public.customer_documents cd
     where cd.customer_id = d.customer_id
       and cd.document_type = 'bank_statement'
  ) bs on true
  left join public.customer_application_signatures sig on sig.customer_id = d.customer_id
  left join lateral (
    select public.is_phantom_application_send(
             d.application_sent_at, d.created_at, d.created_by) as yes
  ) ph on true
  where d.id = any (v_ids)
  order by d.application_sent_at desc nulls last, d.created_at desc;
end;
$function$
;

revoke all on function public.processor_application_queue() from public, anon;
grant execute on function public.processor_application_queue() to authenticated, service_role;

drop function if exists public.deal_application_status(uuid[]);
CREATE OR REPLACE FUNCTION public.deal_application_status(p_deal_ids uuid[])
 RETURNS TABLE(deal_id uuid, app_sent_at timestamp with time zone, app_sent_by uuid, app_sent_by_name text, app_sent_attribution text, app_sent_attribution_basis text, born_at_application_sent boolean, app_signed_at timestamp with time zone, app_signed_state text, app_signed_checked_at timestamp with time zone, disclosure_signed_at timestamp with time zone, disclosure_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    d.id,
    d.application_sent_at,
    -- A phantom stamp is not a send, so it has no sender. This is the rule the
    -- readers already apply to a deal that was never sent — nothing to
    -- attribute, so NULL. Without it MF-2026-0324 reads "sent by Carlos Marquez".
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(d.application_sent_by, d.assigned_closer_id) end,
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(
           nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
           nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), '')
         ) end,
    case
      when d.application_sent_at is null or ph.yes then null
      when d.application_sent_attribution is not null then d.application_sent_attribution
      when d.assigned_closer_id is not null then 'assumed_owner'
      else 'unknown'
    end,
    case
      when ph.yes then
        'no send recorded here — the GHL opportunity mirror stamped this stage when the deal was created; any send happened inside GHL'
      when d.application_sent_at is null then null
      when d.application_sent_attribution is not null then d.application_sent_attribution_basis
      when d.assigned_closer_id is not null then
        'assumed: nobody recorded who sent it — this is the closer the deal is assigned to'
      else 'no record of who sent it, and the deal has no assigned closer'
    end,
    ph.yes,
    sig.app_signed_at,
    case
      when sig.app_signed_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disclosure_signed_at,
    case
      when sig.disclosure_signed_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.customer_application_signatures sig on sig.customer_id = d.customer_id
  left join lateral (
    select public.is_phantom_application_send(
             d.application_sent_at, d.created_at, d.created_by) as yes
  ) ph on true
  where d.id = any (p_deal_ids)
    and (
      public.is_ops_staff(auth.uid())
      or public.is_processor(auth.uid())
      or d.assigned_closer_id is null
      or d.assigned_closer_id = auth.uid()
      or d.created_by = auth.uid()
      or d.assigned_closer_id = any (public.my_closer_ids(auth.uid()))
    );
$function$
;

revoke all on function public.deal_application_status(uuid[]) from public, anon;
grant execute on function public.deal_application_status(uuid[]) to authenticated, service_role;

-- Nothing references it now; retire the 4-arg version so nothing written later can.
drop function if exists public.is_phantom_application_send(timestamptz, timestamptz, uuid, boolean);

commit;
