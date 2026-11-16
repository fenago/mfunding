# Momentum Micro — GHL funnel copy (UNPUBLISHED draft)

Built 2026-11-16 in the MFunding GHL location (`t7NmVR4WCy927j4Zon4b`). Nothing here is
published. Owner approval of the copy below is required before the funnel goes live.

## Where it lives

| Item | Name | ID |
|---|---|---|
| Funnel | Momentum Micro | `odDZUg5qMTARzKj5ZDNE` |
| Step 1 (landing) | Micro — path `/micro` | page `N3mktHLni9GCVDFdcs0p` |
| Step 2 (thank-you) | Micro Thanks — path `/micro-thanks` | page `s1Q03Vz7a7umUCrYq1NN` |
| Form | Momentum Micro — Funnel Form | `QyTYxKdeI84v8zxNriOZ` |
| Booking calendar embedded on thank-you | MFunding Consultation Call | `Y3FHQ9dkpicZJ4c3gy1u` |

Draft preview (no domain connected): `https://link.vibereach.io/preview/N3mktHLni9GCVDFdcs0p`

**No domain is attached yet.** The only domain GHL offers in the funnel picker is
`www.mfunding.net`, which DNS points at the Netlify React site, not GHL. `funding.mfunding.com`
(named in CLAUDE.md) has no DNS record. A subdomain (for example `funding.mfunding.net`) must be
connected in GHL before publishing.

## Landing page (`/micro`)

Branding: navy `#0b2a4a` hero, green `#22c55e` check marks, mint `#7ee0a5` eyebrow.

- Eyebrow: **Momentum Funding · Momentum Micro**
- Headline: **Working capital for small businesses**
- Sub-line: Momentum Micro connects established small businesses with merchant cash advance
  funders for smaller amounts.
- Three points:
  - Advances from $2,000 to $100,000
  - One application and your last 3–4 months of bank statements
  - No upfront fees — the funder pays us, never you

### Form (existing contact fields reused; no fields created)

| Label | Field | Type |
|---|---|---|
| First Name | standard `first_name` | text |
| Last Name | standard `last_name` | text |
| Phone * | standard `phone` | phone |
| Email * | standard `email` | email |
| Business Name | `contact.business_name` | TEXT |
| Monthly Revenue | `contact.monthly_revenue` | option list (Under $25K … $250K +) |
| Time In Business | `contact.time_in_business` | option list (0–6 months … 2 years +) |
| Funding Amount Requested | `contact.funding_amount_requested` | MONETORY |
| (hidden) Source | form source value `Funnel – Micro` | |

Button: **Submit**

Consent line under the button:

> By submitting you agree Momentum Funding may contact you by phone/email about funding.
> [Privacy Policy](https://mfunding.net/privacy) | [Terms of Service](https://mfunding.net/terms)

The GHL default SMS-consent checkboxes (with `[BUSINESS NAME]` placeholders) were removed:
SMS is not a live channel for this account.

On-submit (form-level) message: **Thanks, we have your details. We'll call you shortly.**

## Thank-you page (`/micro-thanks`)

- Eyebrow: **Momentum Funding · Momentum Micro**
- Headline: **Thanks — we'll call you shortly.**
- Body: Prefer to pick a time? Choose one below. Having your last 3–4 months of business bank
  statements handy will speed things up.
- Embedded booking widget: MFunding Consultation Call
  (`https://api.leadconnectorhq.com/widget/booking/Y3FHQ9dkpicZJ4c3gy1u`)
- Footer: Momentum Funding is a broker, not a funder. Privacy Policy | Terms of Service

## Compliance check

- No "loan", no "approved / pre-approved / guaranteed", no rate or speed-to-funding promise.
- "No upfront fees" matches CLAUDE.md (MFunding is paid by funders, never merchants).

## Open items for the owner

1. Approve the copy above.
2. Connect a GHL funnel domain, then publish the funnel.
3. The form element's redirect is "use action from form builder", so a submit currently shows
   the inline thank-you message, not the `/micro-thanks` page. After the domain is connected,
   set the form's On Submit to redirect to `<domain>/micro-thanks` (or set the funnel form
   element to go to the next step).
