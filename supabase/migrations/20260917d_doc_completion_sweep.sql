-- The signature mirror becomes a real sweep — and gains the REAL signed date.
--
-- WHAT WAS MEASURED (live, 2026-09-17, before this)
--   public.ghl_doc_completions held 30 rows across 16 customers. 59 customers
--   have an application sent. So we had looked at 16 and never looked at 43, and
--   every reader rendered "never looked" as "unsigned".
--
--   Probing the GHL proposals API settles what is possible:
--     GET /proposals/document?locationId=…&limit=21
--       -> { documents: […], total: 268 }.  limit caps at 21 (422 above).
--     offset / page          -> rejected ("property should not exist")
--     skip=N                 -> WORKS. So the whole set IS walkable.
--     contactId / recipientId-> rejected. There is NO per-contact filter.
--     status=completed       -> WORKS, and total drops from 268 to 39.
--
--   That last one is the whole design. We only ever care about COMPLETED
--   documents, and there are 39 of them location-wide. Two API calls read every
--   signature in the account. Hourly, that is ~48 calls/day against the 200k
--   cap — and it scales with the number of signatures ever collected (slow),
--   never with the size of the book. This is not the per-record polling class
--   the ghl-standing-consumers-ledger convention warns about; it is a single
--   bounded location-wide query, the same shape ghl-email-doc-sweep moved to.
--
--   Crawling that set found 9 completions we had never recorded, THREE of them
--   real application signatures, plus 6 disclosures.
--
-- WHY THE FULL CRAWL IS WHAT MAKES "not_signed" SAYABLE
--   Because there is no per-contact filter, a targeted refresh is impossible —
--   but a full crawl of the completed set is better anyway: once it succeeds, we
--   have seen EVERY signature in the location, so absence is proven for every
--   contact at once. That is what lets customers.ghl_docs_checked_at be stamped
--   across the whole in-scope set rather than one contact at a time. It is
--   stamped ONLY on a crawl that completed (fetched == reported total); a
--   partial or failed crawl leaves it alone, so a failure can never read as
--   "checked and clean".

begin;

-- ── 1. The real signature timestamp ─────────────────────────────────────────
-- completed_seen_at is when WE noticed. The GHL recipient record carries
-- signedDate — when the merchant actually signed. Every one of the 39 live
-- completed documents has it populated. "Signed 6 days ago" is a chase signal;
-- "we noticed 6 days ago" is not, and the two differ by however long nobody
-- happened to open that contact's documents.
alter table public.ghl_doc_completions
  add column if not exists signed_at timestamptz;

comment on column public.ghl_doc_completions.signed_at is
  'When the merchant actually signed (GHL recipient.signedDate). Prefer this over completed_seen_at, which is only when our mirror first noticed.';
comment on column public.ghl_doc_completions.completed_seen_at is
  'When OUR mirror first recorded the completion. Not the signature time — see signed_at.';

-- Backfill is impossible for rows the sweep has not re-seen yet; the sweep fills
-- signed_at on every row it touches, so this converges on its first successful run.

-- ── 1b. ONE place that turns completion rows into "signed when?" ───────────
-- This lateral had been copy-pasted into three readers, and each copy was one
-- edit away from disagreeing about which doc counts and which timestamp wins.
-- Every reader joins this view now.
create or replace view public.customer_application_signatures as
  select gc.customer_id,
         max(coalesce(gc.signed_at, gc.completed_seen_at))
           filter (where public.is_application_doc_name(gc.doc_name)) as app_signed_at,
         max(coalesce(gc.signed_at, gc.completed_seen_at))
           filter (where gc.doc_name ~* 'disclosure')                 as disclosure_signed_at
    from public.ghl_doc_completions gc
   where gc.customer_id is not null
   group by gc.customer_id;

revoke all on public.customer_application_signatures from public, anon, authenticated;

comment on view public.customer_application_signatures is
  'Per-customer signature times: the APPLICATION (is_application_doc_name — never the Broker Compensation Disclosure) and the disclosure, separately. Prefers the merchant''s real signedDate over when our mirror noticed. Not granted to clients — read it through the SECURITY DEFINER readers, which apply the money wall.';

-- ── 2. Mark the in-scope book as checked, after a COMPLETE crawl ────────────
-- Called by the ghl-doc-sweep edge function, and only when it read the entire
-- completed set. The scope deliberately matches processor_application_queue()'s:
-- the deals a processor is chasing. Customers outside it stay 'unchecked', which
-- is honest — we have not been asked about them.
create or replace function public.ghl_docs_mark_checked(p_checked_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  -- Service-role only. This asserts "we have looked", and nothing that is not
  -- the sweep is in a position to assert it.
  if auth.uid() is not null then
    raise exception 'ghl_docs_mark_checked is service-role only' using errcode = '42501';
  end if;

  update public.customers c
     set ghl_docs_checked_at = p_checked_at
   where c.ghl_contact_id is not null
     and exists (
       select 1 from public.deals d
        where d.customer_id = c.id
          and d.deal_type = 'mca'
          and (
            d.application_sent_at is not null
            or exists (select 1 from public.mca_applications a where a.deal_id = d.id)
            or coalesce(public.deals_stage_rank(d.status), -1) >= 2
          )
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.ghl_docs_mark_checked(timestamptz) from public, anon, authenticated;
grant execute on function public.ghl_docs_mark_checked(timestamptz) to service_role;

comment on function public.ghl_docs_mark_checked(timestamptz) is
  'Stamps customers.ghl_docs_checked_at across the application-chase scope. Call ONLY after a crawl that read the entire completed-document set — a partial crawl must never mark the book as checked.';

-- ── 3. Readers prefer the real signature date ──────────────────────────────
-- Same functions as 20260917c; the only change is coalesce(signed_at,
-- completed_seen_at) wherever a signature time is read. Kept as a full replace
-- so the live definition always matches a file in this repo.

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
    end
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.customer_application_signatures sig on sig.customer_id = d.customer_id
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
  'Cheap signed/unsigned/unchecked + sender badge data for any list page. Signature times prefer the merchant''s real signedDate. app_sent_attribution is the ladder rung (recorded | inferred | inferred_same_day | assumed_owner | unknown); assumed_owner is the deal''s current assigned closer, not a record. Re-states the deals money-wall SELECT predicate. Local tables only.';


-- processor_application_queue re-emitted against the shared signature view.
-- Only change: the copy-pasted signature lateral becomes a join on
-- public.customer_application_signatures, so the queue, the badge reader and the
-- board all read one definition of "signed, and when". Everything else — the
-- gate, the scope, the ladder, app_fields — is byte-identical to 20260917c.

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

commit;
