-- The stacking guard on the merchant's "send me a fresh blank application"
-- button stopped working for most of the book, the same way everything else did.
--
-- request-blank-application read the twenty newest documents LOCATION-WIDE and
-- looked for this merchant's pending blank application in them. It had no date
-- guard at all. Measured against the document index: 45 pending
-- MCA_Merchant_Funding_Application rows across 32 contacts sit outside that
-- window, so for 32 merchants the guard answers "no pending application" forever
-- and each click mints another one. This is a self-service, merchant-facing path.
--
-- It also rested on GHL returning documents newest-first, which is an
-- undocumented default: /proposals/document takes no sort parameter, and this
-- repo sends explicit sortBy/sort=desc on five OTHER GHL endpoints. Correct for
-- incidental reasons, in a repo with no tests.
--
-- This replaces the GHL read entirely. public.ghl_document_recipients is
-- complete (receipt-verified), covers the merchant's whole CONTACT SET, and since
-- ghl-docs-status began writing it on every staff/portal read it is minutes old
-- rather than hours. Zero GHL calls, full coverage.
--
-- FOUR VERDICTS, and the two unknowns must NOT be collapsed into "clear":
--   pending             a pending blank application exists — refuse the mint
--   clear               complete, current, set-scoped read found none — allow
--   unknown_unreadable  no complete crawl has run — we cannot tell
--   unknown_stale       something may have been sent since the evidence — cannot tell
--
-- An unknown must refuse the mint AND say why. The old copy on a refusal was
-- "You already have a blank application ready to fill out" — said to a merchant
-- who has nothing, that is a lie of exactly the class this day was spent
-- removing. Silence about our own blind spot is not caution; it is the bug.

begin;

create or replace function public.merchant_pending_blank_application(p_customer_id uuid)
returns table(
  verdict              text,
  pending_docs         integer,
  evidence_checked_at  timestamptz,
  evidence_age_seconds integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ran_at   timestamptz;
  v_contacts text[];
  v_emails   text[];
  v_pending  integer;
  v_signal   timestamptz;
begin
  -- Newest COMPLETE crawl: a failed run after a good one stops the clock, it does
  -- not blind the check.
  select c.ran_at into v_ran_at
    from public.ghl_document_crawls c
   where c.complete and c.error is null
   order by c.ran_at desc
   limit 1;

  -- THE CONTACT SET, not the single pointer. Miami Concierge Network's documents
  -- all sit on his SECOND contact; a single-pointer read reports him as having no
  -- pending application and lets him mint another.
  select
    coalesce(cu.ghl_contact_ids, '{}'::text[])
      || case when cu.ghl_contact_id is null then '{}'::text[] else array[cu.ghl_contact_id] end,
    array_remove(array[lower(btrim(cu.email))] || coalesce(
      (select array_agg(lower(btrim(x))) from unnest(cu.additional_emails) x), '{}'::text[]
    ), null)
  into v_contacts, v_emails
  from public.customers cu
  where cu.id = p_customer_id;

  if v_contacts is null then
    return query select 'unknown_unreadable'::text, 0, v_ran_at, null::integer;
    return;
  end if;

  -- A PENDING BLANK application: the application family, excluding the prefilled
  -- variant, not completed. Mirrors isBlankApplication() in the edge function —
  -- the one place the two must agree, and the reason the pattern lives here.
  select count(*)::int into v_pending
    from public.ghl_document_recipients r
   where r.doc_name ~* 'application'
     and r.doc_name !~* 'prefill'
     and coalesce(r.doc_status, '') <> 'completed'
     and (r.contact_id = any (v_contacts)
          or (r.recipient_email is not null and lower(r.recipient_email) = any (v_emails)));

  -- Something may have been sent to this merchant since the evidence was taken —
  -- by staff, or by this very function a moment ago. Cannot rule out a pending
  -- one, so must not mint.
  select greatest(
           max(d.application_sent_at),
           max((select max(a.sent_to_merchant_at) from public.mca_applications a where a.deal_id = d.id))
         ) into v_signal
    from public.deals d
   where d.customer_id = p_customer_id;

  return query select
    case
      -- A pending document we can SEE outranks everything: it exists regardless
      -- of how fresh the index is.
      when v_pending > 0 then 'pending'
      when v_ran_at is null then 'unknown_unreadable'
      when v_signal is not null and v_signal > v_ran_at then 'unknown_stale'
      else 'clear'
    end::text,
    coalesce(v_pending, 0),
    v_ran_at,
    case when v_ran_at is null then null
         else greatest(0, extract(epoch from (now() - v_ran_at)))::int end;
end;
$$;

comment on function public.merchant_pending_blank_application(uuid) is
  'Does this merchant already have a PENDING blank application? Read from the '
  'document index across their whole contact set, never from a 20-document GHL '
  'window. Verdicts: pending / clear / unknown_unreadable / unknown_stale. Only '
  '"clear" may permit another mint — an unknown must refuse AND say why, because '
  'telling a merchant "you already have one" when we simply could not look is the '
  'failure this exists to prevent.';

revoke all on function public.merchant_pending_blank_application(uuid) from public, authenticated, anon;
grant execute on function public.merchant_pending_blank_application(uuid) to service_role;

commit;
