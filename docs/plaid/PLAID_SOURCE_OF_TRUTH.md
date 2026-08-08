# Plaid — Source of Truth (MFunding.net)

**Last verified: 2026-08-08** — enabled products read directly from the Plaid dashboard
(`dashboard.plaid.com/settings/team/products`, team **MFunding.net**, owner Ernesto Lee);
integration state verified against the codebase + Supabase, not memory.

**Full API references** (saved from Plaid docs):
- `docs/plaid/api-reference-statements.md` — https://plaid.com/docs/api/products/statements/
- `docs/plaid/api-reference-transactions.md` — https://plaid.com/docs/api/products/transactions/
- Product guides: https://plaid.com/docs/statements/ · https://plaid.com/docs/transactions/

---

## 1. Products ENABLED on our account (dashboard-confirmed 2026-08-08)

| Product | Status | Notes |
|---|---|---|
| **Statements** | ✅ Enabled | "Retrieve a PDF copy of a user's financial statement" — the underwriter-ready path. |
| **Transactions** | ✅ Enabled | Up to 24 months of transaction data. |
| **Auth** | ✅ Enabled | Instantly verify bank accounts (0/200 used). |
| **Balance** | ✅ Enabled | Real-time account balances (0/200). |
| **Identity** | ✅ Enabled | Verify bank account ownership (0/200). |
| **Identity Match** (add-on) | ✅ Enabled | Match identity vs owner data (0/200). |

**Available but NOT enabled:** Assets, Enrich, Income, Investments (+ Investments Move / Refresh), Liabilities, Monitor.
**Not eligible / requires plan upgrade:** Consumer Report – Base, Income Insights, Partner Insights, Signal / Signal Transaction Scores, Transfer.
**Sandbox only:** Identity Verification.
**Add-ons requiring a base product:** Recurring Transactions & Transactions Refresh (need Transactions), Investments Refresh (needs Investments).

---

## 2. Our current integration state (code + DB verified 2026-08-08)

- **Environment:** Limited Production. **Vault secrets** (encrypted, names only): `PLAID_CLIENT_ID`,
  `PLAID_SECRET_PRODUCTION`, `PLAID_SECRET_SANDBOX`, `PLAID_PUBLIC_KEY` (legacy/deprecated).
  ⚠️ `keys_rotated_at` is null — the production secret has **never been rotated** since 2026-07-28 setup.
- **Edge functions:** `plaid-create-link-token`, `plaid-mint-link`, `plaid-exchange`, `plaid-pull`, `plaid-webhook`.
- **`plaid-pull`** already implements the STATEMENTS-FIRST path: calls `/statements/list`, downloads each PDF via
  `/statements/download`, files them as `customer_documents` (document_type `bank_statement`, most recent 6 months),
  then runs the AI underwriter. Falls back to storing transactions if statements are unavailable.
- **`plaid_items` table currently has 0 rows** — no bank is connected right now. (One orphan access token exists in
  the vault, `plaid_item_…ce70f690`, with no matching `plaid_items` row — leftover/deleted test.)

### ⚠️ KNOWN GAP that blocks statements today
`plaid-create-link-token` requests **`products: ['transactions']` only** (from `platform_settings.plaid.products`).
It does **not** consent to Statements. Per Plaid docs, an Item must be linked with the `statements` product to return
statement PDFs. **Fix:** add `statements` (with a `statements: { start_date, end_date }` window ≈ 6 months) to the
link token — OR, for the existing/orphan item, call `/link/token/create` with `access_token` + `products: ['statements']`
to add the product to that Item without a full re-link (see §3). Then a `plaid-pull` returns the PDFs.

---

## 3. Statements API reference  ·  https://plaid.com/docs/statements/

- **What:** US-only. Retrieves an exact, bank-branded **PDF** of the end user's bank statement, straight from the bank.
- **Availability:** up to **2 years** of statements.
- **Link-time config (required to get statements):**
  - Include a `statements` object with **`start_date`** and **`end_date`** in the link token.
  - Put `statements` in the `products` array (if Statements is the only product) or in
    **`required_if_supported_products`** when combined with others.
  - **For an EXISTING Item:** call `/link/token/create` with the item's `access_token` and `products: ["statements"]`
    to add Statements to that Item (no full re-link needed).
- **Endpoints:**
  - **`/statements/list`** — params: `access_token`. Returns accounts → nested `statements[]` each with
    `statement_id`, `month`, `year`. (Returns an error like `INVALID_PRODUCT` if the product/consent isn't present.)
  - **`/statements/download`** — params: `access_token`, `statement_id`. Returns the **raw PDF bytes** (not JSON).
  - **`/statements/refresh`** — rechecks for newly generated statements post-link; fires the
    **`STATEMENTS_REFRESH_COMPLETE`** webhook; then call `/statements/list` again.
- **Consent:** users who connected within the last two years can bypass the credentials pane and complete just the
  Statements consent step; otherwise they do the full Link flow.
- **Gating:** teams created 2023 or earlier may need a product-access request for Sandbox. Production pulls real
  statements from the FI. (Our account: Statements is Enabled — see §1.)

---

## 4. Transactions API reference  ·  https://plaid.com/docs/transactions/

- **What:** transaction history for depository + credit accounts — up to **24 months**. High fill rates
  (amount/date 100%, merchant ~97%, category ~95%).
- **Link-time config:** `products: ['transactions']`, a `webhook` URL, and **`transactions.days_requested`**
  (default 90; **max 730**). Our link token requests **180 days** (~6 months).
- **Endpoints:**
  - **`/transactions/sync`** (primary) — params: `access_token`, `cursor` (omit on first call). Returns transaction
    objects + `next_cursor` + `has_more`. Cursor-based pagination.
  - **`/transactions/recurring/get`** (add-on) — recurring inflow/outflow streams.
- **Webhooks:** **`SYNC_UPDATES_AVAILABLE`** — `initial_update_complete` (recent ~30 days ready), then
  `historical_update_complete` (full history ready).
- **Historical fetch:** after exchanging the `public_token`, call `/transactions/sync` with no cursor; the first call
  often returns nothing (Plaid is still fetching) — wait for the webhooks before expecting complete data.

---

## 5. To pull 4–6 months of bank statements end-to-end
1. Statements product is enabled ✅ (no Plaid-side action needed).
2. Add `statements` + a ~6-month `{start_date, end_date}` window to the link consent in `plaid-create-link-token`
   (and/or add it to the existing Item via `access_token` + `products:['statements']`).
3. Merchant connects their bank (creates a `plaid_items` row with statements consent).
4. `plaid-pull` lists + downloads the statement PDFs (already coded; grabs the most recent 6 → covers 4 months) and
   runs the underwriter.

---

## 6. OAuth institution enablement (dashboard snapshot, 2026-08-08)

Source: `dashboard.plaid.com/activity/status/oauth-institutions`. **Plaid exposes no API for this** — per-bank OAuth
approval is dashboard-only, so this is a recorded snapshot, not a live read. It is mirrored into
`platform_settings.plaid_status.oauth_institutions` (`{ enabled[], request_needed[], as_of, source }`) and rendered
on `/admin/plaid` and the System Monitor Plaid card, both explicitly labelled "as of <date>".

**✅ Enabled (11)** — merchants at these banks can complete the OAuth connect flow:

American Express · Bank of America · Bank of America Private Bank · Capital One · Chase · Citibank Online ·
Merrill · Merrill Lynch – Benefits · Navy Federal Credit Union · PNC · U.S. Bank

**🟡 Request needed (2)** — not yet approved for our account; a merchant banking there hits the
`OAUTH_BLOCKED_MESSAGE` fallback in `_shared/plaid.ts` and is steered to the secure upload link instead:

Charles Schwab · Fidelity

**Why it matters:** OAuth banks (the Chase/BofA class) cannot be connected with credentials — Plaid must have our
account approved for that specific institution. An unapproved OAuth bank fails at Link time, not at pull time.
Re-check the dashboard page and update `as_of` whenever the list changes.

---

## 7. Admin surfaces for Plaid (built 2026-08-08)

- **`/admin/plaid`** (super_admin) — the Plaid control room. Live: API reachability, vault key **presence** (never
  values), connected-bank count, environment. Snapshot: product access, OAuth enablement (§6). Plus a live search of
  Plaid's US institution directory (~10,000 institutions) showing each one's OAuth flag + supported products.
- **`/admin/settings/integrations`** — `PlaidStatusPanel`, the *editable* recorded ledger (product statuses/dates,
  `keys_rotated_at`, notes). `/admin/plaid` is read-only and links here rather than duplicating the editor.
- **`/admin/system`** — the System Monitor now renders a Plaid card from the `plaid` section of
  `system-health-check`'s response: `api_reachable`, `env`, `products_enabled`, `connected_items`,
  `oauth_enabled_count`, `oauth_request_needed`, `keys_rotated_at`. Green when the API is reachable **and** both
  Statements and Transactions are enabled; amber notes for request-needed banks and the never-rotated production key.
- **Edge function `plaid-institutions`** (`verify_jwt = false`; in-code staff-JWT **or** `?secret=` gate, same pattern
  as `plaid-pull`). Actions:
  - `{ action:'search', query, products?, count? }` → `/institutions/search` (US)
  - `{ action:'list', count?, offset? }` → `/institutions/get` (US, `include_optional_metadata`) + `total`
  - `{ action:'status' }` → the integration health snapshot, built by `buildPlaidHealth()` in `_shared/plaid.ts` —
    the **single** builder that `system-health-check` also uses, so the two surfaces can never drift.
  Institution results are shaped to `{ institution_id, name, oauth, products[], logo, url }`.

*Verified live 2026-08-08: `status` → api_reachable true, 6 products enabled, 0 connected items, 11 OAuth banks;
`list` → 10,032 US institutions; `search "chase"` → Chase (`ins_56`, oauth true).*
