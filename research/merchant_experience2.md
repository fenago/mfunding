
# Merchant Portal Plan — "The Journey" Dashboard

**Goal:** A mobile-first, merchant-facing dashboard where a merchant logs in (ideally while on the phone with a closer), sees exactly where they are in the funding journey, does everything in one place — uploads, e-sign, offer review — with full transparency on stips and submission status (without exposing funder names), stays useful after funding as a paydown/renewal tracker, and keeps email as a full-parity fallback channel.

**Status:** Planned July 2026. Grounded in a code audit of the repo (frontend + migrations/edge functions) — file references below are verified.

---

## What already exists (build on, don't rebuild)

| Asset                                                 | Where                                                                                                              | State                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Portal shell (Dashboard, Documents, Estimates, Inbox) | `src/pages/portal/*`, routes in `src/router/index.tsx:277-304`                                                 | Working skeleton, reasonably responsive, dark-mode                                                           |
| Animated pipeline stepper                             | `src/components/shared/PipelineFlow.tsx` + `src/data/pipelines.ts` (merchant-friendly label + blurb per stage) | Good; horizontal scroll is a mobile UX smell                                                                 |
| Per-stage timestamps on deals                         | `contacted_at … funded_at` columns, stamped by `dealService.ts` and `ghl-webhook`                           | The merchant timeline data source — free                                                                    |
| Merchant deal read access (RLS)                       | "Customers view own deals" in`20260626_harden_deals_rls.sql`                                                     | Already merchant-safe                                                                                        |
| Per-funder submissions w/ offer terms                 | `deal_submissions` (status: pending→submitted→under_review→approved/declined→offer_made→…→funded)         | Admin/closer-only RLS; references`lender_id`                                                               |
| Doc upload UI                                         | `PortalDocumentsPage.tsx` → bucket `customer-documents` + `customer_documents` rows                         | Works but type-blind (`document_type: "other"` hardcoded), no checklist                                    |
| E-sign (freeze-and-ledger)                            | `20260711_closer_docs_merge_esign.sql`, `sign_closer_document` RPC, `send-closer-onboarding-package`         | Excellent pattern (server merge, SHA-256 freeze, append-only ledger, IP/UA capture) — hard-wired to closers |
| GHL sync (stage freshness)                            | `ghl-webhook` maps GHL stage → `deals.status` + timestamps; logged to `ghl_webhook_events`                  | Portal stage display stays fresh automatically                                                               |
| Merchant email transport                              | `send-merchant-email` edge fn via GHL (`sales@send.mfunding.net`)                                              | Email fallback exists                                                                                        |
| Renewal data                                          | `deals.paydown_percentage`, `/admin/renewals` page, GHL Sequence E                                             | Admin-only today                                                                                             |
| Deadline field                                        | `deals.stips_promised_by` (merchant's committed bank-statement date)                                             | Countdown-clock fuel                                                                                         |

## Blocking gaps (verified)

1. **No merchant identity link.** Nothing ever writes `customers.user_id`; no invite/magic-link/OTP flow exists anywhere (grep confirmed). A merchant who self-signs-up sees an empty portal. **Everything depends on fixing this first.**
2. **No merchant RLS on `customers`** (all SELECT policies are staff/closer-scoped) and merchant self-RLS on `customer_documents` is **not in repo migrations** — must be verified against the live DB (base tables were created outside the repo).
3. **`deal_submissions` has no merchant policy** and exposes `lender_id` — needs a sanitized exposure path.
4. **No "requested docs" model** — only uploaded docs (`customer_documents`) and a closer-controlled `doc_checklist` JSON on deals. Merchants can't see what's still needed.
5. **Dashboard renders two conflicting stage models** — `PipelineFlow` on `deals.status` AND a legacy hardcoded 5-step tracker on `customers.status` (`PortalDashboardPage.tsx:286-374`). Retire the legacy one.
6. **Inbox has zero producers for merchants** (only writer is closer commission notifications) and no compose.
7. **Merchant application e-sign is a GHL round-trip** — signed PDF manually downloaded from GHL and re-uploaded as `document_type='application'` (`signedApplication.ts`); `submit-to-funders` hard-gates on it.
8. **Plaid absent from frontend** (`PLAID_ENABLED` flag exists, no Plaid Link SDK anywhere).

---

## Phase 0 — Merchant identity & access (the prerequisite)

**Outcome: "We just texted you a link — tap it and you're in."** No passwords on a phone call.

- **Magic-link auth**: `supabase.auth.signInWithOtp` (email) — merchant taps link in SMS/email, lands authenticated. Add `/auth/merchant` landing route that handles the OTP redirect and routes to `/portal`.
- **Invite + claim flow**: new edge function `merchant-invite` (service role): given a `customer_id`, uses `auth.admin.generateLink`/`createUser` keyed to the customer's email, **stamps `customers.user_id`** on creation (or on first verified login via a claim-by-email trigger). Idempotent — re-sending is safe.
- **Closer trigger**: "Send portal invite" button on `/admin/deals/:id` and `/admin/customers/:id` → calls `merchant-invite` → sends SMS + email via GHL with the link. This is the on-call moment: closer clicks, merchant's phone buzzes, closer walks them through while live.
- **RLS**: add merchant self-SELECT on `customers` (`user_id = auth.uid()`); verify/add merchant SELECT+INSERT on `customer_documents` scoped through their customer row; keep existing deals policy.
- **Routing hygiene**: role-aware post-login redirect (merchant `user` role → `/portal`, staff → `/admin`); unify the portal pages on `user_id` linkage (Estimates currently matches by email — fix).

## Phase 1 — The Journey (dashboard rebuild)

**Outcome: one glance answers "where am I, what's happening, what do I do next, how long will it take."**

- **Single source of truth**: retire the legacy 5-step `customers.status` tracker; everything renders from `deals` + `PipelineFlow` stage data.
- **Mobile-first journey view**: on small screens, replace the 13-stage horizontal strip with a collapsed vertical view — completed stages compressed ("✓ 4 steps done"), current stage expanded and animated, upcoming stages summarized. Keep the horizontal animated flow on desktop. (Merchant-facing stage grouping: the 13 internal stages collapse to ~7 merchant-visible steps — e.g. hide `qualifying` vs `contacted` distinctions.)
- **Per-stage cards**: what's happening now, **whose move it is** ("We're on it" vs "⚡ You have a task"), expected timeframe ("submissions typically hear back in 24–48 hours"), and stamped history from the `*_at` timestamp columns ("Application sent Jul 9, 2:14 PM").
- **Countdown clocks**:
  - Stips deadline from `deals.stips_promised_by` ("Bank statements due in 1 day 4 hrs").
  - Offer expiry (add `offer_expires_at` to `deal_submissions` or deal-level) — "This offer is reserved for 3 more days."
  - Stage-SLA expectations rendered as soft timers ("typical wait: 24–48h, elapsed: 6h").
- **Action Needed banner**: sticky top-of-dashboard callout whenever the ball is in the merchant's court (docs outstanding, signature pending, offer awaiting decision) with one-tap deep link to the task.

## Phase 2 — Docs Hub (attacks the funnel's #1 leak)

**Outcome: the closer says "tap Documents — see the three items? Let's do them right now."**

- **Explicit stips model**: new table `deal_doc_requests` (`deal_id`, `doc_type`, `label`, `status: requested|uploaded|under_review|approved|rejected`, `rejection_reason`, `due_at`, `requested_by`). Closer/admin UI to request docs on a deal (seeded from templates: 4 months bank statements, driver's license, voided check, signed application). Keep `deals.doc_checklist` in sync or migrate it onto this table.
- **Merchant checklist UI**: each request is a card with its own upload slot — big tap targets, `capture="environment"` file inputs so the phone camera opens directly for license/voided-check shots, progress ring ("2 of 4 done"), rejected docs show the reason and a re-upload button.
- **Typed uploads**: uploads carry the request's `doc_type` (fixes the hardcoded `"other"`), auto-mark the request `uploaded`, notify the closer (in-app + GHL), and stamp `docs_collected` progress.
- **Email parity**: every doc request also goes out via GHL SMS/email (Sequence A stays), but links now deep-link into the portal checklist.
- **Plaid Link (flag-gated)**: wire real Plaid Link into the bank-statements request slot behind `PLAID_ENABLED` — "Connect your bank (60 seconds)" as the primary path, manual upload as fallback. Requires a `plaid-link-token` edge function. Can ship after the manual checklist; the slot design anticipates it.

## Phase 3 — Submission transparency (without funder names)

**Outcome: "Your file is in front of 4 funders — 2 reviewing, 1 approved, 1 offer in."**

- **Sanitized exposure**: SECURITY DEFINER RPC (or security-barrier view) `get_my_deal_submissions(deal_id)` returning anonymized rows — "Funder A/B/C", status, submitted date, offer terms when made — **never** `lender_id`, lender name, or internal notes. (RLS can't hide columns, so RPC/view is the correct mechanism.)
- **Dashboard card**: submissions counter with live statuses and a subtle "waiting" pulse; flips to celebration state when an offer arrives.
- **Timeline events**: submission sent / response received appear in the merchant timeline (sourced from `deal_submissions` status transitions).

## Phase 4 — Offers & native merchant e-sign

**Outcome: review offers and sign the contract on the phone, on the call — no GHL round-trip.**

- **Offer review page**: renders offers from `deal_submissions` (amount, factor rate → shown as total payback, term, payment) side-by-side as "Offer 1 / Offer 2" — anonymized, plain-language, product-aware wording. Accept/decline buttons notify the closer instantly; countdown if `offer_expires_at` set.
- **Merchant e-sign track**: mirror the closer freeze-and-ledger pattern — `merchant_doc_templates`, `merchant_documents` (server-side merge, placeholder block, frozen `merged_content` + SHA-256), append-only `merchant_document_signatures`, `sign_merchant_document` SECURITY DEFINER RPC (typed legal name + consent + IP/UA). Signer auth = the merchant's portal login (Phase 0 makes this possible; no anonymous token signing needed).
- **Close the loop**: on signature, auto-write the signed doc into `customer_documents` as `document_type='application'` so the existing `submit-to-funders` gate passes untouched. This replaces the manual GHL Documents download/re-upload described in `signedApplication.ts`.
- **Compliance**: contract templates and disclosures per product type + state (reuse `compliance_disclosures`); MCA docs never say "loan."

## Phase 5 — "How this works" + notifications

**Outcome: the portal educates and reassures — it's valuable even when there's nothing to do.**

- **Explainer page (`/portal/how-it-works`)**: plain-language walk through the journey — what each step means, what we need and why, realistic timeframes, "you never pay us — funders compensate us," "checking options doesn't impact your credit; only a formal submission can," what stips are and why funders ask, factor rate vs. interest explained honestly, FAQ. Product-aware copy (advance vs. term-loan language); run through the compliance agent before shipping. Linked from the invite email/SMS and from every stage card ("What does this step mean?").
- **First-login welcome**: short animated journey overview (the "crystal clear animation") shown once — reuses `PipelineFlow` motion.
- **Notification producers**: server-side writes to `messages` (and email via `send-merchant-email`) on: stage change, doc requested, doc approved/rejected, submission update, offer received, signature request, renewal milestone. Inbox gains compose/reply (merchant → assigned closer) so it's genuinely two-way.
- **Email full-parity**: every actionable notification works standalone over email (upload links, sign links, offer summaries) for merchants who never log in — the portal is the better path, never the only path.

## Phase 6 — Renewal mode (the portal outlives the deal)

**Outcome: after funding, the dashboard flips to a paydown tracker and becomes the renewal communication channel.**

- **Paydown tracker**: funded deals render a progress view from `deals.paydown_percentage` — amount advanced, estimated paid down, projected payoff date, and the **40 / 60 / 75 / 100% milestones as visible unlock checkpoints** ("At 60% you typically qualify for additional capital — often on better terms"). `paydown_percentage` is already merchant-readable via the existing deals RLS, and `renewalService.ts` already flips status to `renewal_eligible` at ≥40% and pushes paydown to GHL — reuse both.
- **Data-freshness caveat**: paydown is entered **manually by staff** today (`updateDealPaydown`) — no ACH/bank feed updates it. Show "as of {updated date}" on the tracker, and treat automated paydown (funder portal scrape or Plaid transaction analysis) as a later enhancement; until then, a staff cadence for updating paydown becomes part of the renewal playbook.
- **Renewal countdown**: "You're ~3 weeks from your 60% milestone" — a forward-looking timer that makes the renewal conversation feel like an unlock, not a sales call. Milestone crossings fire an in-portal notification + email and tag GHL so Sequence E and the portal speak with one voice (reuse the `/admin/renewals` push-to-GHL mechanics).
- **One-tap renewal interest**: "I'm interested in additional capital" → notifies the closer/renewal specialist, creates the renewal opportunity. Docs on file + prior Plaid link mean renewal stips are mostly "refresh bank statements" — one tap.
- **Post-funding utility**: signed contracts, funding summary, and document vault stay accessible — a reason to keep the login alive between deals.

---

## Cross-cutting requirements

- **Mobile-first everywhere**: single-column layouts, thumb-sized CTAs, camera-native uploads, vertical journey on small screens, magic-link (no passwords). Most merchants will be on a phone, often literally on the phone with a closer.
- **Compliance language**: product-aware copy throughout (MCA = advance/funding/capital, never "loan"; real loan products use lending terms); state disclosures at application/offer; no-upfront-fee and credit-impact messaging on the explainer. Every merchant-facing string goes through the compliance agent.
- **GHL stays the automation engine**: sequences, SMS, and workflows are untouched — the portal adds a self-serve surface on the same data; `ghl-webhook` keeps stages fresh. Verify the GHL workflow actually fires opportunity-stage webhooks for both pipelines.
- **Live-DB verification before build**: confirm (a) merchant RLS on `customer_documents`, (b) base `customers` policies — both live outside repo migrations.

## Sequencing & dependencies

```
Phase 0 (identity)  ──►  Phase 1 (journey)  ──►  Phase 2 (docs hub)  ──►  Phase 3 (submissions)
                                                        │                        │
                                                        ▼                        ▼
                                                  Plaid (flag-gated)      Phase 4 (offers + e-sign)
                                                                                 │
Phase 5 (explainer + notifications) — parallel from Phase 1 onward               ▼
Phase 6 (renewal mode) — anytime after Phase 1                            GHL round-trip retired
```

Phases 0–2 are the MVP that changes the closer call script ("tap the link, let's upload your docs right now") and directly attacks the docs-collection leak. Phases 3–4 deliver the transparency + native signing. 5–6 make it a relationship platform.
