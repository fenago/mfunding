# MFunding API Keys Checklist
## Gather these before the build starts

---

## IMPORTANT NOTES

- **Email/SMS:** GHL handles ALL email and SMS (LeadConnector/Twilio built in). No separate email API needed unless you want the React portal to send transactional emails independently of GHL.
- **Stripe:** GHL SaaS Pro has Stripe built in for Sub-ISO billing (GHL → Payments → Integrations → connect your Stripe account). Separate Stripe keys only needed if you want payment processing directly in the React app.
- **GHL API v2 uses OAuth now** — no more static API keys. See instructions below.

---

## P0 — GET NOW (Phase 1-2: Deal Pipeline + Plaid + GHL)

- [ ] **PLAID_CLIENT_ID**
  - Sign up: https://dashboard.plaid.com
  - Start with Sandbox environment (free), upgrade to Development, then Production (~$200/mo)
  - Used by: Plaid Edge Function (bank verification)

- [ ] **PLAID_SECRET**
  - Same Plaid dashboard → Keys section
  - You get a different secret per environment (sandbox/development/production)
  - Used by: Plaid Edge Function

- [ ] **GHL_CLIENT_ID** + **GHL_CLIENT_SECRET**
  - GHL v2 API uses OAuth, not static keys. To get credentials:
    1. Go to https://marketplace.gohighlevel.com → **My Apps**
    2. Click **Create App** → choose **Private Integration**
    3. Give it a name (e.g., "MFunding Supabase Sync")
    4. Select scopes needed: contacts, opportunities, workflows, locations, oauth
    5. This gives you a **Client ID** and **Client Secret**
  - If you can't find "My Apps", try: **Settings → Integrations** or **Settings → Developer**
  - Used by: GHL Integration Edge Function (two-way sync)

- [ ] **GHL_LOCATION_ID**
  - GHL dashboard → **Settings → Business Profile** → scroll down to find the Location ID
  - It's also in the URL when you're inside a sub-account: `app.gohighlevel.com/v2/location/XXXXXXX/...`
  - Used by: GHL Integration Edge Function

- [ ] **SUPABASE_SERVICE_ROLE_KEY**
  - Supabase dashboard (https://supabase.com/dashboard) → your project → **Settings → API** → Service Role Key
  - NOT the anon key — this is the admin key
  - Already included in your Supabase plan
  - Used by: All Edge Functions that need admin-level DB access
  - ⚠️ NEVER expose this client-side

---

## P1 — GET BEFORE PHASE 5 (eSignature + Google Workspace)

- [ ] **DOCUSIGN_INTEGRATION_KEY** (or SignNow equivalent)
  - Sign up: https://developers.docusign.com → Create app
  - Free sandbox available, production pricing varies ($10-$40/envelope or monthly plan)
  - Used by: eSignature Edge Function (contract signing)

- [ ] **DOCUSIGN_SECRET_KEY**
  - Same DocuSign developer dashboard
  - Used by: eSignature Edge Function

- [ ] **DOCUSIGN_ACCOUNT_ID**
  - DocuSign dashboard → account settings
  - Used by: eSignature Edge Function

- [ ] **GOOGLE_CLIENT_ID**
  - Sign up: https://console.cloud.google.com → APIs & Services → Credentials → Create OAuth 2.0 Client
  - Enable these APIs in the console: Gmail, Calendar, Drive, Sheets, Docs, Meet, People
  - Free (API calls), Google Workspace subscription is separate
  - Used by: Google OAuth Edge Function + all Google Workspace integrations

- [ ] **GOOGLE_CLIENT_SECRET**
  - Same Google Cloud Console credential
  - Used by: Google OAuth Edge Function

---

## P2 — GET WHEN READY (Credit Bureau, PDF Parsing, Ads Reporting)

- [ ] **EXPERIAN_CLIENT_ID**
  - Sign up: https://developer.experian.com
  - Variable/enterprise pricing — requires business application
  - Used by: Credit pull integration (underwriting)

- [ ] **EXPERIAN_CLIENT_SECRET**
  - Same Experian developer portal
  - Used by: Credit pull integration

- [ ] **OCROLUS_API_KEY**
  - Sign up: https://ocrolus.com
  - Variable pricing — fallback for when merchants can't/won't use Plaid
  - Used by: PDF bank statement parsing

- [ ] **GOOGLE_ADS_DEVELOPER_TOKEN**
  - Apply at: https://developers.google.com/google-ads/api
  - Requires approved developer token (takes a few days)
  - Free (API access), ad spend is separate
  - Used by: Analytics dashboard (ads performance reporting)

- [ ] **GOOGLE_ADS_CUSTOMER_ID**
  - Your Google Ads account → top right corner (xxx-xxx-xxxx format)
  - Used by: Analytics dashboard

---

## P3 — OPTIONAL / FUTURE

- [ ] **STRIPE_SECRET_KEY** + **STRIPE_PUBLISHABLE_KEY** + **STRIPE_WEBHOOK_SECRET**
  - Only needed if you want payment processing OUTSIDE of GHL (e.g., direct billing in React app)
  - GHL already has Stripe built in for Sub-ISO billing via SaaS Mode
  - Sign up: https://stripe.com → Developers → API Keys
  - Can skip if GHL Stripe integration covers your needs

- [ ] **EMAIL_API_KEY** (SendGrid or Resend)
  - Only needed if you want the React portal to send emails independently of GHL
  - GHL handles all email/SMS automation already
  - Sign up: https://sendgrid.com (free tier: 100 emails/day) or https://resend.com
  - Can skip if GHL email covers your needs

- [ ] **THOMSON_REUTERS_CLEAR_API_KEY**
  - Enterprise pricing — contact sales at https://thomsonreuters.com
  - Used by: Business verification, identity intelligence
  - Can skip for MVP

- [ ] **DATAMERCH_API_KEY**
  - Contact DataMerch for access
  - Used by: Risky borrower cross-reference
  - Can skip for MVP

---

## WHERE KEYS GO

Once you have them, they go in two places:

### 1. Project `.env` file (for local development)
```env
# P0
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
GHL_CLIENT_ID=
GHL_CLIENT_SECRET=
GHL_LOCATION_ID=
SUPABASE_SERVICE_ROLE_KEY=

# P1
DOCUSIGN_INTEGRATION_KEY=
DOCUSIGN_SECRET_KEY=
DOCUSIGN_ACCOUNT_ID=
DOCUSIGN_BASE_URL=https://demo.docusign.net
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# P2
EXPERIAN_CLIENT_ID=
EXPERIAN_CLIENT_SECRET=
OCROLUS_API_KEY=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_DEVELOPER_TOKEN=
```

### 2. Supabase Edge Function Secrets (for production)
```bash
supabase secrets set PLAID_CLIENT_ID=xxx PLAID_SECRET=xxx
supabase secrets set GHL_CLIENT_ID=xxx GHL_CLIENT_SECRET=xxx GHL_LOCATION_ID=xxx
# ... etc for each key
```

---

## QUICK COUNT

| Priority | Keys Needed | Can Start Building Without Them? |
|----------|------------|----------------------------------|
| **P0** | 6 keys (Plaid, GHL, Supabase) | Phase 1 needs ZERO keys. P0 needed for Phase 2. |
| **P1** | 5 keys (DocuSign, Google) | Needed for Phase 5 (eSignature + Google Workspace) |
| **P2** | 5 keys (Experian, Ocrolus, Google Ads) | Get when ready for underwriting + ads reporting |
| **P3** | Optional (Stripe, Email, Thomson Reuters, DataMerch) | Only if needed beyond GHL capabilities |

*Phase 1 (Teams 1, 2, 5) needs ZERO external keys — just the existing Supabase setup. Start gathering P0 keys so they're ready for Phase 2.*
