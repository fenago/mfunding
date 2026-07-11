# IMPORTANT — Master TODO & Audit Checklist
**Date:** July 11, 2026
**Scope:** (A) Full read-only code audit by 4 independent auditors — lead lifecycle & intake, document & deal machinery, money & analytics, security & permissions. (B) Owner actions that cannot be done from inside the app.
**Status:** Working checklist. Check items off as they are fixed.
**Entity:** Agentic Voice Inc. d/b/a MFunding.net | Momentum Funding

> **Read the top 3 first.** #1 exposes every merchant's bank statements to any logged-in user. #2 means the payout numbers on screen today are ~2.2× wrong. #O1/#O2 are credential rotations only the owner can perform.

**Sections:** [Owner Actions](#-owner-actions--only-the-owner-can-do-these) · [Critical](#-critical) · [High](#-high) · [Medium](#-medium) · [Low](#-low--polish) · [Verified solid](#-verified-solid-no-action--confirmed-correct-by-auditors) · [Fix order](#suggested-fix-order)

---

## 🔵 OWNER ACTIONS — only the owner can do these
*Outside the codebase: credentials, business terms, and legal facts. These are also loaded into the admin Task Board (`/admin/todos`).*

### Security — credential rotation (URGENT)

- [ ] **O1. ROTATE the leaked Supabase management token.**
  A Supabase management token (`sbp_…`) was committed to the **public** repo history. MCP now uses OAuth so nothing depends on it, but confirm the old token is **revoked**: Supabase → Account → Access Tokens.

- [ ] **O2. ROTATE the Gemini + Firecrawl API keys.**
  Both shipped in the **public browser bundle** via `VITE_` vars, so treat them as compromised. The calls are now server-side behind JWT-gated edge functions, but **the old keys still work for anyone who scraped them.** Rotate Gemini in Google AI Studio → set the new key in Admin → Integrations → AI Provider. Rotate Firecrawl in its dashboard → set the `FIRECRAWL_API_KEY` Supabase secret. *(Note: audit finding #13 also lets anonymous callers drive paid Firecrawl jobs — rotate AND gate.)*

### Business terms — these BLOCK the closer onboarding package from sending
*The send is default-deny: it refuses rather than mailing a contract containing an unresolved `[BRACKET]`. Set these at Admin → Closer Documents → Company terms.*

- [ ] **O3. Set the company signatory (name + title).** Blocks **Schedule A, NDA, Clawback**.
- [ ] **O4. Set the clawback window (days).** Blocks the **Clawback Policy Acknowledgment** — how many days after funding a funder reversal can claw back commission.
- [ ] **O5. Set the renewal override %.** Blocks **Schedule A** — what the originating closer gets when a renewal is routed to a renewals specialist instead (guidance 0–10%).
- [ ] **O6. Confirm the legal entity against the formation paperwork.**
  Now set to **Agentic Voice Inc. d/b/a MFunding.net | Momentum Funding** (`platform_settings.closer_docs.company_legal_name`). This prints on **every executed contract** — verify it matches the formation documents before any closer signs. *(Our own docs previously contradicted themselves: "MFunding, LLC" vs "Florida C-Corp".)*

### Known gaps in the onboarding package

- [ ] **O7. Direct Deposit — build a secure bank-details capture.**
  Deliberately **excluded** from the e-sign package: it needs the closer's routing/account numbers and the form itself says not to email those. Needs its own secure capture (encrypted at rest, restricted read). Collect out of band until then.

- [ ] **O8. Convert the IC Commission Agreement (.docx) so it can be merged + e-signed.**
  The master agreement exists only as a `.docx`, so it can't be placeholder-merged or rendered for in-app signing — today it's marked "send manually." **Currently 5 of 9 onboarding docs e-sign.**

### Data-model debt

- [ ] **O9. Fix the closer identity split-brain.**
  `deals.assigned_closer_id` → **profiles(id)** while `commissions.closer_id` → **closers(id)**. This has already caused two bugs (a closer filter that silently matched zero deals; defensive double-indexing in the analytics + earnings code). Unify on one key so attribution can't drift. *(Related: audit #2, #18, #32 are all "same concept, different answer" bugs.)*

---

## 🔴 CRITICAL

- [ ] **1. Storage buckets leak every merchant's bank statements to any logged-in user.**
  `storage.objects` policies for `customer-documents` and `lender-documents` gate only on `bucket_id` + authenticated role — no owner/tenant scoping. Any merchant or closer can LIST the bucket via the storage API and download (or DELETE) every other merchant's bank statements, IDs, and voided checks — full account + routing numbers. Bypasses the correctly-scoped `customer_documents` table RLS entirely.
  **Fix:** scope SELECT/UPDATE/DELETE by ownership (path prefix keyed to owning customer/uid), or force all access through signed URLs minted by a role-checked edge function.

---

## 🟠 HIGH

- [ ] **2. Referral deals project a 65% closer split but will pay 30%.**
  `splitForDeal` (`src/services/commissionService.ts:447`) maps `referral` → self-gen (65%), but both funded payout paths (`dealService.ts:497`, `ghl-webhook/index.ts:1102`) use `/self/i` regex → referral classifies as company (30%). Both live deals (Brideau MF-2026-0013, Marquee MF-2026-0015) are referrals — My Earnings shows ~2.2× the real payout.
  **Fix:** decide which split referrals get, then make ONE classifier authoritative across all three call sites.

- [ ] **3. Campaign "spend" falls back to budget when actual spend is $0.**
  `spendOf = c.spent || c.budget` (`src/services/campaignService.ts:383`) — 0 is falsy, so a budgeted campaign with no logged spend reports the full budget as spent. Live: page shows $3,500 spent vs $1,000 actual (3.5×), poisoning Cost/funded and ROAS.
  **Fix:** separate "planned" vs "actual"; only actual spend feeds cost/ROAS (or deliberate `spent ?? budget` semantics).

- [ ] **4. Underwriter affordability rating is factor-blind — overstates capacity ~35%.**
  `underwrite-deal/index.ts:619` legacy `maxAffordableAdvance = safeDailyDebitCapacity × TERM_BIZ_DAYS` with no factor divisor; the rating (`:863–878`) and persisted `metrics.max_affordable_advance` (`:791`) use it, while the correct factor-aware block (`affordabilityFor`, `:706`) is ignored for the rating. A "tight" deal rates "strong"; the UI and judge LLM anchor on the inflated number.
  **Fix:** rate off the factor-correct `affordability.max_advance_daily/weekly`, or divide the legacy figure by the factor rate.

- [ ] **5a. `ghl-docs-status` — zero auth: any logged-in user can pull any contact's signed docs.**
  `supabase/functions/ghl-docs-status/index.ts` goes `req.json()` → GHL fetch with no getUser/role/ownership check; returns e-signed documents (incl. public viewer links) + uploaded bank-statement files for any `ghl_contact_id`. Also absent from `config.toml` (verify_jwt unpinned).
  **Fix:** add getUser + is_staff (or closer_owns_deal) gate; pin `verify_jwt = true`.

- [ ] **5b. `recommend-lenders` — verify_jwt only, no role/ownership check.**
  `recommend-lenders/index.ts:218,231` reads deal + customer + underwriting via service role for any `deal_id` and returns AI financial summary. `deal-assistant` enforces `closer_owns_deal` for the same class of call — mirror it.
  **Fix:** getUser + is_admin_or_super OR closer_owns_deal.

- [ ] **6. Duplicate customer email crashes the GHL contact webhook → infinite retry storm.**
  `ghl-webhook/index.ts:740` `.eq("email", …).maybeSingle()` — email index is non-unique, two customers can share an email → "multiple rows" error → 500 → GHL retries forever, sync dead for that contact. Same fragile pattern at `:955` and in `handleInboundMessage`/`linkFunderByDomain`. Made easy by finding #10 (no dedupe in manual capture).
  **Fix:** ordered `.limit(1).maybeSingle()` (or select-array take `[0]`); consider partial unique index on `customers.email`.

- [ ] **7. Intake-vs-webhook race can mint a second deal — and a second commission.**
  `ghl-webhook/index.ts:914–1005` matches deals only by `ghl_opportunity_id` (no unique index — verified); `live-transfer-intake` creates the deal (`:907`) before writing the opportunity id back (`:1004`). An `OpportunityCreate` webhook landing in that window auto-creates a SECOND deal (lead_source `ghl_other`, no campaign, no CALL-NOW clock). If funded, commission dedupe is per-deal so BOTH deals pay.
  **Fix:** Gap-A lookup by `ghl_contact_id`/customer before creating; unique index on `deals.ghl_opportunity_id`.

- [ ] **8. Webhook funder-reply log entries break the marker protocol → unattributed replies + double alerts.**
  `ghl-webhook/index.ts:632` logs subject `ghl:funder-reply` with no `— <funder>` suffix and JSON content (no `[emsg:]`/`[re:]`). FunderResponsesBoard (`:587`) and getFunderAnalytics (`dealService.ts:1002`) can't attribute it (raw JSON renders); poll dedupe keys on `[emsg:]` (`poll-funder-replies:576`) never matches → double log + double owner alert if native webhooks run alongside the cron poller.
  **Fix:** webhook writer emits `ghl:funder-reply — ${company_name}` + `[emsg:]`-shaped content.

- [ ] **9. Shared business_email collapses two merchants onto one GHL contact.**
  `push-application-to-ghl/index.ts:260` resolves identity as `business_email || owner_email || customer.email` (business email FIRST), upserts GHL contact by that email (`:273`), then repoints BOTH `customers.ghl_contact_id` and `deals.ghl_contact_id` (`:284–289`). Two merchants sharing a bookkeeper's address → cross-linked deals, cross-wired reply detection, cross-delivered e-sign docs, contact renamed to whoever sent last.
  **Fix:** prefer owner_email for identity, or refuse relink when the resolved contact already belongs to a different customer_id.

---

## 🟡 MEDIUM

- [ ] **10. Intake dedupe is read-then-insert with no DB guard.**
  `live-transfer-intake/index.ts:776–805` — concurrent/retried Synergy webhooks both pass the dedupe read → duplicate customer + deal + GHL opportunity + urgent alert. No unique constraint backs it (email index non-unique, no phone index).
  **Fix:** idempotency key from GHL message id, or unique key/advisory lock on normalized phone.

- [ ] **11. PlaybookCapture "New lead" never dedupes by email/phone.**
  `src/components/admin/PlaybookCapture.tsx:266–284` inserts a fresh customer on every `mode==="new"` submit; the open-deal guard (`:296`) only checks the just-created id. Duplicate person → duplicate email → trips finding #6.
  **Fix:** match existing customer by normalized phone/email before insert (mirror intake's candidate lookup).

- [ ] **12. Odd phone formats hard-reject real merchants silently.**
  `live-transfer-intake/index.ts:242–263, 723–766` — `isValidMerchantPhone` requires `^\+1\d{10}$`; extensions/intl/formatting quirks → NOTHING created, only a parse-failure alert. Related: `numFrom` (`:229`) garbles ranges — FICO "700-750" → 700750.
  **Fix:** widen phone acceptance or route rejects to a review queue, not alert-only.

- [ ] **13. Unauthenticated website-scan functions can drain the Firecrawl wallet.**
  `scan-lender-website` + `scan-vendor-website`: verify_jwt=false (`config.toml:42/45`), zero in-code auth, call paid Firecrawl API (`scan-lender-website:190/239`). Any anonymous caller can drive unlimited jobs. Also read a `VITE_FIRECRAWL_API_KEY` env fallback. Superseded by role-gated `lender-extract`.
  **Fix:** gate them (verify_jwt + is_ops_staff) or retire; drop the VITE_ fallback.

- [ ] **14. SSN + full bank numbers pushed into GHL custom fields.**
  `push-application-to-ghl/index.ts:148,158,159` — owner_ssn, bank_routing_number, bank_account_number land in the third-party CRM for document merges. Function itself is correctly gated; this is data-residency/minimization.
  **Fix:** confirm GHL fields are restricted/masked, purge post-merge, or avoid sending full SSN unless the merge template needs it.

- [ ] **15. Backward stage drags in GHL rewind deal status with no guard.**
  `ghl-webhook/index.ts:1010` mirrors ANY stage change; `updateDealStatus` (`dealService.ts:232–248`) locks backward moves behind super_admin, the webhook doesn't. Timestamps are protected (only-if-null); status is not.
  **Fix:** forward-only guard (or super-admin-equivalent policy) in the webhook mirror.

- [ ] **16. Funnel rates can exceed 100% and (at volume) silently zero Monte Carlo.**
  `campaignService.ts` foldDeal (~`:331–336`) counts stage timestamps independently → `qualified_at` without `contacted_at` = 200% qualify rate (House campaign shows this NOW). `computeDefaults` (`CampaignMonteCarlo.tsx:159`) seeds knobs unclamped; at denom ≥ 20 a p>1 makes the Beta sampler NaN → sim reports 0 funded/$0 silently.
  **Fix:** clamp observed rates to [0,100] and/or make funnel counts monotonic (min with prior stage).

- [ ] **17. Comp-plan escalators (30→35→40 at $250K/$500K/mo) exist only as text.**
  `CloserCompPage.tsx:226–234` promises automatic climbs; nothing computes monthly funded volume or bumps `company_lead_split`. Underpayment/dispute risk vs a written offer sheet.
  **Fix:** implement volume detection + auto/flagged bump, or reword the page to "review-based."

- [ ] **18. `funder_paid` bucketed inconsistently across money pages.**
  `MyEarningsPage.tsx:35–42` puts it in "Pending"; `closerAnalyticsService.ts:451–453` counts it as payoutApproved. Same commission, two answers.
  **Fix:** one shared bucketing helper.

- [ ] **19. Reply-poller self-concurrency double-logs/double-alerts.**
  `poll-funder-replies/index.ts:572–580, 682` — read-then-write on the `[emsg:]` marker with no DB uniqueness; overlapping cron runs both log + alert (response_at stamp is idempotent, log/alert are not).
  **Fix:** unique/upsert guard on the marker.

- [ ] **20. `app-prefilled` tag is contact-level and sticky → silently gates later doc sends.**
  `push-application-to-ghl:349` adds it; only a blank send (`:321`) removes it. A later plain fillable send via bare stage move on the same contact exits the MCA 04 If/Else silently.
  **Fix:** deal-scoped routing instead of a sticky contact tag.

- [ ] **21. Best-effort MCA 04 workflow-remove can fail → merchant gets double comms.**
  `push-application-to-ghl:351` DELETE is best-effort before 04B enrollment; on failure the merchant keeps MCA 04 follow-ups AND the 04B prefill doc. No retry/verify.

- [ ] **22. Submit-succeeded / stage-failed desync.**
  `dealService.ts:573` advances to `submitted_to_funder` best-effort after `submit-to-funders` returns; if the stage move throws, funders were emailed + submissions recorded but the pipeline shows the prior stage.

- [ ] **23. No orphan detection across the deals↔GHL id seam; no delete handling.**
  No `ContactDelete`/`OpportunityDelete` branch in ghl-webhook; nothing reconciles stored GHL ids. Deleted GHL objects → syncs/doc sends silently write to dead ids; deleted app deals get re-created as `ghl_other` via finding #7's Gap A.
  **Fix:** periodic reconcile job flagging dangling ids; clear stored ids on delete events.

---

## 🟢 LOW / POLISH

- [ ] **24. Emailed bank statements skip underwriting and are auto-approved.**
  `poll-funder-replies:342` files attachments as `bank_statement` status `approved`; only the form-upload path (`ghl-webhook:762`) triggers the underwriter.

- [ ] **25. Auto-underwrite can target a funded/dead deal.**
  `ghl-webhook:858` picks the customer's most-recently-updated deal with no status filter.

- [ ] **26. Impersonation is not audit-logged.**
  `UserProfileContext.tsx:147` — correctly gated to super_admin, no privilege gain, but no server-side record when a super_admin views merchant data. Log start/stop to activity_log.

- [ ] **27. `mca_applications` stores SSN/bank/DOB in plaintext columns.**
  RLS is correctly scoped; this is defense-in-depth on a free-tier project holding real SSNs. Consider pgcrypto/vault or a masked view.

- [ ] **28. Intake logs the full raw lead payload readable by all ops staff (incl. 'employee').**
  `live-transfer-intake/index.ts:938–943`. Latent exposure if a vendor ever includes sensitive fields. Consider redaction or admin-only.

- [ ] **29. Webhook secrets accepted via `?secret=` URL query param.**
  ghl-webhook + live-transfer-intake. Query strings leak to logs/proxies. Prefer header-only (GHL delivery constraint permitting).

- [ ] **30. Stale doc: `commissionService.ts:44` says 35% default company split; actual is 30 (Momentum Standard).** Fix the comment.

- [ ] **31. Unbounded selects hit PostgREST's 1000-row cap silently at scale.**
  `getCampaignMetrics` (`campaignService.ts:434`), `getCloserAnalytics`, `getAllCommissions`. Fine at 2 deals; silent undercount later.

- [ ] **32. Three services define "funded" slightly differently.**
  campaignService (`funded`,`restructure_executed`+funded_at) vs analyticsService (`funded`,`renewal_eligible`) vs closerAnalytics (status==funded||funded_at). VCF `restructure_executed` can be missed in analytics funded totals.

- [ ] **33. `getCommissionSummary` month boundary mixes local midnight with UTC created_at** — up to a few hours of edge-of-month skew.

- [ ] **34. Campaign revenue (`estCommission`) is gross 8 pts always.**
  `campaignService.ts:286,355` — ignores renewals being 6 pts (~33% overstate on renewal-funded) and isn't net of the 30–65% closer split. Disclosed as "@ 8 pts" but should be a conscious choice.

- [ ] **35. My Day refetches the whole queue on every deals change per client** (`MyDayQueue.tsx:386–393`) + 15s poll. Correct but chatty at scale — debounce.

- [ ] **36. Intake `ghlWarning` overwrites on each sync step** (`live-transfer-intake:977,979,1008`) — only the last GHL issue survives on a partial sync. Accumulate into an array.

- [ ] **37. Merchant-app drift banner ignores owner_email.**
  `MerchantApplicationModal.tsx:229` compares only `business_email`; a changed contact email won't surface when identity came from owner_email.

---

## ✅ Verified solid (no action — confirmed correct by auditors)

- Double-commission protection: partial unique index `commissions_deal_id_uniq` confirmed live in DB; both funding paths guarded and idempotent.
- Split math verified against offer sheet: $50K × 8pts = $4,000; company 30% → $1,200/$2,800; self-gen 65% → $2,600/$1,400.
- Webhook auth fail-closed on both intake functions: 503 without secret, 401 on mismatch, constant-time compare, vault→env resolution. Previously-documented fail-open hole confirmed closed.
- RLS enabled on all 58 public tables; helper functions (is_staff, closer_owns_deal, etc.) SECURITY DEFINER + pinned search_path; closer and merchant isolation hold; role self-escalation blocked by trigger; `llm_provider_keys` service-role-only.
- Frontend secrets hygiene clean — only anon/public VITE_ vars in the bundle; .env gitignored.
- Monte Carlo math correct: lognormal mu/sigma, Beta evidence-weighting with right per-stage denominators, benchmark chain ~9.8%.
- Timestamp stamping only-if-null (never clobbers history); webhook and dealService maps match.
- My Day rank catch-all — no open non-terminal deal can be invisible; lanes derive from a single classifier.
- lt-source robot guard prevents junk-deal regression; opportunity-exists 400 reuses existingId.
- Funder reply-stamp idempotency (response_at only-if-null + forward-only poll advance).
- submit-to-funders hard gates: signed-app 422, per-document ownership, GHL URL host whitelist, test-mode recipient override.
- Underwriter statement dedup (byte-hash + period) and the NEW affordability block's math are internally consistent and factor-correct.
- Status unions in `types/deals.ts` exactly match live DB check constraints.
- Commission RLS: closers self-read only; approve/hold/pay super-admin only.

---

## Suggested fix order

**Do first — in parallel with the code fixes, because only the owner can:**
- **#O1 + #O2** rotate the leaked Supabase token and the Gemini/Firecrawl keys (they are public *right now*)
- **#O3–O5** set the three business terms, or the closer onboarding package cannot be sent at all

**Code fixes:**
1. **#1** storage buckets (PII exposure — every merchant's bank statements are readable by any logged-in user)
2. **#2 + #3** referral split mismatch + spend fallback (money numbers on screen today are wrong)
3. **#5a + #5b** the two ungated functions (quick — same pattern as existing gates)
4. **#4** affordability factor bug (before real underwriting volume)
5. **#6 + #7 + #10** the dedupe/race cluster (before real-time lead volume ramps)
6. **#17** the escalators are text-only — either implement the volume bump or reword the page. It is a written comp promise (30→35→40 at $250K/$500K/mo) that nothing enforces. **#O9** and **#18/#32** are the same class of "one concept, several answers" and are worth doing together.
