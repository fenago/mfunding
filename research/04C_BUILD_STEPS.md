# 04C — Step-by-step build guide (GoHighLevel)

**Who:** the owner. GHL's API cannot create templates or workflows, so this cannot be automated.
**Time:** ~30 minutes.
**Every merge tag below was read live from your GHL location — none are guessed.**

---

## THE ANSWER, UP FRONT

| | |
|---|---|
| **Clone from** | **`04B MCA PREFILL`** — yes |
| **Merge tags** (we prefill; merchant cannot edit) | **15** |
| **Fillable fields** (merchant types; we cannot prefill) | **12** |
| **Total fields on the document** | **27** |

*(12 fillable, not 15 — because GHL combines City/State/ZIP into a single field for both the
business and the owner. Fewer boxes for the merchant. Good.)*

**The rule:** if Synergy already told us → **merge tag**. If only the merchant knows it →
**fillable field**.

---

## ⚠️ READ THIS FIRST — the landmine on 04B

I checked your location. **These custom fields exist**, which means 04B may well reference them:

```
contact.additional_owner_name          contact.additional_owner_ssn
contact.additional_owner_dob           contact.additional_owner_title
contact.additional_owner_cell_phone    contact.additional_owner_ownership_percent_doc
contact.bank_account_type
```

**We push NONE of them.** GHL cannot read a template body over the API, so I am blind here — but
if any of these tags are in 04B, they print as raw `{{contact.additional_owner_ssn}}` **on every
signed contract, even a fully-filled one.**

**While you're in the editor: search 04B for `additional_owner` and `bank_account_type`.**
If they're there, either delete them or make them fillable fields. In 04C, make them **fillable**
(a second owner is real, and only the merchant knows about them).

---

## PART 1 — The document template

### Step 1. Clone
GHL → **Payments → Documents & Contracts → Templates** → `04B MCA PREFILL` → **⋯ → Duplicate**.
Rename to:

```
04C MCA PARTIAL PREFILL
```

### Step 2. LEAVE THESE 15 MERGE TAGS ALONE — they prefill from the lead

| Section | Label on the document | Merge tag (verified) |
|---|---|---|
| Business | Legal Business Name | `{{contact.business_name}}` |
| Business | Industry / Business Type | `{{contact.industry_doc}}` |
| Business | Business Phone | `{{contact.business_phone}}` |
| Business | Business Email | `{{contact.business_email}}` |
| Business | Date Business Established | `{{contact.date_business_established}}` |
| Owner | Full Name | `{{contact.owner_full_name}}` |
| Owner | Title | `{{contact.owner_title__position}}` |
| Owner | Ownership % | `{{contact.ownership_percent_doc}}` |
| Owner | Email Address | `{{contact.owner_email}}` |
| Owner | Cell Phone | `{{contact.owner_cell_phone}}` |
| Funding | Amount Requested | `{{contact.amount_requested_doc}}` |
| Funding | Use of Funds | `{{contact.use_of_funds_doc}}` |
| Funding | Average Monthly Revenue | `{{contact.avg_monthly_revenue_doc}}` |
| Funding | Active MCA Positions | `{{contact.active_mca_positions}}` |
| Funding | Outstanding MCA Balance | `{{contact.total_outstanding_mca_balance}}` |

### Step 3. ⭐ CONVERT THESE 12 TO FILLABLE FIELDS — this is the actual work

For each: **delete the merge tag**, then drag in a **fillable field** from the editor toolbar
(the person / `(x)` icon) and assign the **merchant** as the recipient.

**BUSINESS — 4**

| # | Delete this tag | Replace with a fillable field labelled |
|---|---|---|
| 1 | `{{contact.federal_tax_id_ein}}` | Federal Tax ID (EIN) |
| 2 | `{{contact.business_entity}}` | Type of Entity |
| 3 | `{{contact.business_address}}` | Business Street Address |
| 4 | `{{contact.business_city_state_zip}}` | Business City, State, ZIP |

**OWNER / GUARANTOR — 5**

| # | Delete this tag | Replace with a fillable field labelled |
|---|---|---|
| 5 | `{{contact.social_security_number}}` | SSN |
| 6 | `{{contact.owner_date_of_birth}}` | Date of Birth |
| 7 | `{{contact.drivers_license_number}}` | Driver's License # |
| 8 | `{{contact.owner_home_address}}` | Home Street Address |
| 9 | `{{contact.owner_city_state_zip}}` | Home City, State, ZIP |

**BANKING — 3**

| # | Delete this tag | Replace with a fillable field labelled |
|---|---|---|
| 10 | `{{contact.bank_name}}` | Bank Name |
| 11 | `{{contact.bank_routing_number}}` | Routing Number |
| 12 | `{{contact.bank_account_number}}` | Account Number |

**PLUS:** if you find any `additional_owner_*` or `bank_account_type` tags (see the landmine
warning above) → make those **fillable** too.

### Step 4. Save. Copy the template ID from the URL
`…/payments/proposals-estimates/edit/`**`<TEMPLATE_ID>`**

---

## PART 2 — The workflow

### Step 5. Create
**Automation → Workflows → + Create Workflow → Start from scratch.** Name:

```
MCA 04C PARTIAL
```

### Step 6. 🚨 DO NOT ADD A TRIGGER 🚨
Leave it reading **"Add new trigger."** Empty. This is the most important step on the page.

> A pipeline-stage trigger fires on *"the deal reached Application Sent"* — which is true of
> **all three** send paths. It cannot tell them apart, so it will send the wrong document.
> **That is exactly what happened today:** 04B's stage trigger fired on self-fill deals and five
> merchants received a prefill contract full of raw `{{tags}}`. One signed it.
>
> Delivery is the code's job. The workflow fires only when we enroll the contact into it.

### Step 7. Actions (mirror 04B exactly)
1. **Send documents & contracts** → `04C MCA PARTIAL PREFILL`
2. **Send documents & contracts** → `MCA — Broker Compensation Disclosure`
3. **Email** → the same notification email 04B sends

### Step 8. PUBLISH
Flip **Draft → Publish** (top right). **A draft workflow silently does nothing** — the enrollment
"succeeds" and no document is ever sent. That failure looks exactly like success.

### Step 9. Copy the workflow ID from the URL
`…/automation/workflow/`**`<WORKFLOW_ID>`**

---

## PART 3 — Send me these

```
04C template ID:  ________________________
04C workflow ID:  ________________________

Did 04B contain additional_owner_* or bank_account_type tags?   YES / NO
```

Then I wire in the third path (enroll 04C **directly** — never a stage trigger), add the
**"Send partial"** button and make it the default, and verify all three paths **on the test
contact only**.

---

## The three paths, once this is live

| Button | Use when | Closer types | Merchant fills |
|---|---|---|---|
| **Send partial** ⭐ *default* | You have the lead. **Most deals.** | **0** | **12** |
| **Send to e-sign** (04B) | Merchant on the phone, you got everything | ~14 | **0** — just signs |
| **Send blank** (MCA 04) | You never reached them | 0 | everything |
