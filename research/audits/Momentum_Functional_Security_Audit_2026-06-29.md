# Momentum Funding (mfunding.net) — Deep Audit, 2026-06-29

## Executive Summary

This audit of the Momentum Funding (mfunding.net) MCA/VCF brokerage platform surfaced a broad set of verified issues spanning credential exposure, broken access control, lead-flow integrity, commission-engine correctness, and TCPA/debt-relief compliance. The single most urgent issue is a Supabase management token that lived in public git history for ~4.5 months (must be treated as breached). Beyond that, several high-severity problems undermine the core business: closers (1099 contractors) can read and delete the entire merchant book, the most PII-sensitive edge function (`submit-to-funders`) has no in-code authorization, paid leads are silently dropped when GHL sync fails, the commission engine silently pays closers $0 due to a split-brain identity model, and multiple public lead forms collect phone numbers with weak or absent TCPA consent. The 25 findings below were selected from 57 verified items for highest impact and balanced coverage across all categories; the remaining 32 (mostly low-severity hygiene, advisor lints, and additional duplicate-category items) were de-scoped to keep this report actionable.

### Severity Tally (selected 25)

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 15 |
| Medium | 7 |
| Low | 2 |
| **Total** | **25** |

---

## Summary Table

| # | Severity | Category | Finding | Area |
|---|----------|----------|---------|------|
| 1 | Critical | security | Supabase management token committed to PUBLIC repo git history | `.mcp.json` history (fenago/mfunding) |
| 2 | High | security | `submit-to-funders` does privileged work with no authn/authz (IDOR + PII exfil) | `submit-to-funders/index.ts:122-228` |
| 3 | High | security | `ghl-webhook` shared-secret check is bypassable (fails open) | `ghl-webhook/index.ts:79-117` |
| 4 | High | security | Paid 3rd-party API keys (Gemini, Firecrawl) shipped in client bundle | `src/lib/gemini.ts:1,335` |
| 5 | High | rbac | Closers have full CRUD on ALL customer PII and ALL deals | RLS `customers`/`deals`, `is_staff()` |
| 6 | High | functional | Commission never auto-created if `amount_funded` set after "funded" | `dealService.ts:197-227` |
| 7 | High | logic | Closer paid $0 when assigned profile has no matching `closers` row | `dealService.ts:238-282` |
| 8 | High | integration | GHL sync failures silently orphan leads (no CRM, no Speed-to-Lead) | `mca-intake`/`vcf-intake` |
| 9 | High | integration | Contact-form leads never synced to GHL; discarded on insert error | `ContactPage.tsx:74-91` |
| 10 | High | compliance | VCF page presents savings/success rates as headline guarantees | `VCFReliefPage.tsx:36-56` |
| 11 | High | compliance | `/apply` collects phone with weak, non-TCPA consent language | `ApplyPage.tsx:116-150` |
| 12 | High | compliance | VCF relief intake requires phone but has no TCPA consent at all | `VCFReliefPage.tsx:268-289` |
| 13 | High | compliance | Opt-in (TCPA) leads dropped; consent not persisted, never reaches SMS | `OptinPage.tsx:38-53` |
| 14 | High | data-integrity | Split-brain closer identity: `deals→profiles` vs commissions→`closers` | FK catalog |
| 15 | High | data-integrity | Repeat submissions create duplicate deals + duplicate GHL opportunities | `mca-intake`/`vcf-intake` |
| 16 | High | config | Migration history diverged: live 66 vs repo 35 | `supabase/migrations/*` |
| 17 | Medium | rbac | Closer nav/routes grant pages whose tables deny closers in RLS | router + RLS |
| 18 | Medium | logic | Sub-ISO override logic is dead code; Sub-ISO deals over-book MFunding | `dealService.ts:226-304` |
| 19 | Medium | data-integrity | Clawbacks inflate revenue/payouts in summaries (never netted) | `commissionService.ts:224-263` |
| 20 | Medium | config | `verify_jwt` settings not version-controlled — no `config.toml` | `supabase/` |
| 21 | Medium | performance | RLS re-evaluates `auth.<fn>()` per row across 39 tables (83 policies) | RLS policies |
| 22 | Medium | performance | ~30 public marketing pages eagerly imported into initial bundle | `router/index.tsx:25-56` |
| 23 | Medium | ux | Contact form labels not programmatically associated with inputs | `ContactPage.tsx:242-318` |
| 24 | Low | rbac | `AuthProtectedRoute` does no role check; 404 instead of redirect | `AuthProtectedRoute.tsx:5-12` |
| 25 | Low | functional | Apply "Funding amount" is unvalidated free text | `ApplyPage.tsx:126-127` |

---

## Detailed Findings

### 1. Supabase management (personal access) token committed to PUBLIC repo git history
**Badges:** `Critical` · `security`

*Evidence:* `gh repo view` confirms `fenago/mfunding` is PUBLIC. `git log --all -- .mcp.json` shows the file tracked 2026-02-01 → 2026-06-27; `git log --all -p` exposes `sbp_fd6336cbaaf004a837b35d036ad0da2c2c2c3db0` (Supabase PAT) in historical blobs across commits `2576ec0`/`6e89007`, removed in `ea00d0f`. `.gitignore:32` now excludes `.mcp.json` but history remains recoverable; `.env:15` self-documents the value as "COMPROMISED."

*Impact:* An `sbp_` management token grants account/project-level control: arbitrary SQL, reading/rotating the service-role key, dumping all PII (merchant SSNs, bank data, applications), deploying/modifying/deleting edge functions, and pausing/deleting projects. Public exposure for ~4.5 months = full data + infrastructure compromise.

*Recommendation:* Treat as breached. Immediately revoke/rotate the `sbp_` token (Supabase → Account → Access Tokens) and rotate the project's service-role and anon keys. Purge `.mcp.json` from history (BFG/`git filter-repo`) and force-push. Audit Supabase access logs across the exposure window. Keep all MCP/CLI tokens only in gitignored local files going forward.

---

### 2. submit-to-funders performs privileged work with no in-code authn/authz (IDOR + PII exfiltration)
**Badges:** `High` · `security`

*Evidence:* `submit-to-funders/index.ts:122-228` reads `{dealId, lenderIds, notes}` and uses `serviceClient()` (line 133, RLS-bypassing) to load the deal and the FULL customer row (`customers.select("*")`, line 141), then emails funders a package with owner name, phone, email, EIN, revenue, credit range, and VCF balances. There is no `Authorization` check, no `auth.getUser()`, and no role gate — unlike `admin-users/index.ts:48-59`. No `config.toml` exists, so the `verify_jwt = true` comment (line 12) is dashboard-only and unverifiable; even if enabled, any authenticated principal (including a merchant `user`) can pass an arbitrary `dealId`.

*Impact:* Authenticated-but-unauthorized callers can dump any merchant's full PII via funder emails and trigger funder outreach on MFunding's behalf — broken access control on the most data-sensitive function.

*Recommendation:* Extract the bearer token, call `db.auth.getUser(token)`, load `profiles.role`, require role in `('admin','super_admin','closer')` AND verify the caller is permitted on that specific deal. Do not rely on dashboard `verify_jwt` alone. Commit a `config.toml` pinning `verify_jwt` per function.

---

### 3. ghl-webhook shared-secret check is bypassable (fails open); no HMAC source verification
**Badges:** `High` · `security`

*Evidence:* `ghl-webhook/index.ts` runs `verify_jwt=false` (line 10) with only a shared-secret compare. Two fail-open paths: (1) the check is wrapped in try/catch whose comment says "if config read fails, fall through and still attempt to process" (line 86); (2) `if (expected && provided !== expected) return 401` (line 85) — an empty `expected` skips auth entirely. The secret is passed as a `?secret=` query param (line 83, leaks to logs); there is no HMAC. Past the gate, `serviceClient()` upserts customers (merged by email, lines 161-167), inserts/mutates deals, and flips status to `funded` with attacker-chosen amounts (lines 138-255).

*Impact:* If the secret is unset (or on an isolated RPC failure), an unauthenticated attacker can create/overwrite customers, fabricate/mutate deals, and mark deals `funded` with arbitrary amounts — corrupting pipeline, commissions, and CRM, and injecting PII.

*Recommendation:* Fail CLOSED: return 401 if the secret cannot be loaded or is empty. Require the secret via header (`x-ghl-secret`), not query string. Prefer a real HMAC over the raw body. Use constant-time comparison.

---

### 4. Paid third-party API keys (Gemini, Firecrawl) shipped in the client JS bundle via VITE_ prefix
**Badges:** `High` · `security`

*Evidence:* `src/lib/gemini.ts:1` reads `VITE_GEMINI_API_KEY` and `:335` reads `VITE_FIRECRAWL_API_KEY`. Any `VITE_`-prefixed var is inlined into the production bundle by Vite. `gemini.ts` is imported by routed client pages (`CustomerAIRecommendation.tsx`, `LenderDetailPage.tsx`), so the literal `AIzaSy…`/`fc-…` strings are served to every visitor and extractable from the JS bundle. Admin route-gating does not protect bundle contents.

*Impact:* Anyone can scrape both keys and run unlimited Gemini/Firecrawl requests on MFunding's billing — quota exhaustion, surprise bills, and denial of the AI features. No server-side rate limiting protects them.

*Recommendation:* Move both calls server-side into Supabase edge functions holding the keys as non-`VITE` secrets; have the authenticated client call the edge function. Drop the `VITE_` prefix, rotate both keys (assume leaked), and add per-user rate limiting.

---

### 5. Closers (1099 contractors) have unrestricted full CRUD on ALL customer PII and ALL deals
**Badges:** `High` · `rbac`

*Evidence:* `customers` ("Staff manage customers") and `deals` ("Staff manage deals") each carry an `ALL` policy `USING is_staff(auth.uid()) WITH CHECK is_staff(auth.uid())`. `is_staff` = role IN `('closer','admin','super_admin')` with NO per-row scoping (the `assigned_to` column is unused). `customers` holds PII: name, email, phone, address, business_name, ein, monthly_revenue, has_bankruptcies, has_tax_liens. Any `closer` can SELECT/UPDATE/DELETE every merchant and deal.

*Impact:* A single 1099 closer can export the entire merchant book (EINs, revenue, contacts) — the exact non-circumvention/data-leakage risk the business model tries to prevent — and can UPDATE or DELETE any record, including ones they never owned. Insider theft and destructive actions are possible with normal credentials.

*Recommendation:* Split policies by role: keep `is_admin_or_super` for full management; give closers a narrower policy scoped to assigned rows (`assigned_to = auth.uid()`) and remove closer DELETE entirely. Drop the broad `is_staff`-based `ALL` policy on `customers`/`deals`.

---

### 6. Commission auto-creation never runs if amount_funded is entered after the deal is marked funded
**Badges:** `High` · `functional`

*Evidence:* `autoCreateCommissionForFundedDeal` returns null when `!deal.amount_funded` (`dealService.ts:227`). Commission creation fires ONLY on the forward transition into `funded` inside `updateDealStatus` (lines 197-199). `DealDetailPage`'s PipelineFlow lets users click "Funded" directly with no `amount_funded` field on the page; `PlaybooksPage.completeStep` only re-fires the transition when `tgt > currentIdx`. So reaching `funded` without an amount leaves the deal with no commission, and it never regenerates.

*Impact:* Closers and the company silently lose commission records whenever the funded amount wasn't populated at the exact moment of the status change. No error surfaces (best-effort try/catch, lines 198-202).

*Recommendation:* Trigger commission creation when `amount_funded` is set/changed on an already-funded deal (or via a DB trigger on `deals` where `status='funded' AND amount_funded>0`), and surface a "funded deal missing commission" alert in admin.

---

### 7. Per-closer splits silently dropped (closer paid $0) when assigned profile has no matching closers row
**Badges:** `High` · `logic`

*Evidence:* `deals.assigned_closer_id` → `profiles(id)`, but `commissions.closer_id` → `closers(id)`. `autoCreate` resolves via `closers.eq('user_id', deal.assigned_closer_id).maybeSingle()` (`dealService.ts:241-245`). On a miss, `closerId` stays null and `closerSplitPercentage` undefined, so `calculateCommission` sets `effectiveSplit=0` and `closerAmount=0` (`commissionService.ts:64,89`); company absorbs 100%. Live DB: all 3 closers have `user_id = NULL`, so the lookup can NEVER match — this is guaranteed, not edge-case.

*Impact:* A deal closed by a rep generates a commission with `closer_id` null and `closer_amount $0`, full gross booked to the company, no warning. The rep is silently unpaid and data shows the deal as having no closer.

*Recommendation:* When `assigned_closer_id` is set but no `closers` record matches, fail loudly (log/flag commission as needs-review) instead of producing a $0 payout, and reconcile the `profiles`↔`closers` linkage (see #14).

---

### 8. GHL sync failures silently orphan leads — they never enter the CRM pipeline or fire Speed-to-Lead
**Badges:** `High` · `integration`

*Evidence:* The entire GHL block in `mca-intake/index.ts:67-99` and `vcf-intake/index.ts:68-93` is wrapped in `try {…} catch (_e) { /* best-effort */ }` with no logging, flag, or retry (no `console.*` in either function). If `getGhlConfig`/`upsertContact`/`listPipelines` fails, or the hardcoded MCA pipeline id `bG9ZEh4eP9x60E1CyaMx` (mca:83) / name-based VCF heuristic (vcf:79-83) can't resolve, the deal is still inserted with null `ghl_contact_id`/`ghl_opportunity_id` and the function returns `{ok:true}`. 12 public forms route through these. No automated reconciliation/retry/alerting exists.

*Impact:* Paid leads (Google Ads, live-transfer, calculators) land in Supabase but are invisible to closers in the CRM and get zero automated follow-up — directly defeating the funnel's speed-to-contact <60s metric and wasting lead spend. The UI shows success, so nobody knows.

*Recommendation:* Log GHL failures (`console.error` + a `sync_status`/`sync_error` column or a sync-failures table). Add a reconciliation job that retries deals with null `ghl_opportunity_id`. Resolve the pipeline by id from config (not a literal) and hard-alert when a pipeline/stage can't be found.

---

### 9. Contact-form leads are never synced to GHL and are silently discarded on insert error
**Badges:** `High` · `integration`

*Evidence:* `ContactPage.tsx:74-91` writes to `contact_submissions` and, on `submitError`, only `console.error`s then `setIsSubmitted(true)` — the user sees "Message Sent!" regardless of persistence. `contact_submissions` has no GHL sync anywhere (no edge function/trigger; migration `20260628_create_contact_submissions.sql` defines only table+RLS). `LeadToolsPage.tsx:61-67` only COUNTs closer-subject rows, so admins have no list view at all. Subjects include "Funding Question" and "Application Status" — real prospects.

*Impact:* Inbound contact-form prospects never become GHL contacts, never enter a pipeline, and get no follow-up; a DB/RLS failure loses the lead entirely behind a false success message. These warm, self-identified leads are operationally invisible.

*Recommendation:* Route contact submissions through an intake edge function (or trigger) that upserts a tagged GHL contact, and show a real error on write failure instead of unconditionally rendering success.

---

### 10. VCF debt-relief page presents savings/success rates as headline guarantees
**Badges:** `High` · `compliance`

*Evidence:* `VCFReliefPage.tsx` STATS render "50–75% Typical payment reduction" and "90% Restructuring applicants accepted" as hard proof points (lines 36,39); PROGRAMS bullets state "Lower your payments by 50–75%, often within days" (51), "90% of applicants are accepted" (54), and "Often no negative impact to … credit" (56). The only qualifier ("not all businesses qualify, and results vary") sits in 12px footer text (lines 287-288). This contradicts the project rule "VCF must not promise guaranteed savings."

*Impact:* Debt-relief savings/acceptance-rate claims are governed by FTC §5/UDAAP and state debt-adjusting laws. Definitive payment-reduction percentages and a "90% accepted" headline with the material limitation buried at page bottom risk being deemed deceptive — the single highest compliance exposure on the public site.

*Recommendation:* Place a clear, proximate disclaimer adjacent to each savings/acceptance claim ("Results vary; not a guarantee; many clients do not achieve these results"). Recharacterize the stat tiles as illustrative ranges, qualify "90% accepted" with its population, and remove/strongly hedge the credit-impact claim on line 56.

---

### 11. Public application form (/apply) collects phone with weak, non-TCPA-compliant consent language
**Badges:** `High` · `compliance`

*Evidence:* Phone is required (`ApplyPage.tsx:116-117`) and leads feed GHL automated SMS sequences (A–F). The only consent is a non-blocking micro-line: "By submitting you agree to be contacted…" (line 150). It lacks express written consent for autodialed/prerecorded calls and SMS, omits "consent not a condition of purchase," and has no STOP/opt-out or message-rate disclosure. `OptinPage.tsx:162-164` already implements compliant language, proving the primary path is weaker.

*Impact:* Automated calls/texts to numbers captured without express written consent is the core TCPA exposure (statutory damages $500–$1,500 per call/text).

*Recommendation:* Add the same checked express-written-consent gate used on `OptinPage` to `/apply`: autodialer/prerecorded/SMS consent, "not a condition of purchase," STOP to opt out, message/data rates, and Privacy/Terms links.

---

### 12. VCF relief intake form requires phone but has no TCPA consent at all
**Badges:** `High` · `compliance`

*Evidence:* `VCFReliefPage.tsx:266-267` makes Phone a required `type="tel"` field submitting to the VCF pipeline, but a grep for `consent|agree|tcpa|sms` returns no match. The footer (lines 285-289) covers fees/results only.

*Impact:* Distressed-merchant debt-relief leads are contacted by phone/SMS; a required phone number with zero express consent creates direct TCPA exposure — identical in kind to `/apply` but with no consent language whatsoever.

*Recommendation:* Add an explicit TCPA express-written-consent checkbox/disclosure (mirroring `OptinPage` lines 155-164) before submit, including STOP opt-out and consent-not-a-condition language.

---

### 13. Opt-in (TCPA) leads dropped silently; consent is not persisted as a record and never reaches the SMS system
**Badges:** `High` · `compliance`

*Evidence:* `OptinPage.tsx:38-53` collects express written SMS consent (checkbox, lines 149-167) but writes only a generic `contact_submissions` row (subject "Communication Opt-In"). No consent boolean, consent text/version, or IP is stored (schema has no such columns per the `20260628` migration); only `created_at`/phone exist. On insert error it `console.error`s then shows success. `contact_submissions` never syncs to GHL, where SMS would be sent.

*Impact:* The legally meaningful artifact (proof of consent tied to phone, timestamp, and exact disclosure text) is effectively lost, creating exposure if SMS is later sent — while the opted-in lead never reaches the GHL record that drives SMS, so the opt-in produces nothing.

*Recommendation:* Persist a structured consent record (`consent=true`, `consent_ts`, `consent_text/version`, source, IP) and sync the contact + DND/consent flag into GHL with an auditable trail. Stop showing success on a failed write.

---

### 14. Split-brain closer identity: deals.assigned_closer_id → profiles, but commission engine keys off closers table
**Badges:** `High` · `data-integrity`

*Evidence:* FK catalog: `deals_assigned_closer_id_fkey` → `profiles(id)`, `commissions_closer_id_fkey` → `closers(id)`, and `closers.user_id` → `profiles(id)` is NULLABLE. A logical bridge exists (`dealService.ts:240-254`, `closers.user_id = assigned_closer_id`) but is unenforced and currently broken: all 3 closers have `user_id = NULL`. Worse, both assignment UIs (`DealCreateModal.tsx:93-98`, `PlaybookCapture.tsx:96-100`) write `closers.id` into a column FK'd to `profiles(id)` — an unresolvable/violating key.

*Impact:* A deal's assigned closer cannot reliably resolve to the `closers` row that defines its split, producing orphaned/mismatched commission attribution (see #7) and ambiguous per-closer analytics. Current consistency exists only by virtue of seed data.

*Recommendation:* Pick one canonical closer identity — either point `deals.assigned_closer_id` at `closers(id)`, or make `closers.user_id` NOT NULL + UNIQUE and resolve via that mapping. Add a FK/derivation so every funded deal's assigned closer maps to exactly one `closers` row.

---

### 15. Repeat submissions create duplicate deals and duplicate GHL opportunities — no deal-level dedupe
**Badges:** `High` · `data-integrity`

*Evidence:* Both intakes dedupe the customer by email (`maybeSingle` on `customers.email`) but UNCONDITIONALLY insert a new `deals` row (mca:56-65, vcf:55-66) and always call `createOpportunity` — a POST with no search/upsert (`_shared/ghl.ts:153-159`). No unique constraint exists on `deals` (`20260301_001_create_deals.sql`). 12 frontend entry points hit these functions, so one prospect easily submits multiple times. (The GHL contact IS deduped via `upsertContact`, but each call still creates a new opportunity on it.)

*Impact:* One lead becomes multiple deals in Supabase and multiple cards in the GHL pipeline. Closers waste time, conversion/pipeline metrics double-count, and follow-up sequences fire repeatedly against the same person (annoyance / TCPA volume risk).

*Recommendation:* Before inserting, check for an existing open deal for the same customer+deal_type and reuse/update it; track the GHL opportunity id and update the existing opportunity. Add a partial unique index for one open deal per customer per product line.

---

### 16. Migration history diverged: live DB has 66 migrations, repo has 35 with mismatched versions
**Badges:** `High` · `config`

*Evidence:* `list_migrations` returns 66 applied versions; `supabase/migrations/` contains 35 `.sql` files. Many live migrations have no repo file (e.g. `20260201200144 create_crm_tables`, `20260626202655 add_bank_statements_stage`, `20260629014150 staff_can_manage_customers_deals`). Repo filenames use a custom `date_seq` scheme (`20260301_002_create_commissions.sql`) that matches no live 14-digit CLI id (`20260626144213 create_commissions_engine`). Live migrations were applied via MCP `apply_migration`.

*Impact:* The repo cannot reproduce the live schema; a fresh `db reset` or new environment will be missing tables/columns/policies/enum values that exist in prod. Schema review, CI drift detection, and rollbacks are unreliable for a production financial platform.

*Recommendation:* Run `supabase db pull`/`db diff` to regenerate a canonical, ordered migration set matching live `schema_migrations`, commit the missing migrations, and reconcile version/timestamp naming so repo == live.

---

### 17. Closer role granted UI/route access to pages whose tables block closers in RLS
**Badges:** `Medium` · `rbac`

*Evidence:* `AdminSidebar.tsx:55` defines OPS = `['closer','admin','super_admin']`, showing Launch Board, Doc Review, Sequences, Referrals to closers; those routes (`index.tsx` 305/527/532/559) have no per-route guard and `AdminProtectedRoute` gates on `isStaff` (closer-inclusive, `UserProfileContext.tsx:141`). But the backing tables require admin/super: `kanban_tasks`, `customer_documents` (`is_admin_or_super()`), `customer_interactions`, `follow_up_sequences`, `referral_partners`. `is_admin_or_super()` excludes `closer` while `is_staff()` includes it.

*Impact:* A closer logs into a nav full of operational pages and customer-detail tabs that silently return empty/error because RLS denies the reads. Client RBAC (OPS includes closer) and server RBAC (admin/super only) disagree — a broken operator experience and an unmaintainable two-source-of-truth model. (No data exposure; RLS correctly denies.)

*Recommendation:* Pick one definition of "operational staff" and apply it consistently: either extend the RLS policies to `is_staff()` where closers should work, or mark those nav items/routes ADMIN and add per-route guards so closers don't see links that bounce.

---

### 18. Sub-ISO override logic is dead code in the funded-deal path; Sub-ISO deals over-book MFunding's share
**Badges:** `Medium` · `logic`

*Evidence:* `calculateCommission` has full Sub-ISO branching (`commissionService.ts:79-95`), but the only production caller, `autoCreateCommissionForFundedDeal`, never passes `subISOId` and hard-codes `sub_iso_id: null` (`dealService.ts:275-293`). The `deals` table has no `sub_iso`/`iso` column at all, so origin can't be known; `commissions` does have `sub_iso_id`/`override_amount`/`override_points`, confirming the model expects it. No manual commission-create UI sets it either.

*Impact:* Latent: any Sub-ISO deal would be booked as direct (MFunding records all 8 gross points instead of its 2-point override; the Sub-ISO's $3,000/deal payable is never recorded). Currently no deal can be flagged Sub-ISO-originated (Phase 3 feature, 0 of 5 commission rows affected), so no present P&L corruption — but the path is unimplemented and would silently mis-book.

*Recommendation:* Add `sub_iso_id` (and `lead_source 'sub_iso'`) to `deals`, derive `subISOId`/override points in `autoCreate`, and pass them to `calculateCommission`. Until then, Sub-ISO commissions must be created manually and the auto path should refuse to silently treat them as direct.

---

### 19. Clawbacks inflate company revenue and closer payouts in summaries (never netted out)
**Badges:** `Medium` · `data-integrity`

*Evidence:* `getCommissionSummary` (`commissionService.ts:224-234`) sums `company_amount`, `closer_amount`, and `gross_commission` across ALL rows including `payment_status==='clawback'`; `totalClawback` (224-226) is reported separately but never subtracted. Monthly buckets (260-263) do the same. `updatePaymentStatus` (175-178) only flips status, leaving original positive amounts intact. Displayed on `CommissionDashboardPage` (201/206).

*Impact:* When a funded deal is reversed, reported company revenue, gross commission, and closer payouts remain at full value — overstating earnings by the full deal value of every clawed-back deal on dashboards/P&L.

*Recommendation:* Exclude or sign-flip clawback rows in aggregations (subtract `clawback_amount` from company/gross, treat clawed-back `closer_amount` as reversed), or compute `net = gross − totalClawback` explicitly.

---

### 20. verify_jwt settings are not version-controlled — no supabase/config.toml exists
**Badges:** `Medium` · `config`

*Evidence:* No `config.toml` anywhere in the repo. Each function's auth posture lives only in source comments (mca-intake/vcf-intake/ghl-webhook/partner-signup = false, submit-to-funders = true; scan-* silent). `submit-to-funders` has no in-code auth fallback (#2), so a dashboard flip to `false` makes it public; conversely a CLI redeploy defaults public intake functions to `verify_jwt=true`, breaking them.

*Impact:* Config drift with no PR/review trail: a redeploy or dashboard change can silently expose privileged functions or break public intake. The security model is undocumented and unenforceable from the repo.

*Recommendation:* Add `supabase/config.toml` with explicit `[functions.<name>] verify_jwt` entries (public: mca-intake, vcf-intake, partner-signup, ghl-webhook = false; privileged: submit-to-funders, admin-users, scan-* = true), and treat in-code role checks as the real gate.

---

### 21. RLS policies re-evaluate auth.<fn>() per row (auth_rls_initplan) across 39 tables
**Badges:** `Medium` · `performance`

*Evidence:* `get_advisors(type:performance)` returns 83 `auth_rls_initplan` WARNINGs spanning 39 distinct tables, including `customers`, `deals`, `commissions`. `pg_policies` confirms unwrapped `auth.uid()`/`is_staff(auth.uid())` (not `(select auth.uid())`). Sample fix in the advisory: replace `auth.<function>()` with `(select auth.<function>())`.

*Impact:* Each scanned row re-invokes `auth.uid()`/`auth.role()` instead of evaluating once per statement. On the growth-sensitive `customers`/`deals`/`commissions` tables this turns full-table admin reads into per-row function calls, degrading every authenticated query as data grows. (Negligible at current NANO/tiny-data scale.)

*Recommendation:* Wrap auth calls in scalar subselects (`(select auth.uid())`, `(select auth.role())`) across the flagged policies via migration so Postgres caches the value once per statement.

---

### 22. ~30 public marketing pages eagerly imported into the initial bundle while admin pages are lazy-loaded
**Badges:** `Medium` · `performance`

*Evidence:* `src/router/index.tsx:25-56` statically imports ~30 public pages (HomePage, 4 calculators L41-44, 7 assessments L45-51, FreeTools/Partners/Resources/ResourceDetail/Glossary L52-56, business-loans/real-estate hubs+details) into the entry chunk, while 54 admin/portal routes use the `lazyWithReload` helper (L64+).

*Impact:* A visitor landing on `/` downloads and parses JS for every calculator, assessment, glossary, and resource page they may never visit, inflating the marketing-site initial bundle and Time-to-Interactive — the opposite of the per-route splitting already applied to admin.

*Recommendation:* Apply `lazyWithReload` to the secondary public routes (calculators, assessments, resources, glossary, partners, product/real-estate detail pages), keeping only HomePage and shell components eager.

---

### 23. Contact form labels are not programmatically associated with their inputs (accessibility)
**Badges:** `Medium` · `ux`

*Evidence:* In `ContactPage.tsx:242-318` every field renders the label as a separate sibling with no `htmlFor` and the input with no `id` (e.g. `<label>Full Name *</label><input name="name" …>`, lines 242-253); same for email, phone, subject (select), and message. They are not nested either. `OptinPage.tsx:100-112` uses `htmlFor`+`id` correctly, confirming the deviation.

*Impact:* Screen readers can't announce the field name on focus, and clicking the label doesn't focus the control. Fails basic WCAG label association on the primary public contact form.

*Recommendation:* Add `id` to each input and `htmlFor` to each label (or wrap inputs inside labels), matching the `OptinPage` pattern.

---

### 24. AuthProtectedRoute does no role check and renders 404 instead of redirecting on no session
**Badges:** `Low` · `rbac`

*Evidence:* `AuthProtectedRoute.tsx:7-10` only checks `session` and returns `<NotFoundPage />` on no session (vs the admin guards' `<Navigate to='/auth/sign-in' state={from}>`, lines 11-13). It performs no role gate, so the customer Portal (`/portal/*`, intended for `user` merchants) is reachable by any authenticated closer/admin/super_admin.

*Impact:* Inconsistent unauthenticated UX (a 404 loses the post-login return path), and the portal lacks a role assertion so staff accounts load a merchant-only surface. Data exposure is limited because RLS scopes portal data to `auth.uid()`'s own rows.

*Recommendation:* Make `AuthProtectedRoute` redirect to `/auth/sign-in` with location state like the admin guards. If the portal is strictly merchant-facing, add a role check (or a dedicated `UserProtectedRoute`) so non-`user` roles are redirected to `/admin`.

---

### 25. Apply form "Funding amount" is unvalidated free text sent straight to intake
**Badges:** `Low` · `functional`

*Evidence:* `ApplyPage.tsx:126-127` renders funding amount as a plain text input (`placeholder="$50,000"`) and forwards the raw string as `amount_requested` to mca-intake (line 51). No numeric/min/max validation. (mca-intake's `num()` at lines 18-22 strips non-numerics, so "fifty grand" → null, but out-of-range like `$5` and magnitude-ambiguous `50` vs `50000` survive as misleading numerics.)

*Impact:* Out-of-range or ambiguous amounts reach the CRM/pipeline, degrading lead quality and downstream routing/qualification that assumes a sane numeric amount.

*Recommendation:* Use a numeric/currency input with min/max (or a select of ranges like the other dropdowns), and normalize/validate before invoking mca-intake.

---

## Suggested First 5 Fixes (priority order)

1. **#1 — Rotate the leaked Supabase token NOW** and rotate service-role/anon keys, then purge `.mcp.json` from git history and audit access logs. This is an active account-level breach.
2. **#2 — Add in-code authn/authz to `submit-to-funders`** (and pin `verify_jwt` via a committed `config.toml`, #20). It currently lets any authenticated principal exfiltrate full merchant PII.
3. **#5 / #14 / #7 — Lock down closer access and fix the closer-identity model:** scope `customers`/`deals` RLS per closer and remove closer DELETE, then reconcile `profiles`↔`closers` so commissions stop silently paying $0.
4. **#10 / #11 / #12 — Remediate compliance exposure:** add proximate VCF disclaimers/de-guarantee the savings claims, and add real TCPA express-written-consent gates to `/apply` and the VCF intake (with consent persisted, #13).
5. **#8 / #9 — Stop silently dropping paid and inbound leads:** log/flag GHL sync failures with a retry/reconciliation job, route contact-form submissions into GHL, and stop showing "success" on failed writes.