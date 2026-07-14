# 04C — Complete build guide

**This is a full walk of the document.** Every field that can appear on the cloned template is
listed below with exactly one instruction: **KEEP** (leave the merge tag), **FILL** (delete the
tag, drop in a fillable field assigned to the merchant), or **DELETE** (remove the line).

**The counts:** 14 KEEP · 16 FILL · the rest DELETE.

**The rule behind every row:** on 04C the app pushes exactly 14 values (from the Synergy lead).
Any merge tag NOT on the KEEP list has no value behind it and **prints as raw `{{contact.x}}` on
the signed contract** — the exact failure a real merchant signed this week. So nothing stays a
merge tag unless it is one of the 14.

**Catch-all:** if you find ANY `{{tag}}` in the document that is not in a table below —
**make it FILL if a merchant could answer it, DELETE if not. Never leave it as a tag.**

---

## SECTION 1 — BUSINESS INFORMATION

| Line on the document | Tag | → DO THIS |
|---|---|---|
| Legal Business Name | `{{contact.business_name}}` | ✅ **KEEP** |
| Type of Entity | `{{contact.business_entity}}` | ✏️ **FILL** |
| Federal Tax ID (EIN) | `{{contact.federal_tax_id_ein}}` | ✏️ **FILL** |
| Date Business Established | `{{contact.date_business_established}}` | ✏️ **FILL** — the merchant knows the real date; our "7 Years" guess does not belong on a contract |
| Industry / Business Type | `{{contact.industry_doc}}` | ✅ **KEEP** |
| DBA (if any) | `{{contact.dba_doing_business_as}}` *(name may vary — the DBA line)* | ✏️ **FILL** (they may leave it blank — fine) |
| Business Address | `{{contact.business_address}}` | ✏️ **FILL** |
| City, State, ZIP | `{{contact.business_city_state_zip}}` | ✏️ **FILL** — one combined field; Synergy only gives us the state, and half a merge tag isn't a thing |
| Business Phone | `{{contact.business_phone}}` | ✅ **KEEP** |
| Business Email | `{{contact.business_email}}` | ✅ **KEEP** |
| Website (if any) | `{{contact.business_website}}` | 🗑 **DELETE** — nothing anywhere collects it; it prints raw on every 04B today (it's on Victor's signed doc) |

## SECTION 2 — OWNER / GUARANTOR

| Line | Tag | → DO THIS |
|---|---|---|
| Full Name | `{{contact.owner_full_name}}` | ✅ **KEEP** |
| Title | `{{contact.owner_title__position}}` | ✅ **KEEP** (we push "Owner") |
| Ownership % | `{{contact.ownership_percent_doc}}` | ✅ **KEEP** (we push "100%") |
| SSN | `{{contact.social_security_number}}` | ✏️ **FILL** |
| Date of Birth | `{{contact.owner_date_of_birth}}` | ✏️ **FILL** |
| Driver's License # | `{{contact.drivers_license_number}}` | ✏️ **FILL** |
| Cell Phone | `{{contact.owner_cell_phone}}` | ✅ **KEEP** |
| Home Phone | `{{contact.owner_home_phone}}` | 🗑 **DELETE** — collected nowhere, raw on every 04B today |
| Home Address | `{{contact.owner_home_address}}` | ✏️ **FILL** |
| City, State, ZIP | `{{contact.owner_city_state_zip}}` | ✏️ **FILL** |
| Email Address | `{{contact.owner_email}}` | ✅ **KEEP** |

## ADDITIONAL OWNER block (if the template has one)

| Line | Tag | → DO THIS |
|---|---|---|
| Any of: Name / Title / Ownership % / SSN / DOB / Cell | `{{contact.additional_owner_*}}` (6 tags) | 🗑 **DELETE the whole block** — we never push any of it. A second owner is rare; handle it manually when it happens. |

## FUNDING REQUEST

| Line | Tag | → DO THIS |
|---|---|---|
| Amount Requested | `{{contact.amount_requested_doc}}` | ✅ **KEEP** |
| Use of Funds | `{{contact.use_of_funds_doc}}` | ✅ **KEEP** |
| Average Monthly Revenue | `{{contact.avg_monthly_revenue_doc}}` | ✅ **KEEP** |
| Active MCA Positions | `{{contact.active_mca_positions}}` | ✅ **KEEP** |
| Total Outstanding MCA Balance | `{{contact.total_outstanding_mca_balance}}` | ✅ **KEEP** |

## BANKING

| Line | Tag | → DO THIS |
|---|---|---|
| Bank Name | `{{contact.bank_name}}` | ✏️ **FILL** |
| Routing Number | `{{contact.bank_routing_number}}` | ✏️ **FILL** |
| Account Number | `{{contact.bank_account_number}}` | ✏️ **FILL** |
| Account Holder Name | `{{contact.bank_account_holder_name}}` | ✏️ **FILL** |
| Account Type | `{{contact.bank_account_type}}` | ✏️ **FILL** — we never push it |

## BUSINESS FINANCIALS block (if the template has one)

| Line | Tag | → DO THIS |
|---|---|---|
| Annual Gross Revenue | `{{contact.annual_gross_revenue_doc}}` | ✏️ **FILL** |
| Average Monthly Deposits | `{{contact.avg_monthly_deposits_doc}}` | ✏️ **FILL** |
| Number of Employees | `{{contact.number_of_employees_doc}}` | ✏️ **FILL** |
| Bankruptcy history / details | any bankruptcy tag | ✏️ **FILL** |
| Tax liens / details | any tax-lien tag | ✏️ **FILL** |

---

## THE FINAL TALLY

| | Count | Which |
|---|---|---|
| ✅ **KEEP** (merge tags — we prefill from the lead) | **14** | business name, industry, business phone, business email, owner full name, title, ownership %, owner email, owner cell, amount requested, use of funds, monthly revenue, MCA positions, MCA balance |
| ✏️ **FILL** (merchant types) | **~16** | entity, EIN, date established, DBA, business address, business city/state/zip, SSN, DOB, DL#, home address, home city/state/zip, bank name, routing, account, holder name, account type (+ financials block if present) |
| 🗑 **DELETE** | rest | website, home phone, the additional-owner block |

**Note the change from the earlier version of this guide:** *Date Business Established* moved
from KEEP to **FILL**. On 04C the merchant is already typing — their real incorporation date
beats our "today minus 7 years" estimate on a legal document. (The estimate still prefills the
closer's form on the 04B path, where a human confirms it.)

---

## Fillable-field mechanics (the two things that tripped you)

- **The "Update custom fields with response" dialog is OPTIONAL. Skip it.** Click Cancel.
  It only copies the merchant's answer back onto the GHL contact afterward — nothing we run
  depends on that, and the answer is on the signed PDF regardless. (It also only lists TEXT
  fields, which is why searching "entity" found nothing — Business Entity is a dropdown field
  and is filtered out.)
- **Assign every fillable field to the merchant recipient**, not to you.

---

## THE WORKFLOW (unchanged)

1. **Automation → + Create Workflow → Start from scratch** → name it `MCA 04C PARTIAL`.
2. **🚨 NO TRIGGER. Leave "Add new trigger" empty.** A stage trigger fires on "reached
   Application Sent", which is true of all three paths — it cannot tell them apart, and it is
   exactly what sent five merchants the wrong document this week. We enroll contacts directly.
3. Actions, in order — mirror 04B:
   - Send documents & contracts → **`04C MCA PARTIAL`** (your template)
   - Send documents & contracts → **`MCA — Broker Compensation Disclosure`**
   - Email → the same notification email 04B sends
4. **PUBLISH.** A draft workflow silently does nothing — enrollment "succeeds", no document sends.

## SEND ME

```
04C template ID:   6a5594fa268297575c2770d5   ← from your editor URL (confirm)
04C workflow ID:   ________________________
```

Then I wire the third button ("Send partial — merchant completes the rest", the default),
push the 14 fields straight from the lead, and verify all three paths on the test contact.
