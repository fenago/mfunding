# Per-Funder Submission Workflows — Build Plan

**Goal:** On Revenue Playbook Step 6, the closer sees a checkbox list of funders, checks 3–5, clicks **Submit** — and each selected funder receives the deal package **in that funder's exact required format**: their submission email, their subject-line convention, their required body fields, their attachment rules. Portal-only funders get a guided portal flow instead. One click → boom, out the door, all tracked.

---

## 0. What already exists (build on this, don't duplicate)

| Piece | Where | Status |
|---|---|---|
| Funder network (39 lenders) | `lenders` table | ✅ has `submission_email`, `submission_portal_url`, `submission_notes`, criteria (min revenue/TIB/credit, industries, states, paper types) |
| Submission records | `deal_submissions` table | ✅ per deal × lender rows (status, amounts, offers) |
| Send engine | `submit-to-funders` edge function | ✅ emails funders through GHL, upserts funder as GHL contact, logs to `activity_log` — but ONE generic email format for everyone, **no attachments** |
| Matching/scoring | Deal page → Submissions tab | ✅ auto-scores lenders against the deal |
| Docs | `customer_documents` + Supabase storage; signed PDFs on GHL contact | ✅ exist, not yet wired into submissions |
| Playbook Step 6 | `PlaybooksPage` StepCard | ✅ stage move only — no funder picker yet |

**Gap in one sentence:** we can email funders generically; we cannot yet email each funder *their way*, with the documents, from the playbook.

---

## 1. Core design decision: recipes, not 39 hand-built GHL workflows

"Each funder has their own workflow" — correct as a *concept*, wrong as a GHL implementation. 39 hand-maintained GHL workflows = 39 things to break, no versioning, no code review, and GHL workflows can't attach deal documents dynamically anyway.

**Instead: a `funder_submission_profiles` recipe per lender (data), executed by ONE engine (`submit-to-funders` v2).** Same outcome — every funder gets exactly their format — but adding/changing a funder is editing a row in the admin UI, not building automation. A recipe IS that funder's workflow; the engine is the workflow runner.

```
Step 6 checkboxes ──▶ submit-to-funders v2 ──▶ for each checked funder:
                                                 load recipe → render subject/body
                                                 → gather required docs → send email
                                                   (or open portal flow) → record row
```

---

## 2. Data model

### 2.1 `funder_submission_profiles` (new table, 1:1 with lenders)

```sql
create table funder_submission_profiles (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references lenders(id) unique,
  method text not null check (method in ('email','portal','email_and_portal')),

  -- EMAIL recipe
  to_email text,                  -- overrides lenders.submission_email if set
  cc_emails text[],
  subject_template text,          -- "New Submission — {{business_name}} — ${{amount_requested}} — ISO: Momentum Funding"
  body_template text,             -- funder's required layout, merge tokens below
  attach_docs text[] not null default '{}',
      -- ordered doc slugs: 'signed_application','bank_statements','photo_id',
      -- 'voided_check','proof_of_ownership','processing_statements'
  attachment_mode text not null default 'links'
      check (attachment_mode in ('links','attachments','both')),
      -- links = secure expiring URLs in the email body (safest, always works)
      -- attachments = real files on the email (funder requires PDFs attached)
  max_statement_months int default 4,

  -- PORTAL recipe
  portal_url text,                -- overrides lenders.submission_portal_url
  portal_steps text[],            -- ordered human steps shown to the closer
  portal_credentials_hint text,   -- "login is in 1Password → Funders vault"

  -- GUARDS
  required_stips text[] not null default '{}',  -- blocks submit if any missing
  special_instructions text,      -- freeform: "No PDFs over 10MB", "Subject MUST start with ISO#4412"
  active boolean not null default true,
  updated_at timestamptz default now()
);
```

### 2.2 Merge tokens (rendered by the engine)

`{{business_name}} {{dba}} {{owner_name}} {{owner_email}} {{owner_phone}} {{ein}}
{{amount_requested}} {{monthly_revenue}} {{time_in_business}} {{industry}} {{use_of_funds}}
{{state}} {{positions}} {{deal_number}} {{closer_name}} {{closer_email}} {{doc_links}}`

### 2.3 `deal_submissions` additions

```sql
alter table deal_submissions add column if not exists submission_method text;      -- email | portal
alter table deal_submissions add column if not exists sent_payload jsonb;          -- exact subject/body/docs sent (audit)
alter table deal_submissions add column if not exists portal_confirmed_at timestamptz;
alter table deal_submissions add column if not exists error text;
-- status values: queued | sent | send_failed | portal_pending | portal_confirmed | declined | offer
```

---

## 3. The engine — `submit-to-funders` v2

For each checked lender id:

1. **Load recipe** (fallback: generic template + `lenders.submission_email` when no profile exists — today's behavior is the fallback, nothing breaks).
2. **Stips guard:** verify every `required_stips` doc exists on the deal (from `customer_documents` + signed-doc records). Missing → return `blocked: ['bank_statements']` for the UI; do NOT send a partial package to a funder.
3. **Gather docs:** create expiring **signed URLs** (72h) from Supabase storage for each doc slug; `attachment_mode='attachments'` → download and attach real files to the email (GHL attachments API; fallback to links + note if size limits hit).
4. **Render** subject + body templates with merge tokens.
5. **Send** via GHL (funder contact upsert → conversations email) — from `submissions@send.mfunding.net` styled as Momentum Funding.
6. **Portal funders:** no email (or a courtesy heads-up email if `email_and_portal`). Create `deal_submissions` row at `portal_pending`, return the portal recipe (url + steps) for the UI checklist. Closer clicks **"Mark submitted"** after doing it → `portal_confirmed`.
7. **Record** everything: `deal_submissions.sent_payload` (exact email as sent — the audit trail when a funder says "we never got it"), `activity_log`, and per-funder result back to the UI.
8. **Idempotency:** a lender with an existing non-failed submission for this deal is skipped (`already_submitted`) unless `resubmit: true`.

---

## 4. Playbook Step 6 UI (the checkboxes the closer sees)

New `FunderPicker` component rendered inside Step 6's capture box when a deal is loaded:

```
┌ Submit to funders ──────────────────────────────────────────┐
│ ✅ Rapid Capital      A-paper · email · fits (score 92)      │
│ ✅ Fundbox            B-paper · email+portal · fits (88)     │
│ ⬜ Forward Financing   B-paper · PORTAL ONLY · fits (85)     │
│ ⬜ Kalamata            C-paper · email · ⚠ min revenue miss  │
│ …auto-sorted by match score; misfits collapsed under "Show   │
│ 12 non-matching funders"                                     │
│                                                              │
│ Package check: ✅ signed app ✅ disclosure ✅ 4 mo statements │
│                ⚠ missing: voided check (blocks Kalamata)     │
│                                                              │
│ [ Submit to 2 selected funders ]                             │
└──────────────────────────────────────────────────────────────┘
Results (inline, per funder):
  Rapid Capital   ✉ Sent 9:14 AM  · view payload
  Fundbox         ✉ Sent 9:14 AM  · view payload
  Forward Fin.    🔗 Portal — open portal ↗ · steps 1-4 · [Mark submitted]
```

Behavior:
- Checkbox list = lenders scored against the deal (reuse the Submissions-tab matcher), method badge (✉ / 🔗 / both), disabled + reason when criteria hard-fail.
- **Submit button** calls the engine with checked ids → per-funder result rows render live.
- Portal funders expand into a mini-checklist (recipe `portal_steps`) + "Open portal ↗" + **Mark submitted** button.
- When ≥1 funder is `sent`/`portal_confirmed`, the step's main button ("Save & mark Submitted done") advances the stage as usual — stage move stays separate from the fan-out so partial submissions don't strand the deal.
- Everything mirrors on the deal page's Submissions tab (same table).

---

## 5. Admin: recipe editor

On `/admin/lenders/:id` add a **"Submission recipe"** card:
- method, to/cc, subject template, body template (textarea with token palette), attach-docs multiselect + order, attachment mode, required stips, portal URL + steps editor, special instructions, active toggle.
- **"Send test to myself"** button → runs the real engine against a dummy deal, emails the rendered result to the logged-in admin. This is how you QA a funder's format before trusting it.
- Seed: migration creates a default email profile for every lender that has `submission_email` (generic template), so day one behaves exactly like today until recipes are customized funder-by-funder.

---

## 6. Build phases

| Phase | What | Size |
|---|---|---|
| **1** ✅ | Migration (`funder_submission_profiles` + `deal_submissions` columns) + seed defaults | S |
| **2** ✅ | Engine v2: recipes, merge rendering, doc links, stips guard, idempotency, `sent_payload` audit | M |
| **3** ✅ | Step 6 `FunderPicker` (checkboxes → submit → live results) reusing the matcher | M |
| **4** ✅ | Portal flow (steps checklist + Mark submitted) | S |
| **5** ✅ | Admin recipe editor + send-test-to-myself | M |
| **6a** ✅ | Merge GHL-side merchant docs (FILE_UPLOAD custom fields) into `doc_links` | S |
| **6** ⬜ | Real file attachments via GHL (vs links) — needs size-limit testing per funder | S/M |
| Later | offer-parsing from funder reply emails into `deal_submissions`; per-funder SLA nudges (5-day chase); auto-resubmit tier-2 on all-decline | — |

---

## ✅ Implementation notes (Phases 1–5 shipped 2026-07-02)

**Shipped:** Phases 1–5. Migration `20260702_funder_submission_profiles.sql` applied
to `ehibjeonqpqskhcvizow` (15 default email recipes seeded for lenders with a
`submission_email`). Engine `submit-to-funders` redeployed as v2. New UI:
`src/components/admin/FunderPicker.tsx` (playbook Step 6) and
`src/components/lenders/FunderRecipeCard.tsx` (admin lender detail page).

**Deviations from this plan (reality won):**
1. **`lenders.name` does not exist — the column is `company_name`.** v1 selected a
   non-existent `name`; v2 selects `company_name` everywhere. (The FunderPicker and
   engine both use `company_name`.)
2. **Doc slugs are the real `customer_document_type` enum values, not the plan's
   illustrative names.** Canonical slugs: `application, bank_statement, id,
   voided_check, credit_authorization, business_license, personal_guarantee,
   tax_return, other`. This makes the stips-guard match exact against
   `customer_documents.document_type` instead of a lossy mapping. `signed_application`
   → `application`, `photo_id` → `id`, `proof_of_ownership` → `business_license`,
   `processing_statements` → (no enum; use `bank_statement`/`other`).
3. **`deal_submissions.status` keeps only existing `SubmissionStatus` values** so the
   UI's `SUBMISSION_STATUS_CONFIG` record never throws on an unknown key. The plan's
   new lifecycle strings (`queued/send_failed/portal_pending/portal_confirmed`) are
   NOT written to `status`; instead: successful email → `status='submitted'`; failed
   send → `status='pending'` + `error` populated; portal → `status='pending'` +
   `submission_method='portal'`, and "Mark submitted" sets `status='submitted'` +
   `portal_confirmed_at`. The rich per-funder lifecycle (sent / send_failed /
   portal_pending / blocked / already_submitted) is returned in the engine's
   `results` array and rendered live by the FunderPicker, so nothing is lost.
4. **CC emails** are captured on the recipe and stored in `sent_payload` for audit,
   but the GHL conversations email helper sends to a single contact — CC is not yet
   actually delivered (folds into Phase 6 alongside real attachments).
5. **Portal "Mark submitted"** updates `deal_submissions` directly from the browser,
   which works under the admin RLS (`Admins manage deal_submissions`). Closers have
   SELECT-only on `deal_submissions` by policy, so a closer clicking Mark-submitted
   would be blocked — acceptable since the playbook is an admin/super tool; route it
   through the engine if closers need it later.
6. **`test_email`** is a boolean override (not the literal address): the engine forces
   the recipient to the logged-in admin's own email and never writes
   `deal_submissions`, guaranteeing no funder is ever contacted during QA.
7. `attachment_mode` is always effectively `links` (Phase 6 out of scope); recipes may
   store `attachments`/`both` but the engine sends links and records a note in
   `sent_payload`.

**Remaining for Phase 6:** real file attachments through the GHL attachments API
(with per-funder size-limit testing) and actual CC delivery; everything else in
Phases 1–5 is live.

---

## ✅ Phase 6a — GHL-side docs merged into submissions (shipped 2026-07-02)

The docs a merchant sends back usually land **GHL-side**, not in Supabase storage:
bank statements + stips sit on the contact's `FILE_UPLOAD` custom fields (from the
upload form), and signed e-sign PDFs live in GHL Documents & Contracts. v2 only
linked Supabase-storage docs, so a merchant who uploaded through GHL produced an
empty Documents section. Fixed:

1. **New shared helper `listContactFileUploads(cfg, contactId)`** in
   `supabase/functions/_shared/ghl.ts` — enumerates a contact's `FILE_UPLOAD`
   fields (custom-field id→name map, then `contact.customFields` values with
   `meta.originalname` + `url`). `ghl-docs-status` was refactored to call it (same
   output shape, no more duplicated logic), and `submit-to-funders` calls it once
   per submit (contact-level, same for every funder).

2. **GHL download URLs are PUBLIC — linked directly, no proxy.** Verified against a
   real contact: `GET services.leadconnectorhq.com/documents/download/{id}` with
   **no auth header** returns `307` → a short-lived (600s) signed
   `storage.googleapis.com` URL; following it yields `200` + the real PDF bytes
   (`%PDF-1.5`, byte size matches the field meta). The leadconnector URL itself is
   durable (re-issues a fresh signed redirect on each hit), so a funder clicking it
   within the email's lifetime always resolves. Because it needs no auth, we place
   it straight into the email body alongside the Supabase secure links — the
   server-side download-and-re-upload fallback was NOT needed.

3. **Grouping/gating:** GHL files split by field name — `/bank/i` → **"Bank
   statements"** group, everything else → **"Stips documents"** group. A group is
   included only when the recipe's `attach_docs` asks for it (`bank_statement` →
   bank group; any non-bank stip slug → stips group). Rendered as a labelled block,
   e.g. `Bank statements (4):\n  April Statement.pdf — <url>`. The stips guard now
   also counts GHL uploads (bank field ⇒ `bank_statement`; other field ⇒ `id` +
   `voided_check`), mirroring the FunderPicker package check so the UI and engine
   agree on what's "on file" (the upload form can't tag exact types — closers verify
   visually).

4. **Signed application (scope-blocked) handled honestly:** e-sign PDFs in GHL
   Documents & Contracts cannot be fetched via API. If a recipe wants the signed
   application and no app-side copy exists in `customer_documents`, the engine adds
   `Signed application: attached separately / available on request` to `doc_links`
   AND returns a per-funder `warning` ("signed application not auto-attached —
   forward it from GHL"). The FunderPicker renders that warning under the funder's
   result row (amber). Stored in `sent_payload.docsWarning` for audit.

**Caveats:** (a) CC delivery + real attachments still Phase 6. (b) The stips bundle
is untyped — a single non-bank upload marks both `id` and `voided_check` present, so
a funder requiring a specific stip may pass the guard on a different file; closers
confirm in the Docs-back panel. (c) Live end-to-end (an actual funder-format email
with GHL links) is exercised only in NORMAL mode against a real deal with a
`ghl_contact_id`; the admin "Send test to myself" QA path uses sample `doc_links`
and does not hit the GHL merge, so verify the merge on the next real submit.

Order matters: after Phase 2–3 the closer already gets the one-click fan-out with the generic format everywhere; recipes then tighten funder-by-funder as you collect each funder's exact requirements into their profile row (that intake = a VA task, one funder at a time, using each funder's ISO agreement/submission guidelines).

---

## 7. Edge cases & guardrails

- **Missing docs:** engine hard-blocks any funder whose `required_stips` aren't on file — a half-package to a funder burns the relationship.
- **Compliance:** funder-facing copy uses purchase-of-receivables language, never "loan" (MCA). Templates live in the recipe so this is enforceable per funder.
- **PII:** signed URLs expire (72h); `sent_payload` stores the body but doc links are regenerable, not the files.
- **Funder dedupe:** idempotent per deal × lender; resubmits are explicit and logged.
- **Failure visibility:** `send_failed` rows show red in Step 6 + Submissions tab with the error and a Retry button; failures never silently vanish.
- **GHL dependency:** email goes through GHL conversations (existing pattern). If a funder's server rejects GHL sends, recipe can flip that funder to portal/manual without touching code.
