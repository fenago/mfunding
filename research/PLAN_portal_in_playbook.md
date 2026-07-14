# Plan: The Merchant Portal in the Revenue Playbook

**Date:** July 13, 2026 · **Status:** DRAFT for owner review
**Owner's ask (verbatim):** "we're not using the merchant portal enough, my.mfunding.net. We need to validate that it's working, and we need to start integrating that into the revenue playbook. We're sending everything by email, but it sure would be a whole lot easier if we can just send them to my.mfunding.net and have them do everything from there as well, IN ADDITION to all the email stuff."

**Ground rules (non-negotiable):**
1. **The portal is an ADDITIONAL surface, never a replacement.** Email + GHL automations stay exactly as they are. Every portal mention is appended NEXT TO the existing links, never instead of them. (The earlier "portal as primary door" framing was rejected — this plan does not revive it; see `research/merchant_experience_final.md` §5.4: "the portal is the better path, never the only path.")
2. **No GHL workflow is modified by code.** We have no authority over the automations. Everything below uses mechanisms GHL already reacts to — tags, contact-level workflow removal, contact notes, opportunity stage sync — all verified live against the MFunding location (`t7NmVR4WCy927j4Zon4b`).
3. Compliance: MCA = purchase of future receivables. All merchant-facing copy below uses "funding" / "capital" / "advance" — never "loan." Compliance agent reviews final copy before ship.

---

## 1. Validation — what the portal actually does today (verified July 13, 2026)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Every merchant customer has `user_id` (portal provisioning) | **PASS** | 17/17 rows in `customers` have `user_id`; `merchant-login-link` also provisions on demand for any future stragglers (`supabase/functions/merchant-login-link/index.ts:104-122`) |
| 2 | `merchant-login-link` end-to-end | **PASS** | Live test against the TEST merchant only (Socrates Coffee Roasters, `socrates73+merchant@gmail.com`): HTTP 200, `activity_log` marker `portal:login-link sent` written, email landed in GHL Conversations (conversation `kw4rKA3E7klPDAQBwSUF`) at the exact send timestamp |
| 3 | Portal capability inventory | **PASS** (far more built than assumed) | See §1.1 below |
| 4 | Portal upload → GHL write-back | **FAIL — the load-bearing gap** | `merchant-doc-uploaded` writes `activity_log` + re-runs the underwriter but makes **zero GHL calls**. MCA 05/MCA 06 keep chasing a merchant who already uploaded. See §2 |
| 5 | E-sign links visible in portal | **PASS** | `ghl-docs-status` returns the per-recipient signing URL (`link.vibereach.io/documents/v1/{referenceId}`); `DocumentsToSign.tsx` renders both GHL docs ("Review & sign", new tab) and native e-sign docs (in-app modal). Verified in code; function is auth-gated (audit #5a closed) |
| — | Hosting | PASS | `my.mfunding.net` → 200, `mfunding.net/portal` → 200 |
| — | DB machinery | PASS | All 8 portal RPCs exist in prod (`get_my_portal_deals`, `get_my_deal_submissions`, `respond_to_offer`, `notify_merchant`, `send_message_to_advisor`, `express_renewal_interest`, `seed_rail2_doc_requests`, `storage_path_customer_id`); test deal MF-2026-0016 carries 4 seeded Rail-2 doc requests |

### 1.1 What a merchant can DO in the portal today

Built and live (July 11–12 "Merchant Experience" wave, tracked in `research/merchant_experience_final.md`):

- **Dashboard** (`/portal/`): live deal journey (stage hero + step detail), action-needed hero, DocumentsToSign card, notification bell, paydown tracker + renewal countdown, one-tap renewal interest, post-funding vault.
- **Documents** (`/portal/documents`): `DocChecklist` — per-request upload cards driven by `deal_doc_requests` (seeded automatically at `application_sent` by `seed_rail2_doc_requests`: 4 months statements w/ 24h deadline, driver's license, voided check, proof of ownership), plus ad-hoc "upload something else." Uploads land in the `customer-documents` bucket + `customer_documents` row, flip the request to `uploaded`, and fire `merchant-doc-uploaded` (activity trail + auto-underwrite on bank statements).
- **Sign** (`/portal/sign/:id` + dashboard card): native freeze-and-ledger e-sign AND real GHL Documents & Contracts signing links, unified in one list.
- **Offers** (`/portal/offers`): anonymized side-by-side offer cards in dollars, accept/decline with confirmation, expiry countdown — accept does NOT move the stage (closer drives the funded move).
- **Inbox** (`/portal/inbox`): two-way — merchant composes to the assigned closer (`send_message_to_advisor`), staff replies via `send-merchant-email` mirror in; system notifications deep-link.
- **How it works** (`/portal/how-it-works`): compliance-reviewed explainer.

**The portal is not under-built — it is under-USED.** Nothing in the closer's daily motion (the Revenue Playbook) or the merchant's email stream points at it. `src/data/playbooks.ts` contains **zero** portal mentions; the three application cover notes (04B pre-filled / 04C partial / MCA 04 self-fill, `src/components/admin/MerchantApplicationModal.tsx`) describe the e-sign email and upload link but never mention the portal; the GHL message drafts that add a portal line (O11) were written and compliance-passed but never applied in the builder.

---

## 2. The load-bearing fix: portal upload → GHL write-back (P1, blocks everything else)

**The problem (why the portal was demoted before):** a merchant who uploads statements in the portal keeps getting chased by MCA 05 (non-bank stips) / MCA 06 "Bank Statements (Seq A)" — SMS, reminder, call task — because nothing tells GHL the docs arrived. Today the chase only stops when staff notice the upload and advance the deal (deal status → `ghl-sync` action `"deal"` → opportunity stage move). Nights, weekends, and busy days, the merchant who did the right thing gets nagged for it. **We cannot send merchants to the portal at scale until this is closed.**

**The mechanism (verified live, no workflow edits):**

- `DELETE /contacts/{contactId}/workflow/{workflowId}` removes a contact from a running workflow. **Tested against the TEST contact + MCA 06 (`f2472211-...`): HTTP 200 `{"succeeded":true}`.** This stops the chase for that one contact without touching the workflow definition — exactly the authority we have.
- `addContactTags()` already exists in `supabase/functions/_shared/ghl.ts` and "fires GHL tag-added workflows" — a durable, visible marker that future automations can key on without us changing them.
- `POST /contacts/{id}/notes` puts a note on the contact so a VA working purely inside GHL/VibeReach sees the upload without opening our app.

**The change — extend `supabase/functions/merchant-doc-uploaded` (one function, already deployed, already owns this moment):**

1. **Tag** the contact `portal-doc-uploaded` (always) and `portal-statements-in` (when `document_type = 'bank_statement'`). Idempotent; tags are audit-visible in GHL.
2. **Stop the chase**: when the upload satisfies the bank-statement request (`deal_doc_requests` row for `bank_statement` reaches `uploaded`), remove the contact from **MCA 06** (`f2472211-4c93-494f-aca2-1c7c6bfc7e25`). When ALL required non-bank Rail-2 requests are `uploaded`+, remove from **MCA 05** (`d7f5985a-b9a7-4753-aea8-195dd24271e0`). Remove-from-workflow only — never move opportunity stages automatically (stage moves fire other automations, e.g. MCA 07 submits to funders; that stays a human decision).
3. **Mirror visibility into GHL**: write a contact note — "Merchant uploaded «filename» (bank statement) via the portal — file is in the app doc queue." (Optionally also the existing `activity_log` secure link.)
4. All three best-effort, like the function's existing pattern — a GHL hiccup must never fail the merchant's upload.

Guardrails: workflow IDs come from a config map (vault/settings), not hardcoded string literals scattered in code; every GHL side effect logs to `activity_log` so the sync-log page can answer "did the chase stop?"

---

## 3. Where the portal enters the Revenue Playbook (P1)

`src/data/playbooks.ts` steps carry verbatim `say` scripts and `do` checklists — today, zero portal mentions. Additions (all ADDITIVE — the email/GHL lines stay):

**a) Application send** (the step that fires 04/04B/04C): append to the `say` script and to all three cover-note bodies in `MerchantApplicationModal.tsx` (each currently lists the 3 things arriving by email):

> "Everything I just sent also lives in your secure portal at **my.mfunding.net** — one link, no password. You can upload your documents, e-sign, and watch exactly where your funding stands, and everything still comes by email too."

Cover-note line (after the numbered list): `Prefer to do it all in one place? Everything above is also in your secure portal — sign in at my.mfunding.net (we'll email you a one-tap sign-in link any time you ask).`

**b) Stips chase** (Docs Collected / Bank Statements steps): add a `do` line — "If the merchant has portal access (check the Portal chip), text/email them their sign-in link and say: 'fastest way is your portal — snap photos right from your phone, no attachments.'" This needs the one-click send below.

**c) Offer presentation**: add a `say` line — "I've put your options side by side in your portal — open my.mfunding.net and we can walk through them together on this call." (`/portal/offers` is already live and anonymized.)

**d) The context bar — PortalAccessChip is 80% there.** Today (`src/components/admin/PortalAccessChip.tsx`): three states (✅ active / ✉ invite sent / ⚠ none) + a popover that sends the invite via `PortalInviteButton`. **Missing:**
- A **"Send sign-in link"** action for ALREADY-ACTIVE merchants — today the closer has no button for "they lost the link"; the merchant must self-serve on the sign-in page. Add a staff-triggered send (email + SMS, same transport as `merchant-invite`) to the chip popover.
- A **"Copy portal link"** (my.mfunding.net) for pasting into any live channel.

**e) The GHL message copy (owner/builder action, NOT code — already drafted + compliance-passed):** apply O11 (portal line in MCA 06 Day 0 / Day 2 / Day 10 + MCA 04/04B doc-request emails) and O10 (post-sign redirect to `https://mfunding.net/portal?signed=1`) from `research/IMPORTANT_TODO.md`. ~6 minutes in the builder. These are the owner's to apply; the drafts sit ready. This plan does not touch workflows by code.

---

## 4. P2 — the merchant always sees a clear ask

Mostly built; close the last gaps:

- `seed_rail2_doc_requests` (migration `20260712_auto_seed_rail2_doc_requests.sql`) seeds the 4-item checklist when an MCA deal FIRST hits `application_sent` — so the checklist and the email upload link appear at the same moment. Verify + backfill: any live deal past `application_sent` with zero `deal_doc_requests` gets seeded (idempotent one-off script), so no merchant opens an empty Documents page.
- Funder-stips → checklist already works (closer adds a `deal_doc_requests` row → instant portal card + notification). Add a playbook `do` line at the Submitted step so closers actually use it instead of ad-hoc email asks.
- Rejected-doc loop: confirm the rejected → re-upload path reads clearly on mobile (rejected = top of ActionNeededHero today) — UX pass only.

## 5. P3 — offers in the portal, in the motion

`/portal/offers` is live (accept/decline, countdown, anonymized). P3 makes it part of the sale, still closer-led:

- "Present offers" playbook step gets a **"Send portal offer review"** action: fires the existing `notify_merchant` offer notification (email + portal bell) with the deep link, so "check your portal" is one click for the closer, zero new merchant-facing systems.
- Offer-accepted-in-portal already writes the `funder:note` marker onto the closer's funder card; surface it louder in the playbook context bar ("Merchant ACCEPTED offer X in the portal") so the closer calls immediately.
- Renewal: MCA 12 tag-branch build (O12, owner/builder) already deep-links every milestone SMS to the portal paydown countdown — no code needed beyond what ships in P1.

---

## 6. Phasing

| Phase | Items | Effort |
|-------|-------|--------|
| **P1** | §2 write-back (extend `merchant-doc-uploaded`: tags + workflow-removal + GHL note) · §3a script + cover-note lines · §3d chip "Send sign-in link" + "Copy link" · owner applies O10/O11 in builder | 1 build wave |
| **P2** | §4 doc-request backfill + playbook funder-stips line + rejected-doc UX pass | small |
| **P3** | §5 offer-presentation portal action + accepted-offer surfacing | small |

Success measure: % of funded deals where ≥1 stip arrived via portal; time-from-request-to-docs (the #1 leak metric) portal vs email-only; zero "chased after upload" incidents (query: activity_log upload timestamp vs subsequent MCA 06 sends).

---

## TODO entries

- [ ] **P1 · Portal→GHL write-back:** extend `merchant-doc-uploaded` — add contact tags (`portal-doc-uploaded`, `portal-statements-in`), remove the contact from MCA 06 (`f2472211…`) when the bank-statement request is satisfied and from MCA 05 (`d7f5985a…`) when all required non-bank stips are in (verified `DELETE /contacts/{id}/workflow/{wfId}` → 200), and write a GHL contact note so VAs see the upload inside GHL. Best-effort, activity-logged, workflow IDs from settings — never edits a workflow, never moves a stage.
- [ ] **P1 · Cover notes:** add the portal line to all three application cover notes in `MerchantApplicationModal.tsx` (04B pre-filled / 04C partial / MCA 04 self-fill) — ADDITIVE, after the numbered list; compliance re-read before ship.
- [ ] **P1 · Playbook scripts:** add portal `say`/`do` lines in `src/data/playbooks.ts` at application-send, stips-chase, and offer-presentation steps ("also in your portal — my.mfunding.net", never replacing email lines).
- [ ] **P1 · PortalAccessChip:** add "Send sign-in link" (staff-triggered email+SMS for already-active merchants) and "Copy portal link" to the chip popover in the playbook context bar.
- [ ] **P1 · OWNER (GHL builder, drafts ready + compliance-passed):** apply O11 (portal line in MCA 06 Day 0/Day 2/Day 10 + MCA 04/04B doc-request emails) and O10 (post-sign redirect → `mfunding.net/portal?signed=1`) per `research/IMPORTANT_TODO.md`.
- [ ] **P2 · Checklist backfill:** one-off idempotent seed of Rail-2 `deal_doc_requests` for live deals already past `application_sent` with zero requests, so no merchant lands on an empty Documents page.
- [ ] **P2 · Funder stips via checklist:** playbook `do` line at the Submitted step — request extra stips through `deal_doc_requests` (instant portal card + notification), not ad-hoc email.
- [ ] **P3 · Offer presentation:** "Send portal offer review" action on the present-offers playbook step (fires the existing `notify_merchant` offer notification + deep link) and louder surfacing of portal offer-accepts in the playbook context bar.
- [ ] **Measure:** add the portal-adoption panel — % of stips arriving via portal, request→docs cycle time portal vs email-only, and a "chased after upload" zero-incident check.
