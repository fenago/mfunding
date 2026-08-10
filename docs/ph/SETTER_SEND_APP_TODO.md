# Setter "Send Application" (04B) — Build, Wiring & Test To-Do
*MFunding.net / Momentum Funding · created 2026-08-09 · ✅ LIVE & VERIFIED 2026-08-09*

## Goal
A HotProspector setter, on a live call, fills the merchant's info into the HP fields
(Business / Owner / Banking / Funding Request sections), then triggers **"Send Application"** →
the merchant is emailed the fully pre-filled **04B** application to e-sign, and just has to sign.

## The flow (LIVE)
1. Setter fills HP fields → writes to the GHL contact **in real time** (verified).
2. Setter applies tag **`send-app`** (via tag button today; via a Call-Status disposition once a Dialer Campaign exists).
3. GHL workflow **"SETTER — Send Application"** (trigger: Contact Tag Added `send-app`) → Webhook POST → `ghl-send-application`.
4. Function reads the contact, twin-maps for 04B, enrolls the 04B PREFILL workflow, verifies the minted doc.
5. Merchant gets 04B + comp disclosure + statement-upload link → signs.

## DONE ✅ (verified 2026-08-09)
- [x] HP intake fields in 5 sections: Business(11)/Owner(11)/Banking(5)/Funding Request(12) + Other(62).
- [x] Edge function **`ghl-send-application`** deployed (v1, secret-gated). Reads GHL contact, twin-maps, orNA-proofs,
      requires email + all required fields (else 422 no-send), enrolls 04B, verifies template.
- [x] **HP→GHL sync VERIFIED real-time** — HP UI edits to name AND custom field values reflect in GHL within seconds;
      HP tag apply → GHL within seconds. (Reverse GHL→HP is not reliable; HP→GHL is the push direction we use.)
- [x] **GHL workflow "SETTER — Send Application"** built + PUBLISHED (id f8525d08-3094-4c43-8a53-63486b6c05bc):
      trigger Contact Tag Added `send-app` → Webhook POST to the function (secret in `x-webhook-secret` header,
      contactId={{contact.id}}), re-entry OFF, multi-opportunity OFF (double-send safe).
- [x] **`send-app` tag created in GHL** (trigger tags must pre-exist in GHL; HP "add new tag" won't commit one).
- [x] **END-TO-END TEST PASSED** — tag `send-app` on test contact → workflow → function → 3 fresh emails DELIVERED
      to socrates73@gmail.com (04B prefill + comp disclosure + upload step). Distinct from the earlier direct test.
- [x] Cleanup: test contact unenrolled + tags cleared; Khalil test contact reverted.

## The Khalil / sync question — RESOLVED
"Khalil" is in GHL as contact **"Khalil Lyons"** (khalillyons@gmail.com). The rename saved; the owner was
viewing a **logged-out GHL** session, so it looked missing. Sync was never broken — HP→GHL is real-time for
name, field values, and tags. **Design green-lit.**

## OPEN — small owner steps
- [ ] **HP → avatar menu → Quick Links → "Refresh Meta"** — so the new `send-app` tag appears in HP's tag picker
      (HP caches the GHL tag list). One click.
- [ ] **(Optional) Dispositions require a Dialer Campaign.** In HP, dispositions = **"Call Statuses"**, configured
      only inside a campaign: **Dialer → New Campaign → "Call Statuses" tab** (there is NO standalone dispositions page).
      There are zero campaigns yet — that's why no disposition button appears. To get a "Send Application" disposition:
      build a Dialer Campaign on the Leads group, add a "Send Application" Call Status, and map it to apply the
      `send-app` tag (via the campaign "Workflows"/status action — confirm the status→tag mapping during build).
      **Until then, the tag button works today:** Contact → Actions → "+ Add Tags" → `send-app`.

## NEW — raised by owner 2026-08-09
- [x] **Setters can SEND EMAILS from HP — DONE 2026-08-09.** Custom SMTP configured + tested working (test email
      delivered to socrates73@gmail.com). Settings: smtp.gmail.com : 587 : tls : Auth Yes : sales@mfunding.net :
      From "Momentum Funding". Gotcha hit + fixed: the Google app password must be entered with NO spaces (Google
      displays it in 4 spaced blocks). ⚠️ FOLLOW-UP: test emails landed in SPAM — deliverability warm-up + content
      hardening still needed (mark not-spam to train; real content inboxes better; consider List-Unsubscribe header,
      DMARC-alignment check on this send path, gradual warmup). Offered deliverability specialist deep-dive.
- [ ] ~~**Setters need to SEND EMAILS from HP.**~~ (done above) PLAN (deliverability-verified 2026-08-09): use **Google
      Workspace SMTP on `mfunding.net`** (already SPF/DKIM/DMARC-authenticated — ZERO DNS work). HP Custom SMTP:
      host `smtp.gmail.com`, port `587` TLS, username/From = a `@mfunding.net` mailbox (e.g. `setters@mfunding.net`),
      From Name "Momentum Funding", Password = a Google App Password. DO NOT use sales@send.mfunding.net as From
      (breaks DKIM alignment). Keep lanes separate: cold=Instantly domains, CRM automation=send.mfunding.net,
      setter 1:1=mfunding.net. **Owner steps (credential — Claude can't do):** admin.google.com create/confirm the
      mailbox → enable 2-Step Verification → generate App Password ("HotProspector") → paste into HP's SMTP Password.
      Claude will fill all non-secret HP fields once the owner has the app password. OPEN: confirm the mailbox
      exists in admin.google.com → Directory → Users (domain is Workspace; specific mailbox unverified).
- [ ] **Reduce Contact-vs-Owner field duplication / clarify what's required.** The HP Edit Contact modal shows a
      "Contact" tab (HP/GHL STANDARD fields: First/Last Name, Company, Email, Mobile) AND an "Owner" tab (the
      APPLICATION custom fields: Owner Full Name, Owner Email, Owner Cell Phone, etc.). Name/email/phone appear in
      both → confusing + double entry. Fix option: make `ghl-send-application` fall back to the standard contact
      First/Last→Owner Full Name, Email→Owner Email, Mobile→Owner Cell Phone when the owner-specific customs are
      blank, so setters only fill the standard Contact fields once. **What the APP actually reads today = the
      Business/Owner/Banking/Funding CUSTOM tabs** (the Contact tab is only used for delivery email, which the
      function already derives from Business/Owner Email).

## What's REQUIRED to send the 04B (fill these tabs)
Business: Business Name · Entity Type · EIN · Business Established Date · Industry · Business Phone · Business Email ·
Business Address · Business City State ZIP.
Owner: Owner Full Name · Owner Title · Ownership % · Owner DOB · Owner Email · Owner Cell Phone · Owner Home Address ·
Owner City State ZIP.
Banking: Bank Name (routing/account optional).
Funding Request: Amount Requested · Use of Funds · Avg Monthly Revenue.
*(SSN, DL#, DBA, website, account #/routing, financials = optional. The function 422s and refuses to send if any
REQUIRED one is blank — no raw-tag contracts.)*

## Where to press "Send Application" today
Open the contact → **Actions → "+ Add Tags" → `send-app`** (now visible after Refresh Meta). That fires the send.
For a real one-click BUTTON on the call card, build the Dialer Campaign Call-Status "Send Application" (see optional item above).

## Reference
- Function: `supabase/functions/ghl-send-application/index.ts`
- Shared: `supabase/functions/_shared/application-fields.ts`
- GHL workflow: "SETTER — Send Application" `f8525d08-3094-4c43-8a53-63486b6c05bc`
- 04B PREFILL workflow id: `afc21762-6879-4de1-89a2-82cc77479bfa`
- Webhook: `https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-send-application` (header `x-webhook-secret: <GHL_SEND_APP_SECRET>`)
- Trigger tag: `send-app`
