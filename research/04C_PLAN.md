# 04C — The Third Document Path

**Status:** PLAN. Nothing built yet. Owner approval + one GHL build step required.
**Date:** 2026-07-13

---

## 1. The problem this solves

We pay for a lead, get the merchant on the phone, take 20 minutes of their time collecting
information — and only then discover the deal was never fundable, or the paperwork goes out
broken. Every minute a closer spends re-typing data the vendor **already gave us** is a minute
not spent closing.

Today there are two document paths and they are all-or-nothing:

| Path | Who fills the application | Reality |
|---|---|---|
| **MCA 04** (self-fill) | The merchant fills in **everything** | We hand them a blank form and hope |
| **MCA 04B** (prefill) | The closer fills in **all 30 fields** | Requires SSN, EIN, DOB, DL#, full banking — on a cold call |

There is no middle. And the middle is where almost every real deal lives.

**04C is the middle:** we prefill everything the vendor already told us, and the merchant
completes only the things they alone can supply.

---

## 2. What Synergy actually sends — MEASURED, not assumed

Across **all 14 real leads**, every one of the **22 fields is populated 100% of the time.**
Synergy has never once sent us a blank field.

| # | Synergy field | Example | Maps to |
|---|---|---|---|
| 1 | `company` | Braun Blaising And Wynne P.C. | `business_legal_name` |
| 2 | `contact_name` | Victor Nguyan | `owner_first_name` + `owner_last_name` |
| 3 | `phone` | (682) 554-1516 | `business_phone` + `owner_phone` |
| 4 | `email` | victorng7@gmail.com | `business_email` + `owner_email` |
| 5 | `state` | TX | `business_state` |
| 6 | `industry` | Consulting service | `industry` |
| 7 | `monthly_deposits` | $20,000 | `monthly_revenue` |
| 8 | `requested_amount` | $30,000 | `amount_requested` |
| 9 | `use_of_funds` | Expansion | `use_of_funds` |
| 10 | `is_owner` | Yes | ⇒ `owner_title` = **"Owner"** |
| 11 | `time_as_owner` | 7 Years | ⚠️ *approximates* `business_start_date` — see §6 |
| 12 | `open_positions` | No / N/A | `existing_positions` |
| 13 | `positions_balance` | No / N/A | `existing_balance` |
| 14 | `fico` | 600 | (underwriting context) |
| 15 | `best_time` | 4:03 PM EST | (call scheduling) |
| 16 | `need_money_now` | Yes | (urgency) |
| 17 | `processes_cc` | No | (funder routing) |
| 18 | `has_equity` | No | (funder routing) |
| 19 | `property_paid_down` | No | (funder routing) |
| 20 | `difficulty_approved` | No | (underwriting context) |
| 21 | `fax` | No | (noise) |
| 22 | `agent` | Agentic Voice Inc (Real Time) | **routing — live transfer vs real-time** |

### The 14 application fields we can PREFILL from the lead, with zero closer typing

`business_legal_name` · `industry` · `business_phone` · `business_email` · `business_state`
`owner_first_name` · `owner_last_name` · `owner_email` · `owner_phone`
`owner_title` (= "Owner") · `owner_ownership_pct` (= 100)
`amount_requested` · `use_of_funds` · `monthly_revenue`

### The 16 fields the vendor NEVER sends — the merchant must supply them

**Business:** `business_type` (entity) · `ein` · `business_start_date` ·
`business_address` · `business_city` · `business_zip`

**Owner:** `owner_ssn` · `owner_dob` · `owner_dl_number` ·
`owner_home_address` · `owner_home_city` · `owner_home_state` · `owner_home_zip`

**Banking:** `bank_name` · `bank_routing_number` · `bank_account_number`

**This is the entire reason 04B is so painful.** Sixteen fields — including SSN, EIN, driver's
licence and full bank details — that a closer has to extract verbally on a first call. That is
the friction, and it is exactly what 04C removes.

---

## 3. THE CONSTRAINT THAT DEFINES THE DESIGN

In GoHighLevel's Documents & Contracts, a field is **either**:

- a **merge tag** (`{{contact.ein}}`) — prefills from the contact, **merchant cannot edit it**, and
  **renders as raw `{{contact.ein}}` on the signed contract if the field is empty**; or
- a **fillable field** — the merchant types into it, but it **can never be prefilled**
  (GHL fillable fields are write-back only).

You cannot have a field that is both prefilled *and* editable. That is not a bug we can code
around; it is how GHL works.

**This single constraint dictates everything:**

- It is why an unfilled 04B renders `Federal Tax ID (EIN): {{contact.federal_tax_id_ein}}` —
  and why a real merchant signed exactly that today.
- It is why "make SSN optional" **cannot** simply be done on 04B: a blank optional field becomes
  a raw tag on a legal document.
- It is why **04C must be a NEW GHL TEMPLATE.** It cannot be a variant of 04B.

**04C = the 14 known fields as MERGE TAGS + the 16 unknown fields as FILLABLE FIELDS.**

And it resolves the SSN question cleanly: on 04C, SSN is a **fillable field the merchant enters
themselves** — so it is neither mandatory for the closer nor a raw-tag hazard.

---

## 4. The three paths, once 04C exists

| Path | Use when | Closer types | Merchant does |
|---|---|---|---|
| **04B** PREFILL | You have the merchant on the phone and got everything | 30 fields | Signs |
| **04C** PARTIAL ⭐ | **The default.** You have the lead, and the merchant will finish it | **0 fields** | Completes 16, signs |
| **04** SELF-FILL | You never reached them at all | 0 fields | Completes 30, signs |

04C becomes the workhorse. 04B stays for the white-glove close. 04 stays for "never got them."

---

## 5. The application form fixes (owner's list)

| Fix | Detail |
|---|---|
| **Entity type → dropdown** | LLC · S-Corp · C-Corp · Sole Proprietor · Partnership · LP · LLP · Non-profit. Free text guarantees a garbage value on a legal document. |
| **SSN → NOT mandatory** | Removed from `REQUIRED_KEYS`. ⚠️ **But see §3:** on **04B** a blank SSN becomes a raw tag. So SSN stays required *for the 04B path specifically*, and is optional everywhere else — on 04C the merchant enters it themselves. |
| **Title → prefill "Owner"** | `is_owner` = Yes on 100% of leads. |
| **Ownership % → prefill 100** | Sensible default; closer can override. |

**Also prefill from the lead, which the form does not do today:** business legal name, industry,
business phone, business email, business state, owner first/last name, owner email, owner phone,
amount requested, use of funds, monthly revenue. That's **19 of 30 fields pre-populated** — the
closer's job drops from 30 fields to ~11.

---

## 6. The `business_start_date` trap — DO NOT GUESS

`time_as_owner` = "7 Years" is **not** a business start date. It is how long they have owned the
business, it is rounded, and it may predate or postdate incorporation.

`business_start_date` goes on a **signed legal document** and into a **funder submission**. Deriving
"7 Years" → `2019-07-13` invents a fact we cannot support, on paper the merchant signs.

**Decision: never derive it.** Prefill a *hint* in the UI ("merchant said ~7 years") and let a human
enter the real date. On 04C it is a fillable field the merchant completes from their own records.

---

## 7. WHAT THE OWNER MUST DO BY HAND

GHL's API cannot create document templates or workflows. **Three manual steps. Nothing else.**

### Step 1 — Build the `04C MCA PARTIAL PREFILL` document template
Clone `04B MCA PREFILL`, then for each of the **16 merchant-supplied fields** (§2), delete the merge
tag and drop in a **fillable field**. Leave the 14 known fields as merge tags.

### Step 2 — Create the `MCA 04C PARTIAL` workflow
- **NO TRIGGER.** Enrollment-only, exactly like 04B. *(This is what today's incident was about —
  a stage trigger cannot tell the paths apart, so delivery must be ours alone.)*
- Actions: `Send documents & contracts` → **04C** template, then → **MCA — Broker Compensation
  Disclosure**, then the notification email. Mirror 04B's structure.
- Publish it.

### Step 3 — Send me two IDs
The **workflow ID** and the **template ID**. I wire them in, and verify all three paths end-to-end
on the test contact.

### Step 4 — Audit the 04B template body (5 minutes, prevents a repeat)
GHL will not let me read a template's body over the API. **Open 04B and confirm every merge tag in it
is a field we actually push.** If it contains tags for an *Additional Owner* block
(`{{contact.additional_owner_name/_ssn/_dob}}` all exist in the location) or `{{contact.bank_account_type}}`,
those will print as **raw tags even on a fully-filled application.** This is a live landmine.

---

## 8. Build plan (mine, once the IDs land)

| # | Work | Risk |
|---|---|---|
| 1 | Prefill the application form from `deals.lead_qual` on open — 19 of 30 fields | Low |
| 2 | Entity-type dropdown; title → "Owner"; ownership → 100 | Low |
| 3 | `REQUIRED_FOR_04C` = the 14 prefillable fields only (server + client) | Low |
| 4 | Third send path in `push-application-to-ghl`: `variant: '04c'` → tag `app-partial`, enroll `MCA_04C_WORKFLOW_ID` directly, **never** rely on a stage trigger | Medium |
| 5 | Third button: **"Send partial — merchant completes the rest"**, made the DEFAULT | Low |
| 6 | Guard: block 04C if any of its 14 merge-tag fields is empty (raw-tag prevention) | Low |
| 7 | Post-send verification: read back which template GHL actually created; if it's the wrong one, **fail loudly**. This would have caught today's incident in seconds. | Medium |
| 8 | Verify all three paths on the TEST contact only | — |

**Order matters:** #7 before #5. Never ship a new send path without the check that proves what
actually went out.

---

## 9. What this is worth

A closer on a live transfer currently faces 30 fields, including SSN and bank routing, before they
can send anything. With 04C they press one button, the merchant gets a document that already knows
who they are, and fills in only what they alone can know.

**Zero fields typed. Zero raw tags. Zero blank applications.**
