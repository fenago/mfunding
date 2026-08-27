-- Closer COMPENSATION documents: out of the JS bundle, into the DB behind RLS.
--
-- THE HOLE THIS CLOSES
-- The Compensation Offer Sheet was imported into the app with Vite's `?raw`
-- loader, so its full rate ladder (30/35/40 escalators, the $2,500 draw, the
-- worked $1,200 / $2,600 payout example) shipped as a string literal in the JS
-- bundle to EVERY browser that loaded the admin app. Hiding the page from
-- setters in React hid the page, not the text: anyone with devtools could read
-- it out of the bundle. The only fix is for the bytes never to be sent.
--
-- Two compensation documents were ALREADY in this table (Schedule A, Clawback),
-- but the SELECT policy was `is_staff()` — and a setter IS staff (role `closer`
-- with no `closers` row). A setter could read both bodies straight off
-- PostgREST. Same leak, different door.
--
-- THE RULE, in one line: you may read commission terms only if you HAVE
-- commission terms — a real `closers` row — or you are a manager.
-- A setter is paid hourly, has no split, and must never see one, not even a
-- template rate they could mistake for their own.

-- 1. Mark which templates state commission terms. ---------------------------
alter table public.closer_doc_templates
  add column if not exists compensation boolean not null default false;

comment on column public.closer_doc_templates.compensation is
  'This document states commission terms (splits, draw, a worked payout example). Readable only by admin/super_admin or a user with a closers row — see the closer_doc_templates_staff_read policy.';

update public.closer_doc_templates
   set compensation = true
 where slug in ('schedule-a-rate-sheet', 'clawback-policy-acknowledgment');

-- 2. The Comp Offer Sheet moves in. -----------------------------------------
-- It is a REFERENCE doc (nobody signs it), which the action check constraint
-- did not previously allow.
alter table public.closer_doc_templates
  drop constraint if exists closer_doc_templates_action_check;
alter table public.closer_doc_templates
  add constraint closer_doc_templates_action_check
  check (action = any (array['sign'::text, 'collect'::text, 'complete'::text, 'reference'::text]));

-- Body seeded VERBATIM from research/Momentum_Closer_Comp_Offer_Sheet.md.
-- The repo file stays as the authoring source; the app no longer imports it.
insert into public.closer_doc_templates
  (slug, title, action, esignable, compensation, sort_order, source_path, body_md, version)
values (
  'comp-offer-sheet',
  'Closer Compensation Offer Sheet',
  'reference',
  false,
  true,
  101,
  'research/Momentum_Closer_Comp_Offer_Sheet.md',
  $md$# MCA Closer — Compensation Offer Sheet
### 1099 Independent Contractor · Commission-Only · Momentum Funding

> Also live in-app at **/admin/closer-comp** with an interactive comp calculator.

## The Role
Close inbound and transferred merchant leads for working-capital and business-funding products. You own the conversation from first call to funded. We provide the CRM, phone system, funder relationships, and (for company leads) the leads. You bring the hustle and the close.

## How You Get Paid
- **Commission-only, 1099. No cap.** You earn a share of the commission on every deal you fund.
- **Company-provided leads → 30% to you** (the Momentum Standard company-lead split).
- **Self-generated leads → 65% to you.**
- **Renewals on your self-generated funded book → 30%** (or routed to a renewals specialist). Renewals apply to self-gen deals only — company-lead deals are not renewal-eligible for the closer.
- **Example:** $50K advance, 8-point commission = $4,000. Company lead → **you earn $1,200**. Self-gen → **you earn $2,600**.

## Ramp-Up Draw (optional)
Recoverable **draw up to $2,500/month for your first 90 days**. A draw is an advance against future commissions — recovered from what you earn, not a salary. Out-earn it (you will) and there's nothing to recover.

## When You're Paid
Commissions paid **within 5 business days after the funder pays Momentum** on a funded deal — not at point of sale. We pay when we get paid.

## Clawback (important)
If a merchant defaults within the funder's clawback window (typically the first payments/days), the funder reverses our commission — and the corresponding portion of yours is **clawed back or deducted from future commissions**. Keeps everyone underwriting quality, performing deals. Full terms in the IC Commission Agreement.

## Performance Escalators
Your company-lead split climbs with monthly funded volume — **30% → 35% → 40%**:
- **Base:** **30%** company-lead split (the Momentum Standard).
- Fund **$250K+/mo** (≈5 funded deals) → company-lead split rises to **35%**.
- Fund **$500K+/mo** (≈10 funded deals) → company-lead split rises to **40%**.
- Top performers get first pick of premium live transfers.

Escalators apply to company-lead deals funded in the qualifying month and reset monthly; self-gen and renewal rates are unaffected. Thresholds are set by management and may be adjusted.

## We Provide vs. You Bring
| We provide | You bring |
|---|---|
| VibeReach (the CRM) + dialer + local numbers | Phone hustle + closing skill |
| Company leads / live transfers (30% company-lead split) | <60-sec speed-to-lead + relentless follow-up |
| Funder network + submission support | Your own taxes/expenses (1099) |
| Scripts, training, doc automation | Integrity + compliance (never call an MCA a "loan") |

## The Terms (summary)
1099 independent contractor · commission-only + optional draw · non-solicitation & non-circumvention (12 months) · confidentiality · TCPA/regulatory compliance required · full terms in the signed Independent Contractor Commission Agreement (Schedule A sets exact rates).

---
### On the 30% Momentum Standard company-lead split
On **company-provided leads** Momentum starts every closer at the **Momentum Standard 30%**, paired with a ramp-up draw, performance escalators, and renewal upside. The rate is set **per closer** (Admin → Closers), so you can raise a proven closer's split anytime. Keep **self-generated** deals higher (60–70%) — never 30% there.
$md$,
  1
)
on conflict (slug) do update set
  title        = excluded.title,
  action       = excluded.action,
  esignable    = excluded.esignable,
  compensation = excluded.compensation,
  sort_order   = excluded.sort_order,
  source_path  = excluded.source_path,
  body_md      = excluded.body_md,
  updated_at   = now();

-- 3. "Do you have commission terms of your own?" ----------------------------
-- public.has_closer_row(uuid) already exists and answers exactly this
-- (SECURITY DEFINER, so the check does not depend on the caller being able to
-- read `closers` under ITS OWN RLS). Reused deliberately — a second identical
-- helper would be one more SECURITY DEFINER function on the exposed API surface
-- for no gain.

-- 4. The policy. ------------------------------------------------------------
-- Non-compensation templates stay staff-readable exactly as before. A
-- compensation template is returned to NOBODY except a manager or a real
-- closer — a setter's PostgREST read comes back as zero rows, not a redaction.
drop policy if exists closer_doc_templates_staff_read on public.closer_doc_templates;
create policy closer_doc_templates_staff_read on public.closer_doc_templates
  for select to authenticated
  using (
    (select public.is_staff((select auth.uid())))
    and (
      compensation is not true
      or (select public.is_admin_or_super((select auth.uid())))
      or (select public.has_closer_row((select auth.uid())))
    )
  );

-- 5. This project's ALTER DEFAULT PRIVILEGES hands anon every grant on new
--    tables. RLS already gives anon zero rows (no policy names it), but the
--    grant should not be sitting there on a table of contract text.
revoke all on public.closer_doc_templates from anon;
