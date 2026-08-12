-- ============================================================================
-- Substitute IRS Form W-8BEN — e-sign for foreign (PH-based) contractors
-- Applied live via MCP 2026-08-12.
--
-- WHAT THIS ADDS, reusing the EXISTING closer-docs e-sign pipeline (no new
-- signing system):
--   1. A new closer_doc_templates row, slug 'w-8ben' — a SUBSTITUTE Form W-8BEN.
--      The IRS permits a substitute that carries the same certifications as the
--      official form. It is a Markdown template with merge placeholders resolved
--      SERVER-SIDE (profiles + payout_profiles) before it is frozen and signed,
--      exactly like the onboarding docs.
--   2. A trigger that reflects a signed w-8ben back onto payout_profiles:
--      when the closer_documents row for doc_slug='w-8ben' flips to 'signed',
--      the contractor's payout_profiles.foreign_status_certified is set true and
--      foreign_status_certified_at is stamped to the signature time.
--
-- LINKAGE (verified against the live schema before writing this):
--   closers.user_id  --FK-->  profiles.id  <--FK--  payout_profiles.profile_id
--   So the contractor's profile id == closers.user_id == payout_profiles.profile_id.
--
-- NOT tax advice. The substitute W-8BEN is retained for contractor records only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The substitute W-8BEN template.
--    esignable = true so it rides the frozen-merge + sign_closer_document() path.
--    sort_order = 10 — after the 9 Phase-0 onboarding docs. It is intentionally
--    NOT in closer_doc_slugs() (the auto-seed list) — it applies only to foreign
--    contractors and is materialized on demand (self-service or admin), never
--    seeded onto every closer.
-- ---------------------------------------------------------------------------
insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$w-8ben$md$, $md$Substitute Form W-8BEN — Certificate of Foreign Status$md$, $md$sign$md$, true, 10, $md$db://closer_doc_templates/w-8ben$md$, $md$# Substitute Form W-8BEN — Certificate of Foreign Status of Beneficial Owner (Individual)

> **What this is.** This is a **substitute IRS Form W-8BEN** that [COMPANY] ("Company") keeps on file for its non-U.S. independent contractors. The IRS permits a substitute form that contains the same certifications as the official Form W-8BEN. It records that you are a foreign person for U.S. tax purposes. **It is for Company's records only and is not tax advice — please consult your own accountant or tax adviser with any questions.**

**Reference date:** [SIGN DATE]

---

## Part I — Identification of Beneficial Owner

1. **Name of the individual who is the beneficial owner:** [LEGAL NAME]
2. **Country of citizenship:** [CITIZENSHIP COUNTRY]
3. **Permanent residence address** (street, city, province/state, postal code, country — not a P.O. box or in-care-of address):
   [RESIDENCE ADDRESS]
4. **Mailing address** (if different from the permanent residence address):
   [MAILING ADDRESS]
5. **Foreign tax identifying number (TIN):** [FOREIGN TIN]

## Part II — Tax Status of the Income

I certify that the income to which this form relates is **not effectively connected** with the conduct of a trade or business within the United States. I am **not** claiming U.S. income-tax treaty benefits on this substitute form. (If you believe a tax-treaty benefit applies to you, tell Company **before** signing so that the official IRS Form W-8BEN can be used instead.)

## Part III — Certification (Penalties of Perjury)

Under penalties of perjury, I declare that I have examined the information on this form and, to the best of my knowledge and belief, it is true, correct, and complete. I further certify under penalties of perjury that:

- I am the individual that is the **beneficial owner** (or am authorized to sign for the individual that is the beneficial owner) of all the income to which this form relates;
- The person named on line 1 of this form is **not a United States person**;
- The income to which this form relates is **not effectively connected** with the conduct of a trade or business in the United States; and
- I **agree that I will submit a new form within 30 days** if any certification made on this form becomes incorrect.

I authorize this substitute form to be provided to any withholding agent that has control, receipt, or custody of the income of which I am the beneficial owner, or to any withholding agent that can disburse or make payments of that income.

---

**Signed by:** [LEGAL NAME]   ·   **Country of citizenship:** [CITIZENSHIP COUNTRY]   ·   **Date:** [SIGN DATE]

*Substitute W-8BEN retained by [COMPANY] for contractor tax records. Provided for recordkeeping only; it does not constitute tax or legal advice — consult your own accountant.*
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

-- ---------------------------------------------------------------------------
-- 2. Signed w-8ben  ->  payout_profiles.foreign_status_certified.
--
--    UPDATE-ONLY, by design: to have reached 'signed', the contractor's
--    substitute W-8BEN must have merged cleanly, which REQUIRES a non-blank
--    foreign_tax_id — and that lives on payout_profiles. So a payout_profiles row
--    already exists by the time this fires; there is nothing to insert. Keeping it
--    update-only also means the trigger can never fail a NOT NULL insert (country /
--    currency) inside sign_closer_document()'s UPDATE and block a signature.
--
--    Idempotent: re-running on an already-certified row is a harmless no-op write.
-- ---------------------------------------------------------------------------
create or replace function public.sync_w8ben_foreign_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_profile_id uuid;
begin
  if new.doc_slug = 'w-8ben'
     and new.status = 'signed'
     and (tg_op = 'INSERT' or old.status is distinct from 'signed')
  then
    -- closers.user_id IS the contractor's profiles.id == payout_profiles.profile_id.
    select c.user_id into v_profile_id
    from public.closers c
    where c.id = new.closer_id;

    if v_profile_id is not null then
      update public.payout_profiles
        set foreign_status_certified    = true,
            foreign_status_certified_at = coalesce(new.signed_at, now()),
            updated_at                  = now()
      where profile_id = v_profile_id;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists closer_documents_w8ben_certify on public.closer_documents;
create trigger closer_documents_w8ben_certify
  after insert or update of status on public.closer_documents
  for each row execute function public.sync_w8ben_foreign_status();
