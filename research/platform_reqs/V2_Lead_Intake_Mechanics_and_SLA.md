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

### 🔥 Path 4 — Real-Time / Appointment → **real-time email → parse → Active Pipeline, hot**
```
Synergy emails ONE lead per email to a dedicated address (e.g. realtime@send.mfunding.net)
  → DETECTION (layered):
      (primary)  GHL/VibeReach inbound-email webhook on that sender → POST to inbound-lead-intake
      (fallback) 1-min poller scanning the inbox (survives a broken webhook)
      (idempotency) email Message-ID dedupes so webhook+poller can't double-create
  → inbound-lead-intake: AI-parse the email body → structured fields
  → dedup → customer + DEAL (status 'New', temperature 'hot', lead_qual=full,
      first_call_due_at = now + 60s)
  → GHL sync → 🔴 INSTANT alert to on-floor closer (round-robin) + PIN to top of My Day + COUNTDOWN
```
🔌 Needs: the sender address + one sample email (sets the parser).

### 🔥🔥 Path 5 — Live Transfer → **live phone → quick-capture → Active Pipeline, hottest**
```
Synergy DIALS the closer's LeadConnector number and warm-transfers the merchant
  → the answered CALL is the entry (no data feed)
  → closer hits "Live transfer in" (persistent button / hotkey) → quick-capture screen
      spins up customer + DEAL (status 'New', temperature 'hottest') in seconds WHILE TALKING
  → if Synergy sends qual data by email/SMS alongside, it pre-fills the capture screen
```
SLA is **answer speed**, not entry latency — the lead is already a phone call.

### ❄️ Path 6 — Cold Email (our Instantly outbound) → **reply/landing → Active Pipeline, cool**
```
6A reply:   prospect replies → Instantly unified inbox → (VibeReach/GHL integration)
              inbound-email webhook  OR  Instantly API poll
            → inbound-lead-intake + AI INTENT-CLASSIFY
                 interested/question → create customer + DEAL (temperature 'cool', campaign tag)
                 not_interested/OOO → ignore ·  unsubscribe → suppress (compliance)
            → AUTO-STOP the Instantly sequence for that prospect (Instantly API)
6B landing: campaign CTA → landing page form → funding_applications → same web-form intake
```
🔌 Needs: how Instantly reaches us (VibeReach/GHL vs API) + sample reply + campaign offer.

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

## F. Decisions needed before I build the core + importer

1. **Nurture Pool home:** cold bulk as `customers` (status `lead`) in a tagged segment with **no deal** until qualified — confirm that's how you want it (vs. a "Cold" pre-stage on the pipeline). *My strong rec: no deal until qualified* — keeps the board clean.
2. **Where do the real-time + cold-email emails physically land?** A dedicated Google Workspace inbox we poll, or into GHL/VibeReach Conversations we webhook off? (Changes the detection build.)
3. **Live-transfer number:** which LeadConnector/GHL number does Synergy transfer to, and do they send qual data alongside the call to pre-fill capture?
4. **Dialer:** do we work the cold bulk in-house, or take Synergy's **Telemarketing Agents ($12/hr)** to dial it? Determines whether the Nurture Pool feeds our My Day or an external dialer export.
5. **Who imports:** which role runs the CSV uploads (VA? admin?) — sets the permissions on the Lead Import page.

Once 1–3 are answered I can build the shared core + importer with the routing and SLAs wired in from the start, instead of retrofitting them.
