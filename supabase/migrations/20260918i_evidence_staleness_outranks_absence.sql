-- "complete" was answering the wrong question.
--
-- application_claims_vs_evidence() licensed a negative on a crawl receipt whose
-- `complete` flag meant "the fetch count reached GHL's reported total". That
-- proves the crawl read everything THAT EXISTED WHEN IT RAN. It says nothing
-- about whether the index is CURRENT — and "never sent" is a claim about NOW.
--
-- Measured on the very merchant the check was written for. The crawl finished at
-- 20:46:37Z having honestly read 282 of 282. Joyce Derian's 04B MCA PREFILL was
-- created at 20:46:57Z and her disclosure at 20:46:59Z — twenty seconds later,
-- and the location then held 284. For the next eleven hours the check would have
-- said "never sent" about a merchant whose application had just gone out.
--
-- Two changes, and they fix different halves:
--
--   1. STALENESS OUTRANKS ABSENCE. If a deal's send is NEWER than the evidence,
--      the verdict is 'unknown_stale', never 'never_sent'. You cannot claim the
--      absence of something that post-dates your evidence.
--
--      The send signal must be the APPLICATION ROW's sent_to_merchant_at, not
--      deals.application_sent_at. Derian proves why: her deal still carries a
--      19:14 stamp left by the stage-move bug, which is OLDER than the crawl and
--      would sail past a staleness test, while mca_applications.sent_to_merchant_at
--      reads 20:46:59 — the real send, newer than the crawl, correctly stale.
--      Greatest-of-both, so neither a phantom stamp nor a missing app row hides it.
--
--   2. THE READER MUST SEE THE AGE. Even a correct 'never_sent' is computed from
--      evidence of some age, and a twelve-hour-old negative deserves to be read
--      as twelve hours old. evidence_checked_at is now returned on EVERY verdict,
--      not only the readable ones, with evidence_age_seconds alongside it.
--
-- The deeper fix is not here: ghl-docs-status now writes the index on every
-- staff/portal read (it already crawls the whole list, so it costs nothing), which
-- collapses the staleness window from twelve hours to minutes. This migration is
-- what keeps the check honest during whatever window remains.

begin;

-- The return type gains evidence_age_seconds, so the old signature must go first
-- (Postgres refuses to change OUT parameters in place).
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
  v_crawl public.ghl_document_crawls%rowtype;
  v_readable boolean;
begin
  if not (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- The NEWEST COMPLETE crawl is the evidence, not merely the newest crawl: a
  -- failed run after a good one must not blind the check, it must only stop the
  -- clock moving forward.
  select * into v_crawl
    from public.ghl_document_crawls
   where complete and error is null
   order by ran_at desc
   limit 1;
  v_readable := v_crawl.id is not null;

  return query
  with claimed as (
    select d.id, d.deal_number, d.status, d.application_sent_at, d.customer_id,
           case when d.application_sent_at is not null then 'timestamp' else 'stage' end as src,
           -- THE REAL SEND MOMENT. deals.application_sent_at alone is not enough:
           -- a stage-move stamp can be older than the crawl while the actual send
           -- is newer (Derian: 19:14 stamp, 20:46:59 send).
           greatest(
             d.application_sent_at,
             (select max(a.sent_to_merchant_at) from public.mca_applications a where a.deal_id = d.id)
           ) as sent_signal
      from public.deals d
     where d.deal_type = 'mca'
       and (d.application_sent_at is not null
            or coalesce(public.deals_stage_rank(d.status), -1) >= public.deals_stage_rank('application_sent'))
  ),
  ident as (
    select c.id as customer_id,
           coalesce(c.ghl_contact_ids, '{}'::text[])
             || case when c.ghl_contact_id is null then '{}'::text[] else array[c.ghl_contact_id] end
             as contact_ids,
           array_remove(array[lower(btrim(c.email))] || coalesce(
             (select array_agg(lower(btrim(x))) from unnest(c.additional_emails) x), '{}'::text[]
           ), null) as emails,
           c.business_name
      from public.customers c
  ),
  ev as (
    select cl.id as deal_id, count(r.*)::int as docs
      from claimed cl
      join ident i on i.customer_id = cl.customer_id
      left join public.ghl_document_recipients r
        on public.is_application_doc_name(r.doc_name)
       and (r.contact_id = any (i.contact_ids)
            or (r.recipient_email is not null and lower(r.recipient_email) = any (i.emails)))
     group by cl.id
  )
  select cl.id, cl.deal_number, i.business_name, cl.status, cl.application_sent_at, cl.src,
         case
           -- No complete crawl has ever run: nothing to compare against.
           when not v_readable then 'unknown_unreadable'
           -- Evidence found. Freshness cannot make a POSITIVE wrong — a document
           -- we can see exists — so this outranks the staleness test.
           when coalesce(ev.docs, 0) > 0 then 'has_evidence'
           -- The send is NEWER than the evidence. Absence here is our blind spot,
           -- not the merchant's missing document.
           when cl.sent_signal is not null and cl.sent_signal > v_crawl.ran_at then 'unknown_stale'
           else 'never_sent'
         end,
         coalesce(ev.docs, 0),
         v_crawl.ran_at,
         case when v_crawl.ran_at is null then null
              else greatest(0, extract(epoch from (now() - v_crawl.ran_at)))::int end
    from claimed cl
    join ident i on i.customer_id = cl.customer_id
    left join ev on ev.deal_id = cl.id
   order by cl.application_sent_at desc nulls last;
end;
$$;

comment on function public.application_claims_vs_evidence() is
  'Every deal claiming an application was sent, next to whether an application '
  'document exists on ANY of that merchant''s GHL contacts. Verdicts, in rank '
  'order: has_evidence; unknown_unreadable (no complete crawl has run); '
  'unknown_stale (the send post-dates the evidence — our blind spot, not their '
  'missing document); never_sent. evidence_checked_at / evidence_age_seconds are '
  'returned on every row so a reader can see how old the answer is — a twelve-hour '
  'old negative must read as twelve hours old.';

grant execute on function public.application_claims_vs_evidence() to authenticated, service_role;

commit;
