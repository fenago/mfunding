# 06 — Key Subsystems

## Commission engine

Code: `src/services/commissionService.ts`, `src/services/dealService.ts` (`autoCreateCommissionForFundedDeal`, line 461), `src/types/commissions.ts`, and a **hand-mirrored copy of the constants** inside `supabase/functions/ghl-webhook/index.ts` (edge functions cannot import from `src/`).

### Constants (`COMMISSION_DEFAULTS`, `src/types/commissions.ts:45`)

| Key | Value |
|-----|-------|
| `NEW_DEAL_POINTS` | 8 |
| `RENEWAL_POINTS` | 6 |
| `COMPANY_LEAD_SPLIT` | **30** (the code comment records "was 35 in the original Schedule A") |
| `SELF_GEN_SPLIT` | 65 |
| `RENEWAL_SPLIT` | 30 |
| `SUB_ISO_OVERRIDE_POINTS` | 2 |
| `SUB_ISO_KEEPS_POINTS` | 6 |
| `AVERAGE_DEAL_SIZE` | 50 000 |

Per-closer overrides live on `closers` — DB defaults are `company_lead_split = 30`, `self_gen_split = 70`, `renewal_split = 35`. **The DB defaults and the TS defaults do not agree** (see [09](./09-doc-drift.md)); the closer's row wins whenever one exists, so in practice the TS constants only apply to a deal with no linked closer.

### Calculation (`calculateCommission`)

```
gross            = amount_funded × points / 100
mfundingPortion  = subISOId ? (amount_funded × override_points / 100) : gross
closerAmount     = mfundingPortion × effectiveSplit / 100
managerOverride  = mfundingPortion × managerOverridePct / 100
companyAmount    = mfundingPortion − closerAmount − managerOverride
```

Note the Sub-ISO semantics: on a Sub-ISO deal the closer splits **only MFunding's 2-point override**, not the full gross.

`effectiveSplit` precedence: an explicit `closerSplitPercentage` (the closer's own rate) → renewal → self-gen → company.

### Creation

On funding, `autoCreateCommissionForFundedDeal(deal)`:
1. no-ops if `amount_funded <= 0` or a commission already exists (also guarded by the `commissions_deal_id_unique` constraint — **one commission per deal**);
2. maps `deal.assigned_closer_id` (a **profiles.id**) → `closers.id` via `closers.user_id` — the split-brain hop;
3. classifies the lead source as `renewal | self_generated | company` with `/self/i.test(deal.lead_source)`;
4. writes the commission with `payment_status: 'pending'`.

⚠️ There are **three** lead-source classifiers and they disagree: `splitForDeal` (`commissionService.ts:439`) treats `referral` as self-gen (65%), while both funded paths (`dealService.ts:497` and `ghl-webhook`) use `/self/i` and classify `referral` as **company** (30%). "My Earnings" therefore projects ~2.2× what a referral deal actually pays. Open audit finding #2 — one classifier must become authoritative.

Reassignment: `reassignDealCloser()` writes only `assigned_closer_id` and deliberately does **not** rewrite an existing commission (a commission snapshots the closer and their split at funding time). Call `dealHasCommission()` first and warn.

### Lifecycle (`commissions.payment_status`, CHECK-constrained)

```
pending ──approve──▶ approved ──▶ funder_paid ──▶ closer_paid ──▶ completed
   ▲                    │
   └──release_hold──── on_hold ◀──hold(reason)── (any state)
                                clawback  ← (amount + reason)
```

- `approveCommission` stamps `approved_at` / `approved_by`.
- `holdCommission(reason)` sets `on_hold` + `hold_reason`; `releaseHold()` returns it to `pending`.
- `updatePaymentStatus` auto-stamps `funder_paid_at` / `closer_paid_at`, and on `clawback` requires `clawback_amount` + `clawback_reason`.
- Each transition best-effort inserts an in-app `messages` row to the closer (skipped if `closers.user_id` is null).
- Writes are super-admin-only by RLS; a closer can only SELECT their own rows (`/admin/my-earnings`).

⚠️ `funder_paid` is bucketed inconsistently across surfaces (`MyEarningsPage` calls it "Pending"; `closerAnalyticsService` counts it as approved payout) — audit finding #18.

---

## Lead assignment (round-robin)

Two moving parts, both in SQL.

**1. `next_lead_closer()`** (SECURITY DEFINER) — the picker:
- takes `pg_advisory_xact_lock('mfunding.lead_round_robin')` so concurrent inserts can't hand the same closer two leads;
- reads the strategy from `platform_settings.key = 'lead_assignment'`:
  `{"strategy": "round_robin" | "least_open_deals" | "manual" | "specific_closer", "specific_closer_profile_id": uuid|null}` (live value: `round_robin`). An unknown value falls back to `round_robin`; **`manual` returns no row → no auto-assignment**;
- backfills `lead_assignment_state` for every active closer with a `user_id`;
- eligibility = `closers.status='active' AND user_id IS NOT NULL`;
- ordering: under-cap first (`max_leads_per_month` vs deals created this month) → then, for `least_open_deals`, fewest open deals → then oldest `last_assigned_at` → then lowest `assigned_count`;
- returns `(closer_profile_id, closer_name, over_cap, strategy)`. If **every** closer is at cap it still returns one, flagged `over_cap`.

"Open" excludes `funded, renewal_eligible, restructure_executed, servicing, declined, dead, nurture`.

**2. `trg_deals_auto_assign_closer`** (BEFORE INSERT on `deals` → `deals_auto_assign_closer()`):
- if `assigned_closer_id` is NULL → calls `next_lead_closer()`, sets it, calls `stamp_lead_assignment()`, and writes an `activity_log` note (`lead:auto-assigned`, naming the strategy and whether the closer was over cap);
- if it was supplied → still stamps rotation state when it matches an active closer;
- the whole body is wrapped in `exception when others then return new` — **auto-assignment can never block a deal insert.**

Why a trigger rather than app code: every intake path (public forms, live transfers, bulk import, GHL webhook) creates deals, several of them with the service role and no `auth.uid()`. The trigger is the only place all of them pass through.

Manual reassignment is governed by `trg_enforce_deal_closer_assignment` — see [03](./03-auth-and-rbac.md).

---

## AI deal assistant

`supabase/functions/deal-assistant/index.ts`. A closer on a live call asks "what does this funder need right now".

- Auth: staff + `closer_owns_deal`.
- Assembles a **deterministic** JSON context: deal, merchant, submissions, lenders, docs, underwriting, recent activity. The per-funder missing-doc gap (`funderDocGap`) is computed in TypeScript from `lender_programs.doc_*` columns — never by the model.
- Sends it with `callLLM` (task `deal_assistant`); the system prompt enforces "answer only from the supplied context" and MCA compliance language.
- Returns `{ ok, answer, model, context_summary }`.

Sibling AI surfaces: `recommend-lenders` (ranks funders, but **hard-gates** the model's output against code-computed qualification — a funder failing hard minimums is forced to `fit: "poor"` no matter what the model said; it also runs a second pass on bank-statement-**verified** revenue and flags "flips"), `recommend-customer`, `analyze-campaign`.

---

## Underwriter (`underwrite-deal`)

Three passes, and **only two of them are AI**:

| Pass | What | Model |
|------|------|-------|
| **A — extract** | Each bank-statement PDF is fetched from Storage via a 10-minute signed URL and sent to Claude as a **native document block** (`callAnthropicBlocks`, forced tool-use so no field can be omitted). Parallelized across statements to stay inside the edge-function wall clock. Byte-identical PDFs are hashed and sent once. | `underwriting_settings.extraction_model` (default `claude-sonnet-4-6`) |
| **B — aggregate** | **Pure TypeScript, zero AI.** True revenue = deposits − padding (padding categories are admin-configurable), safe daily-debit capacity, max affordable advance, debt-service %, and flags derived from the admin thresholds in `underwriting_settings` (`nsf_monthly_cap`, `negative_days_flag`, `debt_service_flag_pct`, `min_avg_daily_balance`, `holdback_ceiling_pct`, `revenue_quality_flag_pct`, `max_payment_pct_of_revenue`, `balance_buffer_pct`, `affordability_factor_rate`, `term_daily_biz_days`, `term_weekly_weeks`). | — |
| **C — judge** | A narrative constrained to the computed metrics. | `underwriting_settings.judge_model` (default `claude-opus-4-8`) |

- **Dedup:** `docs_hash` (FNV-1a over the doc id + timestamp set). In `mode: "auto"` an unchanged doc set short-circuits to `{ok:true, skipped:true, reason:"docs_hash unchanged"}`. A post-extraction pass also collapses two files covering the same statement period (month + account last-4), keeping the richer extraction.
- **Trigger paths:** manual (staff click) or `auto` (invoked by `ghl-webhook` with the service-role key when new bank statements arrive).
- Output row: `deal_underwriting` (versioned; `settings_snapshot` freezes the thresholds used).
- ⚠️ Open finding #4: the **rating** is computed from a legacy factor-blind `maxAffordableAdvance` (capacity × business days, no factor divisor), overstating capacity ~35%, while the correct factor-aware `affordabilityFor` block is computed but not used for the rating.

---

## Funder submission (`submit-to-funders`)

The core money path.

- Per-funder **recipes** in `funder_submission_profiles`: `method`, `to_email`, `cc_emails`, `subject_template`, `body_template`, `attach_docs` (slugs from the `customer_document_type` enum), `attachment_mode`, `max_statement_months`, `required_stips`, `special_instructions`, `portal_*`. Funders with no recipe get a generic fallback template.
- Documents: attachments are pulled from the Supabase `customer-documents` bucket (72-hour signed URLs) and from GHL `FILE_UPLOAD` custom fields. Ceilings: `MAX_ATTACH_BYTES = 20MB`, `MAX_ATTACH_COUNT = 15` (GHL/SendGrid cap total payload ~25MB); over the ceiling, links are sent instead. Only `leadconnectorhq.com` / `msgsndr.com` URLs are accepted as pass-through attachment links — this prevents using the sender as an open-URL exfiltration relay.
- Transport is GHL email. The owner is CC'd on every funder submission.
- Secondary actions: `courtesy_decline` (idempotent — fires once, only on a `declined` submission, stamps `courtesy_sent_at`), `message_funder` (free-form), `withdraw` (stamps `withdrawn_at`, refuses on a funded submission).
- Authorization: staff + `closer_owns_deal`; `test_email` (recipe QA) is admin/super only.

**Which funders can I even submit to?** `src/services/funderAvailability.ts` + `src/services/lenderMatch.ts` evaluate the merchant against each `lender_programs` row's hard gates and structured doc requirements (`doc_bank_statement_months`, `doc_application`, `doc_photo_id`, `doc_voided_check`, …) against the closer-maintained `deals.doc_checklist`. `lenderMatch.ts` is a pure module (no DB access) and is the source of truth for the Revenue Playbook's submission step.

Note: a voided check is **never** a hard blocker — a bank-portal screenshot satisfies it. Do not gate Submit on it.

---

## Closer document merge + append-only e-signature ledger

Three tables (`closer_doc_templates` → `closer_documents` → `closer_document_signatures`) and one rule: **what gets signed is what was frozen at send time.**

1. **Seed.** `closers_seed_documents` (AFTER INSERT on `closers`) creates one `closer_documents` row per template, `status = 'not_sent'`.
2. **Merge + freeze + send.** `send-closer-onboarding-package` (admin/super only) merges `closer_doc_templates.body_md` with the closer's row + `platform_settings.closer_docs` (company legal name, governing state, payment method, draw treatment, clawback window, …) via `_shared/closerDocMerge.ts`. Placeholder detection is **default-deny**: any `[bracketed run]` that is not `[ ]`, `[x]`, or `[___]` counts as unresolved. If any selected doc has `missing.length > 0`, the whole batch is refused (422) and **nothing is sent**. On success, `merged_content` + `merged_sha256` + `template_version` are written to `closer_documents` and `status → 'sent'` — later template edits cannot change what the closer is signing.
3. **Sign.** The closer calls the `sign_closer_document(p_doc_slug, p_signer_name, p_consent_text)` SECURITY DEFINER RPC. It re-validates in SQL: signed in, name + consent non-empty, a closer row is linked to the caller, the doc is on **their** checklist, not already signed, `status = 'sent'` with a non-null `merged_content`, and **no unfilled placeholder remains** (the same regex, re-implemented in PL/pgSQL). It captures IP (`x-forwarded-for`) and user-agent from `request.headers`, inserts the signature with `content_snapshot` + `content_sha256`, and flips `closer_documents.status → 'signed'`.
4. **Ledger.** `closer_document_signatures` has **only SELECT policies** (self + admin). No INSERT/UPDATE/DELETE policy exists for any role — rows can only be created by the RPC, and nothing in the system can amend or delete one.

Client mirror: `src/lib/closerDocMerge.ts` renders a preview. It is a **copy**, not the authority; if the two ever diverge, the server (and the SQL re-check at signing time) wins.
