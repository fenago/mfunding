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
- [x] Subdomain `my.mfunding.net` (DNS + hosting alias + app awareness) *(LIVE + validated Jul 11: owner fixed the GoDaddy CNAME (was accidentally pointed at GHL's sites.ludicrous.cloud) → mfunding.netlify.app; propagated ~50 min; Netlify cert renewed to cover my.mfunding.net; HTTP 200 serving the app; IS_PORTAL_HOST routes '/' → /portal on this host. Minor owner tidy-up: remove my.mfunding.net from GHL → Settings → Domains so GHL stops thinking it owns it)*
- [x] Compliance review of all Wave 1 merchant-facing copy *(ALL PASS, Jul 11 — zero loan-language violations, timeframes hedged, no guarantees, terminal states respectful)*
- [x] Review, commit, deploy Wave 1 *(commit 54a226e pushed Jul 11; edge functions + migrations already live; Netlify deploys from main)*

### Wave 2 — SHIPPED (Jul 11, 2026)
- [x] 2.1 `deal_doc_requests` table + closer request-docs UI *(live: table + RLS (staff/closer ALL, merchant SELECT-only), `doc_type` reuses the `customer_document_type` enum = same vocab as `doc_checklist`; approve → DB trigger auto-ticks `deals.doc_checklist` (single source of truth preserved); closer UI `DealDocRequests` on the deal page Documents tab — template quick-picks + custom label + due date + approve/reject-with-reason. Migration: `supabase/migrations/20260711_deal_doc_requests.sql`)*
- [x] 2.2 Merchant checklist UI *(PortalDocumentsPage rebuilt checklist-first: per-request cards with own upload slots, progress ring "X of Y done", rejected cards show reviewer reason + re-upload, approved collapse ✓, ad-hoc upload section kept below, reassuring empty state)*
- [x] 2.3 Mobile camera capture *("Take a photo" input with `capture="environment"` on every card + `accept="image/*,.pdf"`)*
- [x] 2.4 Typed uploads + 10MB enforced *(checklist uploads carry the request's `doc_type` into `customer_documents.document_type` — hardcoded "other" killed for checklist flow; 10MB enforced in code; merchant write path is the `mark_doc_request_uploaded` RPC only — merchants have no direct table writes)*
- [x] 2.5 Ops feedback loop *(edge fn `merchant-doc-uploaded`, verify_jwt=true + server-side ownership check: activity_log 'document_uploaded' + auto underwriter re-run on bank statements — closes audit #24 for the portal path; ops surface = existing NeedsAttention "Documents to review" queue; dedicated notification producer deferred to Wave 4 §5.2; NOTE: never reuse `merchant_reply_at` as an upload signal — poll-funder-replies uses it as its reply-detection baseline)*
- [x] 2.6 Email parity — DRAFTED, apply pending *(GHL API cannot read/write step-level workflow copy, builder-only. Full inventory + before/after drafts done for MCA 06/Seq A + MCA 04/04B; portal line is ADDITIVE next to the existing vibereach upload link so uninvited merchants aren't stranded; SMS line only on Day 0 + Day 2 "methods" steps + Day 10 email; both lines compliance-PASSED. **Owner/builder action to apply** — 5 min in the GHL builder, or a supervised browser session)*
- [x] 3.1 `get_my_deal_submissions` RPC + `offer_expires_at` *(live: SECURITY DEFINER, zero rows unless caller owns the deal; returns "Funding Partner A/B/…" positional labels, status buckets (submitted/reviewing/offer/declined/withdrawn), offer fields non-null only at 'offer'; never lender identity/notes/commissions; `deal_submissions` still has NO merchant RLS — RPC is the only path. Migration: `supabase/migrations/20260711_offer_expires_and_deal_submissions_rpc.sql`)*
- [x] 3.2 Dashboard submissions card *(SubmissionsCard: "Your file is in front of N funding partners", per-partner status chips, waiting pulse, offer celebration + detail grid, Countdown on `offer_expires_at`; MCA-family deals at/past submission only)*
- [x] 3.3 Funder stips → merchant action items *(same `deal_doc_requests` flow — closer adds a request, it appears instantly in the portal checklist + ActionNeededHero (rejected doc = top priority); no separate mechanism needed)*
- [x] Compliance review of all Wave 2 merchant-facing copy + the 2 GHL insertion lines *(ALL PASS, 0 violations; optional voided-check "preferred" polish applied)*

### Wave 3 — SHIPPED (Jul 11, 2026)
- [x] 4.1 Offer review page *(live: `/portal/offers` — anonymized side-by-side offer cards in dollars (no factor/APR framing), accept/decline with confirm modals, `offer_expires_at` Countdown, "What do these numbers mean?" expander; `respond_to_offer(p_submission_id, p_response)` RPC gates ownership/stage/expiry, writes the `funder:note` activity marker so responses render on the closer's funder card with zero reader changes; `get_my_deal_submissions` gained `submission_id` (opaque handle, still fully anonymized). Accept does NOT move deal stage or touch sibling offers — closer drives the funded move (commission/GHL live there). E2E-verified with a real merchant JWT)*
- [x] 4.2 Native merchant e-sign *(live: `merchant_doc_templates` / `merchant_documents` (frozen merged text + SHA-256) / append-only `merchant_document_signatures` (service-role-only writes — no REST forge path); signing via `sign-merchant-document` edge fn (verify_jwt + owner check): typed legal name + consent + real IP/UA captured, hash-integrity gate, atomic ledger+status flip, renders a signed PDF artifact. Staff send via `send-merchant-document` (ops or owning closer). `/portal/sign/:id` mobile-first signing page + dashboard DocumentsToSign card + closer SendForSignature control on the deal page. Migration: `20260712_merchant_esign.sql`)*
- [x] 4.3 Signed doc → customer_documents 'application' *(verified E2E: signing inserts the `document_type='application'` row — the exact submit-to-funders gate passes; GHL download/re-upload round-trip no longer required for portal-signed apps)*
- [x] 4.4 Per-product/state disclosures *(send-time injection from `compliance_disclosures` by product_type + customer.address_state into [STATE_DISCLOSURE] — verified live with CA disclosure, zero unresolved tokens; the disclosure's per-offer brackets ([APR] etc.) are funder-filled at OFFER time by design and don't block sends/signing)*
- [x] 5.1 `/portal/how-it-works` explainer *(accordion FAQ: who we are, journey steps, why each doc, honest MCA explainer ("purchase of future receivables, not a loan"), hedged timeframes, "you never pay us", credit-impact line, stips FAQ; linked from WelcomeOverlay + journey stage cards + nav)*
- [x] Compliance review *(ALL PASS, 0 violations; seeded template 'mca-application-authorization' ruled ACTIVATE-OK on compliance grounds but stays DRAFT pending **owner/attorney sign-off** — activating it is an owner action)*

### Wave 4 — SHIPPED (Jul 11, 2026)
- [x] 5.2 Notification producers *(live: `notify_merchant()` + `merchant_notice_copy()` (ONE canonical copy source, MCA + VCF variants) + origin-independent, exception-guarded triggers on deals (stage-step + renewal-milestone crossings), deal_doc_requests (requested/approved/rejected), deal_submissions (offer), merchant_documents (signature requested/completed). Messages carry `kind` + `action_path` columns (NULL = person message) for the notification center. `notify-merchant` edge fn (verify_jwt, staff-gated) = the EMAIL half + explicit GHL tagging. Notes: 'offer_received' covers submission events (stage message already announces submission — no double); silently no-ops for merchants without a claimed portal profile)*
- [x] 5.3 Two-way inbox *(merchant compose/reply via `send_message_to_advisor(p_deal_id,p_subject,p_body)` RPC — resolves recipient to assigned closer (super_admin fallback) + writes the self-describing `merchant:reply — portal` activity_log note on the deal timeline (the staff surface; deliberately NO separate admin inbox). /portal/inbox reworked: chronological mobile-first list, deal picker when multi-deal, system notifications render with kind icons + deep links, person messages get reply UI. **Completed to genuinely two-way (Jul 11 follow-up):** staff replies via send-merchant-email now ALSO mirror into the portal inbox as person messages (kind NULL) when the merchant has a claimed profile — email parity unchanged, best-effort insert never blocks the send; inbox renders a full conversation (sent = right-aligned "You" bubbles via `.or(from,to)` read, received-only fallback), bell/unread stay inbound-only)*
- [x] **Notification center (owner requirement, added Jul 11)** *(NotificationBell in the portal header on every page: unread badge (status='unread'), dropdown/mobile sheet with kind icon + subject + relative time + action_path deep link (opening marks read), mark-all-read, "View all" → inbox. Classifier prefers kind/action_path columns, falls back to keyword heuristic pre-deploy)*
- [x] 5.4 Email parity — PARTIAL by design *(emailed: doc_rejected + offer_received (admin-UI fire-and-forget notify-merchant hooks), renewal milestones (renewalService → notify-merchant), signature_requested (send-merchant-document already emails), invites (merchant-invite). Portal-message-only this wave: stage changes, doc_requested/approved, signature_completed — **deferred gap**)*
- [x] 6.1 Renewal mode *(funded/renewal_eligible MCA deals flip the dashboard to PaydownTracker; VCF excluded; journey "Growing with us" step augmented, not duplicated)*
- [x] 6.2 Remittance projection *(deals + admin RenewalProjectionEditor: payback_amount, remittance_amount, remittance_frequency daily|weekly, first_remittance_date, balance_override (auto-stamps balance_as_of), last_renewal_milestone. `estimate_paydown()`: balance_override beats schedule estimate beats nothing; staff `paydown_percentage` beats all for display. Verified: $500/day on $65k over 30d = 16.15%; override 32.5k/65k = 50.00%. Always-visible "As of {date}" freshness)*
- [x] 6.3 Renewal countdown UI *(progress bar w/ 40/60/75/100 unlock checkpoints, "≈ N days until you may qualify for additional capital (estimated — around {date})" business-day projection, graceful no-projection degradation)*
- [x] 6.4 Sequence E one-voice *(backend: `paydown-40/60/75/100` GHL tags added in ghl-sync "paydown" action — single owner, idempotent (verified fires once), thresholds mirror RENEWAL_MILESTONES; identical milestone language in portal message + email + drafted GHL copy. **Builder action pending**: wire MCA 12 into four tag-triggered branches (re-enrollment OFF) using the w4-ghl drafts — with compliance amendments: 75% draft MUST say "typically on more favorable terms" (not "on our most favorable terms"); 100% draft adopted as "You may qualify for fresh working capital. Reach out to your advisor whenever you're ready" (matches canonical copy))*
- [x] 6.5 One-tap renewal interest *(`express_renewal_interest(p_deal_id)` — owner-gated, idempotent, `renewal:interest` activity note; `get_my_portal_deals()` returns `renewal_interest_expressed` for server-truth button state. GHL tag on interest **deferred** — merchant can't call the staff-only edge fn; activity note is the staff surface)*
- [x] 6.6 Post-funding vault *(PostFundingVault accordion on funded deals: signed agreements, uploaded docs, funding summary)*
- [x] Compliance review *(9/9 files PASS; GHL drafts a/b/c PASS, d + e amended per above)*

**Wave 4 deferred gaps (tracked, deliberate):**
- [ ] Estimated-only paydown milestone crossings don't fire notifications (trigger needs staff paydown update) — needs a scheduled recompute (pg_cron/edge cron)
- [ ] Email for stage changes, doc_requested/approved, signature_completed (portal-message-only today)
- [ ] GHL tag on express_renewal_interest (activity_log note only today)

### Post-close owner-feedback round (Jul 12, 2026 — live testing with the owner)
- [x] Merchant self-serve sign-in links (merchant-login-link fn via GHL email; sign-in page + expired screen) *(4f63677)*
- [x] Merchant-first branded sign-in (logo, staff login collapsed, Sign Up removed) + animated JourneyHero + Documents page To sign/To upload/On file *(7e76f21)*
- [x] One branded template for every merchant email (button CTA, wordmark, fallback link) *(b8b0407)*
- [x] **RLS regression fixed**: dropping merchant SELECT on customers broke 7 ownership policies (sign page, checklist, uploads) — `merchant_owns_customer()` SECURITY DEFINER helper; full behavioral re-verify *(b515819)*. Standing rule: any merchant-table RLS change gets the merchant-JWT test matrix before ship.
- [x] Inline-everything dashboard: clickable journey anchors, embedded upload checklist (shared DocChecklist), in-place signing modal, markdown-formatted contract rendering (shared MarkdownDoc), 24h bank-statement default, docs-to-sign on 4 surfaces *(47b669f)*
- [x] "My Portal" navbar link for signed-in merchants on the marketing site *(341687f)*
- [x] Real merchant doc bundle: 4 templates seeded verbatim from research/legal (Lendini clause typos preserved per owner); markdown PDF renderer; placeholder retired *(4090a1a)*
- [x] **Portal surfaces the REAL GHL signing documents** (owner decision: GHL links are the primary path — same per-recipient links the email sends; MCA 04 = merchant-fills, 04B = pre-filled): ghl-docs-status referenceId URL fix + server-side contact resolution; unified To sign across dashboard/documents/bell/hero; focus-refetch flips status after signing *(68976b2)*
- [x] Both signing variants proven live on the owner's test account (fillable MCA 04 + pre-filled 04B sent via /proposals/templates/send; owner signed 04B end-to-end) *(native templates now ALL deactivated — GHL docs are the single source; native signer kept dormant for future portal-only docs)*
- [x] Signing feedback loop *(161e85b: ghl-doc-completions record-once ledger in ghl-docs-status → merchant bell/message "Thanks for signing", closer timeline `merchant:signed` note, doc_checklist application tick (submit-to-funders gate advances on portal signing); `?signed=1` return banner + journey scroll; verified idempotent on the owner's real signature)*
- [ ] **Owner builder toggle (60s): post-sign auto-return** — GHL → Payments → Documents & Contracts → Settings → Document Settings → "Redirect to a Custom URL" = `https://mfunding.net/portal?signed=1` (existing tab) → Save. API can't set this.
- [ ] Later enhancements noted: GHL document-completed webhook (workflow → ghl-webhook branch) to replace polling; white-label the link.vibereach.io signing domain; consider retiring the duplicate body deep-link in notify_merchant now that the inbox renders action_path buttons

### Close
- [x] Full auditor pass on the merchant surface *(ran Jul 11 — verdict **NO-GO pending 1 fix**. CLEAN: all RPC gates, RPC column-safety + funder anonymization, e-sign ledger (append-only, service-role-only, forgery impossible — signer from verified JWT), storage customer/lender-documents scoping both path conventions, all edge-fn auth, notification triggers (no orphans), structural cross-merchant isolation. FINDINGS: **CRITICAL** — merchant direct REST select on own customers/deals row returns ALL columns (commission_earned, funded_by_lender_id = funder identity, notes, AI recs, lead_source, temperature…) because merchant SELECT policies are row-level only and column GRANTs can't help (staff share the authenticated role); MEDIUM — vendor-documents bucket open (read+delete) to any authenticated user; LOW — messages INSERT to any to_user_id, customer_documents merchant ALL policy too broad, stray anon EXECUTE grants. NOTE: 0 real customers have user_id → nobody exposed yet)*
- [x] **NO-GO fix SHIPPED (Jul 11) → merchant surface is GO** *(migration `20260712_merchant_column_leak_lockdown.sql`, applied live: `get_my_customer()` safe-column RPC (8 fields, nothing internal); merchant direct-SELECT policies on customers + deals DROPPED — merchant reads flow ONLY through the SECURITY DEFINER RPCs (staff untouched); vendor-documents bucket → ops-only ALL verbs; messages INSERT tightened (sender or recipient must be ops staff — merchant→advisor rides the RPC); customer_documents merchant narrowed to SELECT+INSERT; anon EXECUTEs revoked; orphaned PortalEstimatesPage deleted (read lead_source). **Behaviorally verified with two real throwaway merchant JWTs over live REST**: customers/deals direct selects = 0 rows, RPCs return safe columns + own data only, all cross-tenant probes denied (RPC "not yours", message insert 42501, vendor bucket 403), fixtures fully cleaned (all counts back to 0). **Real merchant invites are now UNBLOCKED.**)*
