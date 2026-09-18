-- send_evidence on deal_application_status: "was a document ACTUALLY sent?",
-- answered from the system of record, for all eight badge surfaces at once.
--
-- WHY THE BADGE CANNOT WORK THIS OUT ITSELF
-- Joyce Derian (MF-2026-0363) has an assigned closer, so the attribution ladder
-- returns 'assumed_owner' for her — BYTE-IDENTICAL to a genuine send. Every
-- client-side heuristic anyone reached for (application_sent_by is null → never
-- sent) is therefore wrong on exactly the row it needs to be right on. The answer
-- is not inferable from the deal row at all; it has to be read back out of GHL.
-- So it is computed here, once, and handed to the UI.
--
-- ONE DEFINITION, THREE CALLERS
-- public.deal_send_evidence() holds the rule. deal_application_status() joins it
-- (which is what reaches the badges), application_claims_vs_evidence() calls it
-- (the standing audit), and nothing else reimplements it. Two copies of a verdict
-- this load-bearing would drift, and a drifted copy here prints an accusation.
--
-- THE FOUR VERDICTS, IN RANK ORDER
--   has_evidence       a document was read back — outranks everything, because a
--                      document we can see exists regardless of index freshness
--   unknown_unreadable no complete crawl has ever run; nothing to compare against
--   unknown_stale      the send POST-DATES the evidence. Absence here is our blind
--                      spot, not the merchant's missing document
--   never_sent         a complete, current, set-scoped read found nothing
--
-- Only never_sent licenses the badge's "NEVER SENT — nothing to sign". Both
-- unknowns fall back to today's behaviour, which is the safe direction: the cost
-- of an unnecessary "unknown" is a shrug, and the cost of a wrong "never sent" is
-- eight surfaces accusing a merchant of ignoring an application they were sent.
--
-- BOTH PRECONDITIONS ON never_sent HAVE ALREADY FAILED IN PRODUCTION:
--   1. THE READ MUST BE COMPLETE — a merchant was reported never-sent off 273 of
--      282 documents and had in fact signed. Hence the crawl receipt.
--   2. IT MUST COVER THE WHOLE CONTACT SET — Miami Concierge Network's documents
--      all sit on his SECOND contact; the single ghl_contact_id pointer calls him
--      never-sent. Hence contact_ids + recipient email.
--   And a third, learned twenty seconds too late: the read must be CURRENT.
--   Joyce's application was created 20 seconds after a complete crawl finished.

begin;

-- ── THE RULE ────────────────────────────────────────────────────────────────
-- Internal helper. NOT granted to `authenticated`: the two SECURITY DEFINER
-- functions below execute as the owner and can call it, while a client cannot
-- probe arbitrary deal ids with it directly.
create or replace function public.deal_send_evidence(p_deal_ids uuid[])
returns table(
  deal_id              uuid,
  verdict              text,
  evidence_docs        integer,
  evidence_checked_at  timestamptz,
  evidence_age_seconds integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ran_at timestamptz;
begin
  -- The newest COMPLETE crawl is the evidence, not merely the newest crawl: a
  -- failed run landing after a good one must stop the clock, not blind the check.
  select c.ran_at into v_ran_at
    from public.ghl_document_crawls c
   where c.complete and c.error is null
   order by c.ran_at desc
   limit 1;

  return query
  with d as (
    select dl.id, dl.customer_id, dl.application_sent_at,
           -- THE REAL SEND MOMENT. deals.application_sent_at alone is not enough:
           -- a stage-move stamp can be OLDER than the crawl while the actual send
           -- is newer (Derian: 19:14 stamp, 20:46:59 send). Greatest of both, so
           -- neither a phantom stamp nor a missing application row can hide it.
           greatest(
             dl.application_sent_at,
             (select max(a.sent_to_merchant_at) from public.mca_applications a where a.deal_id = dl.id)
           ) as sent_signal
      from public.deals dl
     where dl.id = any (p_deal_ids)
  ),
  ident as (
    select c.id as customer_id,
           coalesce(c.ghl_contact_ids, '{}'::text[])
             || case when c.ghl_contact_id is null then '{}'::text[] else array[c.ghl_contact_id] end
             as contact_ids,
           array_remove(array[lower(btrim(c.email))] || coalesce(
             (select array_agg(lower(btrim(x))) from unnest(c.additional_emails) x), '{}'::text[]
           ), null) as emails
      from public.customers c
     where c.id in (select customer_id from d)
  ),
  ev as (
    select d.id as deal_id, count(r.*)::int as docs
      from d
      left join ident i on i.customer_id = d.customer_id
      left join public.ghl_document_recipients r
        on public.is_application_doc_name(r.doc_name)
       and (r.contact_id = any (i.contact_ids)
            or (r.recipient_email is not null and lower(r.recipient_email) = any (i.emails)))
     group by d.id
  )
  select d.id,
         case
           when coalesce(ev.docs, 0) > 0 then 'has_evidence'
           when v_ran_at is null then 'unknown_unreadable'
           when d.sent_signal is not null and d.sent_signal > v_ran_at then 'unknown_stale'
           else 'never_sent'
         end,
         coalesce(ev.docs, 0),
         v_ran_at,
         case when v_ran_at is null then null
              else greatest(0, extract(epoch from (now() - v_ran_at)))::int end
    from d left join ev on ev.deal_id = d.id;
end;
$$;

revoke all on function public.deal_send_evidence(uuid[]) from public, authenticated, anon;
grant execute on function public.deal_send_evidence(uuid[]) to service_role;

comment on function public.deal_send_evidence(uuid[]) is
  'Was an application document ACTUALLY sent to this merchant? Read back from the '
  'GHL document index across the merchant''s whole contact set. Verdicts in rank '
  'order: has_evidence, unknown_unreadable, unknown_stale, never_sent. Only '
  'never_sent licenses a UI claim that nothing was sent. Internal — reached '
  'through deal_application_status() and application_claims_vs_evidence().';

-- ── deal_application_status gains the verdict ───────────────────────────────
drop function if exists public.deal_application_status(uuid[]);
CREATE OR REPLACE FUNCTION public.deal_application_status(p_deal_ids uuid[])
 RETURNS TABLE(deal_id uuid, app_sent_at timestamp with time zone, app_sent_by uuid, app_sent_by_name text, app_sent_attribution text, app_sent_attribution_basis text, born_at_application_sent boolean, app_signed_at timestamp with time zone, app_signed_state text, app_signed_checked_at timestamp with time zone, disclosure_signed_at timestamp with time zone, disclosure_state text, send_evidence text, send_evidence_docs integer, send_evidence_checked_at timestamp with time zone, send_evidence_age_seconds integer)
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
      when not known.any_contact or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disclosure_signed_at,
    case
      when sig.disclosure_signed_at is not null then 'signed'
      when not known.any_contact or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    -- WAS A DOCUMENT ACTUALLY SENT? Not inferable from this row — Joyce Derian
    -- carries an assigned closer and reads 'assumed_owner' exactly like a genuine
    -- send — so it is read back out of GHL by public.deal_send_evidence().
    coalesce(se.verdict, 'unknown_unreadable'),
    coalesce(se.evidence_docs, 0),
    se.evidence_checked_at,
    se.evidence_age_seconds
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.customer_application_signatures sig on sig.customer_id = d.customer_id
  left join lateral (
    select public.is_phantom_application_send(
             d.application_sent_at, d.created_at, d.created_by) as yes
  ) ph on true
  -- "Do we know ANY GHL contact for this merchant?" — the set, not the pointer.
  left join lateral (
    select (c.ghl_contact_id is not null
            or coalesce(array_length(c.ghl_contact_ids, 1), 0) > 0) as any_contact
  ) known on true
  left join public.deal_send_evidence(p_deal_ids) se on se.deal_id = d.id
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

grant execute on function public.deal_application_status(uuid[]) to authenticated, service_role;

-- ── The standing audit now shares the rule rather than restating it ─────────
drop function if exists public.application_claims_vs_evidence();
create or replace function public.application_claims_vs_evidence()
returns table(
  deal_id              uuid,
  deal_number          text,
  business_name        text,
  deal_status          text,
  application_sent_at  timestamptz,
  claim_source         text,
  verdict              text,
  evidence_docs        integer,
  evidence_checked_at  timestamptz,
  evidence_age_seconds integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ids uuid[];
begin
  if not (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select array_agg(d.id) into v_ids
    from public.deals d
   where d.deal_type = 'mca'
     and (d.application_sent_at is not null
          or coalesce(public.deals_stage_rank(d.status), -1) >= public.deals_stage_rank('application_sent'));
  if v_ids is null then return; end if;

  return query
  select d.id, d.deal_number, c.business_name, d.status, d.application_sent_at,
         case when d.application_sent_at is not null then 'timestamp' else 'stage' end,
         se.verdict, se.evidence_docs, se.evidence_checked_at, se.evidence_age_seconds
    from public.deals d
    join public.customers c on c.id = d.customer_id
    join public.deal_send_evidence(v_ids) se on se.deal_id = d.id
   order by d.application_sent_at desc nulls last;
end;
$$;

comment on function public.application_claims_vs_evidence() is
  'Standing audit: every deal claiming a sent application, next to whether the '
  'document exists. Shares its verdict with deal_application_status() through '
  'public.deal_send_evidence() — one rule, not two copies.';

grant execute on function public.application_claims_vs_evidence() to authenticated, service_role;

commit;
