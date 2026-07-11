# 05 — Integrations

## GoHighLevel ("VibeReach")

GHL is the **CRM and email system of record**. It is not a side-channel: merchant email, funder email, e-signature documents, opportunities, and follow-up workflows all live there. The React app never talks to GHL directly — every call goes through an edge function so the Private Integration Token stays server-side (`src/services/ghlService.ts` and `commsService.ts` deliberately contain **zero** `.from()` calls).

| Fact | Value |
|------|-------|
| API | LeadConnector v2, version header `2021-07-28` |
| Location | `t7NmVR4WCy927j4Zon4b` |
| MCA pipeline | `bG9ZEh4eP9x60E1CyaMx` |
| VCF pipeline | `nsmH6jIeVA0SsZMMq4LC` |
| Sending address | `sales@send.mfunding.net` (hardcoded server-side in `ghl-comms`) |

### Credentials — vault, not env

`public.get_ghl_config()` is a `SECURITY DEFINER` function that reads `vault.decrypted_secrets` and returns:

```json
{ "api_key": …, "location_id": …, "webhook_secret": …, "live_transfer_secret": … }
```

from vault entries `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `LIVE_TRANSFER_SECRET`. Edge functions call it with a service-role client (`_shared/ghl.ts → getGhlConfig`). Env-var fallbacks (`GHL_WEBHOOK_SECRET`, `LIVE_TRANSFER_SECRET`) exist only for the secret gates.

### The inbound webhook gate (fail-closed)

`ghl-webhook` resolves the expected secret from the vault, then the env var. **If neither yields a secret it returns 503 and processes nothing.** Comparison is constant-time (`timingSafeEqualStr`). This replaced an earlier fail-*open* implementation where a missing secret meant "accept everything". `live-transfer-intake` uses the same pattern with its own secret. `poll-funder-replies` uses a plain `!==` compare (still 403s on an unset secret, but lacks the timing mitigation).

### Data flow

| Direction | Path |
|-----------|------|
| Supabase → GHL | `ghl-sync` (contacts, opportunities, businesses, `Paydown %` custom field that drives the GHL renewal workflow at 40/60/75/100%), `push-application-to-ghl` (application custom fields for doc merge), `submit-to-funders` / `send-merchant-email` (email send), the intake functions |
| GHL → Supabase | `ghl-webhook` (push) and `poll-funder-replies` / `funder-reply-reconcile` (pull, via GitHub Actions cron). Both write the same fields; the poller stamps `response_at` **only when NULL** so the two paths are idempotent with each other. |

Opportunity status mapping: `funded` → `won`, `declined`/`dead` → `lost`.

### Email reconciliation markers

Outbound emails write an `activity_log` row whose `content` embeds `[emsg:<messageId>]` (`sendMarker` in `_shared/ghl.ts`). Opens and replies are matched back to the submission/deal via that marker. Any code that writes a funder-reply log entry **must** use the marker protocol and the `ghl:funder-reply — <funder>` subject shape, or the reply will not be attributable (audit finding #8).

---

## Instantly.ai (cold email)

Read-only proxy — the platform does not send cold email from our code; Instantly does, and we surface its state.

- Function: `instantly` (admin/super_admin).
- Key: vault → `public.get_instantly_key()` RPC.
- Actions:
  - `overview` (default) → `{ key_present, accounts, campaigns, forwarding, real_site, errors }` — also performs live HTTP HEAD/redirect checks on each sending domain to verify it forwards to `mfunding.net`.
  - `accounts`, `campaigns`
  - `analytics` → `{ ok, totals, campaigns[], warning? }`
- Failure mode: returns **200 with warnings** rather than erroring, so the admin dashboard never breaks on a partial Instantly outage.
- UI: `src/pages/admin/EmailPage.tsx` (admin-only) and `ColdEmailPlannerPage.tsx` (any staff).

---

## LLM provider layer

All AI runs server-side through `supabase/functions/_shared/llm.ts`. **No LLM key ever reaches the browser.**

### Providers

| Wire protocol | Providers |
|---------------|-----------|
| Anthropic native | `anthropic` |
| Gemini native | `gemini` |
| OpenAI-compatible (one adapter, per-provider base URL) | `openai`, `openrouter`, `deepinfra`, `nvidia`, `ollama_cloud` |

Defaults (zero-regression fallback when no settings row exists): `DEFAULT_PROVIDER = "anthropic"`, `DEFAULT_MODEL = "claude-sonnet-4-6"`.

### Configuration tables

| Table | Columns | RLS |
|-------|---------|-----|
| `llm_settings` | `id` (singleton = 1), `provider`, `model`, `task_overrides` (jsonb), `updated_at` | super_admin manages; read by service role |
| `llm_provider_keys` | `provider` (PK), `api_key`, `updated_at` | **RLS on, zero policies** — service role only. Keys are write-only via `llm-admin`; the API never returns them, only `key_status` booleans. |

### Resolution

`resolveConfig(db, task?)` reads `llm_settings`, then applies a **per-task override** from `task_overrides` if one exists. Task strings currently in use:

`analyze_campaign`, `recommend_lenders`, `deal_assistant`, `customer_recommendation`, `lender_extract`, `classify_reply`, `summarize_merchant_reply`.

`getKey(db, provider)` reads `llm_provider_keys` and throws a user-legible "set it in Admin → Integrations" error when unset.

### Two entry points

| Function | Use |
|----------|-----|
| `callLLM(db, opts)` | Normal text/JSON calls. `jsonMode` strips ``` fences. Provider/model come from `llm_settings` (+ task override). |
| `callAnthropicBlocks(db, model, content[], opts)` | **Forces provider `anthropic`** regardless of settings, because it sends native PDF **document blocks** (an Anthropic-only feature) and can force tool-use so extraction JSON cannot omit required fields. Used by `underwrite-deal` to read bank statements. |

The underwriter's models are separately tunable in `underwriting_settings.extraction_model` (default `claude-sonnet-4-6`) and `.judge_model` (default `claude-opus-4-8`).

Admin UI: `src/pages/admin/settings/AIProviderPanel.tsx` + `src/services/llmProviderService.ts` → `llm-admin`.

---

## Plaid

**Scaffolded, not live.** The schema (`plaid_connections`, `bank_analyses.source ∈ manual|plaid`) and a client flag (`VITE_PLAID_ENABLED`, `PLAID_ENABLED` in `src/config.ts`) exist, and `src/pages/ApplyPage.tsx` / `BankAnalysisCard.tsx` branch on the flag. There is **no Plaid edge function and no Plaid SDK dependency in `package.json`**, and `plaid_connections` / `bank_analyses` are both empty. The path that is actually in production is: merchant uploads bank statement PDFs (via the GHL form / email) → `underwrite-deal` reads them with Claude. Treat any doc claiming "60-second Plaid verification" as aspirational.

---

## Firecrawl

Website scraping for the funder/vendor network.

| Consumer | Endpoint | Auth |
|----------|----------|------|
| `lender-extract` | `/v1/scrape` + `callLLM` | staff-gated ✅ |
| `scan-lender-website` | `/v2/agent` (autonomous, polled ~105s) | **unauthenticated** ⚠️ |
| `scan-vendor-website` | `/v2/agent` | **unauthenticated** ⚠️ |

The key comes from the Supabase secret `FIRECRAWL_API_KEY` (with a legacy `VITE_FIRECRAWL_API_KEY` fallback that should be dropped). The two `scan-*` functions can be driven by any anonymous caller and spend real money — see [08](./08-security-posture.md) finding #13.
