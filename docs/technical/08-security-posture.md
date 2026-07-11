# 08 — Security Posture

Status as of **2026-07-11**. Two inputs: the code/DB as they actually are, and the read-only audit in `research/audit-findings-2026-07-11.md` (unchecked boxes there = still open).

---

## 🔴 STILL OPEN — owner action required: KEY ROTATION

These credentials are **known-compromised**. Removing them from the client bundle stopped the bleeding; it did **not** invalidate the leaked values. Rotation has **not** been done and can only be done by the account owner.

| Secret | Why it's burned | Rotate where | Then |
|--------|-----------------|--------------|------|
| **Supabase personal/management access token** (`sbp_…`) | Was committed to `.mcp.json` in a **public** repo. A management token can read/modify the entire project. | Supabase dashboard → Account → Access Tokens (revoke + issue new) | Update `SUPABASE_ACCESS_TOKEN` locally; this also unblocks `supabase db pull` and ends the migration-ledger drift ([07](./07-conventions-and-operations.md)). |
| **Gemini API key** (`AIzaSyBwZdDy0…`) | `VITE_GEMINI_API_KEY` was inlined into the production JS bundle — extractable by any visitor. | Google AI Studio / Cloud console | Set the new key via **Admin → Integrations** (it lands in `llm_provider_keys`, server-side only). |
| **Firecrawl API key** (`fc-6b6639d4ee…`) | `VITE_FIRECRAWL_API_KEY` was likewise in the bundle. | Firecrawl dashboard | `supabase secrets set FIRECRAWL_API_KEY=…`. |
| Hostinger API token | Pasted into a chat session. | Hostinger | env only. |

The `.env` file carries these warnings inline. **Until rotation happens, treat the Supabase project and both third-party accounts as compromised.**

---

## ✅ Hardened (verified in code/DB)

| Area | What was done |
|------|---------------|
| **Client bundle** | Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` remain client-side. Gemini/Firecrawl calls moved into edge functions (`recommend-customer`, `lender-extract`); LLM keys live in `llm_provider_keys` (**RLS on, zero policies** — no client JWT can read them) and are write-only through `llm-admin` (super_admin), which only ever returns existence booleans. |
| **GHL credentials** | Moved to the Supabase **vault**, reachable only through `get_ghl_config()` / `get_instantly_key()`, whose `EXECUTE` is granted **only to `postgres` and `service_role`** (verified against `pg_proc.proacl`). The browser never sees a GHL token. |
| **`ghl-webhook` fail-closed** | If no webhook secret can be resolved from the vault or env, the function returns **503 and processes nothing**. Previously a missing secret meant "accept everything". Constant-time comparison. Same pattern in `live-transfer-intake`. |
| **Closer RLS lockdown** | Closers can only SELECT/UPDATE deals, customers, submissions, documents, activity, and MCA applications they own — enforced by `closer_owns_deal` / `closer_owns_customer` in both USING and WITH CHECK. Commissions are read-only and self-scoped. |
| **Closer reassignment trigger** | `trg_enforce_deal_closer_assignment` — only admin/super_admin can change a deal's closer; a closer may claim an *unassigned* deal, and only to themselves. Needed because a WITH CHECK expression that re-selects the row cannot see the proposed new value ([03](./03-auth-and-rbac.md)). |
| **Role escalation** | `trg_prevent_role_self_escalation` — only a super_admin can change `profiles.role`. |
| **`submit-to-funders` authz** | Staff role check **+ `closer_owns_deal`**; `test_email` restricted to admin/super. Attachment pass-through URLs are allow-listed to `leadconnectorhq.com` / `msgsndr.com` so the sender can't be used as an exfiltration relay. |
| **E-signature ledger** | `closer_document_signatures` has no INSERT/UPDATE/DELETE policy for any role. Rows only via `sign_closer_document()`, which re-validates ownership, doc state, and placeholder-freeness in SQL. |
| **HTML sanitization** | `get-funder-email` strips script/style/iframe/event handlers and neutralizes `javascript:` URLs before the client renders the email in a sandboxed iframe. |
| **`admin-users`** | super_admin only; self-destructive actions blocked against the caller's own id. |
| **`verify_jwt` in version control** | `supabase/config.toml` pins it per function so it is no longer an invisible dashboard setting. |

---

## 🟠 Open findings (from the 2026-07-11 audit — none fixed)

Ranked; full detail in `research/audit-findings-2026-07-11.md`.

| # | Severity | Finding |
|---|----------|---------|
| **1** | 🔴 CRITICAL | **Storage buckets are not owner-scoped.** `storage.objects` policies for `customer-documents` and `lender-documents` gate only on `bucket_id` + `authenticated` — any logged-in user (including a merchant or any closer) can LIST and download or DELETE **every** merchant's bank statements, IDs, and voided checks. This bypasses the correctly-scoped `customer_documents` table RLS entirely. Fix: scope by path/ownership, or force all access through signed URLs minted by a role-checked edge function. |
| **5a** | 🟠 HIGH | `ghl-docs-status` has **zero in-code auth** — any authenticated user can pull any contact's e-signed documents (incl. public viewer links) and uploaded bank statements by passing a `ghl_contact_id`. |
| **5b** | 🟠 HIGH | `recommend-lenders` is gateway-JWT-only — no role or ownership check; returns an AI financial summary for any `deal_id`. Its sibling `deal-assistant` already enforces `closer_owns_deal`; mirror it. |
| **9** | 🟠 HIGH | `push-application-to-ghl` resolves GHL identity as `business_email || owner_email || customer.email` — **business email first**. Two merchants sharing a bookkeeper's address collapse onto one GHL contact, cross-wiring deals, reply detection, and e-sign document delivery. |
| **6 / 7 / 10** | 🟠 HIGH | GHL↔Supabase seam has no uniqueness guarantees: `.eq("email", …).maybeSingle()` on a **non-unique** email index throws on duplicates → 500 → GHL retry storm; `deals.ghl_opportunity_id` has **no unique index**, so an `OpportunityCreate` webhook landing in the intake's write-back window mints a second deal — and, if funded, a second commission. Intake dedupe is read-then-insert with no DB guard. |
| **13** | 🟡 MEDIUM | `scan-lender-website` / `scan-vendor-website` are **unauthenticated** (`verify_jwt=false`, no in-code check) and call the paid Firecrawl API — any anonymous caller can drain the wallet. Superseded by the role-gated `lender-extract`; gate or retire them. |
| **14** | 🟡 MEDIUM | `push-application-to-ghl` writes `owner_ssn`, `bank_routing_number`, `bank_account_number` into GHL custom fields for the document merge. The function itself is correctly gated; this is a data-minimization/residency question about the third-party CRM. |
| **15** | 🟡 MEDIUM | `dealService.updateDealStatus` locks backward stage moves behind super_admin (they re-send that stage's automated merchant emails), but the **`ghl-webhook` stage mirror has no such guard** — dragging a card backwards in GHL rewinds `deals.status` freely. |
| **2 / 3 / 4 / 16 / 18** | 🟠/🟡 | Money-accuracy bugs: the referral split disagreement (see [06](./06-subsystems.md)), campaign `spent || budget` falsy-zero fallback, the factor-blind affordability rating, funnel rates able to exceed 100%, inconsistent `funder_paid` bucketing. Not exploitable — but they misreport money. |

---

## Live Supabase advisor output (2026-07-11)

| Lint | Count | Notes |
|------|-------|-------|
| `anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` | 22 each | Every helper in `public` is `EXECUTE`-able by `anon`/`authenticated` over `/rest/v1/rpc/…`. Most are harmless predicates (`is_staff(uid)` just answers a question). **Three deserve attention:** `stamp_lead_assignment(uuid)` (an anon caller can skew round-robin rotation state), `next_lead_closer()` (leaks the closer roster + caps), and `seed_closer_documents(uuid)` (can seed rows for an arbitrary closer id). `sign_closer_document` is anon-executable but internally requires `auth.uid()` and a linked closer row, so it is safe. Consider `REVOKE EXECUTE … FROM anon, authenticated` on the internal ones. |
| `rls_policy_always_true` | 2 | `contact_submissions` and `funding_applications` INSERT `WITH CHECK (true)` — intentional (public forms), but they are unauthenticated write endpoints with no rate limiting. |
| `public_bucket_allows_listing` | 1 | `avatars` is a public bucket with a broad SELECT policy — clients can list all files. |
| `function_search_path_mutable` | 9 | Functions without a pinned `search_path`. |
| `extension_in_public` | 1 | `pg_net` installed in `public`. |
| `auth_leaked_password_protection` | 1 | Supabase's leaked-password check is **disabled**. |
| `rls_enabled_no_policy` | 1 | `llm_provider_keys` — **this one is intentional and correct** (deny-all to clients). |

---

## Dead code with a live URL

Five edge functions are deployed and reachable with `verify_jwt = false` but have **no source in this repo**: `process-document`, `process-document-upload`, `rag-chat`, `rag-chat-pgvector`, `gemini-chat`. They belong to the abandoned RAG scaffolding. Nobody can review what they do from this repository. Delete them from the project or restore their source.
