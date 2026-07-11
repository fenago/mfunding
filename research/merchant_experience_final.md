# Merchant Experience — FINAL Plan & Living Checklist
**Date:** July 11, 2026 · **Approved by owner July 11, 2026** — all plan assumptions accepted; **Plaid is OUT** (owner decision); subdomain `my.mfunding.net` approved.
**Supersedes:** `merchant_experience1.md` and `merchant_experience2.md` (this merges both — Plan 2's product architecture on Plan 1's security spine and execution model, with each plan's factual misses corrected).
**THIS FILE IS THE WORKING CHECKLIST** — items get checked off as they ship. See "Wave Execution Checklist" at the bottom for build status.

**Goal:** A mobile-first merchant dashboard where a merchant logs in (ideally live on the phone with a closer), sees exactly where they are in the funding journey with time frames and countdown clocks, does every document task in one place (uploads, camera capture, e-sign, offer review), sees their submissions transparently (never funder names), and — after funding — watches a renewal countdown that becomes the anchor of all renewal communication. Email remains a full-parity parallel channel.

---

## Ground truth (verified against code + live DB)

- The portal shell EXISTS (`/portal/` — Dashboard, Documents, Estimates, Inbox) but is **unreachable**: `customers.user_id` is never set anywhere; 0 of 2 live customers linked. This is the #1 prerequisite.
- Merchant RLS **already exists live** (verified via pg_policies, created outside repo migrations): `customers` self-SELECT, `customer_documents` self-ALL, `deals` own-row SELECT, `messages` own send/receive. Do NOT rebuild; do capture them as repo migrations for the record.
- **BUT deals RLS is row-level only** — a merchant can read internal `notes`, `ai_lender_recommendations`, and closer fields through the API. Needs column-sanitized reads.
- The `customer-documents` storage bucket is **open to any authenticated user** (audit finding #1, CRITICAL) — hard blocker before merchant uploads scale.
- `deal_submissions` has NO merchant policy (good — clean slate for sanitized exposure).
- Stage timestamps (`contacted_at` … `funded_at`, 12 columns), `stips_promised_by`, `deals.paydown_percentage`, `renewalService` (flips `renewal_eligible` at ≥40%, pushes paydown to GHL), `/admin/renewals`, the animated `PipelineFlow`, and the closer **freeze-and-ledger e-sign pattern** (server merge, SHA-256 freeze, append-only signature ledger, IP/UA) all exist — reuse all of them.
- Dashboard currently renders two conflicting stage models (deal pipeline + legacy `customers.status` stepper) — retire the legacy one.
- Portal Inbox has zero merchant producers; Estimates queries by email and is RLS-blocked; doc uploads hardcode `document_type: "other"`.

---

## Phase 0 — Security + identity (the prerequisites)

**Outcome: "We just texted you a link — tap it and you're in." And nothing we invite them into is insecure.**

- [ ] **0.1 Fix `customer-documents` (and `lender-documents`) storage bucket policies** — scope by ownership path prefix (`${customerId}/…`) or signed-URL-only via role-checked function. **Hard blocker: no merchant invites before this ships.** (Audit finding #1.)
- [ ] **0.2 Magic-link auth + invite/claim flow.** No passwords on a phone call.
  - `merchant-invite` edge function (staff-gated, idempotent): given customer_id → `auth.admin.createUser`/`generateLink` keyed to the customer's email → **stamps `customers.user_id`** → sends the link via GHL **email + SMS** (SMS is the on-call path: closer clicks, merchant's phone buzzes).
  - `/auth/merchant` OTP-redirect landing route → `/portal`.
  - Fallback claim-by-email: verified signup email exact-matches a customer with null `user_id` → server-side trigger links it.
  - "Send portal invite" button on `/admin/deals/:id`, `/admin/customers/:id`, and the Playbook context bar, with sent/accepted status.
- [ ] **0.3 Role-aware routing.** Post-login: role `user` → `/portal`, staff → `/admin`. `/portal` guard checks role, not just session.
- [ ] **0.4 Gate `ghl-docs-status`** (audit #5a) with a merchant-scoped path (own contact only) — needed until native e-sign (Phase 4) retires the dependency.
- [ ] **0.5 Sanitized merchant reads.** Column-safe RPC/view for portal deal reads — merchants never receive `notes`, AI recommendations, closer/commission fields. Capture the existing live merchant RLS policies as repo migrations while here.
- [ ] **0.6 Fix duplicate-identity landmines** that merchant self-serve amplifies: audit findings #6 (email `.maybeSingle()` crash) and #11 (PlaybookCapture no dedupe).

## Phase 1 — The Journey (dashboard rebuild)

**Outcome: one glance answers "where am I, what's happening, whose move is it, how long will it take."**

- [ ] **1.1 One status truth.** Retire the legacy 5-step `customers.status` tracker; everything renders from `deals.status` + stage timestamps. Remove/fix Estimates (email lookup is RLS-blocked).
- [ ] **1.2 Merchant-grouped journey.** Collapse the 13 internal stages to **~7 merchant-visible steps** (hide `contacted` vs `qualifying` distinctions). Mobile: vertical journey — completed steps compressed ("✓ 3 steps done"), current step expanded and animated, upcoming summarized. Desktop: keep the horizontal animated `PipelineFlow`.
- [ ] **1.3 Per-stage cards.** What's happening now, **whose move it is** ("We're on it" vs "⚡ You have a task"), expected time frame ("funders typically respond in 24–48 hours"), stamped history from the `*_at` columns ("Application sent Jul 9, 2:14 PM"). Merchant-friendly, product-aware copy.
- [ ] **1.4 Countdown clocks.**
  - Stips deadline from `deals.stips_promised_by` ("Bank statements due in 1 day 4 hrs").
  - Offer expiry — add `offer_expires_at` to `deal_submissions` (per-offer, not deal-level) — "This offer is reserved for 3 more days."
  - Stage-SLA soft timers ("typical wait 24–48h · elapsed 6h").
- [ ] **1.5 Action Needed hero.** Sticky top-of-dashboard callout whenever the ball is in the merchant's court (docs outstanding, signature pending, offer awaiting decision), one-tap deep link. When nothing's needed: "You're all set — we're working. Next update expected ~X."
- [ ] **1.6 First-login welcome.** One-time animated journey overview (the "crystal clear animation") — reuses PipelineFlow motion; links to How It Works.

## Phase 2 — Docs Hub (attacks the funnel's #1 leak)

**Outcome: closer says "tap Documents — see the three items? Let's do them right now."**

- [ ] **2.1 Explicit stips model — new table `deal_doc_requests`** (`deal_id`, `doc_type`, `label`, `status: requested|uploaded|under_review|approved|rejected`, `rejection_reason`, `due_at`, `requested_by`). Closer UI to request docs from templates (4 months bank statements, driver's license, voided check, signed application). Migrate/sync `deals.doc_checklist` onto it so admin and merchant read one source of truth.
- [ ] **2.2 Merchant checklist UI.** Each request = a card with its own upload slot — big tap targets, progress ring ("2 of 4 done"), rejected docs show the reviewer's reason + re-upload button. Fully transparent stips.
- [ ] **2.3 Mobile camera capture.** `capture="environment"` inputs so the phone camera opens directly for license/voided-check shots. (Business rule: a bank-portal screenshot satisfies voided check — never block Submit on it.)
- [ ] **2.4 Typed uploads.** Upload carries the request's `doc_type` (kills the hardcoded `"other"`), auto-marks the request `uploaded`, enforces the 10MB limit that's currently copy-only.
- [ ] **2.5 Ops feedback loop.** Merchant upload → notify assigned closer (activity_log + My Day surfacing + GHL); **bank-statement uploads trigger the underwriter** the same way form uploads do (closes audit finding #24's gap for this path).
- [ ] **2.6 Email parity.** Doc requests still go out via GHL SMS/email (Sequence A untouched) — links now deep-link into the portal checklist.
- ~~**2.7 Plaid Link**~~ — **REMOVED by owner decision (Jul 11, 2026). We are NOT using Plaid.** Bank statements collect via upload/camera/email only.

## Phase 3 — Submission transparency (never funder names)

**Outcome: "Your file is in front of 4 funding partners — 2 reviewing, 1 offer in."**

- [ ] **3.1 Sanitized exposure.** SECURITY DEFINER RPC `get_my_deal_submissions(deal_id)` returning anonymized rows — "Funding Partner A/B/C", status bucket, submitted date, offer terms once presented — **never** `lender_id`, lender name, or internal notes. (RLS can't hide columns; RPC is the correct mechanism. `deal_submissions` currently has no merchant policy — keep it that way.)
- [ ] **3.2 Dashboard submissions card.** Live counter with status chips and a subtle "waiting" pulse; flips to a celebration state when an offer arrives.
- [ ] **3.3 Funder stips → merchant action items.** Funder requests extra stips → closer adds a `deal_doc_requests` row → appears instantly in the portal ("The reviewing team needs your 3 most recent statements").

## Phase 4 — Offers + native merchant e-sign

**Outcome: review offers and sign on the phone, on the call — GHL round-trip retired.**

- [ ] **4.1 Offer review page.** Offers from `deal_submissions` rendered side-by-side as "Offer 1 / Offer 2" — amount, total payback (factor shown as dollars), term, payment — anonymized, plain-language, product-aware. Accept/decline notifies the closer instantly; expiry countdown from `offer_expires_at`.
- [ ] **4.2 Native merchant e-sign** — mirror the proven closer freeze-and-ledger pattern: `merchant_doc_templates`, `merchant_documents` (server-side merge, frozen content + SHA-256), append-only `merchant_document_signatures`, `sign_merchant_document` SECURITY DEFINER RPC (typed legal name + consent + IP/UA). Signer auth = the merchant's portal login (Phase 0 enables this — no anonymous token signing).
- [ ] **4.3 Close the loop.** On signature, auto-write the signed doc into `customer_documents` as `document_type='application'` so the existing `submit-to-funders` signed-app gate passes untouched — replaces the manual GHL download/re-upload in `signedApplication.ts`.
- [ ] **4.4 Compliance.** Contract templates + disclosures per product type and state (reuse `compliance_disclosures`); MCA docs never say "loan."

## Phase 5 — Explain & notify (the value layer)

**Outcome: the portal educates and reassures — valuable even when there's nothing to do.**

- [ ] **5.1 `/portal/how-it-works` explainer page.** Plain-language walkthrough: who MFunding is and what we do for you (we shop your file so you don't have to), what each journey step means, why each document is needed, what "purchase of future receivables" means, factor rate explained honestly, realistic time frames, "you never pay us — funders compensate us," "checking options doesn't impact your credit — only a formal submission can," stips FAQ, who to contact. Linked from invite email/SMS and from every stage card ("What does this step mean?"). **Compliance agent reviews every word before ship.**
- [ ] **5.2 Notification producers.** Server-side writes to `messages` + email via `send-merchant-email`/GHL on: stage change, doc requested, doc approved/rejected, submission update, offer received, signature request, renewal milestone. This revives the dead Inbox.
- [ ] **5.3 Two-way inbox.** Merchant compose/reply → assigned closer (RLS already permits merchant sends; add the UI + closer-side surfacing).
- [ ] **5.4 Email full parity.** Every actionable notification works standalone over email (upload links, sign links, offer summaries) for merchants who never log in — the portal is the better path, never the only path.

## Phase 6 — Renewal mode (the countdown that drives renewal revenue)

**Outcome: after funding, the dashboard flips to a paydown tracker — renewal conversations become an unlock the merchant is watching for, not a cold call. This is the basis of renewal communication.**

- [ ] **6.1 Reuse existing machinery first.** `deals.paydown_percentage` (already merchant-readable), `renewalService` (flips `renewal_eligible` at ≥40%, pushes paydown to GHL), `/admin/renewals` — the portal renders the same numbers admin sees.
- [ ] **6.2 Add remittance-schedule projection** so the countdown has real math: new deal fields `payback_amount`, `remittance_amount`, `remittance_frequency` (daily/weekly), `first_remittance_date`, optional `balance_override` + `balance_as_of`. Estimated paydown = elapsed business-day remittances × amount ÷ payback, corrected by staff-entered `paydown_percentage`/override. Show **"as of {date}"** freshness on everything (paydown truth is staff-entered today; automated feeds — funder portals or Plaid — are a later enhancement, and a staff update cadence joins the renewal playbook).
- [ ] **6.3 Renewal countdown UI.** Paydown progress bar with **40 / 60 / 75 / 100% milestones as visible unlock checkpoints** ("At 60% you typically qualify for additional capital — often on better terms") and the headline projection: "≈ **62 days** until you may qualify for additional capital (around Sep 12)." Compliance-safe: "may qualify," never guaranteed.
- [ ] **6.4 One voice with Sequence E.** Milestone crossings fire in-portal notification + email + GHL tag so Sequence E and the portal say the same thing, and every Sequence E message deep-links back to the countdown.
- [ ] **6.5 One-tap renewal interest.** "I'm interested in additional capital" → notifies closer/renewal specialist, creates the renewal opportunity. Docs on file mean renewal stips ≈ "refresh bank statements" — one tap.
- [ ] **6.6 Post-funding utility.** Signed contracts, funding summary, and document vault stay accessible — a reason the login stays alive between deals.

---

## Cross-cutting requirements (every screen, every phase)

1. **Mobile-first everywhere** — single column, thumb-sized CTAs, camera-native uploads, vertical journey, magic links (no passwords). The merchant is on their phone, often literally on the phone with us.
2. **One glance = where am I, what's next, what do you need from me.**
3. **Countdowns wherever there's a wait** — waiting with a clock feels like progress; silence feels like being ignored.
4. **Transparent on stips and submissions; silent on funder identity.**
5. **Compliance-safe language always** — MCA = advance/funding/capital, never "loan"; loan products use lending terms; neutral wording when the product is ambiguous; state disclosures at application/offer. Every merchant-facing string goes through the compliance agent.
6. **Email is a first-class parallel path, never a fallback.**
7. **GHL stays the automation engine** — sequences/SMS/workflows untouched; the portal is a self-serve surface on the same data; `ghl-webhook` keeps stages fresh.

## Sequencing & agent workstreams

```
Phase 0 (security+identity) ─► Phase 1 (journey) ─► Phase 2 (docs hub) ─► Phase 3 (submissions)
                                                          │                       │
                                                          ▼                       ▼
                                                    Plaid (flag-gated)     Phase 4 (offers + e-sign)
Phase 5 (explainer + notifications) — parallel from Phase 1 onward
Phase 6 (renewal mode) — anytime after Phase 1
```

| Wave | Agent(s) | Delivers |
|------|----------|----------|
| **1 — unblockers** | `supabase-backend` | 0.1 bucket policies, 0.2 merchant-invite + claim trigger, 0.4 gate ghl-docs-status, 0.5 sanitized reads + policy migrations, 0.6 dedupe fixes |
| **1 — parallel** | `ui-ux` | 1.1–1.6 Journey rebuild (grouped stages, cards, countdowns, action hero, welcome) + 0.3 role routing |
| **1 — parallel** | `ghl-vibereach` | Invite email/SMS templates, deep-link plumbing |
| **2** | `supabase-backend` + `ui-ux` | Phase 2 Docs Hub (`deal_doc_requests`, checklist UI, camera, typed uploads, ops loop) + 3.1–3.3 submissions RPC + panel |
| **3** | `supabase-backend` + `ui-ux` | Phase 4 offers page + native merchant e-sign |
| **3 — parallel** | `ui-ux` + `compliance` | 5.1 How It Works + all merchant copy review (mandatory) |
| **4** | `supabase-backend` + `ui-ux` + `ghl-vibereach` | Phase 6 renewal mode + 5.2–5.4 notifications/inbox; Plaid Link when flag flips |
| **Close** | `auditor` | End-to-end audit of the merchant surface (bucket, RLS, RPC column-safety, cross-merchant isolation, e-sign ledger) **before real merchants get invites** |

**MVP = Waves 1–2** — that's the moment the closer call script changes: "tap the link, let's upload your docs right now." It directly attacks docs collection, the funnel's #1 leak.

## Owner decisions (resolved July 11, 2026)

1. **Offer terms in-portal:** YES — amounts/payback/term visible once presented.
2. **Paydown truth for v1:** remittance-schedule estimate + staff-entered correction. (No Plaid — automated feeds would come from funder reports if ever.)
3. **SMS invites:** YES — via LeadConnector alongside email.
4. **Subdomain:** YES — set up `my.mfunding.net`.
5. **Plaid:** NO — removed from the plan entirely.

---

## Wave Execution Checklist (working status — check off as shipped)

### Wave 1 — IN PROGRESS (launched Jul 11, 2026)
**Backend agent (`supabase-backend`):**
- [x] 0.1 Storage bucket policies fixed *(shipped+applied Jul 11 — 8 permissive policies dropped; ownership-scoped replacements via `storage_path_customer_id()` helper handling BOTH path conventions (`customer/<uuid>/…` staff and `<uuid>/…` portal); audit finding #1 CLOSED)*
- [x] 0.2 `merchant-invite` edge function + claim-by-email trigger *(deployed Jul 11 — staff-gated, idempotent, magic link → /auth/merchant, GHL email + SMS, `portal_invited_at` stamp; live-tested end-to-end with throwaway customer, zero residue)*
- [x] 0.2b "Invite to portal" button in admin UI (DealDetailPage + CustomerDetailPage via reusable PortalInviteButton; date-only stips deadline handling fixed in utils/deadline.ts) *(shipped Jul 11)*
- [x] 0.4 `ghl-docs-status` gated (staff OR own-contact merchant) + verify_jwt pinned *(deployed Jul 11; audit finding #5a CLOSED)*
- [x] 0.5 `get_my_portal_deals()` sanitized RPC + live merchant RLS policies captured as repo migrations *(applied Jul 11; note: `stips_promised_by` is `date`)*
- [x] 0.6 Dedupe fixes: ghl-webhook lookups crash-proofed (audit #6 CLOSED); PlaybookCapture new-lead dedupe (audit #11 CLOSED) *(ghl-webhook redeployed)*
- [ ] Auditor E2E check post-first-invite: merchant A cannot read merchant B's storage objects (flagged by backend — needs a real merchant JWT to test)

**UI agent (`ui-ux`):**
- [x] 0.3 Role-aware routing (merchant → /portal, staff → /admin) + `/auth/merchant` magic-link landing route *(shipped Jul 11 — AdminProtectedRoute already blocked merchants; SignInPage now role-redirects)*
- [x] 1.1 Legacy customers.status stepper retired; Estimates tab removed; all reads via portalService (RPC contract w/ fallback)
- [x] 1.2 Merchant-grouped journey (7 MCA + 7 VCF steps, mobile vertical / desktop horizontal, real dates) — `src/data/merchantJourney.ts`
- [x] 1.3 Per-stage cards (whose move, timeframe, stamped history)
- [x] 1.4 Countdown component + stips deadline + stage-SLA soft timers (offer expiry drops in Wave 2)
- [x] 1.5 Action Needed hero with deep links + all-set empty state
- [x] 1.6 First-login welcome animation (one-time, localStorage)
- [x] Subdomain awareness in app ('/' → '/portal' on my.mfunding.net; /auth/merchant host-agnostic) *(shipped Jul 11 — src/config.ts IS_PORTAL_HOST)*
- [x] Logged-out /portal/* → redirect to /auth/sign-in (with bounce-back location state) *(shipped Jul 11)*

**Team lead:**
- [ ] Subdomain `my.mfunding.net` (DNS + hosting alias + app awareness)
- [x] Compliance review of all Wave 1 merchant-facing copy *(ALL PASS, Jul 11 — zero loan-language violations, timeframes hedged, no guarantees, terminal states respectful)*
- [ ] Review, commit, deploy Wave 1

### Wave 2 — QUEUED
- [ ] 2.1 `deal_doc_requests` table + closer request-docs UI (templates: bank statements, license, voided check, signed app)
- [ ] 2.2 Merchant checklist UI (per-item status, rejection reasons, re-upload, progress ring)
- [ ] 2.3 Mobile camera capture (`capture="environment"`)
- [ ] 2.4 Typed uploads (kill hardcoded "other") + 10MB enforcement
- [ ] 2.5 Ops feedback loop (closer ping + My Day + underwriter trigger on bank statements)
- [ ] 2.6 Email parity (Sequence A links deep-link to portal checklist)
- [ ] 3.1 `get_my_deal_submissions` sanitized RPC (no funder identity) + `offer_expires_at` on deal_submissions
- [ ] 3.2 Dashboard submissions card (counts, statuses, celebration state)
- [ ] 3.3 Funder stips → merchant action items

### Wave 3 — QUEUED
- [ ] 4.1 Offer review page (anonymized side-by-side, accept/decline, expiry countdown)
- [ ] 4.2 Native merchant e-sign (freeze-and-ledger mirror: templates, merge, SHA-256, signature ledger, RPC)
- [ ] 4.3 Signed doc auto-writes to customer_documents as 'application' (submit-to-funders gate passes; GHL round-trip retired)
- [ ] 4.4 Per-product/state compliance disclosures on contracts
- [ ] 5.1 `/portal/how-it-works` explainer page (compliance-reviewed)

### Wave 4 — QUEUED
- [ ] 5.2 Notification producers (stage change, docs, submissions, offers, signatures, milestones → messages + email)
- [ ] 5.3 Two-way inbox (merchant compose → closer)
- [ ] 5.4 Email full parity for every actionable notification
- [ ] 6.1 Renewal mode reusing paydown_percentage/renewalService//admin/renewals
- [ ] 6.2 Remittance-schedule projection fields + "as of" freshness
- [ ] 6.3 Renewal countdown UI (milestone unlocks + projected date)
- [ ] 6.4 Sequence E ↔ portal one-voice linking
- [ ] 6.5 One-tap renewal interest
- [ ] 6.6 Post-funding document vault

### Close
- [ ] Full auditor pass on the merchant surface (bucket, RLS, RPC column-safety, cross-merchant isolation, e-sign ledger) **before real merchants get invites**
