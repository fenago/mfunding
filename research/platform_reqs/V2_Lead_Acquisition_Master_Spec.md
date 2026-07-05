# Lead Acquisition Master Spec — Every Source, One Pipeline
### Synergy Direct Solution lead menu + our cold-email engine, mapped end-to-end
*Draft July 4, 2026. Supersedes V2_Inbound_Lead_Products_Spec.md (folded in below). Build straight from this.*

---

## 0. The one idea this whole thing rests on: **the Temperature Ladder**

Every lead source we buy or run is the **same MCA pipeline** and the **same close engine** (steps 4–9, `MCA_CLOSE_STEPS`). They differ on only three axes:

1. **How it enters** — bulk file, real-time email, live phone, form, email reply.
2. **How much we already know** — a cold record is a name + phone; a real-time lead arrives with revenue/FICO/funding request.
3. **How fast we must move** — a live transfer is "you're on the phone NOW"; an aged record is "dial this week."

So we **never fork the pipeline.** We tag `lead_source`, set a `temperature`, attach whatever qualification data arrived, and route the closer into the right **playbook intake** (steps 1–3). Everything downstream is identical. This keeps the funnel, the analytics, and the close engine unified while every source gets a tailored front door.

### The ladder (coldest → hottest)

| Temp | Path | Synergy product(s) | Enters as | Qual data on arrival | Speed | Playbook intake |
|---|---|---|---|---|---|---|
| 🧊 Cold | **Cold Bulk Data** | Aged · UCC · Trigger | Bulk CSV import (thousands) | Name, phone, email only | Nurture / dial this week | Cold outreach — qualify from zero |
| ❄️ Cool | **Cold Email** (ours) | *(our Instantly outbound)* | Email reply / landing page | Prospect raised a hand | Same day | Re-engage, qualify fresh |
| 🌤️ Warm | **Web Leads** | Web Leads (purchased) | Batch/drip import | Revenue, TIB, FICO, funding req | Same-day, fast | Verify their form, straight to app |
| ☀️ Warmer | **Aged Live Transfers** | Aged Live Transfers | Batch import | Full qual, but 30–120 days old | Fast re-warm | "You spoke with us before" |
| 🔥 Hot | **Real-Time / Appointment** | Real-Time / Appointment | Real-time email → parse | Full qual, fresh | **Call in <60s** (countdown) | Call NOW, verify pre-qual |
| 🔥🔥 Hottest | **Live Transfer** | Live Transfers / Live Call | Live phone transfer | Full qual, on the phone | Already talking | Take the call, close |

Six paths, one pipeline. The rest of this doc specs each one and the shared machinery.

---

## 1. Shared architecture — build this once, every path uses it

```
inbound_lead_sources (config — one row per source)
  ├─ key              'aged' | 'ucc' | 'trigger' | 'web_purchased' | 'aged_transfer'
  │                   | 'realtime_appt' | 'live_transfer' | 'cold_email' | 'cold_email_landing'
  ├─ feed_type        'bulk_csv' | 'realtime_email' | 'email_reply' | 'web_form' | 'live_manual'
  ├─ temperature      'cold' | 'cool' | 'warm' | 'warmer' | 'hot' | 'hottest'
  ├─ qual_richness    'identity_only' | 'partial' | 'full'   (what arrives with the lead)
  ├─ parser_prompt    AI extraction prompt tuned to that source's format (for email/CSV mapping)
  ├─ playbook_id      which revenue playbook the closer lands on
  ├─ default_status   pipeline stage on creation (usually 'new'; cold bulk → 'new' + nurture)
  ├─ urgency_alert    how loud + who (round-robin, floor, nurture queue)
  └─ unit_cost        per-lead cost → feeds cost-per-funded-deal ROI
```

Two feed mechanisms do all the work:

- **`inbound-lead-intake` edge function** (real-time/email/reply/form): `detect → AI-parse → dedup → create customer + deal + qual snapshot → GHL sync → alert + queue`. Adding an email/form source = insert a config row + drop in the parser prompt.
- **Bulk lead importer** (CSV): upload → column-map (remembered per source) → dedup → batch-create customers + deals with the source's tag/temperature/qual data → drop into nurture or the dialer list. Records every batch in `lead_import_batches`.

Shared services both use: **dedup** (match incoming by phone/email → update existing contact instead of duplicating — critical when the same merchant shows up as a UCC record *and* later a web lead), **`lead_intake_log`** (raw input + parsed fields + created deal, so a misparse is never silent), and the **qual snapshot** (`deals.lead_qual` jsonb — everything the source already told us, shown to the closer as "what we know").

---

## 2. The Paths

### 🧊 Path 1 — Cold Bulk Data = Aged + UCC + Trigger (ONE path)

Per your call: **these three are one path.** Same feed (bulk CSV), same coldness (identity only — name, company, phone, email), same process (import → cold outreach → qualify from scratch). We keep three `lead_source` tags for cost/ROI attribution (they convert differently), but **one playbook and one path** — no forking.

| | Aged | UCC | Trigger |
|---|---|---|---|
| Synergy price | $0.05 → $0.01/record | $0.05 → $0.01 | $0.05 → $0.01 |
| Who they are | General TCPA-scrubbed business data | Owners who **took a prior advance** | Businesses whose **credit was just pulled** |
| Intent signal | None (cold) | Renewal/stack candidate | **Actively shopping RIGHT NOW** |
| Data | Company, contact, phone, validated email | + additional business data | + additional business data |

- **Feed:** bulk CSV import. TCPA-scrubbed by Synergy, but we still run our own DNC/consent check before dialing/SMS.
- **Creation:** customer + deal (`status='new'`, `temperature='cold'`, `lead_source` = aged/ucc/trigger, `lead_qual` = whatever columns came).
- **Routing:** into the **nurture + dialer** queue (this is dial-through-a-list work, not a hot alert). Trigger leads get **priority within the queue** — credit-just-pulled = highest intent of the three — but it's the *same* path, just sorted to the top.
- **Playbook — "Cold Outreach":** (1) dial / SMS / email attempt (multi-touch cadence, follow-up sequences B/F from the CRM); (2) if reached, pitch by sub-type — Aged: cold open; **UCC**: *"you've used an advance before — ready for more capital?"*; **Trigger**: *"noticed you're shopping for financing — let's get you funded"*; (3) qualify from scratch (Synergy min quals as the bar), then application → shared close.
- **⚠️ Compliance flags:** **Trigger leads carry FCRA obligations** — using credit-inquiry data to solicit generally requires a *firm offer of credit*; legal must confirm our trigger-lead usage is compliant before we run them. All three: TCPA/DNC on calls + SMS, and MCA-not-a-loan language (UCC "prior advance," not "prior loan").

### 🌤️ Path 2 — Web Leads (purchased from Synergy)

- **What:** form-generated leads Synergy sells, $1–$3 by age (1–7d $3, 8–14d $2, 15–30d $1). Arrive **with full self-reported qual: revenue, TIB, FICO, funding request, existing loan info.** Bonus lead offers on spend ($1k→10%, $2k→20%, $3k→25%).
- **Feed:** batch/drip CSV import (or a feed if Synergy offers one).
- **Creation:** customer + deal (`temperature='warm'`, `lead_source='web_purchased'`, `lead_qual` = revenue/TIB/FICO/funding request/existing loan). **Age matters** — a 1-day web lead is far warmer than a 30-day one; store `lead_age_days` and sort fresh-first.
- **Routing:** same-day contact queue, fresh-first. Not a 60-second alert, but *fast* — these decay.
- **Playbook — "Web Lead":** (1) fast first contact (they filled a form, expect a call); (2) **verify the data they gave** (revenue/TIB/FICO/funding request) rather than re-collect; (3) application → shared close.

### ☀️ Path 3 — Aged Live Transfers (purchased)

- **What:** "all qualification details from previous live-transfer campaigns, without the live call." $3–$5 by age (30–59d $5, 60–89d $4, 90–120d $3). **Fully qualified once — but 1–4 months ago.**
- **Feed:** batch CSV import.
- **Creation:** customer + deal (`temperature='warmer'`, `lead_source='aged_transfer'`, `lead_qual` = full prior qualification + `qualified_date`).
- **Routing:** fast re-warm queue.
- **Playbook — "Aged Live Transfer":** (1) re-engage — *"you spoke with us about funding ~{{age}} back; still looking?"*; (2) **re-confirm the qual** (revenue/positions may have changed in 1–4 months — this is the key risk with aged); (3) application → shared close.

### 🔥 Path 4 — Real-Time / Appointment Leads (already specced)

- **What:** pre-qualified merchant delivered in real time, $10–$20 (100+ → $10). Arrives with contact, funding request, revenue, FICO, existing loan balances, business info. **The merchant just hung up with Synergy and expects your call now.**
- **Feed:** **real-time email → `inbound-lead-intake` parse** (+ 1-min poller fallback + GHL webhook for instant). Speed-to-lead IS the product.
- **Creation:** customer + deal (`temperature='hot'`, `lead_source='realtime_appt'`, full `lead_qual`), **instant loud alert to the on-floor closer, pinned to the TOP of My Day with a live countdown.**
- **Playbook — "Real-Time / Appointment":** (1) **CALL NOW** — countdown, whole screen says GO; (2) verify Synergy's pre-qual (don't re-interrogate); (3) straight to application → shared close.
- **Metric:** track **time-to-first-call** — it's the KPI that separates a live-transfer close rate from a wasted $20 lead.
- 🔌 **Needs:** Synergy real-time sender email address + one sample email (decides the parser).

### 🔥🔥 Path 5 — Live Transfers / Live Call Leads (purchased)

- **What:** Synergy qualifies live and **transfers the phone call directly to us**, $20–$40 (200+ → $20). Full qual + real-time phone transfer + custom call scheduling. The hottest lead there is — the merchant is literally on the line.
- **Feed:** **live phone** (LeadConnector/GHL phone), not an automated data feed. The *call* is the intake. A lightweight capture screen lets the closer spin up the contact+deal in seconds while talking, pre-filled from Synergy's transfer data if they send it alongside.
- **Creation:** customer + deal (`temperature='hottest'`, `lead_source='live_transfer'`), created at pickup.
- **Playbook — "Live Transfer":** (1) take the call, warm open; (2) full qual live on the call; (3) application on the same call → shared close. This is the existing live-transfer playbook — already in the revenue playbook; this spec just formalizes it as one rung of the ladder.

### ❄️ Path 6 — Cold Email (our Instantly outbound) — kept separate

*(Folded from the prior spec — this is OUR outbound, not a Synergy product, and must stay separate from real-time transfers.)*

- **What:** warmed Instantly mailboxes run cold campaigns; interested prospects reply (into the Instantly/VibeReach unified inbox) or click to a landing page.
- **Feed:** email reply (AI intent-classify — only `interested`/`question` become leads; `unsubscribe` → suppress) **or** landing-page form (reuses the web-form intake).
- **Creation:** customer + deal (`temperature='cool'`, `lead_source='cold_email'`/`cold_email_landing'`, campaign tag). **Auto-stop the Instantly sequence on reply.**
- **Playbook — "Cold Email Response":** (1) re-engage the interest they showed; (2) qualify fresh (cold prospect, not pre-qualified); (3) application → shared close.
- 🔌 **Needs:** how Instantly responses reach us (GHL/VibeReach Conversations vs Instantly API), a sample reply, the campaign offer, reply-vs-landing decision.

---

## 3. Revenue Playbooks — six intakes, one close

All six share **`MCA_CLOSE_STEPS` (steps 4–9):** Application → Docs (with the funder-availability checklist + doc checklist) → Submit to funders (with the qualification gate + AI recs + business summary) → Offer → Fund → Renew. Only the **intake (steps 1–3)** differs:

| Playbook | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| Cold Outreach | Dial/SMS/email cadence | Pitch by sub-type + qualify from zero | App |
| Cold Email Response | Re-engage the reply | Qualify fresh | App |
| Web Lead | Fast first contact | Verify their submitted data | App |
| Aged Live Transfer | "You spoke with us ~{{age}} ago" | Re-confirm qual (may have changed) | App |
| Real-Time / Appt | **CALL NOW (countdown)** | Verify Synergy pre-qual | App |
| Live Transfer | Take the live call | Full qual on the call | App |

The playbook selector keys off `deal.lead_source` → the closer always lands on the right intake for how that lead arrived, then flows into the identical close.

---

## 4. Data model additions

- **`deals.lead_source`** vocabulary: `aged`, `ucc`, `trigger`, `web_purchased`, `aged_transfer`, `realtime_appt`, `live_transfer`, `cold_email`, `cold_email_landing` (+ existing web-form/organic).
- **`deals.temperature`** (`cold`|`cool`|`warm`|`warmer`|`hot`|`hottest`) → drives My Day rank + alert loudness.
- **`deals.lead_qual`** jsonb — the qualification data that arrived with the lead (revenue, TIB, FICO, funding request, existing positions, `qualified_date`, `lead_age_days`). Shown to the closer as "what we already know," and pre-fills the application.
- **`deals.first_call_due_at`** — SLA clock for hot/hottest (the countdown).
- **`inbound_lead_sources`** config table (§1).
- **`lead_import_batches`** (file name, source, row count, imported/skipped-dupes, by, at) — bulk-import audit.
- **`lead_intake_log`** (raw input, parsed fields, source, created deal id) — per-lead audit; a misparse is debuggable, never silent.
- **Dedup helper** — match by phone/email across all sources; same merchant from two sources = one contact, both attributions.

## 5. My Day queue & routing by temperature

- 🔥🔥 **Live transfer / 🔥 real-time** → top rank, loud alert, live countdown ("CALL NOW 0:47").
- ☀️ **Aged transfer / 🌤️ web lead** → same-day contact rank, fresh-first.
- ❄️ **Cold email** → normal new-lead rank.
- 🧊 **Cold bulk (aged/ucc/trigger)** → the **nurture/dialer list**, not the alert rail; trigger sorted to the top of that list.

## 6. Build sequence

1. **Shared core:** `inbound_lead_sources` config + `lead_qual`/`temperature`/`first_call_due_at` columns + `lead_intake_log` + dedup helper.
2. **Bulk lead importer** (CSV upload → map → dedup → batch create + `lead_import_batches`). Unlocks Aged, UCC, Trigger, Web Leads, Aged Live Transfers all at once — 5 of 6 paths ride this.
3. **Cold Outreach playbook** (Path 1) + nurture/dialer routing + trigger-priority + the compliance gates (DNC, FCRA-on-trigger).
4. **Web Lead + Aged Live Transfer playbooks** (Paths 2–3) — thin variants over the importer.
5. **`inbound-lead-intake` real-time engine** + **Real-Time/Appointment** path (Path 4) — parse, hot alert, countdown, time-to-first-call. *(Needs Synergy's sender address + sample.)*
6. **Live Transfer** capture screen + playbook (Path 5).
7. **Cold Email** detection + intent classification + playbook (Path 6). *(Needs Instantly integration details.)*
8. GHL webhook instant-triggers layered over the pollers.

## 7. Open inputs (per path)

- **Real-Time/Appointment:** Synergy real-time **sender email address** + 1 sample email.
- **Cold Email:** Instantly→us mechanics (VibeReach/GHL vs API) + sample reply + campaign offer + reply/landing decision.
- **Bulk paths (Aged/UCC/Trigger/Web/Aged-Transfer):** one **sample CSV per type** from Synergy so the importer's column-map is right the first time.
- **Live Transfer:** does Synergy send the qual data alongside the call (to pre-fill), or is it phone-only?
- **Trigger leads:** legal sign-off on FCRA firm-offer-of-credit before running them.

---

## Appendix — Synergy Direct Solution, full menu (source of truth)

| Product | Price | Enters | Data included |
|---|---|---|---|
| Aged Leads | $0.05 → $0.01 bulk | CSV | company, contact, phone, validated email (TCPA-scrubbed) |
| UCC Leads | $0.05 → $0.01 bulk | CSV | company, contact, business data — prior advance takers |
| Trigger Leads | $0.05 → $0.01 bulk | CSV | company, contact, business data — credit just pulled |
| Web Leads | $1–$3 by age | CSV/feed | contact, revenue, TIB, FICO, funding request, existing loan |
| Aged Live Transfers | $3–$5 by age (30–120d) | CSV | full prior live-transfer qualification |
| Real-Time / Appointment | $10–$20 (vol) | real-time email | contact, funding req, revenue, FICO, existing balances, biz info |
| Live Transfers | $20–$40 (vol) | live phone | full qual + real-time phone transfer + scheduling |

**Synergy minimum qualifications** (most types): 500+ FICO · 6+ months in business · $15,000+/mo revenue · active business bank account · no bankruptcies/defaults/judgments · seeking funding within 30 days. *(Use as the qualification bar in the Cold Outreach + verification playbooks.)*

**Telemarketing Agents** ($12/hr, 25-hr/wk min): pre-trained agents + dialer + aged leads included + scripts + appointment setting + live transfers + email follow-up. **Not a pipeline path** — it's an outsourced-labor option to *work* the Cold Bulk path (dial the aged/UCC/trigger lists and set appointments/transfers). Worth considering as the staffing for Path 1 rather than hiring dialers in-house; revisit under the hiring plan.

**Vendor:** Synergy Direct Solution — already in the system as a lead partner (`/admin/lead-partner`).
