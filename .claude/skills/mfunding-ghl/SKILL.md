---
name: mfunding-ghl
description: Manage the MFunding GoHighLevel sub-account (this project only) by talking to it in plain English. Operates on the MFunding location, NOT the global "ghl" skill (which points at the OSP account). Use whenever working in this project and the user mentions GHL, GoHighLevel, HighLevel, or the MFunding CRM — contacts, leads, opportunities/pipelines, conversations/SMS/email, calendars/appointments, tasks, custom fields, tags, campaigns/workflows, or sub-account settings. Triggers on phrases like "add a contact", "look up <name> in GHL", "what's in my pipeline", "send a text to <contact>", "book an appointment", "tag this lead", "how many leads this week".
---

# MFunding GHL — account manager (this project)

This skill operates the **MFunding** GoHighLevel sub-account (location `t7NmVR4WCy927j4Zon4b`) over the LeadConnector REST API v2.

> ⚠️ **Account isolation.** The global `~/.claude/skills/ghl` skill points at a DIFFERENT account (OSP). In this project, ALWAYS use this `mfunding-ghl` skill — never the global `ghl` — so you don't act on the wrong account. Credentials are read from the project `.env` (`GHL_API_KEY`, `GHL_LOCATION_ID`), which is gitignored; the same values are mirrored in the Supabase vault.

## How to make calls

Always use the helper script. It loads the MFunding creds from `.env`, injects auth + the `Version` header, and prints the HTTP status. The location ID is exported as `$LOC`:

```bash
bash .claude/skills/mfunding-ghl/ghl.sh <METHOD> "<path?query>" ['<json body>']
```

Examples (the helper sets `$LOC` = `t7NmVR4WCy927j4Zon4b`):

```bash
# Sanity check — sub-account details
bash .claude/skills/mfunding-ghl/ghl.sh GET "/locations/$LOC"

# List recent contacts
bash .claude/skills/mfunding-ghl/ghl.sh GET "/contacts/?locationId=$LOC&limit=20"

# Search contacts by name/email/phone
bash .claude/skills/mfunding-ghl/ghl.sh POST "/contacts/search" '{"locationId":"t7NmVR4WCy927j4Zon4b","query":"jane","pageLimit":20}'

# Create a contact
bash .claude/skills/mfunding-ghl/ghl.sh POST "/contacts/" '{"locationId":"t7NmVR4WCy927j4Zon4b","firstName":"Jane","lastName":"Doe","email":"jane@example.com","phone":"+13055551234"}'

# Update a contact
bash .claude/skills/mfunding-ghl/ghl.sh PUT "/contacts/<contactId>" '{"tags":["hot-lead"]}'

# Send an SMS in an existing conversation
bash .claude/skills/mfunding-ghl/ghl.sh POST "/conversations/messages" '{"type":"SMS","contactId":"<contactId>","message":"Hi from MFunding!"}'
```

## Working approach

1. **Read before write.** For any update/delete, first GET the record, show the user what you found, and confirm the change in plain language before mutating.
2. **Confirm outbound communication.** Never send an SMS/email or create/modify a campaign enrollment without explicit user go-ahead in the current turn — show the exact recipient and message first.
3. **Resolve names to IDs.** Users will say "text Khalil" — search contacts first, disambiguate if multiple matches, then act on the chosen ID.
4. **Report the HTTP status.** The helper appends `HTTP_STATUS:<code>`. 2xx = success; surface 4xx/5xx bodies instead of claiming success. `traceId` in errors is safe to share.
5. **Paginate when needed.** List endpoints take `limit` and a `startAfter`/`startAfterId` cursor (returned in `meta`). Don't claim "that's all" off one page.
6. **Pull live structure, don't guess.** Pipeline stage IDs, custom field IDs, calendar IDs, user IDs are account-specific — fetch them (see reference) rather than inventing values.

## Endpoint reference

See `reference/endpoints.md` for the common endpoint map (contacts, opportunities/pipelines, conversations, calendars, tasks, tags, custom fields, users). For anything not listed, the full GoHighLevel API v2 surface is documented at https://highlevel.stoplight.io/docs/integrations — the base URL is `https://services.leadconnectorhq.com` and the same `ghl.sh` helper works for every endpoint.

## Security

- The Private Integration Token lives only in the project `.env` (gitignored) and the Supabase vault. Do not echo it, log it, or paste it into responses or commits.
- This is a live production account — treat every write as real customer data.
