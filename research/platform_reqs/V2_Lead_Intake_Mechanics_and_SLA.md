# Lead Intake Mechanics & Timing — Pre-Build Deep-Dive
### Exactly how each lead enters, how it's routed to the RIGHT place, and the clock on every step
*Draft July 4, 2026. Companion to V2_Lead_Acquisition_Master_Spec.md. Read this before building the shared core + importer.*

---

## A. The non-negotiable: every lead lands in the RIGHT place

Before any mechanics, the routing rules — because a lead in the wrong pipeline, or 250,000 cold records flooding the active board, is the failure mode we're preventing.

### A.1 — Two destinations, and the rule that decides

There are **two places a new lead can land**, and picking wrong is the whole risk:

| Destination | What lands here | Why |
|---|---|---|
| **🅐 Nurture Pool** (customers only, **no active deal**) | Cold Bulk (Aged / UCC / Trigger) | Identity-only, unqualified, high volume. If these created pipeline deals, 250k cold records would bury the working board and destroy every velocity/conversion metric. They sit as `customers` (status `lead`) in a dialer/nurture segment. **A deal is created only when a dialer reaches + qualifies them** — that's the promotion into the pipeline. |
| **🅑 Active MCA Pipeline** (customer **+** deal at stage `New`) | Everything warm+ : Web, Aged Transfer, Real-Time, Live Transfer, Cold-Email responder | Already qualified or hand-raised → they belong on the working board immediately, ranked by temperature. |

**This split is the single most important intake decision.** Cold data is fuel for the dialer, not entries on the pipeline. Warm+ leads are real deals. The importer must enforce it: `qual_richness = identity_only` → Pool; anything else → Pipeline.

### A.2 — Which pipeline (MCA vs VCF)

- **Default every Synergy-sourced lead to `deal_type = 'mca'`** → the **MCA GHL pipeline** (`bG9ZEh4eP9x60E1CyaMx`). Never the VCF pipeline at intake.
- **Re-route to VCF is a *qualification-step* decision, never an intake one.** If, on the call, the merchant turns out to be distressed/over-leveraged and wants *relief* not more capital (heavy existing positions, seeking to reduce payments), the closer re-routes the deal to `deal_type='vcf'` → VCF pipeline (`nsmH6jIeVA0SsZMMq4LC`). Intake never guesses this; a human decides it once they understand the merchant.
- **Why not auto-detect at intake?** Because "existing loan balances" in the lead data doesn't mean distress — a healthy merchant renewing has balances too. Auto-routing to VCF on a data field would mis-file good MCA deals. Default MCA, let the closer re-route.

### A.3 — The five guardrails (how a lead can't end up wrong)

1. **Pool-vs-Pipeline gate** (A.1) — cold never floods the board.
2. **deal_type default + human re-route** (A.2) — no auto-VCF.
3. **Dedup on entry** — every incoming record is matched by **phone + email** against existing `customers`. A hit → **merge** (add the new `lead_source` attribution to the existing contact), do **not** create a second contact. If the existing deal is open, the lead is a *touch* on it, not a new deal; if the prior deal is closed/lost, a fresh deal is created for the re-approach. (Prevents the same merchant existing 3× from a UCC list, a web buy, and a cold-email reply.)
4. **Source + batch stamping** — every record carries `lead_source`, `temperature`, and `import_batch_id`. Nothing is ever "unsourced" — cost-per-funded-deal stays traceable to the dollar.
5. **Parse-fail quarantine** — a real-time email or CSV row that won't parse is **quarantined and a human is alerted**, never silently dropped. A $20 real-time lead lost to a parse error is a lost deal; it must surface loudly.

---

## B. Entry mechanics per path — the actual plumbing

For each path: **physical entry point → detection/ingestion → parse → dedup → create → route → alert.**

### 🧊 Path 1 — Cold Bulk (Aged / UCC / Trigger) → **CSV import → Nurture Pool**
```
Synergy delivers a CSV (email attachment or portal download)
  → a VA opens Admin → Lead Import, drag-drops the file
  → client parses headers → COLUMN-MAP UI (CSV col → company/contact/phone/email);
      the map is SAVED per source as a template (Synergy's format is stable → one-click next time)
  → picks source (aged | ucc | trigger), optional campaign/owner
  → PREVIEW: "12,000 rows · 480 dupes (merge) · 210 invalid (quarantine) · 11,310 new"
  → confirm → server fn `bulk-lead-import`:
        normalize phone/email · DNC/TCPA screen · dedup vs customers
      → INSERT customers (status 'lead', lead_source, temperature 'cold',
        tags=['nurture', source], lead_qual = raw columns)
      → NO deal (Nurture Pool) · write lead_import_batches row
  → lands in the DIALER / nurture segment (not the board)
```
**Promotion to pipeline:** when a dialer/agent connects and the merchant qualifies → "Promote" → creates the `deal` (status `New`, temperature upgrades to warm) in the MCA pipeline. That's the moment a cold record becomes a deal.

### 🌤️ Path 2 — Web Leads (purchased) → **CSV import → Active Pipeline**
```
Synergy CSV (or future API drip)
  → same Lead Import page, source = web_purchased
  → COLUMN-MAP includes revenue / TIB / FICO / funding request / existing loan / lead_date
  → dedup → INSERT customer + DEAL (status 'New', temperature 'warm',
      lead_qual = full, lead_age_days computed from lead_date)
  → enters MCA pipeline at New, auto-sorted FRESH-FIRST (a 1-day lead ≫ a 30-day lead)
```

### ☀️ Path 3 — Aged Live Transfers (purchased) → **CSV import → Active Pipeline**
```
Synergy CSV (30–120 day-old qualified transfers)
  → Lead Import, source = aged_transfer
  → map full prior qualification + qualified_date
  → dedup → customer + DEAL (status 'New', temperature 'warmer', lead_qual=full+qualified_date)
  → pipeline at New, "re-warm" queue
```
*Paths 1–3 all ride the SAME importer — one build, three source templates.*

### B.0 — ONE detection point for all inbound email (CONFIRMED)

Ernesto confirmed: **real-time leads, cold-email replies, and live-transfer emails ALL arrive at `sales@send.mfunding.net` → our main GHL/VibeReach Conversations.** That collapses detection to a **single door**:

```
Inbound email to sales@send.mfunding.net
  → GHL/VibeReach fires an inbound-message webhook → our ghl-webhook fn (already exists)
      (fallback: 1-min poll of GHL Conversations API — survives a dropped webhook)
  → LEAD ROUTER classifies by SENDER (+ In-Reply-To for replies):
       • from Synergy REAL-TIME sender      → Path 4 (hot) — parse, create hot deal, countdown
       • from Synergy LIVE-TRANSFER sender  → Path 5 (match to a live call — see below)
       • reply to one of OUR cold campaigns → Path 6 (intent-classify)
       • anything else                      → normal Conversations (NOT a lead — leave it)
  → Message-ID idempotency so webhook + poll can't double-create
```

So we **extend the existing `ghl-webhook`** with a lead-router rather than standing up separate inboxes/pollers. The **sender address is the disambiguation key** — which is why the two Synergy sender addresses (real-time vs live-transfer) are the critical missing inputs. Emails that don't match a lead sender are ignored and stay in the normal inbox.

### 🔥 Path 4 — Real-Time / Appointment → **email to sales@ → router → Active Pipeline, hot**
```
Synergy emails one lead → sales@send.mfunding.net → ghl-webhook → router (real-time sender)
  → inbound-lead-intake: AI-parse the email body → structured fields
  → dedup → customer + DEAL (status 'New', temperature 'hot', lead_qual=full,
      first_call_due_at = now + 60s)
  → GHL sync → 🔴 INSTANT alert to on-floor closer (round-robin) + PIN to top of My Day + COUNTDOWN
```
🔌 Needs: the **real-time sender address** + one sample email (sets the parser).

### 🔥🔥 Path 5 — Live Transfer → **live phone (primary) + email (async, may arrive after) → Active Pipeline, hottest**

The real design problem you flagged: **Synergy calls `954-737-5692` AND emails at the same time, but the email may arrive *after the call ends*.** So neither can be assumed first — we handle the race both ways.

```
ENTRY A — the CALL (primary): Synergy warm-transfers the merchant to 954-737-5692
  → closer hits "Live transfer in" → quick-capture spins up customer + DEAL
     (status 'New', temperature 'hottest') WHILE TALKING — does NOT wait for the email

ENTRY B — the EMAIL (async qual data): arrives at sales@ before, during, or after the call
  → router (live-transfer sender) → MATCH to a live-transfer deal by
       merchant PHONE (extracted from email)  +  time window (±15 min)
     ├─ MATCH found  → ENRICH that deal's lead_qual with the emailed data (no duplicate)
     └─ NO match yet → create the deal from the email (temperature 'hottest') AND
                        alert the floor: "Live-transfer email — did you take this call?"
  → the closer's later quick-capture also dedupes by phone → folds into the same deal
```

**Why this works regardless of order:** whoever lands first (call-capture or email) creates the deal; whoever lands second **matches by merchant phone + time window and enriches** instead of duplicating. The closer never waits on the email to start talking, and the qual data attaches itself whenever it shows up. SLA is still **answer speed** (< 3 rings) — the email is a bonus that fills in `lead_qual`, never a blocker.

🔌 Needs: the **live-transfer sender address**, and confirmation the merchant's **phone number is in the email body** (that's the match key).

### ❄️ Path 6 — Cold Email (our Instantly outbound) → **reply to sales@ → router → Active Pipeline, cool**
```
Prospect replies to a campaign → lands at sales@send.mfunding.net (our VibeReach inbox)
  → ghl-webhook → router (recognized as a reply to one of our campaigns)
  → inbound-lead-intake + AI INTENT-CLASSIFY
       interested/question → create customer + DEAL (temperature 'cool', campaign tag)
       not_interested/OOO  → ignore ·  unsubscribe → suppress (compliance)
  → AUTO-STOP the Instantly sequence for that prospect (Instantly API)
6B landing: campaign CTA → landing page form → funding_applications → same web-form intake
```
🔌 Needs: a sample reply + campaign offer (so the router recognizes campaign replies and the intake references the offer). *Confirmed: replies land in the main VibeReach inbox, not a separate Instantly-only inbox — so the same router handles them.*

---

## C. Steps 1–3 (intake) per path, WITH a clock on each step

Steps 4–9 are the shared close. Here are the unique intakes with timing:

| Path | Step 1 (clock) | Step 2 (clock) | Step 3 (clock) |
|---|---|---|---|
| 🧊 **Cold Bulk** | First dial **within 24–48h** of import; then multi-touch cadence (Seq B/F) over **14 days** | On connect: pitch by sub-type + qualify from zero — **same call** | Application **within 24h** of a positive qualify |
| ❄️ **Cold Email** | First contact **< 15 min** of the reply (they're at their desk) | Qualify fresh — **same call/thread** | App **< 24h** |
| 🌤️ **Web Lead** | First contact **< 5 min** (fresh 1–7d) / **< 1h** (8–30d) | Verify their submitted data — **same call** | App **same call**, hard **< 24h** |
| ☀️ **Aged Transfer** | First contact **< 30 min**, same day | Re-confirm qual (may have changed in 1–4 mo) — **same call** | App **same call / < 24h** |
| 🔥 **Real-Time** | **CALL < 60 sec** (hard countdown) | Verify Synergy pre-qual — **same call** | App **same call** |
| 🔥🔥 **Live Transfer** | **Answer < 3 rings (~15s)** | Full qual live — **on the call** | App **on the same call** |

## D. The master SLA table — a time boundary at EVERY step

| Step | 🔥🔥 Live | 🔥 Real-Time | ☀️ Aged Xfer | 🌤️ Web (fresh) | ❄️ Cold Email | 🧊 Cold Bulk |
|---|---|---|---|---|---|---|
| **Ingestion latency** (Synergy → workable in system) | instant (call) | **< 30s** (webhook) / <60s poll | minutes (import) | minutes (import) | < 2 min | minutes (import) |
| **Speed to 1st contact** | < 15s (answer) | **< 60s** ⏱ | < 30 min | < 5 min | < 15 min | 24–48h (1st dial) |
| **No-answer cadence** | n/a (live) | redial **now → +2m → +5m → +15m → +1h**, then Seq B | Seq B (7-day) | Seq B (7-day) | email thread + Seq B | Seq B/F over 14 days |
| **Contacted → Qualified** | same call | same call | same call | same call | same call/thread | same call |
| **Qualified → App sent** | same call | same call | < 24h | same call / < 24h | < 24h | < 24h |
| **App → Docs collected** | Plaid **60s**; else Seq A (14-day chase) — identical for all paths | ← | ← | ← | ← | ← |
| **Docs → Submitted to funders** | **same day** (< 4h once docs complete) — all paths | ← | ← | ← | ← | ← |
| **Submitted → Offer** | funder-driven; **chase at 24h & 48h** (Step 7 board) — all paths | ← | ← | ← | ← | ← |
| **Offer → Presented** | < 2h of receipt — all paths | ← | ← | ← | ← | ← |
| **Presented → Funded** | contract same day; fund 24–72h — all paths | ← | ← | ← | ← | ← |

Reading it: the **paths diverge only at the top** (ingestion + speed-to-contact + cadence — that's the temperature). Once a lead is *contacted and qualified*, **every path runs the identical downstream clock**, because it's the same close engine.

## E. What happens when a clock is missed (SLAs need teeth)

An SLA with no consequence is a wish. Escalation rules:

- **🔥 Real-time `first_call_due_at` passes uncalled** → the countdown turns red, the lead **re-alerts + re-assigns** to the next closer in the round-robin, and (if still untouched at +5 min) pings the sales manager. A $20 hot lead cannot silently rot.
- **🌤️/☀️ warm lead not contacted same day** → drops to a "⚠️ aging — contact today" band in My Day; overnight, unworked warm leads surface on the manager's dashboard.
- **🧊 Cold bulk not dialed within 48h of import** → the batch flags "un-worked" so we don't pay $0.02×12,000 and let it sit.
- **Docs stalled** → Sequence A already handles this (14-day chase + breakup).
- **Every breach is logged** → so "speed-to-lead" and "time-to-first-call" become real, reportable metrics per source — which is also how we learn which Synergy product actually converts for the price.

## F. Decisions — CONFIRMED vs still-open

**✅ CONFIRMED by Ernesto:**
1. **Nurture Pool = contacts, no deal until qualified.** Cold bulk lands as `customers` (status `lead`) in a tagged/dialer segment; the deal is created at qualification (promotion). Board stays clean.
2. **All inbound lead email → `sales@send.mfunding.net` → main GHL/VibeReach Conversations.** Detection = extend `ghl-webhook` with a lead-router (+ GHL Conversations poll fallback). One door, classified by sender.
3. **Live transfer → call `954-737-5692` (GHL number)** + a simultaneous email that **may arrive after the call**. Handled by the call-first / email-enrich race design in Path 5 (match by merchant phone + ±15-min window).

**⛳ Still open (needed to build/enable each path):**
1. **The two Synergy sender addresses** — the **real-time** sender and the **live-transfer** sender. These are the router's disambiguation keys; without them the router can't tell a hot appointment from a live-transfer email. (Plus one sample email of each → sets the parser + confirms the merchant phone is in the live-transfer email body for matching.)
2. **Cold-email recognition:** a sample campaign reply so the router reliably tags "this is a reply to one of our campaigns" (vs. via In-Reply-To/campaign thread) + the campaign offer.
3. **Dialer for the Nurture Pool:** in-house, or Synergy's **Telemarketing Agents ($12/hr)**? Decides whether the pool feeds our My Day dialer view or an external export.
4. **Who imports:** which role runs the CSV uploads (VA? admin?) — sets permissions on the Lead Import page.
5. **Bulk CSV samples** (one per type: aged/ucc/trigger/web/aged-transfer) — so the importer's column-map is right first try.

**I can start building now:** the shared core (config + `lead_qual`/`temperature` columns + `lead_intake_log` + dedup), the **Nurture Pool + bulk importer** (Paths 1–3), and the **`ghl-webhook` lead-router skeleton** — none of those are blocked. Only the live *activation* of Paths 4–6 waits on the two Synergy sender addresses + the cold-email sample. Retrofitting is avoided because routing + SLAs are designed in from the first commit.
