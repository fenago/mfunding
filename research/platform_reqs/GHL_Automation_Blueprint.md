# MFunding × GoHighLevel — One-Page Automation Blueprint
### Decision document · June 25, 2026

> **The thesis:** GoHighLevel is the **automation engine and system of action** (every customer touch, every workflow, scheduling, e-sign, intake). This React/Supabase app is the **system of record and intelligence** (financial math, underwriting, funder matching/submission, deep analytics). The two are joined by a two-way sync. Goal: a near-fully-automated brokerage where a lead can move from capture → nurture → application → underwriting hand-off → funded → renewal with minimal human touches.

---

## Division of labor (the rule of thumb)
**GHL does the talking, scheduling, signing, and intake. Our app does the math, the risk, the matching, and the truth.**

| GoHighLevel owns (configure, don't rebuild) | Our app builds (GHL can't do this) |
|---|---|
| CRM contacts + lead capture from all sources | Commission engine (splits, overrides, clawbacks) |
| **The 9-stage deal pipeline** (drag-and-drop) | Plaid bank verification + transaction analysis |
| All SMS / email / voicemail sequences (6 flows) | Internal **underwriting workbench** (scorecard, risk) |
| AI Employee (24/7 pre-qualification) | **Funder matching** engine (AI, by lender criteria) |
| Phone, local numbers, missed-call text-back | **Multi-funder deal submission** + offer tracking |
| Calendars / appointment booking | Deep analytics (cost-per-funded-deal, velocity) |
| **Documents & e-signature** (contracts) | Lender network DB + criteria matrix (source of truth) |
| **Compliance disclosures as workflow steps** | The public brand website (mfunding.com) |
| **Customer application intake** (forms/surveys) | Admin management layer (already built) |
| Sub-ISO white-label portals (sub-accounts, SaaS) | Two-way GHL sync (webhooks + API) |
| Payments / invoicing (platform fees, Stripe) | Renewal **detection** (paydown math → triggers GHL) |

---

## The automated deal lifecycle — who does what
```
LEAD IN ──────────────▶ NURTURE ─────────▶ APPLY ──────────▶ UNDERWRITE ───────▶ SUBMIT ──────▶ OFFER ──────▶ FUND ──────▶ RENEW
GHL: capture, AI         GHL: SMS/email     GHL: form +        OUR APP: Plaid     OUR APP:       GHL: present  GHL: e-sign   OUR APP:
pre-qual, round-robin,   sequences, missed- disclosure         pull, scorecard,   match funders, offer link,   contract,     paydown math
phone, pipeline card     call text-back     workflow, Plaid    risk dashboard     package &      compare       fund confirm  → GHL renewal
                                            hand-off                              submit to 3-5                            workflow
        └────────────────── two-way sync: GHL opportunity ⇄ Supabase deal (ghl_contact_id / ghl_opportunity_id already in schema) ──────────────┘
```
**Human touches left:** underwriter reviews the scorecard; closer picks which funders to submit to and presents the offer. Everything else is automated.

---

## Decisions I need from you (the open questions)
Mark your call next to each — these set the build order.

1. **GHL account** — Is **"TheApexRules"** (the account already connected here) your MFunding sub-account, or do we provision/point to a different one? *Need: API key (Private Integration token) + Location ID.* → **[ your call ]**
2. **Docs & e-signature** — Use **GHL's** built-in Documents & Contracts for commission agreements + funding paperwork (recommended; you said it's "already in GHL"), and skip building a DocuSign/eSign engine? → **[ GHL ✅ / build own ]**
3. **Compliance disclosures** — Run state-specific disclosures as a **GHL workflow step** (send doc + capture acknowledgment) vs. building a disclosure engine in our app? Recommendation: GHL workflow, with our app supplying the *correct* disclosure per state+product via API. → **[ GHL workflow ✅ ]**
4. **Customer application portal** — You said: **put it in GHL** (forms/surveys + funnel). Plaid hand-off then happens via a single embedded React page or link. Confirm: GHL owns intake, our app owns the Plaid step only. → **[ confirm ]**
5. **Pipelines** — One master 9-stage pipeline in GHL, mirrored to `deals` in Supabase. Confirm stage names match our funnel. → **[ confirm ]**
6. **Per-stage automations** — Map each of the 6 sequences to its trigger stage (Sequence A→Docs, B→No-answer, etc.). → **[ build matrix ]**
7. **Multi-funder submission + underwriting** — Built in **our app** (GHL can't). Requires: (a) **funder criteria matrix** from your 40 lenders, (b) **internal underwriting scorecard**, (c) **live-vendor qualification specs**. → **[ data-gathering task ]**
8. **Google Workspace** — Nice-to-have. Gmail/Calendar/Drive — but GHL already covers calendar + email. Likely **defer** unless you need Drive/Sheets export. → **[ defer? ]**

---

## Where things stand right now
- **Schema is GHL-ready** (`ghl_contact_id`, `ghl_opportunity_id`, `ghl_location_id` already in tables) — but **no integration code exists yet**. This is the #1 task.
- Admin layer (deals, commissions, closers, sub-ISOs, analytics) is **built**.
- Missing intelligence pieces: Plaid, underwriting, funder matching/submission UI, GHL sync.

*Full task list with GHL-vs-build tags: see `GHL_Integration_Checklist.md`.*
