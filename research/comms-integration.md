# mfunding.net Comms Page — Unified Contacts & Communication over GoHighLevel

**Goal:** Let logged-in staff (closers, admins, super-admins) search contacts and send
email to them — e.g. a closer emailing a lender for a submission — without leaving
mfunding.net. **We are NOT building an email system.** Sending, delivery, inboxes, and
conversation history already live in **GoHighLevel** (the engine behind VibeReach).
The Comms page is a thin client that calls the GHL API. GHL stays the system of record.

---

## Why this is small (most of it already exists)

The app already talks to GHL through `supabase/functions/_shared/ghl.ts`, which has:

| Helper | Use for Comms page |
|---|---|
| `getGhlConfig(db)` | Pulls API key + location from the Supabase vault (never the client) |
| `ghlFetch(cfg, method, path, body)` | Generic authenticated GHL call |
| `upsertContact` / `addContactTags` / `getContact` | Contact create/tag/read |
| **`sendEmailToContact(cfg, contactId, subject, html, {emailFrom, text})`** | **Already sends email via `POST /conversations/messages` `type:"Email"`** |

So the send path is **already written**. We add two small helpers and one edge-function
route, plus a React page.

---

## Architecture

```
React page  /admin/comms   (closer | admin | super_admin)
      │  supabase.functions.invoke("ghl-comms", { action, ... })   ← Supabase JWT
      ▼
Edge function  ghl-comms   (verify_jwt = true, mirrors ghl-sync)
      │  getGhlConfig(db) → creds from vault
      ▼
GoHighLevel API (services.leadconnectorhq.com)
   • POST /contacts/search           → search/list contacts
   • GET  /conversations/search      → find a contact's conversation
   • GET  /conversations/{id}/messages → thread history
   • POST /conversations/messages    → send Email   (sendEmailToContact)
```

No new database tables are required for v1 — GHL holds contacts and message history,
and the page reads them live. (Optional audit mirror below.)

---

## New edge function: `ghl-comms`

Copy the header/auth/CORS skeleton from `ghl-sync/index.ts`. One POST endpoint that
switches on `action`:

| `action` | Body | GHL call | Returns |
|---|---|---|---|
| `searchContacts` | `{ query, tags?, pageLimit?, startAfter? }` | `POST /contacts/search` | `{ contacts, total, nextCursor }` |
| `getThread` | `{ contactId }` | `GET /conversations/search?contactId=` → `GET /conversations/{id}/messages` | `{ conversationId, messages }` |
| `sendEmail` | `{ contactId, subject, html, text? }` | `sendEmailToContact(...)` | `{ messageId, conversationId }` |

Auth rule inside the function: decode the caller's Supabase JWT, look up `profiles.role`,
allow only `closer | admin | super_admin` (same gate `admin-users` already uses). The
**from-address is fixed server-side** to the shared company mailbox; the client never
chooses the sender. Set `emailFrom` (or rely on the GHL location default) and put the
sending user's name in the signature so replies are attributable.

### Two helpers to add to `_shared/ghl.ts`

```ts
export async function searchContacts(cfg, { query, pageLimit = 20, startAfter, filters }) {
  return ghlFetch(cfg, "POST", "/contacts/search",
    { locationId: cfg.locationId, query, pageLimit, ...(startAfter && { searchAfter: startAfter }) });
}
export async function getContactThread(cfg, contactId) {
  const convs = await ghlFetch(cfg, "GET",
    `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`);
  const id = convs?.conversations?.[0]?.id;
  return id ? await ghlFetch(cfg, "GET", `/conversations/${id}/messages`) : { messages: [] };
}
```

---

## React page: `/admin/comms`

- **Route:** add to `src/router/index.tsx` (wrap in `lazyWithReload` like the others).
- **Sidebar:** new item in the **Pipeline** group (or a new "Comms" group),
  `roles: OPS`, icon `ChatBubbleLeftRightIcon`. Visible to all staff.
- **Layout:** two-pane.
  - **Left:** search box + tag filter chips (`lender`, `lead-vendor`, `funder-network`,
    paper tier) → results list (name, company, email, tags). Debounced call to
    `searchContacts`. Quick filter buttons: "Lenders", "Lead vendors".
  - **Right:** selected contact → details header + **compose email** (subject + body,
    optional saved templates such as a submission cover note) + **history** pulled from
    `getThread` (read-only timeline of prior emails).
- **Send flow:** confirm dialog showing exact recipient + subject → `sendEmail` →
  on success, optimistic-append to the thread. Email-only; no SMS controls anywhere.
- **Service:** `src/services/commsService.ts` wrapping the three `invoke` calls,
  mirroring `adminUserService.ts` (extracts `FunctionsHttpError` context).

---

## Templates (closer efficiency)

Seed a few reusable email templates the closer picks from, since the #1 use case is
"email a lender for a submission":
- **Submission cover** — "New deal for review: [merchant], [state], [monthly revenue],
  [amount requested]. Statements attached." (advance/working-capital language for MCA).
- **Status follow-up** — "Following up on [merchant] submitted [date]."
- **New ISO intro** — for first contact with a funder's partner program.

Store as static config first (`src/config/commsTemplates.ts`); promote to a DB table only
if staff need to edit them in-app.

---

## Optional v1.5 — audit mirror

If you want in-app reporting on outreach without calling GHL each time, add a thin
`contact_messages` log written by the `sendEmail` action: `id, ghl_contact_id, sent_by
(auth.uid()), subject, snippet, ghl_message_id, created_at`, RLS = staff read, owner
write. This is a *log*, not a mailbox — GHL still does the actual sending and stores the
canonical thread. Skip for v1.

---

## ⚠️ One setup prerequisite (flag before go-live)

The GHL location detail currently shows `defaultEmailService: ""` — i.e. **no email
service is connected** on the MFunding sub-account yet. Outbound email via
`/conversations/messages` needs an email provider wired up in GHL
(**Settings → Email Services**: LC Email / Mailgun, with the sending domain verified).
Until that's done, `sendEmail` calls will fail at GHL. Contact search, history, and
tagging all work today regardless.

---

## Build order (when approved)

1. Add `searchContacts` + `getContactThread` to `_shared/ghl.ts`.
2. Create + deploy `ghl-comms` edge function (verify_jwt, role gate, 3 actions).
3. `src/services/commsService.ts`.
4. `/admin/comms` page + sidebar nav + router entry.
5. Seed `commsTemplates.ts`.
6. Connect an email service in GHL (prereq for sending).
7. (Optional) `contact_messages` audit table.

Everything in 1–5 reuses existing patterns (`ghl-sync`, `admin-users`, `lazyWithReload`,
`adminUserService`). Estimated: a focused build, no new third-party dependencies.
