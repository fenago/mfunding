# 04C — Step-by-step build guide (GoHighLevel)

**Who does this:** the owner. GHL's API cannot create document templates or workflows, so this
cannot be automated. Everything else is on me.

**Time:** ~30 minutes.

**The result:** the closer presses one button. The merchant gets an application that already
knows who they are and asks them only for what they alone can supply.

---

## THE SPLIT — 15 we fill, 15 they fill

| | |
|---|---|
| **Merge tags** (we prefill — merchant CANNOT edit) | **15** |
| **Fillable fields** (merchant types — we CANNOT prefill) | **15** |

That is the whole design. In GHL a field is **either** a merge tag **or** fillable. Never both.
A merge tag with no value prints as a literal `{{contact.whatever}}` on the signed contract —
that is exactly what a real merchant signed today, and it is why 04C must be a new template
rather than a tweak to 04B.

---

## PART 1 — Build the document template

### Step 1. Clone 04B
GHL → **Payments → Documents & Contracts → Templates** → find **`04B MCA PREFILL`** →
**⋯ → Duplicate**. Rename the copy:

```
04C MCA PARTIAL PREFILL
```

### Step 2. LEAVE THESE 15 AS MERGE TAGS
Do not touch them. These prefill from the lead automatically.

| Section | Field | Tag |
|---|---|---|
| Business | Legal business name | `{{contact.company_name}}` |
| Business | Industry / business type | `{{contact.industry}}` |
| Business | Business phone | `{{contact.phone}}` |
| Business | Business email | `{{contact.email}}` |
| Business | Business state *(within City, State, ZIP)* | `{{contact.state}}` |
| Business | Date business established | `{{contact.date_business_established}}` |
| Owner | Full name | `{{contact.owner_full_name}}` |
| Owner | Title | `{{contact.owner_title__position}}` |
| Owner | Ownership % | `{{contact.ownership_percent_doc}}` |
| Owner | Email address | `{{contact.email}}` |
| Owner | Cell phone | `{{contact.phone}}` |
| Funding | Amount requested | `{{contact.requested_amount}}` |
| Funding | Use of funds | `{{contact.use_of_funds}}` |
| Funding | Average monthly revenue | `{{contact.average_monthly_deposits}}` |
| Funding | Existing positions / balance | `{{contact.open_positions}}` |

*(Field names in your template may differ slightly — go by the label, not my wording.)*

### Step 3. CONVERT THESE 15 TO FILLABLE FIELDS ⭐ THE ACTUAL WORK
For each one: **delete the `{{merge tag}}`**, then from the left toolbar drag in a
**fillable field** (the `(x)` / person icon in the editor toolbar) and assign it to the merchant
as the recipient.

**BUSINESS — 5**
1. Federal Tax ID (EIN)
2. Type of Entity
3. Business street address
4. Business city
5. Business ZIP

**OWNER / GUARANTOR — 7**
6. SSN
7. Date of birth
8. Driver's licence number
9. Home address
10. Home city
11. Home state
12. Home ZIP

**BANKING — 3**
13. Bank name
14. Routing number
15. Account number

> **Rule of thumb:** if the merchant is the only person on earth who knows it, it's a **fillable
> field**. If Synergy already told us, it's a **merge tag**.

### Step 4. Save. Copy the template ID.
It's in the URL: `…/proposals-estimates/edit/<TEMPLATE_ID>`

---

## PART 2 — Build the workflow

### Step 5. Create it
GHL → **Automation → Workflows → + Create Workflow → Start from scratch**. Name it:

```
MCA 04C PARTIAL
```

### Step 6. 🚨 DO NOT ADD A TRIGGER 🚨
Leave it showing **"Add new trigger"**. Empty. This is the single most important step on the page.

> **Why.** A pipeline-stage trigger fires on *"the deal reached Application Sent"* — which is true
> of **all three** send paths. It cannot tell them apart, so it will happily send the wrong
> document. That is precisely what happened today: 04B's stage trigger fired on self-fill deals
> and five merchants got a prefill contract full of raw `{{tags}}`.
>
> **Delivery is the code's job.** `push-application-to-ghl` knows which document the closer asked
> for; a stage trigger does not. The workflow fires only when we enroll the contact into it.

### Step 7. Add the actions (mirror 04B exactly)
1. **Send documents & contracts** → template **`04C MCA PARTIAL PREFILL`**
2. **Send documents & contracts** → template **`MCA — Broker Compensation Disclosure`**
3. **Email** → the same notification email 04B sends

### Step 8. PUBLISH IT
Flip **Draft → Publish**, top right. A draft workflow silently does nothing when we enroll a
contact into it — the enrollment "succeeds" and no document is ever sent.

### Step 9. Copy the workflow ID
It's in the URL: `…/automation/workflow/<WORKFLOW_ID>`

---

## PART 3 — Send me two IDs

```
04C template ID:  ________________________
04C workflow ID:  ________________________
```

Then I:
- wire `MCA_04C_WORKFLOW_ID` into `push-application-to-ghl`
- add the third send path (tag `app-partial`, enroll 04C **directly** — never a stage trigger)
- add the **"Send partial — merchant completes the rest"** button, and make it the **default**
- verify all three paths end-to-end **on the test contact only**

---

## PART 4 — While you're in there (5 minutes, prevents a repeat)

**Open `04B MCA PREFILL` and read every merge tag in it.**

GHL will not let me read a template body over the API — this is the one thing I am blind to.
If 04B contains tags for fields **we do not push**, they will print as raw `{{tags}}` **even on a
fully-filled application**. Specifically check for:

- an **Additional Owner** block — `{{contact.additional_owner_name}}` / `_ssn` / `_dob`
  (all three of those custom fields exist in your location, so the template may well reference them)
- `{{contact.bank_account_type}}`

If either is there, tell me and I'll either push those fields or you delete them from the
template. **This is a live landmine on the path you use most.**

---

## The three paths, once this is done

| Button | Use when | Closer types | Merchant fills |
|---|---|---|---|
| **Send partial** ⭐ *(default)* | You have the lead. Most deals. | **0 fields** | **15** |
| **Send to e-sign** (04B) | Merchant on the phone, you got everything | 15 fields | **0** — just signs |
| **Send blank** (MCA 04) | You never reached them | 0 fields | **30** |
