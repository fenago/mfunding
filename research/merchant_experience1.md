# Merchant Experience Dashboard — Build Plan
**Date:** July 11, 2026
**Goal:** A mobile-first merchant dashboard where a merchant can see their entire funding journey, do every document task in one place, watch their submissions, and — after funding — watch a renewal countdown that becomes the basis of our renewal communication. Email remains a full parallel path for merchants who prefer it.

---

## The headline discovery

**We already have a merchant portal — it has just never been reachable.** `/portal/` exists with a Dashboard (deals + pipeline + next step), Documents (upload + status), and Inbox pages. But `customers.user_id` — the column every portal query joins on — **is never set anywhere in the codebase**. No signup match, no admin action, no invite flow. Live DB: 0 of 2 customers linked. Every real merchant who logged in today would see empty states.

So this is not a greenfield build. It's: **(1) connect it, (2) secure it, (3) upgrade it to the experience described below.** That cuts the effort dramatically.

## The experience we're building (merchant's eyes)

1. **On the call:** closer clicks "Invite to portal" → merchant gets an email/SMS with a magic link → they tap it, they're in — no password to invent while on the phone. Closer walks them through uploads live: bank statements, driver's license, voided check, right from their phone camera.
2. **The Journey:** a crystal-clear animated timeline of their deal — every stage, where they are now, what we're doing for them right now, and **time frames with countdown clocks** (docs deadline, offer expiry, expected decision window).
3. **Action callouts:** if anything needs THEM, it's a big unmissable card at the top — "2 documents needed" / "Sign your application" — never buried.
4. **Docs tab:** the full stip checklist, per-item status (needed / received / approved / rejected-with-reason), typed uploads, camera capture on mobile, and e-sign status + signing link in one place. Fully transparent stips.
5. **Submissions:** "Your file is with 4 funding partners — 2 reviewing, 1 offer received" — counts and statuses, **never funder names**.
6. **After funding — the renewal engine:** a paydown progress bar with milestone countdowns (40% / 60% / 75% / 100%) — "You're on track to unlock additional capital around **Sep 12**." This countdown is the anchor for all renewal communication (Sequence E emails link back to it).
7. **"How it works" page:** explanatory, value-adding — what MFunding does, what each stage means, why we need each document, who to contact. Builds trust and cuts "what's happening?" calls.

---

## Phase 0 — Prerequisites (security + access) — DO FIRST

Nothing merchant-facing ships before these. Both are also audit findings.

- [ ] **0.1 Fix `customer-documents` storage bucket policies** (audit finding #1 — CRITICAL). Today any authenticated user can list/read/delete every merchant's files. Scope by path prefix (`${customerId}/…` keyed to ownership) or move all reads to signed URLs from a role-checked function. **Hard blocker: we cannot invite merchants to upload into an insecure bucket.**
- [ ] **0.2 Merchant account linking + magic-link invite.**
  - New staff-gated edge function `invite-merchant`: given a customer_id → creates the auth user (admin API, email from customer record), sets `customers.user_id`, sends a magic-link/OTP email (via GHL so it lands in their Conversations thread too). Idempotent — re-invite just re-sends the link.
  - "Invite to portal" button in the Playbook context bar + Deal detail (closer-visible), with sent/accepted status.
  - Fallback auto-link: on any new signup, match verified email → existing customer with null `user_id` → link (server-side trigger, exact-match only).
- [ ] **0.3 Gate `ghl-docs-status`** (audit finding #5a) and add a merchant-scoped path (own contact only) so the portal can show e-sign status safely.
- [ ] **0.4 Portal route guard:** `/portal` currently only checks "session exists" — any staff login lands there too. Route by role; merchants (role `user`) get the portal, staff get `/admin`.

## Phase 1 — The Journey (core dashboard rebuild)

- [ ] **1.1 One status truth.** Kill the legacy 5-step stepper driven by `customers.status` (it contradicts the deal-stage pipeline shown inches below it). Everything derives from `deals.status` + the stage timestamps that already exist (`contacted_at` … `funded_at` — 12 columns, already in the schema).
- [ ] **1.2 Journey timeline component (mobile-first).** Vertical stepper on phones, horizontal on desktop. Completed stages show their real dates; current stage pulses/animates; future stages show expected time frames. Per-stage merchant copy: *what's happening, what we're doing, what (if anything) you do*. Product-aware language (MCA = "advance/funding," never "loan").
- [ ] **1.3 Countdown clocks.**
  - Docs deadline: `stips_promised_by` already exists on deals — count down to it.
  - Stage expectation windows: small config (per-stage expected duration, e.g. "submission decisions typically 1–3 business days") → "estimated by Tue, Jul 15" with live countdown.
  - Offer expiry: needs an `offer_expires_at` field (new column) set when an offer is presented.
- [ ] **1.4 "Action needed" hero card.** Single derived model: unmet doc checklist items + unsigned application + expiring offer → one prioritized card at the top of the dashboard with deep links. If nothing is needed: "You're all set — we're working. Next update expected in ~X."
- [ ] **1.5 Retire/repair dead surfaces.** Inbox is empty forever (nothing writes merchant messages) — either wire real notifications into it (see Phase 5) or drop the tab for now. "My Estimates" queries by email and is RLS-blocked — remove or fix.

## Phase 2 — Docs Hub (everything doc-related, one tab)

- [ ] **2.1 Merchant-facing stip checklist.** Mirror the admin `DocumentChecklist` (`deals.doc_checklist` is already the closer-maintained source of truth) → merchant sees each required item with status: **Needed / Uploaded—in review / Approved / Rejected (with the reviewer's reason and a re-upload button)**.
- [ ] **2.2 Typed uploads.** Fix the hardcoded `document_type: "other"` — merchant picks (or the checklist item pre-selects) the type: bank_statement, id, voided_check, business_license, tax_return, etc. Enforce the 10MB limit that's currently copy-only.
- [ ] **2.3 Mobile camera capture.** `accept="image/*" capture="environment"` path for driver's license / voided check — snap it on the call. (Remember: a bank-portal screenshot satisfies voided check — never block on it.)
- [ ] **2.4 E-sign surface.** Show application signing status (via the now-gated `ghl-docs-status`) + a "Sign now" button opening the VibeReach signing link. Signing still happens on VibeReach; the portal is the launchpad and status tracker.
- [ ] **2.5 Upload → ops feedback loop.** New merchant upload pings the assigned closer (activity_log + My Day surfacing), and bank-statement uploads trigger the underwriter the same way form uploads do.

## Phase 3 — Submissions transparency (no funder names)

- [ ] **3.1 Merchant-safe submissions view.** `deal_submissions` has NO merchant policy today (good). Add a SECURITY DEFINER RPC returning sanitized rows for the merchant's own deals: sequence number, submitted date, status bucket (Under review / Offer received / Declined) — **no funder name, no contact info, no terms until presented**.
- [ ] **3.2 Submissions panel on the journey.** "Your file is with N funding partners" with per-submission status chips and dates. Offer-received items link to the offer stage of the journey.
- [ ] **3.3 Funder stips → merchant action items.** When a funder requests additional stips, the closer marks them on the checklist → they appear instantly as action items in the portal ("The reviewing team needs your 3 most recent statements").

## Phase 4 — Renewal engine (the countdown that drives renewal comms)

This is the merchant experience becoming a revenue engine — 45–60% of merchants seek more capital within 6 months, and Sequence E fires at 40/60/75/100% paydown. The portal makes those milestones *visible and anticipated* instead of a cold outreach.

- [ ] **4.1 Paydown data model.** New deal fields: `payback_amount` (funded × factor), `remittance_amount` + `remittance_frequency` (daily/weekly), `first_remittance_date`, optional `balance_override` + `balance_as_of` for manual corrections. Estimated paydown % = elapsed remittances × amount ÷ payback (business-day aware), corrected by any override.
- [ ] **4.2 Renewal countdown UI.** Post-funding dashboard flips to: paydown progress bar, milestone markers at 40/60/75/100%, and the headline countdown — "≈ **62 days** until you may qualify for additional capital (around Sep 12)." Value framing, compliance-safe ("may qualify," never guaranteed).
- [ ] **4.3 Renewal comms anchored to the portal.** Milestone crossings → alert the owner/closer AND drive Sequence E messaging that links back to the portal countdown ("your renewal window is opening — see your dashboard"). Admin `/admin/renewals` reads the same computed paydown so both sides see one number.
- [ ] **4.4 Open decision for Ernesto:** where does real paydown truth come from — estimated schedule only (v1, above), manual funder-report entry, or Plaid transaction reads (later)? Plan assumes estimate + manual override for v1.

## Phase 5 — Explain & notify

- [ ] **5.1 "How it works" page (the value/explainer page).** In-portal page covering: who MFunding is and what we do for you (we shop your file so you don't have to), the journey stages in plain language, why each document is needed, what "purchase of future receivables" means (MCA compliance framing), realistic timelines, no-upfront-fees promise, and who to contact. Also linked from invite emails. **Compliance agent reviews every word before ship.**
- [ ] **5.2 Event notifications (email as the parallel path).** Merchants can do EVERYTHING via email if they prefer — so portal events mirror to email via GHL: doc approved/rejected, offer received, action reminders, milestone crossings. Every email deep-links to the relevant portal tab. (This also revives the Inbox tab if we mirror notifications in-app.)
- [ ] **5.3 Narrow merchant reads.** Deals RLS is row-level only — a merchant can technically read `notes`, AI recommendations, and closer fields through the API. Add a column-safe view or move portal reads to sanitized RPCs.

---

## Build sequencing & agent workstreams

Per project convention, this ships via parallel sub-agents:

| Wave | Agent(s) | Delivers |
|------|----------|----------|
| **Wave 1 (unblockers)** | `supabase-backend` | 0.1 bucket policies, 0.2 invite-merchant fn + linking, 0.3 gate ghl-docs-status, 3.1 submissions RPC, 5.3 sanitized reads |
| **Wave 1 (parallel)** | `ui-ux` | 1.1–1.4 Journey rebuild + countdowns + action card; 0.4 role routing |
| **Wave 2** | `ui-ux` + `supabase-backend` | Phase 2 Docs Hub (checklist mirror, typed uploads, camera, e-sign surface, upload pings) |
| **Wave 2 (parallel)** | `ghl-vibereach` | Invite email template, notification sends, Sequence E ↔ portal linking |
| **Wave 3** | `supabase-backend` + `ui-ux` | Phase 4 renewal engine (paydown model + countdown UI + milestone alerts) |
| **Wave 3 (parallel)** | `ui-ux` + `compliance` | 5.1 How-it-works page (compliance reviews ALL merchant-facing copy — mandatory) |
| **Close** | `auditor` | End-to-end audit of the merchant surface (RLS, bucket, RPCs, cross-merchant isolation) before real merchants get invites |

**Estimated scope:** Waves 1–2 are the "walk them through it on the call" MVP. Wave 3 completes the renewal engine.

## Dependencies on the July 11 audit (`research/audit-findings-2026-07-11.md`)

- Finding **#1** (storage buckets) = Phase 0.1 — hard blocker.
- Finding **#5a** (ghl-docs-status ungated) = Phase 0.3 — blocker for the e-sign surface.
- Findings **#6/#11** (duplicate emails) matter more once merchants self-serve — fix alongside Wave 1.

## Design principles (hold every screen to these)

1. **Mobile-first** — the merchant is on their phone, on a call with us.
2. **One glance = where am I, what's next, what do you need from me.**
3. **Countdowns everywhere there's a wait** — waiting with a clock feels like progress; waiting in silence feels like being ignored.
4. **Transparent on stips and submissions, silent on funder identity.**
5. **Compliance-safe language always** — MCA = advance/funding/capital, never "loan"; loans get standard terms; neutral wording when product is ambiguous.
6. **Email is a first-class parallel path, never a fallback.**

## Open questions for Ernesto

1. **Paydown truth source** (4.4): estimate + manual override for v1 — good enough?
2. **SMS invites too?** Magic link via SMS (LeadConnector) would be even faster on-call than email.
3. **Show offer terms in-portal** once presented (amount, factor, term) or keep offers verbal/closer-presented with portal showing "offer available — call scheduled"?
4. **Branding:** portal stays under mfunding.net/portal, or worth a friendlier subdomain (my.mfunding.net) later?
