-- ============================================================================
-- Closer onboarding: merged documents + in-app e-signature
-- Applied live via MCP 2026-07-11.
--
-- THE PROBLEM THIS SOLVES: the closer legal docs are TEMPLATES full of
-- [COMPANY] / [CLOSER NAME] / [COMMISSION %] / [DRAW AMOUNT] placeholders.
-- Nobody can sign a document with raw brackets in it. So:
--
--   1. closer_doc_templates  — the authoritative template text, in the DB.
--   2. send-closer-onboarding-package (edge fn) merges the template against the
--      closer's real row + company settings, SERVER-SIDE, and freezes the result
--      into closer_documents.merged_content + merged_sha256.
--   3. The closer is emailed a link, reads that exact frozen text, and signs.
--   4. sign_closer_document() records the signature against merged_sha256.
--
-- Why freeze the content: a signature against a mutable template is worthless.
-- The signature ledger points at the exact bytes the signer saw. If the template
-- later changes, old signatures still reference what was actually agreed to.
--
-- Why the merge is server-side: the browser must never be trusted to tell the
-- database what a person agreed to.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Template store. Body text is seeded verbatim from research/legal/*.md.
--    Nothing in this system authors or edits legal language.
-- ---------------------------------------------------------------------------
create table if not exists public.closer_doc_templates (
  slug         text primary key,
  title        text not null,
  action       text not null check (action in ('sign', 'collect', 'complete')),
  esignable    boolean not null default false,
  sort_order   int not null default 0,
  source_path  text,
  body_md      text not null,
  version      int not null default 1,
  updated_at   timestamptz not null default now()
);

comment on table public.closer_doc_templates is
  'Authoritative text of the closer onboarding documents, seeded verbatim from research/legal/*.md. Merged server-side per closer before sending.';

alter table public.closer_doc_templates enable row level security;

drop policy if exists closer_doc_templates_staff_read on public.closer_doc_templates;
create policy closer_doc_templates_staff_read on public.closer_doc_templates
  for select to authenticated using ( is_staff((select auth.uid())) );

drop policy if exists closer_doc_templates_super_manage on public.closer_doc_templates;
create policy closer_doc_templates_super_manage on public.closer_doc_templates
  for all to authenticated
  using ( is_super_admin((select auth.uid())) )
  with check ( is_super_admin((select auth.uid())) );

-- ---------------------------------------------------------------------------
-- 2. Frozen merged content on the tracker row.
-- ---------------------------------------------------------------------------
alter table public.closer_documents add column if not exists merged_content  text;
alter table public.closer_documents add column if not exists merged_sha256   text;
alter table public.closer_documents add column if not exists template_version int;
alter table public.closer_documents add column if not exists sent_at         timestamptz;
alter table public.closer_documents add column if not exists sent_by         uuid references public.profiles(id) on delete set null;

comment on column public.closer_documents.merged_content is
  'The exact, fully-merged document text sent to this closer. Frozen at send time. This — not the template — is what gets signed.';
comment on column public.closer_documents.merged_sha256 is
  'SHA-256 of merged_content. The signature ledger references this.';

-- ---------------------------------------------------------------------------
-- 3. Signature ledger. APPEND-ONLY: there is deliberately no UPDATE or DELETE
--    policy on this table for ANY role, including super_admin. An e-signature
--    record that staff can edit is not evidence of anything.
-- ---------------------------------------------------------------------------
create table if not exists public.closer_document_signatures (
  id              uuid primary key default gen_random_uuid(),
  closer_id       uuid not null references public.closers(id) on delete restrict,
  doc_slug        text not null references public.closer_doc_templates(slug) on delete restrict,
  signer_user_id  uuid not null references public.profiles(id) on delete restrict,
  -- The full legal name the signer TYPED. Not copied from their profile — the
  -- act of typing it is the signature (ESIGN-style intent).
  signer_name     text not null,
  -- The exact consent sentence they ticked, stored verbatim.
  consent_text    text not null,
  -- What they actually agreed to, byte for byte, plus its hash.
  content_snapshot text not null,
  content_sha256  text not null,
  signed_at       timestamptz not null default now(),
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists closer_doc_sig_closer_idx on public.closer_document_signatures (closer_id);
create index if not exists closer_doc_sig_slug_idx   on public.closer_document_signatures (doc_slug);

comment on table public.closer_document_signatures is
  'Append-only e-signature ledger. No UPDATE/DELETE policy exists for any role, by design.';

alter table public.closer_document_signatures enable row level security;

-- Staff (admin/super_admin) can READ every signature — they need the evidence.
drop policy if exists closer_doc_sig_staff_read on public.closer_document_signatures;
create policy closer_doc_sig_staff_read on public.closer_document_signatures
  for select to authenticated
  using ( is_admin_or_super((select auth.uid())) );

-- A closer can read ONLY their own signatures.
drop policy if exists closer_doc_sig_self_read on public.closer_document_signatures;
create policy closer_doc_sig_self_read on public.closer_document_signatures
  for select to authenticated
  using ( closer_id in (select c.id from public.closers c where c.user_id = (select auth.uid())) );

-- NO insert policy: signatures are written ONLY through sign_closer_document()
-- (SECURITY DEFINER), so the row is always built from the server's view of who
-- the caller is and what the frozen content says. Nobody can forge one via REST.

-- ---------------------------------------------------------------------------
-- 4. The signing entry point.
--    Validates: caller holds the closer row · the doc was actually sent ·
--    frozen content exists · no raw [PLACEHOLDER] survives · not already signed.
--    Captures IP + user-agent server-side from the PostgREST request headers,
--    so the browser cannot spoof them.
-- ---------------------------------------------------------------------------
create or replace function public.sign_closer_document(
  p_doc_slug     text,
  p_signer_name  text,
  p_consent_text text
)
returns public.closer_document_signatures
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_closer    public.closers%rowtype;
  v_doc       public.closer_documents%rowtype;
  v_headers   json;
  v_ip        text;
  v_ua        text;
  v_sig       public.closer_document_signatures;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if coalesce(btrim(p_signer_name), '') = '' then
    raise exception 'Type your full legal name to sign';
  end if;
  if coalesce(btrim(p_consent_text), '') = '' then
    raise exception 'Consent text is required';
  end if;

  -- Only the person the document belongs to may sign it.
  select * into v_closer from public.closers where user_id = v_uid;
  if not found then
    raise exception 'No closer record is linked to your account';
  end if;

  select * into v_doc
  from public.closer_documents
  where closer_id = v_closer.id and doc_slug = p_doc_slug;
  if not found then
    raise exception 'This document is not on your checklist';
  end if;

  if v_doc.status = 'signed' then
    raise exception 'You have already signed this document';
  end if;
  if v_doc.status <> 'sent' or v_doc.merged_content is null then
    raise exception 'This document has not been sent to you yet';
  end if;

  -- Belt-and-braces: never let anyone sign a document that still has an
  -- unresolved [PLACEHOLDER] in it. The send path already blocks this; this is
  -- the second lock, at the moment of legal consequence.
  --
  -- DEFAULT-DENY, matching PLACEHOLDER_RE in closerDocMerge.ts: match ANY
  -- bracketed run, then allow back only the markdown checkbox "[ ]"/"[x]" and a
  -- hand-written blank "[____]". Matching only SHOUTING_CASE (the first cut of
  -- this) let "[DRAW AMOUNT — recommended $2,500]" and "[#]" straight through.
  if exists (
    select 1
    from regexp_matches(v_doc.merged_content, '\[[^\]\n]{1,80}\]', 'g') as m(tok)
    where m.tok[1] !~ '^\[(\s*|[xX]|_+)\]$'
  ) then
    raise exception 'This document still has unfilled fields and cannot be signed';
  end if;

  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := null;
  end;
  v_ip := split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1);
  v_ua := v_headers ->> 'user-agent';

  insert into public.closer_document_signatures (
    closer_id, doc_slug, signer_user_id, signer_name, consent_text,
    content_snapshot, content_sha256, ip_address, user_agent
  ) values (
    v_closer.id, p_doc_slug, v_uid, btrim(p_signer_name), btrim(p_consent_text),
    v_doc.merged_content,
    -- digest() lives in the `extensions` schema, so it must be qualified — the
    -- function's search_path is 'public'. (The edge fn normally supplies the
    -- hash at send time; this is the fallback.)
    coalesce(v_doc.merged_sha256, encode(extensions.digest(v_doc.merged_content, 'sha256'), 'hex')),
    nullif(btrim(v_ip), ''), v_ua
  )
  returning * into v_sig;

  update public.closer_documents
  set status = 'signed', signed_at = v_sig.signed_at
  where id = v_doc.id;

  return v_sig;
end;
$fn$;

revoke all on function public.sign_closer_document(text, text, text) from public;
grant execute on function public.sign_closer_document(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Company merge settings. These fill [COMPANY], [SIGNATORY NAME, TITLE],
--    [STATE], the clawback window, and the Schedule A §4 draw treatment.
--
--    company_legal_name is seeded but MUST be confirmed by the owner: CLAUDE.md
--    describes the entity as both "MFunding, LLC" and a "Florida C-Corp", and
--    Schedule A's own text says "a Florida corporation". That contradiction is a
--    human decision, not one this migration should silently make — which is
--    exactly why it is a setting and not a hardcoded constant.
--
--    draw_unrecovered_treatment resolves Schedule A §4's "[ ] forgiven / [x]
--    repayable" checkbox. It defaults to 'repayable' (the owner's standing
--    policy) and is an admin flag on /admin/platform-config. The merge always
--    resolves it to one side or the other — a signer must never see a Schedule A
--    with both boxes empty, and Schedule A is therefore sendable out of the box.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value)
values ('closer_docs', jsonb_build_object(
  'company_legal_name',         'MFunding, LLC d/b/a Momentum Funding',
  'company_signatory',          null,
  'governing_state',            'Florida',
  'clawback_window_days',       null,
  'renewal_override_pct',       null,
  'draw_unrecovered_treatment', 'repayable',
  'payment_method',             'direct deposit (ACH)'
))
on conflict (key) do nothing;
insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$schedule-a-rate-sheet$md$, $md$Schedule A — Compensation Rate Sheet$md$, $md$sign$md$, true, 2, $md$research/legal/closer-ic-commission-agreement-scheduleA.md$md$, $md$# Schedule A — Compensation Rate Sheet
### To accompany the Independent Contractor Commission Agreement (v2) between [COMPANY] ("Company") and [CLOSER NAME] ("Contractor")

> This Schedule A sets the **exact rates** referenced in the body of the Independent Contractor Commission Agreement. It is incorporated by reference into that Agreement. Where this Schedule conflicts with the Agreement body on a rate, this Schedule controls; on all other terms, the Agreement controls. All compensation is **commission-only** (plus optional draw per §4) for a **1099 independent contractor**. Contractor is responsible for all self-employment taxes.

**Company:** [COMPANY] (a Florida corporation), d/b/a Momentum Funding
**Contractor:** [CLOSER NAME]
**Effective Date:** [DATE]

---

## 1. Definitions
- **Commission Pool** — the gross commission Company actually receives from a funder/lender on a funded deal (e.g., 8 points on a $50,000 advance = $4,000). Contractor's share is a percentage of this pool, not of the deal face amount.
- **Company-Provided Lead** — any lead Company supplies (live transfer, purchased lead, inbound from Company marketing, round-robin assignment, or any contact already in Company's CRM).
- **Self-Generated Lead** — a lead Contractor sources independently at Contractor's own cost and effort, with no Company lead spend, and logged as self-generated in the CRM **before** first contact.
- **Renewal** — additional capital funded to a merchant Contractor previously funded on a **Self-Generated Lead**, within Contractor's self-generated funded book. Company-Provided Lead deals are not renewal-eligible for the Contractor.

## 2. Commission Splits
| Deal type | Contractor share of Commission Pool | Company retains |
|---|---|---|
| Company-Provided Lead | **[COMMISSION %] (default 30%)** | balance |
| Self-Generated Lead | **[COMMISSION %] (recommended 65%)** | balance |
| Renewal on Contractor's self-generated funded book | **[COMMISSION %] (recommended 30%)** | balance |

**Worked example (Company lead, 30%):** $50,000 advance × 8 points = $4,000 pool → Contractor $1,200, Company $2,800.
**Worked example (Self-gen, 65%):** $4,000 pool → Contractor $2,600, Company $1,400.

> Renewals may instead be routed to a dedicated renewals specialist at Company's discretion, in which case the originating Contractor receives **[RENEWAL OVERRIDE % — e.g., 0–10%]**.

## 3. Performance Escalators (Company-Provided Leads only)
Measured on Contractor's **total funded volume in a calendar month** — base 30% escalating to 35% then 40%:
| Monthly funded volume | Company-lead split rises to |
|---|---|
| Base (Momentum Standard) | **30%** |
| $250,000+ (≈5 funded deals) | **35%** |
| $500,000+ (≈10 funded deals) | **40%** |

Escalators apply to deals funded **in the qualifying month** and reset monthly. Self-gen and renewal rates are unaffected by escalators. Thresholds are business terms set by Company management and may be adjusted.

## 4. Ramp-Up Draw (optional)
- Recoverable draw of up to **$[DRAW AMOUNT — recommended $2,500]/month** for the first **[# — recommended 90] days**.
- A draw is an **advance against future commissions**, not salary or guaranteed pay. It is recovered first from earned commissions before any net payout to Contractor.
- If, at the end of the draw period or upon termination, drawn amounts exceed earned commissions, the unrecovered balance is [ ] forgiven / [x] repayable per the Agreement — **select one and confirm with attorney; treatment affects tax and enforceability**.

## 5. Payment Timing
Commissions are paid **within 5 business days after the funder/lender pays Company** on the funded deal — not at point of sale. Company pays when Company is paid. Payment by [direct deposit / method] per the signed Direct Deposit Authorization.

## 6. Clawback
If a merchant defaults, rescinds, or otherwise triggers a funder reversal within the funder's clawback window, the funder reverses Company's commission and the corresponding portion of Contractor's share is **clawed back** — either repaid by Contractor or **deducted from future commissions/draw balance**, at Company's election. Full terms in the Clawback Policy Acknowledgment and the Agreement.

## 7. No Other Compensation
This Schedule is the complete statement of Contractor compensation. No salary, benefits, expense reimbursement, or equity is provided unless separately agreed in writing and signed by an officer of Company.

---

### Acknowledged and agreed:

Contractor: _________________________ [CLOSER NAME]  Date: __________

Company: ___________________________ [SIGNATORY NAME, TITLE]  Date: __________

*Rates above are negotiable business terms, not legal advice. Confirm draw repayment treatment, clawback mechanics, and non-solicitation/non-circumvention terms with counsel before use.*
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$nda-confidentiality$md$, $md$Confidentiality & Non-Disclosure Agreement$md$, $md$sign$md$, true, 3, $md$research/legal/closer-nda-confidentiality.md$md$, $md$# Confidentiality & Non-Disclosure Agreement
### Between [COMPANY] ("Company") and [CLOSER NAME] ("Recipient")

**Effective Date:** [DATE]

This Agreement supplements (and does not replace) the confidentiality provisions of the Independent Contractor Commission Agreement.

## 1. Confidential Information
"Confidential Information" means all non-public information disclosed to or accessed by Recipient in connection with services for Company, including but not limited to:
- Merchant and lead lists, contact data, application data, bank statements, and any merchant financial or personal information;
- Funder/lender identities, rate sheets, underwriting criteria, commission structures, and submission contacts;
- VCF / debt-relief partner terms, rate cards, and referral arrangements;
- CRM data, scripts, pricing, marketing strategy, vendor lists, and business processes;
- Any information marked confidential or that a reasonable person would understand to be confidential.

## 2. Obligations
Recipient shall: (a) use Confidential Information solely to perform services for Company; (b) not disclose it to any third party; (c) protect it with at least reasonable care; (d) not copy, export, or retain it except as needed for the services; and (e) immediately notify Company of any actual or suspected unauthorized disclosure.

## 3. Personal & Financial Data
Recipient acknowledges that merchant data includes sensitive personal and financial information subject to privacy and data-security laws (including but not limited to GLBA-type obligations and applicable state law). Recipient shall handle such data strictly per Company's Data Security Policy and applicable law, and shall not store merchant data on personal devices or accounts outside Company-approved systems.

## 4. Exclusions
Confidential Information does not include information that is or becomes public through no fault of Recipient, was lawfully known before disclosure, or is independently developed without use of Confidential Information.

## 5. Return / Destruction
On termination or on request, Recipient shall promptly return or destroy (and certify destruction of) all Confidential Information and copies, including data in personal accounts, devices, or cloud storage.

## 6. Survival & Duration
Confidentiality obligations survive termination and continue for **[TERM — recommended: indefinitely for trade secrets; 3 years for other Confidential Information]**.

## 7. No License; Remedies
No license or ownership is transferred. Recipient agrees that breach may cause irreparable harm for which money damages are inadequate, and Company may seek **injunctive relief** in addition to other remedies. This Agreement is governed by the laws of the State of [STATE] (recommended: Florida).

---

Recipient: _________________________ [CLOSER NAME]  Date: __________

Company: ___________________________ [SIGNATORY NAME, TITLE]  Date: __________
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$tcpa-compliance-acknowledgment$md$, $md$TCPA & Regulatory Compliance Acknowledgment$md$, $md$sign$md$, true, 4, $md$research/legal/closer-tcpa-compliance-acknowledgment.md$md$, $md$# TCPA & Regulatory Compliance Acknowledgment + Script-Adherence Sign-Off
### [COMPANY] ("Company") · [CLOSER NAME] ("Contractor")

**Effective Date:** [DATE]

Contractor acknowledges and agrees to the following as a condition of performing outreach and sales services for Company.

## 1. TCPA / Calling Rules
- I will call/text only numbers for which there is a **lawful basis** — prior express consent, an established business relationship, or a contact properly scrubbed against the National and internal Do-Not-Call (DNC) lists.
- I will **honor opt-outs immediately** (verbal "stop calling," SMS "STOP," or any clear revocation) and log them so they propagate to the DNC list.
- I will respect **calling-hours / quiet-hours** rules (generally 8:00 a.m.–9:00 p.m. in the contact's local time zone) and any stricter state limits.
- I will **not** use an autodialer, prerecorded message, or ringless voicemail to a cell phone without the consent required by law. I will manually dial cells where required.
- I will not spoof caller ID or misrepresent my identity or Company's.

## 2. DNC & Litigator Scrub
I understand Company maintains an internal DNC list and uses litigator/DNC scrubbing. I will only dial from approved, scrubbed lists and will not import or call my own unscrubbed lists through Company systems.

## 3. Product-Language Compliance
- For **MCA / merchant cash advance** products, I will **never** use the word "loan." I will use "advance," "funding," "working capital," or "purchase of future receivables."
- For actual loan products (term loan, SBA, equipment financing, line of credit, the VCF FDIC bank refinance), standard lending terminology is appropriate.
- For **VCF / debt relief**, I will make **no guarantees** of savings, approval, or outcome; I will lead with "no upfront fees"; I will describe the program as **attorney-led** without overstating attorney involvement; and I will state it is **not a law firm** where relevant.
- I will **not** charge or request any **upfront fee** from a merchant.

## 4. State Disclosures
I understand certain states (CA, NY, VA, UT, FL, CT, GA, KS, TX, MO, and others) require commercial-financing or debt-relief disclosures. I will deliver the Company-provided, attorney-approved disclosure for the merchant's state and product, and will not improvise disclosure language.

## 5. Script Adherence
I will use Company-approved scripts and disclosures for regulated statements. I will not make claims about rates, approval, timing, credit impact, or savings beyond what approved materials permit. Deviations that create compliance risk are grounds for corrective action or termination.

## 6. Consequences
I understand violations of TCPA, DNC, state law, or these rules can create personal and Company liability, and are grounds for **immediate termination**, withholding of commissions tied to non-compliant deals, and indemnification per the Independent Contractor Commission Agreement.

---

I have read and agree to the above.

Contractor: _________________________ [CLOSER NAME]  Date: __________
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$code-of-conduct$md$, $md$Closer Code of Conduct$md$, $md$sign$md$, true, 5, $md$research/legal/closer-code-of-conduct.md$md$, $md$# Closer Code of Conduct — Do's & Don'ts
### [COMPANY] (Momentum Funding) · for 1099 closers

**Effective Date:** [DATE]

This Code is a condition of working with Company. It exists to protect merchants, Company, and you. When in doubt, ask before you say it.

## Core Principle
Help, don't hype. Tell the truth. Honor the rules. Sell hard, but clean.

## ✅ DO
- **DO** call/text only lawfully contactable, scrubbed numbers; honor opt-outs instantly; respect quiet hours (8a–9p local).
- **DO** call MCA products an "advance," "funding," "working capital," or "purchase of future receivables."
- **DO** lead with **no upfront fees** and **no credit impact to review options** (a soft check; only a formal funder submission may affect credit).
- **DO** present **two or more offers** when available and explain factor rate, total payback, and retrieval rate honestly.
- **DO** deliver the correct state + product disclosure provided by Company.
- **DO** log accurate notes, qualifying data, and outcomes in the CRM.
- **DO** use approved scripts for regulated statements (rates, approval odds, timing, credit, savings).
- **DO** protect merchant data — Company-approved systems only.

## ❌ DON'T
- **DON'T** ever call an MCA a "loan."
- **DON'T** guarantee approval, a specific rate/factor, funding time, savings %, or "no credit impact" beyond what's true.
- **DON'T** charge or request any **upfront fee** from a merchant — Company is paid by funders/lenders.
- **DON'T** improvise legal/disclosure language or skip required disclosures.
- **DON'T** misrepresent your identity, Company, or the product; no spoofed caller ID.
- **DON'T** use autodialers/prerecorded/ringless voicemail to cells without required consent.
- **DON'T** submit falsified applications, altered bank statements, or fabricated stips. Fraud = immediate termination + potential liability.
- **DON'T** stack a merchant into a deal you know they can't perform just to fund.
- **DON'T** poach merchants/funders for yourself or a competitor (see non-solicitation / non-circumvention in your Agreement).
- **DON'T** store merchant data on personal devices, email, or cloud accounts.

## VCF / Debt-Relief Specific
- Describe as **attorney-led debt restructuring**; do **not** overstate attorney involvement and note it is **not a law firm** where relevant.
- Use ranges ("many clients see 50–75%") as **typical, substantiated** outcomes — never promises.
- Never describe the merchant's existing MCA as a "loan." The FDIC refinance product **is** a loan — that term is fine there.

## Enforcement
Violations may result in coaching, withheld commissions on non-compliant deals, or **immediate termination**, depending on severity. Compliance violations and fraud are zero-tolerance.

---

I have read, understand, and agree to follow this Code of Conduct.

Closer: _________________________ [CLOSER NAME]  Date: __________
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$clawback-policy-acknowledgment$md$, $md$Clawback Policy Acknowledgment$md$, $md$sign$md$, true, 6, $md$research/legal/closer-clawback-policy-acknowledgment.md$md$, $md$# Clawback Policy Acknowledgment
### [COMPANY] ("Company") · [CLOSER NAME] ("Contractor")

**Effective Date:** [DATE]

This Acknowledgment explains how commission clawbacks work and is incorporated into the Independent Contractor Commission Agreement and Schedule A.

## 1. Why Clawbacks Exist
Company is paid commission by funders/lenders **after** a deal funds. Funders reverse that commission if a deal goes bad early — most commonly a **default, rescission, NSF/non-performance, or merchant fraud within the funder's clawback window** (often the first payments or first 30–90 days; the exact window is set by each funder). When the funder reverses Company's commission, the portion already paid to Contractor must be returned.

## 2. What Gets Clawed Back
If a funder reverses or reduces commission on a deal Contractor was paid on, Contractor's corresponding share is subject to clawback in the **same proportion** as Contractor's original split. Example: Contractor earned $1,400 (35% of a $4,000 pool); funder claws back 100% → Contractor owes $1,400; funder claws back 50% → Contractor owes $700.

## 3. How It's Recovered
At Company's election, clawed-back amounts are recovered by any combination of:
- **Deduction from future commissions** or draw balance;
- **Offset against amounts otherwise owed** to Contractor;
- **Direct repayment** by Contractor within [#] days of written notice if no sufficient future commissions exist.

## 4. Draw Interaction
Outstanding draw balances and clawbacks are both recoverable from future commissions. Company will provide a written accounting on request.

## 5. Fraud / Misrepresentation
If a deal is reversed due to falsified documents, misrepresentation, or fraud attributable to Contractor, Contractor is responsible for the **full** clawback regardless of split, and such conduct is grounds for immediate termination and potential legal action.

## 6. Records & Disputes
Company will provide the funder's reversal documentation supporting any clawback. Contractor may dispute in writing within [#] days; Company's reasonable determination, consistent with the funder's reversal, controls.

## 7. Survival
Clawback obligations survive termination of the relationship.

---

I understand and agree that commissions are conditional and subject to clawback as described above.

Contractor: _________________________ [CLOSER NAME]  Date: __________
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

insert into public.closer_doc_templates (slug, title, action, esignable, sort_order, source_path, body_md)
values ($md$direct-deposit-authorization$md$, $md$Direct Deposit (ACH) Authorization$md$, $md$complete$md$, false, 8, $md$research/legal/closer-direct-deposit-form.md$md$, $md$# Direct Deposit (ACH) Authorization — Commission Payments
### [COMPANY] (Momentum Funding) · 1099 Independent Contractor

**Effective Date:** [DATE]

I, the undersigned independent contractor, authorize [COMPANY] to deposit my commission payments by ACH electronic transfer into the account designated below, and, if necessary, to make correcting debit entries to reverse any erroneous credit.

## Contractor Information
- Full legal name: [CLOSER NAME]
- Business / DBA name (if paid to an entity): [ENTITY NAME — optional]
- Taxpayer ID (SSN or EIN — last 4 only on this form; full TIN via W-9): XXX-XX-[____]
- Address: [ADDRESS]
- Email: [EMAIL]  Phone: [PHONE]

## Bank Account Information
- Bank name: [BANK NAME]
- Account holder name (must match account): [NAME]
- Routing number (9 digits): [ROUTING #]
- Account number: [ACCOUNT #]
- Account type: [ ] Checking  [ ] Savings  [ ] Business

> **Verification:** Attach a voided check or a bank letter confirming the account. Do not email full account/routing numbers in plain text; submit via the secure Company-approved upload.

## Terms
- Payments are made **within 5 business days after the funder/lender pays Company** on a funded deal, subject to clawback and any outstanding draw balance.
- This authorization remains in effect until I revoke it in writing with reasonable notice for Company to act.
- I am responsible for notifying Company promptly of any account change to avoid failed/misdirected payments.
- This form does **not** change my status as a 1099 independent contractor; no taxes are withheld and I am responsible for all self-employment taxes.

---

Contractor signature: _________________________ [CLOSER NAME]  Date: __________

*Company use only:* Verified by ______  Date ______  Voided check/bank letter on file [ ]
$md$)
on conflict (slug) do update set
  title = excluded.title, action = excluded.action, esignable = excluded.esignable,
  sort_order = excluded.sort_order, source_path = excluded.source_path,
  body_md = excluded.body_md, version = public.closer_doc_templates.version + 1, updated_at = now()
where public.closer_doc_templates.body_md is distinct from excluded.body_md
   or public.closer_doc_templates.title is distinct from excluded.title;

