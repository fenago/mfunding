# Plaid Statements — API Reference

Source: https://plaid.com/docs/api/products/statements/ · saved 2026-08-08. Verify against the live page before relying on it.
See also `PLAID_SOURCE_OF_TRUTH.md` for our account's enabled products + integration state.

## Endpoints
| Endpoint | Method | Purpose |
|---|---|---|
| `/statements/list` | POST | Get a list of statements available to download |
| `/statements/download` | POST | Download a single bank statement (PDF) |
| `/statements/refresh` | POST | Trigger on-demand statement extractions for a date range |

---

## POST /statements/list
Retrieve all statements associated with an Item.

**Request:** `access_token` (required, string) · `client_id` (header/body) · `secret` (header/body)

**Response:**
```
{
  item_id: string,
  institution_id: string,
  institution_name: string,
  accounts: [{
    account_id: string,
    account_mask: string,          // last 2-4 chars
    account_name: string,
    account_official_name: string,
    account_type: string,          // e.g. "depository"
    account_subtype: string,       // e.g. "savings"
    statements: [{
      statement_id: string,
      month: integer,              // 1-12
      year: integer,               // min 2010
      date_posted: string|null     // YYYY-MM-DD
    }]
  }],
  request_id: string
}
```

## POST /statements/download
**Request:** `access_token` (required) · `statement_id` (required) · `client_id`/`secret`
**Response:** binary PDF bytes. Response header `Plaid-Content-Hash` = SHA-256 checksum for verification.

## POST /statements/refresh
Initiate an on-demand extraction to fetch statements for the given dates (up to 2 years).
**Request:** `access_token` (required) · `start_date` (required, YYYY-MM-DD) · `end_date` (required, YYYY-MM-DD) · `client_id`/`secret`
**Response:** `{ request_id: string }`. Completion is signaled by the `STATEMENTS_REFRESH_COMPLETE` webhook — then call `/statements/list` again.

## Webhook: STATEMENTS_REFRESH_COMPLETE
`webhook_type`="STATEMENTS" · `webhook_code`="STATEMENTS_REFRESH_COMPLETE" · `item_id` · `result`="SUCCESS"|"FAILURE" · `environment`="sandbox"|"production"

## Notes
- Availability: up to **2 years** of statements. Range inclusion uses the statement posted date.
- All Plaid identifiers are case-sensitive.
- To get statements for an Item it must be linked with the `statements` product (link token `statements:{start_date,end_date}` + `products`/`required_if_supported_products`), or add it to an existing Item via `/link/token/create` with `access_token` + `products:['statements']`.
