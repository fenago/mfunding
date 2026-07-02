# Merchant Funding Application — Field → GHL Link Map

Every data component on the e-sign application (template `MCA_Merchant_Funding_Application`),
the GHL field it should LINK to, and its status. Linking a Text/Date field in the
Documents & Contracts editor does two things: **pre-fills** from the contact at send
time, and **writes back** to the contact when the merchant signs — so everything the
merchant types becomes reusable CRM data.

**GHL limitation:** only **Text and Date** fillable fields can link to custom values.
**Checkboxes cannot link** — checkbox answers stay on the signed PDF only. The matching
custom fields still exist so the same answers can be captured via the closer/forms; the
doc's checkboxes just won't sync them automatically.

## Section 1 — Business Information
| Doc field | Link to | Status |
|---|---|---|
| Legal Business Name | Custom: **Business Name** (`business_name`) | existed · auto-synced by app |
| DBA | Custom: **DBA (Doing Business As)** | existed |
| Business Address | Custom value → Contact → **Address** (standard address1) | standard |
| City, State, ZIP | Custom: **Business City State ZIP** | **created now** |
| Business Phone | Standard: **Phone** | standard |
| Business Email | Standard: **Email** | standard |
| Website | Standard: **Website** | standard |
| Federal Tax ID (EIN) | Custom: **Federal Tax ID (EIN)** | existed |
| Date Business Established | Custom: **Date Business Established** | existed |
| Type of Entity ☐s | (checkboxes — can't link) field exists: **Business Entity** | existed |
| Industry ☐s | (checkboxes — can't link) field exists: **Industry** | existed |

## Section 2 — Owner / Guarantor
| Doc field | Link to | Status |
|---|---|---|
| Full Name | Standard: **Full Name** (or First + Last) | standard |
| Title | Custom: **Owner Title / Position** | existed |
| Ownership % | Custom: **Ownership %** | existed |
| SSN | Custom: **Social Security Number** | existed |
| Date of Birth | Standard: **Date of Birth** | standard |
| Driver License # | Custom: **Driver's License Number** | existed |
| Home Phone | Custom: **Owner Home Phone** | **created now** |
| Cell Phone | Standard: **Phone** | standard |
| Home Address | Custom: **Owner Home Address** | existed |
| City, State, ZIP | Custom: **Owner City State ZIP** | **created now** |
| Email Address | Standard: **Email** | standard |
| Additional Owner: Full Name | Custom: **Additional Owner Name** | **created now** |
| Additional Owner: Title | Custom: **Additional Owner Title** | **created now** |
| Additional Owner: Ownership % | Custom: **Additional Owner Ownership %** | **created now** |
| Additional Owner: SSN | Custom: **Additional Owner SSN** | **created now** |
| Additional Owner: DOB | Custom: **Additional Owner DOB** | **created now** |
| Additional Owner: Cell | Custom: **Additional Owner Cell Phone** | **created now** |

## Section 3 — Funding Request
| Doc field | Link to | Status |
|---|---|---|
| Amount Requested $ | Custom: **Funding Amount Requested** | existed · auto-synced by app |
| Use of Funds ☐s (+ Other) | (checkboxes) field exists: **Use of Funds**; link the "Other: ___" text to it | existed |
| How Soon ☐s | (checkboxes) field exists: **Funding Timeframe** | existed |

## Section 4 — Business Financials
| Doc field | Link to | Status |
|---|---|---|
| Avg Monthly Revenue $ | Custom: **Avg Monthly Revenue ($)** (`avg_monthly_revenue_`) — dollar amount; the older **Monthly Revenue** field is an options-range, keep for forms | **created now** |
| Avg Monthly Deposits $ | Custom: **Average Monthly Deposits** | existed |
| Annual Gross Revenue $ | Custom: **Annual Gross Revenue** | existed |
| # of Employees | Custom: **Number of Employees** | existed |
| Outstanding advances? ☐ | (checkbox) field exists: **Has Existing Advances** | **created now** |
| Positions table (lender/original/balance/payment) | Custom: **Funding Positions Notes** (one text field over the table area; structured per-position data also lives in **Current Funder Names / Total Outstanding MCA Balance / Total Daily Debit / Number of MCAs**) | **created now** |
| Bankruptcy? ☐ + year/chapter/status | ☐ can't link (**Bankruptcy History** exists); link the detail blanks to **Bankruptcy Details** | **created now** |
| Tax liens? ☐ + amount/plan | ☐ can't link (**Tax Liens or Judgments** exists); link the detail blanks to **Tax Lien Details** | **created now** |

## Section 5 — Bank Account
| Doc field | Link to | Status |
|---|---|---|
| Bank Name | Custom: **Bank Name** | existed |
| Account Holder Name | Custom: **Bank Account Holder Name** | **created now** |
| Routing Number | Custom: **Bank Routing Number** | existed |
| Account Number | Custom: **Bank Account Number** | existed |
| Account Type ☐s | (checkboxes) field exists: **Bank Account Type** | existed |
| How long with bank ☐s | (checkboxes) field exists: **Years With Bank** | **created now** |

## Section 7 — Signatures
Signature / Date / Print Name / Title — signature + date are e-sign elements (auto-audited);
Print Name can link to **Full Name**, Title to **Owner Title / Position**.

## To finish (manual, in the template editor)
Open `MCA_Merchant_Funding_Application` → for each **Text/Date** field: click it →
**LINKED FIELDS → Add custom fields → Contact Custom Value →** pick per the map → Link and
Save. (~5 min; checkboxes are skipped by design.) After linking, every application a
merchant completes writes all of this back onto their contact — reusable for funder
submissions, renewals, and VCF routing.
