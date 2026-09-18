-- A signature nobody could map to a merchant used to leave NO ROW AT ALL.
--
-- ghl-doc-sweep counted it (`unmappedContacts`) and skipped the insert, so the
-- signature existed only as an integer in one run's response JSON: no card, no
-- badge, no timeline note, nothing a human would ever see. That is the same
-- shape as the failure this whole day of work started from — a merchant signed
-- and nobody saw it — just one layer earlier, and it is the failure-reads-as-
-- success trap again: "not in the table" renders everywhere as "did not sign".
--
-- Measured live 2026-09-18: GHL held 41 completed documents, the table held 37.
-- The 4 absent ones were not noise. Of the 8 signatures that could not be
-- attributed on a full crawl, 4 belong to an address that maps to TWO merchants
-- (refusing to guess is correct — filing a signature under the wrong company is
-- worse than leaving it unfiled) and 4 are test documents signed with the
-- owner's own address. Both are things a human should be able to look at.
--
-- So: record the orphan with a NULL customer_id and enough context to act on it.
-- Every existing reader is already safe with that — customer_application_
-- signatures carries `where customer_id is not null`, application_signature_alert
-- and processor_pipeline_rows join through customer_id so a null simply does not
-- join, and the three client readers all skip a null explicitly.
--
-- The columns below are what make an orphan ACTIONABLE rather than merely
-- present, and what make it HEALABLE: because document_id is the primary key, a
-- row recorded orphaned would otherwise stay orphaned forever — a later, better
-- resolution would hit a 23505 and skip. _shared/ghlDocCompletions.ts therefore
-- adopts a null-customer_id row when it can finally resolve it, which is exactly
-- what should happen the day a merchant record is created for a signer we did
-- not know yet.

alter table public.ghl_doc_completions
  add column if not exists ghl_contact_id     text,
  add column if not exists recipient_email    text,
  add column if not exists unresolved_reason  text;

comment on column public.ghl_doc_completions.ghl_contact_id is
  'The signer''s GHL contact id — recipients[].id where entityName = "contacts". NOT recipients[].contactId, which does not exist. Kept even when customer_id resolved, so a signature can always be traced back to the contact it was filed against.';

comment on column public.ghl_doc_completions.recipient_email is
  'The signer''s address as GHL recorded it. Free (it arrives with the document crawl) and it is what resolves a signature filed against a contact our tables have never stored.';

comment on column public.ghl_doc_completions.unresolved_reason is
  'NULL means attributed. Non-null means we recorded the signature but could not say whose it is, and this is why. A row like this is a question for a human, never a merchant who did not sign.';

-- The orphan worklist. Partial, so it costs nothing while the healthy case is
-- the overwhelming majority.
create index if not exists ghl_doc_completions_unattributed_idx
  on public.ghl_doc_completions (signed_at desc)
  where customer_id is null;

-- One place to ask "what signatures can we not account for?" — so the answer
-- lives somewhere a human reads instead of in a cron run's response body.
create or replace view public.unattributed_doc_signatures as
  select document_id,
         doc_name,
         signed_at,
         completed_seen_at,
         ghl_contact_id,
         recipient_email,
         unresolved_reason,
         public.is_application_doc_name(doc_name) as is_application
    from public.ghl_doc_completions
   where customer_id is null;

comment on view public.unattributed_doc_signatures is
  'Signatures we have recorded but cannot attribute to a merchant. Non-empty is not an error — it is a worklist. An is_application row here is urgent: somebody signed an application and no deal shows it.';

grant select on public.unattributed_doc_signatures to authenticated;
