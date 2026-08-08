# Plaid Transactions — API Reference

Source: https://plaid.com/docs/api/products/transactions/ · saved 2026-08-08. Verify against the live page before relying on it.
See also `PLAID_SOURCE_OF_TRUTH.md` for our account's enabled products + integration state.

## Endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/transactions/sync` | POST | Incremental updates via cursor pagination (**preferred**) |
| `/transactions/get` | POST | Offset-paginated fetch by date range (legacy) |
| `/transactions/recurring/get` | POST | Recurring inflow/outflow streams (add-on) |
| `/transactions/refresh` | POST | Force an on-demand transaction refresh |

---

## POST /transactions/sync  (preferred)
**Request:** `client_id`, `secret`, `access_token` (required); `cursor` (omit on first call; `"now"` to migrate from /get); `count` (default 100, max 500); `account_id` (optional filter — creates a per-account cursor stream); `options.include_raw_description`, `options.personal_finance_category_version` (`v1`|`v2`), `options.days_requested` (1–730, default 90).

**Response:** `accounts[]` · `added[]` · `modified[]` · `removed[]` (ids) · `next_cursor` · `has_more` (bool) · `request_id` · `transactions_update_status` (`TRANSACTIONS_UPDATE_STATUS_UNKNOWN`|`NOT_READY`|`INITIAL_UPDATE_COMPLETE`|`HISTORICAL_UPDATE_COMPLETE`).

### Transaction object (key fields)
`transaction_id` · `account_id` · `amount` (positive=outflow, negative=inflow) · `iso_currency_code` / `unofficial_currency_code` · `date` (YYYY-MM-DD) · `datetime` · `authorized_date` / `authorized_datetime` · `name` (bank description) · `merchant_name` · `merchant_entity_id` · `payment_channel` (`online`|`in store`|`other`) · `pending` (bool) · `pending_transaction_id` · `check_number` · `logo_url` · `website` · `account_owner` · `transaction_code`.
- `personal_finance_category`: `.primary`, `.detailed`, `.confidence_level` (`VERY_HIGH`|`HIGH`|`MEDIUM`|`LOW`|`UNKNOWN`).
- `location`: `.address` `.city` `.region` `.postal_code` `.country` `.lat` `.lon` `.store_number`.
- `payment_meta`: `.reference_number` `.ppd_id` `.payee` `.payer` `.payment_method` `.payment_processor`.
- `counterparties[]`: `.name` `.entity_id` `.type` (`merchant`|`financial_institution`|`payment_app`|`marketplace`|`payment_terminal`|`income_source`) `.website` `.logo_url` `.confidence_level`.

### Account object (key fields)
`account_id` · `name` · `official_name` · `type` (`depository`|`credit`|`loan`|`investment`|`brokerage`|`other`) · `subtype` (`checking`|`savings`|…) · `mask` · `balances` (`.current` `.available` `.limit` `.iso_currency_code` `.last_updated_datetime`).

## POST /transactions/get  (legacy — new work should use /sync)
**Request:** `client_id`, `secret`, `access_token`, `start_date` (YYYY-MM-DD), `end_date` (required); `options.account_ids[]`, `options.count` (max 500), `options.offset`, `options.include_raw_description`, `options.personal_finance_category_version`, `options.days_requested` (1–730).
**Response:** `accounts[]` · `transactions[]` (reverse-chronological) · `total_transactions` · `request_id`.

## POST /transactions/recurring/get
**Request:** `client_id`, `secret`, `access_token`; `options`. **Response:** `recurring_transactions[]` · `request_id`.

## POST /transactions/refresh
**Request:** `client_id`, `secret`, `access_token`. **Response:** `{ request_id }`.

## Webhooks (`webhook_type`="TRANSACTIONS")
- **`SYNC_UPDATES_AVAILABLE`** — new updates ready via /sync. Fields: `item_id`, `error`.
- **`INITIAL_UPDATE`** — initial pull complete. `item_id`.
- **`HISTORICAL_UPDATE`** — full history ready. `item_id`.
- **`RECURRING_TRANSACTIONS_UPDATE`** — recurring updates ready. `item_id`.
- **`DEFAULT_UPDATE`** — new txns (legacy). `item_id`.
- **`TRANSACTIONS_REMOVED`** — `item_id`, `removed_transactions[]`.

## Implementation notes
- Persist `next_cursor` per Item (per account_id if used); on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, restart from the first-page cursor, not the failed request.
- Data goes back up to **24 months**. First /sync call often returns nothing — wait for webhooks.
- Plaid checks institutions 1–4×/day; check `last_successful_update` via `/item/get`.
