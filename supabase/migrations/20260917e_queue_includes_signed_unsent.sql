-- Queue scope: a SIGNED application pulls its deal in, even with no sent stamp.
--
-- The scope was "sent, or has a draft, or at/past Qualifying". Running the first
-- real document sweep surfaced a deal that satisfies none of them and is the
-- single most urgent row in the system: Express Redemption (MF-2026-0113), where
-- the merchant signed the application on 2026-07-22 and the deal is still at
-- 'contacted' because no send was ever recorded. A queue whose job is chasing
-- applications must not be able to miss a signed one. Only change to the
-- function; everything else is as 20260917d.

drop function if exists public.processor_application_queue();
CREATE OR REPLACE FUNCTION public.processor_application_queue()
 RETURNS TABLE(deal_id uuid, deal_number text, merchant_name text, deal_status text, deal_type text, customer_id uuid, do_not_contact boolean, assigned_closer_id uuid, assigned_closer_name text, app_sent_at timestamp with time zone, app_sent_by uuid, app_sent_by_name text, app_sent_attribution text, app_sent_attribution_basis text, app_signed_at timestamp with time zone, app_signed_state text, app_signed_checked_at timestamp with time zone, disclosure_signed_at timestamp with time zone, disclosure_state text, statements_count integer, statements_last_at timestamp with time zone, qa_decision text, qa_decided_at timestamp with time zone, qa_decision_reason text, days_since_app_sent integer, first_call_due_at timestamp with time zone, attempts_since_sent integer, last_attempt_at timestamp with time zone, last_conversation_at timestamp with time zone, app_row_exists boolean, app_fields jsonb)
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
    coalesce(c.do_not_contact, false),
    d.assigned_closer_id,
    nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), ''),
    d.application_sent_at,
    -- Rung 4: no evidence, so the honest answer is whoever owns the deal. NULL
    -- only when the application was never sent — nothing to attribute.
    case when d.application_sent_at is null then null
         else coalesce(d.application_sent_by, d.assigned_closer_id) end,
    case when d.application_sent_at is null then null
         else coalesce(
           nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
           nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), '')
         ) end,
    case
      when d.application_sent_at is null then null
      when d.application_sent_attribution is not null then d.application_sent_attribution
      when d.assigned_closer_id is not null then 'assumed_owner'
      else 'unknown'
    end,
    case
      when d.application_sent_at is null then null
      when d.application_sent_attribution is not null then d.application_sent_attribution_basis
      when d.assigned_closer_id is not null then
        'assumed: nobody recorded who sent it — this is the closer the deal is assigned to'
      else 'no record of who sent it, and the deal has no assigned closer'
    end,
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
  where d.id = any (v_ids)
  order by d.application_sent_at desc nulls last, d.created_at desc;
end;
$function$
;

revoke all on function public.processor_application_queue() from public, anon;
grant execute on function public.processor_application_queue() to authenticated, service_role;

-- ── The sweep's schedule ────────────────────────────────────────────────────
-- Hourly. A signature is not a speed-to-lead event, and the whole crawl is 2 GHL
-- calls today (status=completed, 39 documents, 21 per page) — ~48 calls/day
-- against the location's 200k cap. Cost scales with signatures ever collected,
-- never with the size of the book, so this does not join the per-record polling
-- class the ghl-standing-consumers-ledger convention exists to contain.
select cron.schedule(
  'ghl-doc-sweep-hourly',
  '12 * * * *',
  $job$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-doc-sweep?secret='
           || (public.get_ghl_config()->>'webhook_secret'),
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $job$
);
