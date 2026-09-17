-- The attribution ladder: a name beside every send, and never a fabricated one.
--
-- OWNER RULING (2026-09-17, relayed by the team lead): every sent application
-- should show a name. The tempting shortcut — put the busiest closer on all the
-- unattributed rows — is exactly the failure this layer exists to remove: of the
-- rows with no evidence at all, four are Carlos's deals and one is the owner's,
-- so "attribute them all to Carlos" would print his name on an application that
-- was not his. The answer is a LADDER whose rung is always visible, so a name
-- that came from an assumption never renders like a name that came from a record.
--
--   1. mca_applications.sent_by                        -> 'recorded'
--   2. nearest activity_log.logged_by within ±10 min   -> 'inferred'
--   3. nearest activity_log.logged_by within ±24 h     -> 'inferred_same_day'
--   4. the deal's assigned closer                      -> 'assumed_owner'
--   5. nothing at all (no closer either)               -> 'unknown'
--
-- WHY RUNG 4 IS COMPUTED IN THE READERS AND NOT STORED
--   Rungs 1-3 are EVIDENCE about a moment that has passed, so they are written
--   into the row and frozen. Rung 4 is not evidence at all — it is a restatement
--   of who owns the deal right now. If the deal is reassigned tomorrow, the
--   honest assumption changes with it, and a frozen copy would quietly become a
--   lie. So deals.application_sent_by stays NULL for these and the readers
--   coalesce to the current assigned closer, labelled 'assumed_owner'.
--
-- MEASURED BEFORE THIS MIGRATION: 9 of the 63 sends were unattributable under
-- the ±10 min rule. Widening to ±24 h resolves 4 of them (MF-2026-0016,
-- MF-2026-0052, MF-2026-0126, MF-2026-0273). Five have no identifiable activity
-- in a 48-hour window at all — MF-2026-0013 (Brideau Insurance, owner's book),
-- 0032 (BRB Environmental), 0034 and 0242 (both Nothing But Waste), 0324
-- (Singing Mimi Music Studio) — and those five fall to rung 4.

begin;

-- ── 1. Widen the stored vocabulary to rungs 1-3 ─────────────────────────────
-- 'assumed_owner' is deliberately NOT accepted here: it is a reader-side label,
-- and allowing it to be stored would let a stale assumption freeze into the row.
alter table public.deals
  drop constraint if exists deals_application_sent_attribution_check;
alter table public.deals
  add constraint deals_application_sent_attribution_check
  check (application_sent_attribution is null
         or application_sent_attribution in ('recorded','inferred','inferred_same_day'));

comment on column public.deals.application_sent_attribution is
  'Evidence rung for application_sent_by: recorded (mca_applications.sent_by, or auth.uid() captured at the stamp) | inferred (activity within ±10 min) | inferred_same_day (activity within ±24 h). NULL means no evidence — the readers fall back to the assigned closer and label it assumed_owner. Never store assumed_owner here.';

-- ── 2. Rung 3 backfill — same-day activity ──────────────────────────────────
-- An application sent and worked the same day is a reasonable inference; ±10 min
-- was too tight for the batch-worked deals. Deal-scoped rows still beat
-- customer-scoped ones, then nearest in time.
with scope as (
  select d.id, d.customer_id, d.application_sent_at
    from public.deals d
   where d.application_sent_at is not null
     and d.application_sent_by is null
),
same_day as (
  select s.id,
         (select al.logged_by
            from public.activity_log al
           where al.logged_by is not null
             and ((al.entity_type = 'deal'     and al.entity_id = s.id)
               or (al.entity_type = 'customer' and al.entity_id = s.customer_id))
             and al.created_at between s.application_sent_at - interval '24 hours'
                                   and s.application_sent_at + interval '24 hours'
           order by (al.entity_type = 'deal') desc,
                    abs(extract(epoch from (al.created_at - s.application_sent_at))) asc
           limit 1) as who
    from scope s
)
update public.deals d
   set application_sent_by = sd.who,
       application_sent_attribution = 'inferred_same_day',
       application_sent_attribution_basis =
         'inferred: nearest person active on this deal/customer the same day (±24 h) — no send was recorded'
  from same_day sd
 where d.id = sd.id
   and sd.who is not null;

-- ── 3. Readers gain rung 4 ──────────────────────────────────────────────────
-- Both readers now return a name for every SENT application. They still return
-- NULL attribution for a deal that was never sent: that is not a blank name, it
-- is "there is no send to attribute", and printing "sent by …" there would be
-- the same class of invention the ladder exists to prevent.

drop function if exists public.deal_application_status(uuid[]);
create function public.deal_application_status(p_deal_ids uuid[])
returns table (
  deal_id                    uuid,
  app_sent_at                timestamptz,
  app_sent_by                uuid,
  app_sent_by_name           text,
  app_sent_attribution       text,
  app_sent_attribution_basis text,
  app_signed_at              timestamptz,
  app_signed_state           text,
  app_signed_checked_at      timestamptz,
  disclosure_signed_at       timestamptz,
  disclosure_state           text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    d.id,
    d.application_sent_at,
    -- Rung 4: no evidence, so the honest answer is whoever owns the deal.
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
    sig.app_at,
    case
      when sig.app_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disc_at,
    case
      when sig.disc_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join lateral (
    select max(gc.completed_seen_at) filter (where public.is_application_doc_name(gc.doc_name)) as app_at,
           max(gc.completed_seen_at) filter (where gc.doc_name ~* 'disclosure')                 as disc_at
      from public.ghl_doc_completions gc
     where gc.customer_id = d.customer_id
  ) sig on true
  where d.id = any (p_deal_ids)
    and (
      public.is_ops_staff(auth.uid())
      or public.is_processor(auth.uid())
      or d.assigned_closer_id is null
      or d.assigned_closer_id = auth.uid()
      or d.created_by = auth.uid()
      or d.assigned_closer_id = any (public.my_closer_ids(auth.uid()))
    );
$function$;

revoke all on function public.deal_application_status(uuid[]) from public, anon;
grant execute on function public.deal_application_status(uuid[]) to authenticated, service_role;

comment on function public.deal_application_status(uuid[]) is
  'Cheap signed/unsigned/unchecked + sender badge data for any list page. app_sent_attribution is the ladder rung (recorded | inferred | inferred_same_day | assumed_owner | unknown); assumed_owner is the deal''s current assigned closer, not a record, and must not render like recorded. Re-states the deals money-wall SELECT predicate. Local tables only.';

drop function if exists public.processor_application_queue();
create function public.processor_application_queue()
returns table (
  deal_id                    uuid,
  deal_number                text,
  merchant_name              text,
  deal_status                text,
  deal_type                  text,
  customer_id                uuid,
  do_not_contact             boolean,
  assigned_closer_id         uuid,
  assigned_closer_name       text,
  app_sent_at                timestamptz,
  app_sent_by                uuid,
  app_sent_by_name           text,
  app_sent_attribution       text,
  app_sent_attribution_basis text,
  app_signed_at              timestamptz,
  app_signed_state           text,
  app_signed_checked_at      timestamptz,
  disclosure_signed_at       timestamptz,
  disclosure_state           text,
  statements_count           integer,
  statements_last_at         timestamptz,
  qa_decision                text,
  qa_decided_at              timestamptz,
  qa_decision_reason         text,
  days_since_app_sent        integer,
  first_call_due_at          timestamptz,
  attempts_since_sent        integer,
  last_attempt_at            timestamptz,
  last_conversation_at       timestamptz,
  app_row_exists             boolean,
  app_fields                 jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    sig.app_at,
    case
      when sig.app_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disc_at,
    case
      when sig.disc_at is not null then 'signed'
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
  left join lateral (
    select max(gc.completed_seen_at) filter (where public.is_application_doc_name(gc.doc_name)) as app_at,
           max(gc.completed_seen_at) filter (where gc.doc_name ~* 'disclosure')                 as disc_at
      from public.ghl_doc_completions gc
     where gc.customer_id = d.customer_id
  ) sig on true
  where d.id = any (v_ids)
  order by d.application_sent_at desc nulls last, d.created_at desc;
end;
$function$;

revoke all on function public.processor_application_queue() from public, anon;
grant execute on function public.processor_application_queue() to authenticated, service_role;

comment on function public.processor_application_queue() is
  'Application-chase queue for the processor. Gated on is_processor OR is_ops_staff (the processor money-wall exemption is deliberate). app_sent_attribution is the ladder rung (recorded | inferred | inferred_same_day | assumed_owner | unknown); assumed_owner is the deal''s current assigned closer, NOT a record, and must never render like recorded. Never computes partial-vs-complete: app_fields carries the raw draft + seed material and src/lib/applicationCompleteness.ts decides. Signature has three states because ghl_doc_completions is a lazy mirror, not a sweep.';

commit;
