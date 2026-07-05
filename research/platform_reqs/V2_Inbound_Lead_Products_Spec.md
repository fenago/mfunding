# Inbound Lead Products — End-to-End Spec
### Synergy Real-Time Transfers + Cold-Email (Instantly) Responses
*Draft July 4, 2026 — plug-and-play spec so tomorrow's details drop into defined slots and we build.*

---

## 0. Guiding principle — sources feed the pipeline; they don't fork it

Every new lead product is a **new SOURCE into the existing MCA pipeline**, not a new pipeline. The downstream (Qualify → App → Docs → Submit → Fund → Renew) is identical no matter how the lead entered. What differs per source is only:

1. **How it enters** (email parse, form submit, live call)
2. **How hot it is** (urgency / speed-to-lead SLA)
3. **The intake steps** of its revenue playbook (steps 1–3); steps 4–9 are the shared `MCA_CLOSE_STEPS`.

So we differentiate by `deals.lead_source` + an urgency flag + a playbook variant — **never** a separate pipeline. This keeps analytics, the funnel, and the close engine unified.

### The "plug-in" architecture (build this first — both products use it)

A single, source-agnostic intake path, parameterized by a config row:

```
inbound_lead_sources (config table)
  ├─ key                 e.g. 'synergy_realtime', 'cold_email_reply'
  ├─ match_rule          how we recognize it (sender address / inbox / form id)
  ├─ parser_prompt       the AI extraction prompt tuned to this source's format
  ├─ lead_source_tag     written to deals.lead_source
  ├─ urgency             'realtime' | 'warm' | 'normal'  → drives alert + queue rank
  ├─ playbook_id         which revenue playbook the closer lands on
  └─ alert_routing       who gets pinged + how loud
```

**One generic `inbound-lead-intake` edge function** does the work for every source:
`detect → AI-parse → dedup → create customer + deal → GHL sync → alert + queue`.
Adding a new source = **insert one config row + drop in the parser prompt**. That's the "plug it in tomorrow" design.

Shared detection = **webhook (instant) + poller (reliable fallback)**, because the GHL workflow builder has fought us before and for a hot lead we won't let the trigger depend on a flaky UI step.

---

## PRODUCT 1 — Synergy Real-Time Transfer 🔴

**What it is:** Synergy qualifies a merchant on the phone, then the instant they hang up, Synergy **emails the lead to us** for an immediate call-back. The merchant is expecting the phone to ring in the next 60 seconds. **Speed-to-lead IS the product** — call in 45 seconds and it closes like a live transfer; sit for 10 minutes and it's a cold web lead.

### Flow
```
Synergy email lands
  → inbound-lead-intake (source=synergy_realtime)
  → AI parses the lead → structured fields
  → dedup (by phone/email) → create Customer + Deal (status 'new', lead_source 'synergy_realtime', urgency 'realtime')
  → GHL sync (contact into CRM)
  → 🔴 INSTANT ALERT to the on-floor closer / round-robin
  → deal auto-pinned to TOP of My Day with a ticking speed-to-lead countdown
```

### Detection (both, layered)
- **Primary (instant):** GHL workflow "email received from `<Synergy sender>`" → webhook → intake fn.
- **Fallback (reliable):** a **1-minute poller** scanning the monitored inbox for new Synergy emails (same pattern as `poll-funder-replies`). Zero GHL config; survives a broken workflow.

### Parse
Reuse the reply-intelligence AI-extraction pattern (`callLLM`). Extract → business name, owner name, **phone** (critical), email, monthly revenue, time in business, industry, amount requested, state, anything Synergy pre-qualified. Parser prompt tuned to Synergy's exact email format once we see a sample.

### Revenue playbook — **"Synergy Real-Time"** (dedicated intake, shared close)
- **Step 1 — CALL NOW:** not "contact within 5 min" — *"This lead landed 40 seconds ago. Call {{phone}} immediately while they're warm."* Live countdown; the whole screen says GO.
- **Step 2 — Verify, don't re-interrogate:** *"Synergy already confirmed: {{revenue}}/mo, {{tib}}, needs {{amount}}. Confirm these, don't re-run full BANT-F."*
- **Step 3 — Straight to application.**
- **Steps 4–9:** the shared `MCA_CLOSE_STEPS` (unchanged).

### Metrics
Track **time-to-first-call** on these specifically. It's the KPI that separates a $-live-transfer close rate from a wasted lead. Surface it so you can see if the floor is hitting the SLA.

### 🔌 Plug-in inputs needed tomorrow
1. **Synergy real-time sender email address** (the match key).
2. **One sample real-time-transfer email** (labeled fields vs. prose → decides the parser).

---

## PRODUCT 2 — Cold-Email (Instantly) Responses 📧

**What it is:** warmed Instantly mailboxes (getmfunding.com, tryMFunding.com) run cold outbound campaigns. Interested prospects respond. Responses arrive via the **Instantly unified inbox, integrated to VibeReach/GHL.** This is a **separate, cooler path** from real-time transfers — the prospect replied to an *email*, they're not on the phone, they raised a hand not a flare.

### Two response sub-paths (support both)
- **2A — Email reply:** prospect replies "yes, tell me more" → lands in the Instantly/VibeReach unified inbox → we detect the interested reply → create Contact + Deal.
- **2B — Landing page:** the campaign CTA points to a landing page (apply.mfunding.com or a GHL page) → prospect fills the form → form submit creates Contact + Deal (identical to the existing web-form path).

### Flow (2A, email reply)
```
Cold campaign reply lands in Instantly/VibeReach inbox
  → detect + AI-classify intent (interested / not interested / OOO / unsubscribe / question)
  → ONLY 'interested' or 'question' create a lead
  → inbound-lead-intake (source=cold_email_reply)
  → create Customer + Deal (status 'new', lead_source 'cold_email', urgency 'warm', tag = campaign)
  → GHL sync → alert closer (warm, not 60-sec-hot) → normal My Day new-lead rank
  → auto STOP the Instantly sequence for that prospect (they replied — don't keep cold-mailing them)
```

### Detection
Depends on how Instantly responses reach us — **the key open question for tomorrow:**
- If responses flow into **GHL/VibeReach Conversations** (via the integration), we reuse the funder-reply detection pattern (webhook + poller on inbound email).
- If they stay in **Instantly's unified inbox only**, we poll the **Instantly API** for replies per campaign.
Either way the intent-classification + intake is the same; only the source pull differs.

### Intent classification (don't create junk leads)
AI-classify each reply: `interested`, `question`, `not_interested`, `out_of_office`, `unsubscribe`. Only `interested`/`question` become deals. `unsubscribe` → suppress + honor opt-out (compliance). This prevents the pipeline filling with "not interested / remove me."

### Revenue playbook — **"Cold Email Response"** (warm re-engage intake, shared close)
- **Step 1 — Re-engage the interest:** *"{{name}} replied to the {{campaign}} email. Reference what they responded to; book the call / call now."* Warm, not frantic.
- **Step 2 — Qualify:** they're unqualified vs Synergy's pre-qual, so run BANT-F here (revenue, TIB, amount, use of funds).
- **Step 3 — Application.**
- **Steps 4–9:** shared `MCA_CLOSE_STEPS`.

### Landing page (2B) — if you go that route
A dedicated landing page per campaign (or one with a campaign param) → form → `funding_applications` → same intake as the web form, tagged `lead_source='cold_email_landing'` + campaign. Reuses everything that already exists for `/apply`.

### 🔌 Plug-in inputs needed tomorrow
1. **How Instantly responses reach us** — into GHL/VibeReach Conversations, or Instantly API only?
2. **A sample interested reply** (to tune intent classification + extraction).
3. **The campaign/offer** the email pitched (so the playbook can reference it).
4. **Email-reply, landing page, or both?**

---

## Cross-cutting: keep the two paths SEPARATE (your explicit requirement)

| | **Real-Time Transfer** | **Cold-Email Response** |
|---|---|---|
| Temperature | 🔴 Live-transfer hot | 📧 Warm |
| `lead_source` | `synergy_realtime` | `cold_email` / `cold_email_landing` |
| Urgency | `realtime` — top of queue + countdown | `warm` — normal new-lead rank |
| Alert | Instant, loud, "CALL NOW" | Prompt, not frantic |
| Playbook | "Synergy Real-Time" (verify pre-qual) | "Cold Email Response" (qualify fresh) |
| Pre-qualified? | Yes, by Synergy | No — cold prospect |
| Same pipeline / close steps | ✅ | ✅ |

Separate sources, separate playbook intakes, separate urgency — **one pipeline, one close engine underneath.**

---

## Data-model additions (build)
- Extend `deals.lead_source` vocabulary: `synergy_realtime`, `cold_email`, `cold_email_landing`.
- `deals.lead_urgency` (`realtime` | `warm` | `normal`) + optional `first_call_due_at` for the SLA/countdown.
- `inbound_lead_sources` config table (the plug-in point above).
- `lead_intake_log` (audit: raw email, parsed fields, source, created deal) — so a misparse is debuggable, never silent.
- Dedup helper (match incoming by phone/email to avoid duplicate contacts — the Peter-Piper problem).

## My Day queue additions
- New top rank **"🔴 Real-time lead — CALL NOW (0:47)"** with a live countdown, above "Funder replied."
- Cold-email leads slot at the normal "🆕 Untouched lead" rank.

## Build sequence (tomorrow, once inputs arrive)
1. `inbound_lead_sources` config + generic `inbound-lead-intake` fn skeleton + `lead_intake_log` + dedup.
2. **Plug in Synergy real-time** (address + parser from the sample) → live-test end to end.
3. Urgency flag + My Day top-of-queue + countdown + time-to-first-call metric.
4. "Synergy Real-Time" playbook.
5. **Cold-email path:** Instantly/VibeReach response detection + intent classification → intake → "Cold Email Response" playbook (+ auto-stop the Instantly sequence on reply).
6. Landing-page path (if chosen).
7. GHL webhook instant-triggers layered on top of the pollers.

## What I need tomorrow (the whole plug-in list)
- **Synergy:** real-time sender email address + 1 sample email.
- **Cold email:** how Instantly responses reach us (GHL/VibeReach vs Instantly API) + a sample interested reply + the campaign/offer + reply-vs-landing-page decision.

Everything else is specced. When these land, it's insert-config + drop-in-parser, not design-from-scratch.
