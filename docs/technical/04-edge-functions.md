# 04 — Edge Functions

29 functions in `supabase/functions/` + 3 shared modules. All are Deno; almost all import `corsHeaders` and the GHL/service-role helpers from `_shared/ghl.ts`.

`verify_jwt` below is the **live deployed value** (read from the platform on 2026-07-11), cross-checked against `supabase/config.toml`. The gateway `verify_jwt` only proves *some* valid JWT was presented — **role enforcement is in-code**, by reading the `Authorization` header → `db.auth.getUser(token)` → `profiles.role`.

---

## Shared modules

### `_shared/ghl.ts`
- `serviceClient()` — service-role Supabase client (bypasses RLS) from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- `getGhlConfig(db)` — calls the `public.get_ghl_config()` SECURITY DEFINER RPC, which reads the **vault** and returns `{ api_key, location_id, webhook_secret, live_transfer_secret }`. Throws if api_key/location_id are missing.
- `ghlFetch(cfg, method, path, body?)` — authenticated LeadConnector v2 fetch (`GHL_API_VERSION = 2021-07-28`).
- Contacts: `upsertContact`, `getContact`, `updateContactCustomFields`, `addContactTags`, `searchContacts`, `listContactFileUploads`.
- Businesses: `listBusinesses`, `createBusiness`, `linkContactToBusiness` (a `PUT /contacts/{id}` — `businessId` is rejected on upsert).
- Opportunities: `createOpportunity`, `updateOpportunity`, `listPipelines`.
- Email: `sendEmailToContact` (`POST /conversations/messages`, type `Email`), `latestEmailMessageId` (threading), `getContactThread`, `sendMarker()` (embeds `[emsg:<id>]` / `[msg:<id>]` into `activity_log.content` so opens/replies can be reconciled later).

### `_shared/llm.ts`
See [05 — Integrations](./05-integrations.md#llm-provider-layer). Exposes `callLLM(db, opts)` and `callAnthropicBlocks(db, model, blocks, opts)`.

### `_shared/closerDocMerge.ts`
Server-authoritative merge of closer legal templates. `mergeCloserDoc(slug, templateBody, closer, settings) → { content, missing[] }` + `sha256Hex(text)`. Default-deny placeholder regex (`/\[[^\]\n]{1,80}\](?!\()/g`, with an allow-list for `[ ]`, `[x]`, `[___]`). `missing.length > 0` is a **hard send blocker**. `src/lib/closerDocMerge.ts` is a client-side **mirror** used only for preview — the server copy is authoritative.

---

## Public intake (no auth — self-validating)

| Function | verify_jwt | Input | Output | Notes |
|----------|-----------|-------|--------|-------|
| `mca-intake` | false | `{contact_first_name, contact_last_name?, email, phone, business_name?, amount_requested?, use_of_funds?, lead_source?, lead_source_detail?}` | `{ok, deal_id, ghl_synced, ghl_warning?}` | Dedupes by customer email; **reuses an existing open MCA deal** rather than minting a duplicate deal + duplicate GHL opportunity. |
| `vcf-intake` | false | `{contact_first_name, …, active_positions?, total_balance?, daily_debit?, current_funders?, hardship_reason?}` | `{ok, deal_id, ghl_synced, ghl_warning?}` | Same dedupe; creates a `deal_type = 'vcf'` deal and routes to the VCF pipeline. |
| `contact-intake` | false | `{name, email, phone?, subject?, message, tcpa_consent?}` | `{ok, ghl_synced, ghl_warning?}` | DB insert into `contact_submissions` is the record and **fails loud**; GHL sync is best-effort. `sms-consent` tag only when `tcpa_consent === true`. |
| `partner-signup` | false | `{name, email, company?, phone?, partner_type?, notes?}` | `{ok:true}` | Inserts `referral_partners` with `status: 'inactive'`. No GHL sync. |

## Webhook / cron (shared-secret auth)

| Function | verify_jwt | Auth | Purpose |
|----------|-----------|------|---------|
| `ghl-webhook` | **false** | **Fail-closed** shared secret (`?secret=` or `x-ghl-secret`) compared with `timingSafeEqualStr` against vault `webhook_secret` (fallback env `GHL_WEBHOOK_SECRET`). **If no secret can be resolved at all it returns 503 and refuses to process** — this replaced an earlier fail-*open* bug. | Inbound GHL events → Supabase. Handles `ContactCreate/Update`, `OpportunityCreate/Update/StatusUpdate` (stage-id → `deals.status` maps for both MCA and VCF pipelines are hardcoded), `InboundMessage` (funder-reply detection + owner alert), `EmailOpened` (stamps `deal_submissions.opened_at` / `open_count`). Every event is best-effort logged to `ghl_webhook_events`. Also triggers `underwrite-deal` (service-role) when new bank statements land. |
| `live-transfer-intake` | **false** | Fail-closed shared secret (`?secret=` / `x-lt-secret`) vs vault `live_transfer_secret` (fallback env `LIVE_TRANSFER_SECRET`), constant-time compare. | Synergy "Double-Verified" live transfers / real-time appointments arriving as email → GHL workflow webhook. Rejects anything not from the trusted delivery domain or lacking the subject marker. **Self-healing**: auto-adopts a new trusted sender contact (tags `lt-source`, sets all-channel DND). **Hard-reject**: refuses to create records if the parsed "merchant" is the delivery robot itself or has no valid phone — but still fires the team alert so a real lead is never silently dropped. 30-day dedupe by phone/email; 5-minute first-call SLA (`first_call_due_at`). |
| `poll-funder-replies` | **false** | Shared secret (plain `!==` compare — **not** constant-time, unlike its siblings); 403s when no expected secret is set. | Pull-based reply detection (GitHub Action `funder-reply-poll.yml`, every 10 min). Scans each funder's GHL conversation for inbound email newer than our submission → stamps `response_at` (only-when-NULL, so it is idempotent with the push path), classifies via LLM, alerts the owner. Also harvests opens + merchant replies. |
| `funder-reply-reconcile` | true | **Dual-mode**: trusted cron via `?secret=`/`x-ghl-secret` (the workflow sends the service-role key as `Bearer` to satisfy the gateway), **or** a signed-in `admin`/`super_admin` JWT. | Matches stray inbound funder emails from unmapped GHL contacts to the right `lenders` row by sender domain, AI-extracts the contact, auto-applies only high-confidence proposals and leaves the rest for review. Actions: `scan \| backfill-phones \| match-phones \| sync-ghl \| list-unmatched-phones \| tie-phone \| apply \| cron`. |

## Staff-gated (verify_jwt = true **and** in-code role check)

| Function | Roles enforced in code | Input | Output / notes |
|----------|------------------------|-------|----------------|
| `submit-to-funders` | closer/admin/super_admin **+ `closer_owns_deal`**; `test_email` restricted to admin/super | `{dealId?, lenderIds?, lenderId?, notes?, resubmit?, test_email?, action?: courtesy_decline\|message_funder\|withdraw, subject?, body?, cc?, bcc?, attachments?}` | The submission engine — see [06](./06-subsystems.md). `{merchantNotified, ok, dealId, total, sentCount, via:"ghl", results[]}` |
| `send-merchant-email` | closer/admin/super + `closer_owns_deal` | `{dealId, subject, body, cc?, bcc?, regarding?}` | Sends through GHL, threads as a reply, cc/bcc capped at 10 and format-validated. Never auto-sent — explicit closer click only. |
| `push-application-to-ghl` | closer/admin/super + `closer_owns_deal` | `{dealId, blank?, resend?}` | Pushes ~40 hardcoded GHL custom-field ids so the e-sign doc merges pre-filled. Two workflow paths (MCA 04 fillable vs 04B pre-filled) with explicit un-enroll/tag logic (`app-prefilled`) so only one is ever active. 422s if the merchant has no email (GHL silently no-ops the doc send without one). |
| `sync-lead-to-ghl` | closer/admin/super + `closer_owns_deal` (when `dealId` given) | `{customerId, dealId?}` | Updates the **existing** GHL contact by id (deliberately not an upsert-by-email, which would fork a duplicate). Returns 409 with the conflicting contact id on an email collision. |
| `get-funder-email` | closer/admin/super | `{messageId \| emailMessageId \| conversationMessageId}` | Fetches one GHL email and **sanitizes the HTML** (strips script/style/iframe/handlers, neutralizes `javascript:`) for a sandboxed iframe. Read-only. |
| `ghl-comms` | closer/admin/super | `{action: searchContacts\|getThread\|sendEmail, …}` | Proxy for the admin Comms page. The FROM address is **hardcoded server-side** to `sales@send.mfunding.net`. |
| `deal-assistant` | closer/admin/super + `closer_owns_deal` | `{deal_id, question, history?}` (history truncated to 8 turns) | Deal-scoped AI. Per-funder missing-doc math is computed in TypeScript, never by the model. |
| `analyze-campaign` | closer/admin/super | `{campaignId}` | KPIs computed deterministically in code; the LLM only reasons over them. Persists to `campaign_analyses`. |
| `recommend-customer` | closer/admin/super | `{customer: {...}}` | Sales recommendation (products, opening script, objections). Replaced a client-side Gemini call that shipped the key in the bundle. |
| `lender-extract` | closer/admin/super | `{url}` | Firecrawl `/v1/scrape` + `callLLM` extraction into the `LenderExtraction` shape; falls back to raw fetch + tag-strip if Firecrawl is unavailable. |
| `bulk-lead-import` | admin/super | `{source_key, column_map, rows[], batch_id?, total_rows?, file_name?}` | CSV import with dedupe/merge by normalized phone OR email; routes to nurture pool vs active pipeline per `inbound_lead_sources.creates_deal`. Always creates `deal_type='mca'`. Writes `lead_import_batches` + `lead_intake_log`. |
| `send-closer-onboarding-package` | **admin/super only** (a closer cannot send themselves a package) | `{closerId, slugs?}` | Merges → freezes `merged_content` + `merged_sha256` → emails e-sign links. **All-or-nothing:** if any selected doc has an unresolved placeholder, 422 and *nothing* is sent. |
| `underwrite-deal` | service-role bearer (trusted `auto` call) **or** closer/admin/super + `closer_owns_deal` | `{dealId, mode?: manual\|auto}` | Three-pass AI underwriter — see [06](./06-subsystems.md). Dedups by `docs_hash`. |
| `llm-admin` | **super_admin only** | `{action: set_key\|key_status\|test, provider?, api_key?}` | Provider keys are **write-only** — only existence booleans are ever returned. |
| `admin-users` | **super_admin only** | `{action: list\|setRole\|updateFields\|setPaused\|setPassword\|logout\|delete, …}` | Self-destructive actions are blocked against the caller's own id. `setPaused` bans for `876000h`. |
| `instantly` | admin/super | `{action: overview\|accounts\|campaigns\|analytics}` | Read-only Instantly.ai v2 proxy; key from vault via `get_instantly_key()`. Degrades gracefully (200 + warnings) on partial API failure. |

## Gateway-only (verify_jwt = true, **no in-code role check**) — ⚠️

| Function | Risk |
|----------|------|
| `ghl-sync` | `{entity: customer\|deal\|lender\|vendor, id}` or `{action: pipelines\|paydown\|tag_funders}`. Outbound push to GHL. Any authenticated user (including a merchant) satisfies the gateway. |
| `ghl-docs-status` | `{ghl_contact_id}` → returns e-signed documents (incl. public viewer links) and uploaded bank statements for **any** contact id, with no ownership check. Tracked as audit finding **#5a** ([08](./08-security-posture.md)). |
| `recommend-lenders` | `{deal_id}` → reads deal + customer + underwriting via service role and returns an AI financial summary for **any** deal id. Tracked as audit finding **#5b**. `deal-assistant` enforces `closer_owns_deal` for the same class of call and should be mirrored. |

## Unauthenticated & structurally different — ⚠️

| Function | verify_jwt | Note |
|----------|-----------|------|
| `scan-lender-website` | **false**, no in-code auth | `{url}` → Firecrawl `/v2/agent` (paid), polls up to ~105s. Any anonymous caller can drive unlimited paid jobs (audit finding **#13**). Imports `serve` from `deno.land/std@0.168.0` instead of the repo's `Deno.serve` pattern. Superseded in purpose by the role-gated `lender-extract`. |
| `scan-vendor-website` | **false**, no in-code auth | Same shape, for lead-gen vendor sites. |

## Deployed but not in this repo

Five functions are **live** on the project yet have no source directory here (all `verify_jwt = false`): `process-document`, `process-document-upload`, `rag-chat`, `rag-chat-pgvector`, `gemini-chat`. They are leftovers from the RAG scaffolding (`documents` / `document_chunks` / `document_embeddings`, all 0 rows). Treat them as **dead code with a live URL** — they should be deleted or re-imported into the repo. Do not assume they are safe.

---

## Deploy convention

Functions are deployed either with the Supabase CLI (`supabase functions deploy <slug>`) or via the MCP `deploy_edge_function` tool. In **both** cases, **any function that imports from `_shared/` must have those shared files included in the deploy payload** — the platform does not resolve `../_shared/ghl.ts` from a previous deploy. Deploying `submit-to-funders` without also shipping `_shared/ghl.ts` produces a module-resolution failure at cold start.

`supabase/config.toml` is version-controlled specifically so `verify_jwt` is no longer a dashboard-only, invisible setting. Two functions (`instantly`, `underwrite-deal`) have **no entry** in it and inherit the dashboard value (both are currently `true`); `scan-lender-website` / `scan-vendor-website` are declared `false`.
