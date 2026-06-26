# MFunding — GHL Integration & Build Checklist
### Last updated: June 25, 2026

**Legend** — every item is tagged by who owns it:
- 🟣 **GHL** = configure inside GoHighLevel; do NOT build in React/Supabase
- 🔵 **BUILD** = build in this React/Supabase app (GHL can't do it)
- 🟢 **HYBRID** = GHL + our app working together (sync/webhooks)
- 🟡 **DATA** = research / data-gathering, no code

> Architecture principle: **GHL = automation engine + system of action. This app = system of record + intelligence.** See `GHL_Automation_Blueprint.md` for the one-page version.

---

## 0. GHL INTEGRATION FOUNDATION — do this first 🟢
*The schema is already GHL-ready (`deals.ghl_contact_id`, `deals.ghl_opportunity_id`, `sub_isos.ghl_location_id`) but no integration code exists yet.*

- [ ] **Confirm the GHL account** — verify "TheApexRules" (already connected in this session) is the MFunding sub-account, or identify the correct one. 🟡
- [ ] **Get credentials:** GHL **Private Integration token** (location-level) + **Location ID** (and Agency/Company ID if managing sub-accounts). 🟡
- [ ] **Store secrets server-side** — Supabase secrets / edge-function env. NEVER expose the GHL token in the React frontend. 🔵
- [ ] **Build GHL API client** — `src/services/ghlService.ts` (or a Supabase edge function) wrapping GHL API v2: contacts, opportunities, custom fields, workflows. 🔵
- [ ] **Inbound webhook receiver** — Supabase edge function to receive GHL events (contact created, opportunity stage changed, appointment booked, payment) and update Supabase. 🟢
- [ ] **Outbound sync** — on Supabase changes (deal stage, status), push to GHL opportunity via API. 🟢
- [ ] **Entity mapping** — `customers ⇄ GHL contacts`, `deals ⇄ GHL opportunities`; reconcile/backfill `ghl_*_id` columns. 🟢
- [ ] **Custom fields in GHL** — Monthly Revenue, Time in Business, Industry, Lead Source, Target Market, Funding Amount, Paydown %. 🟣
- [ ] **Sync health/monitoring** — log + retry failed syncs; surface in admin. 🔵

---

## 1. CONFIGURE IN GHL (do NOT rebuild) 🟣
- [ ] **9-stage deal pipeline** built in GHL, stage names matched to our funnel. 🟣
- [ ] **Lead capture** from all sources (forms, ads, live transfers, aged leads) → GHL CRM. 🟣
- [ ] **6 follow-up sequences** as GHL workflows (A: Stips/Docs, B: No-answer, C: Soft-no, D: Offer-declined, E: Funded→Renewal, F: Reactivation). 🟣
- [ ] **Per-stage automation map** — each pipeline stage triggers its sequence (see §5). 🟣
- [ ] **AI Employee** — 24/7 SMS/chat pre-qualification. 🟣
- [ ] **Phone system** — local numbers per market, call recording, missed-call text-back. 🟣
- [ ] **Calendars** — appointment booking for closers. 🟣
- [ ] **Round-robin** lead assignment to closers. 🟣
- [ ] **City campaign landing pages** — funding.mfunding.com/[city]. 🟣
- [ ] **Documents & e-signature** — commission agreements, funding paperwork. 🟣
- [ ] **Customer application intake** — GHL forms/surveys/funnel (the "application portal"). 🟣
- [ ] **Compliance disclosures** — delivered + acknowledged as workflow steps (content supplied by our app per state+product). 🟢
- [ ] **Sub-ISO white-label portals** — GHL sub-accounts + SaaS Mode + Stripe rebilling. 🟣
- [ ] **Payments** — platform fees / invoicing via GHL Stripe. 🟣

---

## 2. BUILD IN THIS APP (GHL can't do it) 🔵
- [ ] **Plaid integration** — bank verification + 3–6 mo transaction analysis (edge function + one embedded Link page). 🔵
- [ ] **Underwriting workbench** — risk dashboard (ADB, NSFs, negative days, existing MCA payments) + configurable scorecard. 🔵
- [ ] **Funder matching engine** — match deal profile → best-fit funders using `lenders` criteria (Gemini AI). 🔵
- [ ] **Multi-funder deal submission UI** — package deal, submit to 3–5 funders, track responses. Needs a `deal_submissions` table. 🔵
- [ ] **Offer comparison** — side-by-side by factor rate, term, amount, daily payment (can also present via GHL offer link). 🟢
- [ ] **Commission engine** — splits, overrides, clawbacks, payout tracking (services already exist; wire to funded events). 🔵
- [ ] **Renewal detection** — paydown math at 40/60/75/100% → fire GHL renewal workflow via webhook. 🟢
- [ ] **Advanced analytics** — cost-per-funded-deal by source/market, pipeline velocity, closer/lender performance (pages exist; feed real data). 🔵
- [ ] **Lender network + criteria matrix** — source of truth for matching/submission (`lenders` table populated; add structured criteria). 🔵
- [ ] **Public brand website** — already built; keep on React. ✅
- [ ] **Admin management layer** — deals/commissions/closers/sub-ISOs/analytics already built; connect to live data + GHL. ✅

---

## 3. DEFER / EVALUATE 🟡
- [ ] **Google Workspace integration** — Gmail/Calendar/Drive/Sheets/Meet. GHL already covers calendar + email; likely defer unless Drive/Sheets export is needed. Decide. 🟡
- [ ] **Credit bureau (Experian)** — Phase 2. 🔵
- [ ] **Bank-statement PDF parsing (Ocrolus)** — only if Plaid coverage is insufficient. 🔵

---

## 4. DATA & RESEARCH (gather before submission can work) 🟡
- [ ] **Live transfer vendors** — finalize the active vendor list and each vendor's **qualification specs** (start from `research/MCA_Live_Transfer_Vendors.xlsx` + `marketing_vendors` table, 11 rows). 🟡
- [ ] **Funder criteria** — for each of the 40 lenders, capture: min revenue, time in biz, credit, industry restrictions, max position/stacking, factor range, paper tier (A/B/C/D), required stips. Feeds matching + submission. 🟡
- [ ] **Internal underwriting rules** — define the scorecard thresholds we apply BEFORE submitting to funders (so we only send fundable deals). 🟡
- [ ] **Stips matrix** — required docs per product type / funder. 🟡
- [ ] **State disclosure content** — exact text per state (NY, CA, VA, UT, FL, CT, GA, KS, TX, MO) × product type. 🟡

---

## 5. PER-STAGE AUTOMATION MAP (fill in during GHL build) 🟣🟢
| # | Pipeline Stage | GHL automation on entry | Our-app action |
|---|---|---|---|
| 1 | New Lead | Auto-response SMS+email; AI pre-qual; round-robin | Create `deals` row, link `ghl_*_id` |
| 2 | Contacted | Speed-to-lead alerts | — |
| 3 | Qualifying | BANT-F capture into custom fields | — |
| 4 | Application Sent | Send GHL form + disclosures workflow | Disclosure content per state/product |
| 5 | Docs Collected | **Sequence A** (stips, 14 days) | **Plaid** pull + transaction analysis |
| 6 | Submitted to Funder | Notify VA/closer | **Underwrite + match + multi-funder submit** |
| 7 | Offer Presented | Offer link; **Sequence D** if declined | **Offer comparison** |
| 8 | Funded | Congrats; review/referral ask | **Commission calc** + payout tracking |
| 9 | Renewal Eligible | **Sequence E** at paydown triggers | **Paydown math** fires the trigger |

---

## Suggested build order
1. **§0 Foundation** (credentials + API client + webhooks + sync). ← start here
2. **§1 GHL config** (pipeline + sequences + intake + docs/e-sign) — can run in parallel by you in GHL.
3. **§4 DATA** (funder criteria + vendor specs + underwriting rules) — unblocks submission.
4. **Plaid → Underwriting → Funder matching → Multi-funder submission** (the money path).
5. **Renewal detection + advanced analytics + commission wiring.**
6. **Sub-ISO portals + payments** (Phase 3).
