-- THE COMPARISON THAT HAS NEVER EXISTED.
--
-- We hold a CLAIM — deals.application_sent_at, "an application went to this
-- merchant" — and we hold EVIDENCE — the documents GHL actually has. Nothing has
-- ever put the two next to each other. Joyce Derian (MF-2026-0363) has read
-- "application sent" since 2026-09-18 19:14 and has zero documents in GHL; one
-- ad-hoc query found it in thirty seconds, two days later, only because someone
-- happened to look.
--
-- ── WHY ghl_doc_completions CANNOT ANSWER THIS ──────────────────────────────
-- The hourly sweep crawls `status=completed` only — 41 of the location's 282
-- documents. That is the right shape for "who has SIGNED", and it is useless for
-- "was anything ever SENT": an application sitting unsigned is invisible to it,
-- and so is a merchant who was sent nothing at all. Those two look identical
-- there, which is the same empty-vs-unreadable confusion this whole day was
-- about. So the evidence side needs its own index of every document, not just
-- the completed ones.
--
-- ── COST (ghl-standing-consumers-ledger) ────────────────────────────────────
-- 282 documents at 21/page = 14 calls, DAILY (?full=1), not hourly: ~14 calls a
-- day against a 200k cap, ~0.01%. It scales with documents ever created (slow),
-- never with the size of the book, which is the bounded location-wide shape the
-- convention asks for rather than the per-record polling class it forbids.
--
-- ── AND IT MUST REFUSE TO SAY "ZERO" OFF A SHORT READ ───────────────────────
-- The team lead first reported THREE merchants with no documents. The third,
-- Brideau Insurance, has a completed application AND a completed disclosure — the
-- crawl had fetched 273 of 282 and absence was reported off a partial read. That
-- is the same defect that locked 44 merchants out of signing, committed while
-- investigating it. So every crawl records whether it was COMPLETE, and the check
-- below returns 'unknown_unreadable' — never 'no_evidence' — unless the newest
-- crawl proved it read the whole set.

begin;

-- ── One row per (document, recipient). A document can have several recipients,
--    and the merchant we are asking about may be any of them.
create table if not exists public.ghl_document_recipients (
  document_id     text not null,
  contact_id      text not null,
  recipient_email text,
  doc_name        text,
  doc_status      text,
  doc_created_at  timestamptz,
  seen_at         timestamptz not null default now(),
  primary key (document_id, contact_id)
);

comment on table public.ghl_document_recipients is
  'Index of EVERY GHL proposal document and who it was addressed to, refreshed by '
  'ghl-doc-sweep?full=1. The evidence side of "was an application actually sent?". '
  'Deliberately not limited to completed documents — an unsigned application is '
  'still proof something went out, and its absence is the thing we need to see.';

create index if not exists ghl_document_recipients_contact_idx
  on public.ghl_document_recipients (contact_id);
create index if not exists ghl_document_recipients_email_idx
  on public.ghl_document_recipients (lower(recipient_email));

-- ── The readability receipt. Without this, an empty index and a failed crawl are
--    the same thing, and the check would report a merchant as never-sent because
--    OUR read broke.
create table if not exists public.ghl_document_crawls (
  id             uuid primary key default gen_random_uuid(),
  ran_at         timestamptz not null default now(),
  complete       boolean not null,
  fetched        integer,
  reported_total integer,
  error          text
);

comment on table public.ghl_document_crawls is
  'One row per full document crawl. complete = fetched reached the reported total. '
  'application_claims_vs_evidence() returns unknown_unreadable unless the newest '
  'row is complete — a short read may never be reported as "no document".';

create index if not exists ghl_document_crawls_ran_idx
  on public.ghl_document_crawls (ran_at desc);

alter table public.ghl_document_recipients enable row level security;
alter table public.ghl_document_crawls enable row level security;

drop policy if exists staff_read_doc_recipients on public.ghl_document_recipients;
create policy staff_read_doc_recipients on public.ghl_document_recipients
  for select to authenticated
  using (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid()));

drop policy if exists staff_read_doc_crawls on public.ghl_document_crawls;
create policy staff_read_doc_crawls on public.ghl_document_crawls
  for select to authenticated
  using (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid()));

-- ── THE CHECK ───────────────────────────────────────────────────────────────
-- For every deal that CLAIMS an application went out — by timestamp or by stage —
-- does the merchant have an application document on ANY of their GHL contacts?
--
-- The contact SET, not the single pointer. Miami Concierge's eight documents all
-- sit on his SECOND contact; a single-pointer check would have reported him as
-- never-sent and been confidently wrong about the merchant who actually signed.
-- Recipient email is matched too, because that finds a document filed against a
-- contact we have never stored at all.
create or replace function public.application_claims_vs_evidence()
returns table(
  deal_id             uuid,
  deal_number         text,
  business_name       text,
  deal_status         text,
  application_sent_at timestamptz,
  claim_source        text,
  verdict             text,
  evidence_docs       integer,
  evidence_checked_at timestamptz
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

  select * into v_crawl from public.ghl_document_crawls order by ran_at desc limit 1;
  -- No crawl has ever run, or the newest one was short/errored. Either way we
  -- cannot prove absence, and saying "no document" would be reporting our own
  -- failure as a fact about a merchant.
  v_readable := v_crawl.id is not null and v_crawl.complete and v_crawl.error is null;

  return query
  with claimed as (
    select d.id, d.deal_number, d.status, d.application_sent_at, d.customer_id,
           case when d.application_sent_at is not null then 'timestamp'
                else 'stage' end as src
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
           when not v_readable then 'unknown_unreadable'
           when coalesce(ev.docs, 0) > 0 then 'has_evidence'
           else 'no_evidence'
         end,
         coalesce(ev.docs, 0),
         case when v_readable then v_crawl.ran_at else null end
    from claimed cl
    join ident i on i.customer_id = cl.customer_id
    left join ev on ev.deal_id = cl.id
   order by cl.application_sent_at desc nulls last;
end;
$$;

comment on function public.application_claims_vs_evidence() is
  'Every deal claiming an application was sent, next to whether an application '
  'document actually exists on ANY of that merchant''s GHL contacts. Returns '
  'unknown_unreadable rather than no_evidence whenever the newest document crawl '
  'was incomplete — a short read may never be reported as absence.';

grant execute on function public.application_claims_vs_evidence() to authenticated, service_role;

commit;

-- Applied separately (cron.schedule cannot run inside the transaction above):
--
--   select cron.schedule('ghl-doc-sweep-nightly-full', '35 7 * * *', $cron$
--     select net.http_post(
--       url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-doc-sweep?full=1&secret='
--              || (public.get_ghl_config()->>'webhook_secret'),
--       headers := jsonb_build_object('Content-Type','application/json'),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 120000
--     );
--   $cron$);
--
-- jobid 63, live. The explicit timeout matters: pg_net's default is 5 s, and a
-- 14-page crawl exceeds it — a cron'd call that "ran" nightly while proving
-- nothing is one of the four failures that produced the unreadable-vs-empty rule.
