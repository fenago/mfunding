# HERMES → Microsoft 365 — Administrator Consent Guide

**Audience:** Your organization's Microsoft 365 / Microsoft Entra ID administrator
**Goal:** Grant HERMES tenant-wide permission to securely connect to your Microsoft 365 (email, calendar, files, etc.) on your organization's behalf
**Time required:** ~5–10 minutes
**You must be:** A **Global Administrator** (recommended) — see [Prerequisites](#3-prerequisites)

> **One-time setup.** You do this **once** for your whole organization. After it's done, the people you authorize can use HERMES with Microsoft 365 — they will **not** each get a consent prompt.

---

## 📋 HERMES team: fill these in before sending this guide

> Replace every `{{PLACEHOLDER}}` below, then delete this box. Everything else in the document is generic and reusable.

| Placeholder | Value to insert | Where you get it |
|---|---|---|
| `{{HERMES_APP_NAME}}` | The exact display name of the app registration | Entra → App registrations → your app |
| `{{HERMES_CLIENT_ID}}` | Application (client) ID — a GUID | Same app → Overview |
| `OSP.net` *(publisher — already set)* | The verified publisher of HERMES | Entra → Branding / Publisher verification |
| `{{ADMIN_CONSENT_URL}}` | The one-click consent link (built in [§5](#5-path-a--one-click-consent-recommended)) | You construct it |
| `{{REDIRECT_URI}}` | The success URL the admin lands on after consent | Your Supabase callback, e.g. `https://<project>.supabase.co/functions/v1/ms-oauth/consent-complete` |
| `{{PERMISSION_PROFILE}}` | Which tier you request: **Read-only** or **Read/Write** | Your decision (see [§4](#4-what-hermes-can-access-permissions)) |
| `{{ACCESS_MODE}}` | **Delegated** (acts as the signed-in user) or **Application** (background, app-only) | Your app design |
| `{{SUPPORT_EMAIL}}` | Where the admin emails questions | Your support address |

---

## Table of contents

1. [What you are approving](#1-what-you-are-approving)
2. [Why this needs an administrator](#2-why-this-needs-an-administrator)
3. [Prerequisites](#3-prerequisites)
4. [What HERMES can access (permissions)](#4-what-hermes-can-access-permissions)
5. [Path A — One-click consent (recommended)](#5-path-a--one-click-consent-recommended)
6. [Path B — Manual consent in the Entra admin center](#6-path-b--manual-consent-in-the-entra-admin-center)
7. [Reading the consent screen](#7-reading-the-consent-screen)
8. [Verify it worked](#8-verify-it-worked)
9. [Optional — limit who can use HERMES](#9-optional--limit-who-can-use-hermes)
10. [How to revoke access later](#10-how-to-revoke-access-later)
11. [Troubleshooting](#11-troubleshooting)
12. [Security & privacy FAQ](#12-security--privacy-faq)
- [Appendix A — Exact permission scopes](#appendix-a--exact-permission-scopes)
- [Appendix B — Find your Tenant ID](#appendix-b--find-your-tenant-id)
- [Appendix C — What to send back to the HERMES team](#appendix-c--what-to-send-back-to-the-hermes-team)

---

## 1. What you are approving

HERMES is a multi-tenant application published by **OSP.net**. When you approve it, Microsoft creates a record of HERMES inside **your** tenant (an *Enterprise Application*, also called a *service principal*) and records that your organization has consented to a specific, named list of Microsoft Graph permissions.

Approving does **not**:
- give HERMES your password (it never sees it),
- give blanket "access to everything" (only the exact permissions listed in [§4](#4-what-hermes-can-access-permissions)),
- prevent you from revoking it later in two clicks ([§10](#10-how-to-revoke-access-later)).

Approving **does**:
- let HERMES request OAuth access tokens for your tenant, scoped to those exact permissions,
- stop every individual user from being prompted to consent themselves.

> **📸 Screenshot 1** — *Capture:* the final HERMES consent dialog (you'll reach it in §5/§7) showing the app name and publisher. *Annotate:* circle the app name `{{HERMES_APP_NAME}}` and the publisher `OSP.net`. *(This is a great "hero" image for the top of the guide.)*

---

## 2. Why this needs an administrator

Any one of these makes administrator approval mandatory — HERMES typically hits the **bold** one:

1. **Tenant consent policy.** Most organizations disable end-user consent (Entra default for many tenants is *"Do not allow user consent"* or *"verified publishers, limited permissions only"*). When that's on, **every** app — even low-risk ones — needs an admin to consent on the organization's behalf.
2. **Admin-restricted permissions.** Some Graph permissions (anything organization-wide, e.g. `*.All`, directory reads) are flagged *"Admin consent required"* and can never be granted by a regular user.
3. **Application (app-only) permissions.** If HERMES runs in the background without a signed-in user (`{{ACCESS_MODE}}` = Application), those permissions **always** require admin consent.

If a user has already tried to connect and seen an error like **AADSTS65001** ("user or administrator has not consented") or **AADSTS90094** ("admin consent required"), that's reason #1, #2, or #3 above. This guide resolves it.

---

## 3. Prerequisites

**Role.** To grant tenant-wide consent you must sign in as one of:
- **Global Administrator** ✅ *recommended — works for every permission, no edge cases*
- **Privileged Role Administrator**
- **Cloud Application Administrator** or **Application Administrator** *(can grant most app consents, but some highly-privileged permissions still require Global Administrator)*

> If you're not sure which role you have: Entra admin center → **Identity → Users → (your account) → Assigned roles**.

**You also need:**
- The HERMES **consent link** (`{{ADMIN_CONSENT_URL}}`) — or the app name `{{HERMES_APP_NAME}}` / client ID `{{HERMES_CLIENT_ID}}`.
- ~5–10 minutes.
- (Helpful) Your **Tenant ID** handy to send back to the HERMES team — see [Appendix B](#appendix-b--find-your-tenant-id).

**Two portals, same place.** You can use either — they're the same directory:
- **Microsoft Entra admin center** → <https://entra.microsoft.com> *(newer, recommended; "Azure Active Directory" was renamed "Microsoft Entra ID")*
- **Azure portal** → <https://portal.azure.com> → search **"Microsoft Entra ID"**

---

## 4. What HERMES can access (permissions)

### 4.1 The two access tiers

You will be granting **one** of these profiles (`{{PERMISSION_PROFILE}}`). Pick based on what HERMES needs to do:

- **🔵 Read-only** — HERMES can **see** data (read email, view calendar, open files) but **cannot change, send, or delete** anything. Lowest risk. Choose this if HERMES only summarizes, searches, and answers questions.
- **🟠 Read/Write** — HERMES can **also create, edit, send, and delete** (reply to email, book meetings, save files). Choose this if HERMES takes actions on your behalf.

> You can start Read-only and upgrade later (re-run consent with the Read/Write app configuration).

### 4.2 Permission matrix — every Microsoft 365 work & productivity tool HERMES connects to

This is the **complete** set of Microsoft 365 surfaces an assistant like HERMES uses. Each has a **Read-only** scope and a **Read/Write** scope, and a plain-English "what it enables." Keep the rows that match what HERMES does and drop the rest.

Legend: 🔒 = organization-wide, **always requires this admin consent** · 🔄 = needs `offline_access` to stay connected.

**A. Communication & scheduling**

| Tool / surface | 🔵 Read-only | 🟠 Read/Write | What it enables |
|---|---|---|---|
| **Outlook — Email** | `Mail.Read` | `Mail.ReadWrite` | Read-only: read & search messages, folders, attachments. Read/Write: also draft, reply, move, flag, delete. |
| **Outlook — Send email** | *(n/a)* | `Mail.Send` | Send email as the user. Omit if HERMES must never send. |
| **Outlook — Mailbox settings** | `MailboxSettings.Read` | `MailboxSettings.ReadWrite` | Read-only: working hours, time zone, auto-reply status. Read/Write: set out-of-office, mail rules, language. |
| **Calendar** | `Calendars.Read` | `Calendars.ReadWrite` | Read-only: view events & free/busy. Read/Write: create, reschedule, accept/decline, cancel meetings. |
| **Teams / online meetings** | `OnlineMeetings.Read` | `OnlineMeetings.ReadWrite` | Read-only: read meeting details. Read/Write: generate Teams meeting join links for events HERMES books. |
| **Contacts** | `Contacts.Read` | `Contacts.ReadWrite` | Read-only: look up saved contacts. Read/Write: add/edit contacts. |
| **People (relevant)** | `People.Read` | *(n/a)* | Surface the colleagues a user works with most (for "who do I email about X?"). |

**B. Files, documents & knowledge**

| Tool / surface | 🔵 Read-only | 🟠 Read/Write | What it enables |
|---|---|---|---|
| **OneDrive — Files** | `Files.Read` / `Files.Read.All` | `Files.ReadWrite` / `Files.ReadWrite.All` | Read-only: open & download files the user can access. Read/Write: upload, edit, delete. `.All` widens from "own files" to "all files the user has access to." |
| **SharePoint — Sites** 🔒 | `Sites.Read.All` | `Sites.ReadWrite.All` | Read-only: read documents, libraries & lists in SharePoint sites. Read/Write: edit & upload. |
| **Word / Excel / PowerPoint** | *(via `Files.Read*`)* | *(via `Files.ReadWrite*`)* | Read & edit document contents — incl. reading/writing Excel workbook cells. Uses the OneDrive/SharePoint file scopes above (no separate permission). |
| **OneNote** | `Notes.Read` / `Notes.Read.All` | `Notes.ReadWrite` / `Notes.ReadWrite.All` | Read-only: read notebooks & pages. Read/Write: create & edit notes. |
| **Microsoft Search** | *(via `Files.Read.All` + `Sites.Read.All`)* | *(n/a)* | Org-wide "find anything" across mail, files & sites. Uses the scopes above — no separate permission. |

**C. Teams & group collaboration**

| Tool / surface | 🔵 Read-only | 🟠 Read/Write | What it enables |
|---|---|---|---|
| **Teams — Chats (1:1 & group)** | `Chat.Read` | `Chat.ReadWrite` | Read-only: read chat messages & threads. Read/Write: send chat messages. |
| **Teams — Channel posts** 🔒 | `ChannelMessage.Read.All` | `ChannelMessage.Send` | Read-only: read team/channel conversations. Read/Write: post to channels. |
| **Teams — Membership** 🔒 | `Team.ReadBasic.All` / `Channel.ReadBasic.All` | *(n/a)* | List the teams & channels a user belongs to. |
| **Microsoft 365 Groups** 🔒 | `Group.Read.All` | `Group.ReadWrite.All` | Read-only: group membership, group mailbox & files. Read/Write: post to & manage groups. *(Also backs Planner.)* |

**D. Tasks & planning**

| Tool / surface | 🔵 Read-only | 🟠 Read/Write | What it enables |
|---|---|---|---|
| **Microsoft To Do** | `Tasks.Read` | `Tasks.ReadWrite` | Read-only: read personal tasks & lists. Read/Write: create, update, complete tasks. |
| **Planner (team boards)** 🔒 | `Tasks.Read` *(+`Group.Read.All`)* | `Tasks.ReadWrite` *(+`Group.ReadWrite.All`)* | Read/manage Planner tasks & buckets. Planner lives inside M365 Groups, so it also needs the Group scope. |

**E. Directory, presence & identity (plumbing)**

| Tool / surface | 🔵 Read-only | 🟠 Read/Write | What it enables |
|---|---|---|---|
| **Your profile / sign-in** | `User.Read` | *(same)* | Identify the connecting user (name, email, photo). Baseline — required. |
| **Org directory lookup** 🔒 | `User.ReadBasic.All` / `User.Read.All` | *(rarely needed)* | Look up any colleague's email, title, manager (for "send this to Jane in Finance"). |
| **Presence** 🔒 | `Presence.Read` / `Presence.Read.All` | *(n/a)* | See if someone is available / busy / away (for scheduling). |
| **Stay connected** 🔄 | `offline_access` | *(same)* | Refresh access without re-prompting the user. Required for an always-on agent. |
| **Sign-in basics** | `openid`, `profile`, `email` | *(same)* | Standard OpenID Connect claims. No data access on their own. |

> **HERMES default set (this deployment):** profile = `{{PERMISSION_PROFILE}}`.
> *(OSP.net team: list the exact rows you request so the admin sees precisely what's coming. A typical "productive assistant" starter set:)*
> **Read-only:** `User.Read`, `Mail.Read`, `MailboxSettings.Read`, `Calendars.Read`, `Contacts.Read`, `People.Read`, `Files.Read.All`, `Sites.Read.All`, `Notes.Read.All`, `Chat.Read`, `Tasks.Read`, `Presence.Read.All`, `offline_access`, `openid`, `profile`, `email`.
> **Read/Write (adds the ability to act):** swap in `Mail.ReadWrite` + `Mail.Send`, `MailboxSettings.ReadWrite`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `Contacts.ReadWrite`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `Notes.ReadWrite.All`, `Chat.ReadWrite`, `Tasks.ReadWrite`.

### 4.3 Delegated vs Application — which HERMES uses

- **Delegated (`{{ACCESS_MODE}}` = Delegated):** HERMES acts **as the signed-in user** and can only ever see what *that* user is already allowed to see. Safer, narrower.
- **Application (`{{ACCESS_MODE}}` = Application):** HERMES acts as **itself** (a background service) and can access data **across the tenant** within the granted scopes, with **no** signed-in user. More powerful; **always** requires admin consent. If HERMES uses app permissions, scope them tightly and consider [Application Access Policies](https://learn.microsoft.com/graph/auth-limit-mailbox-access) to restrict which mailboxes it can touch.

---

## 5. Path A — One-click consent (recommended)

This is the fastest route and the one to give every admin. The link both **registers** HERMES in your tenant and **records your consent** in one step.

### The link

```
{{ADMIN_CONSENT_URL}}
```

If the HERMES team hasn't pre-built it, it follows this shape:

```
https://login.microsoftonline.com/organizations/adminconsent
  ?client_id={{HERMES_CLIENT_ID}}
  &redirect_uri={{REDIRECT_URI}}
  &state=hermes-onboarding
```

*(One line, no spaces. `organizations` = "any work/school tenant"; you can replace it with your own Tenant ID to lock it to just your org.)*

### Steps

**5.1** In a browser where you can sign in as administrator, open `{{ADMIN_CONSENT_URL}}`.

> **📸 Screenshot 2** — *Capture:* the Microsoft sign-in page. *Annotate:* note "sign in with a **Global Administrator** account."

**5.2** Sign in (and complete MFA if prompted) **as the admin**.

**5.3** Microsoft shows the **"Permissions requested — Accept for your organization"** dialog. It lists:
- the app name `{{HERMES_APP_NAME}}` and publisher `OSP.net`,
- a checkbox/notice that this is **on behalf of your organization**,
- **every permission** from [§4](#4-what-hermes-can-access-permissions) in plain language.

Review it against the matrix in §4 (see [§7](#7-reading-the-consent-screen) for how to read it).

> **📸 Screenshot 3** — *Capture:* the full consent dialog with the permission list expanded. *Annotate:* highlight the "on behalf of your organization" line and 2–3 example permissions (e.g. "Read user mail", "Maintain access to data you have given it access to" = `offline_access`).

**5.4** Click **Accept**.

> **📸 Screenshot 4** — *Capture:* the **Accept** button (zoom in). *Annotate:* arrow pointing at it.

**5.5** Your browser redirects to the HERMES success page (`{{REDIRECT_URI}}`). You'll see a confirmation like "HERMES is now connected to your organization."

> **📸 Screenshot 5** — *Capture:* the HERMES success/landing page. *Annotate:* circle the success message.

✅ **Done.** Skip to [§8 Verify](#8-verify-it-worked). (Path B is only if you prefer to do it manually in the portal.)

---

## 6. Path B — Manual consent in the Entra admin center

Use this if your security policy requires you to review/approve apps inside the portal, or if HERMES already exists in your tenant (e.g. a user tried to connect first) and you just need to grant consent.

> **Note:** A custom app like HERMES won't be in the Microsoft app gallery. If HERMES isn't listed under Enterprise applications yet, use **Path A** once to provision it, then manage it here.

**6.1** Go to **<https://entra.microsoft.com>** and sign in as administrator.

> **📸 Screenshot 6** — *Capture:* the Entra admin center home. *Annotate:* circle your signed-in admin account (top-right).

**6.2** In the left menu, expand **Identity → Applications → Enterprise applications**.

> **📸 Screenshot 7** — *Capture:* the left navigation with **Identity → Applications → Enterprise applications** expanded. *Annotate:* highlight "Enterprise applications".

**6.3** In the **Enterprise applications** list, search for **`{{HERMES_APP_NAME}}`** and click it.

> **📸 Screenshot 8** — *Capture:* the search box with `{{HERMES_APP_NAME}}` typed and the matching result. *Annotate:* circle the result row.

**6.4** In the app's left menu choose **Security → Permissions** (on some tenants: **Manage → Permissions**).

> **📸 Screenshot 9** — *Capture:* the app's left menu with **Permissions** selected. *Annotate:* highlight "Permissions".

**6.5** Click **Grant admin consent for `<Your Organization>`** (button across the top).

> **📸 Screenshot 10** — *Capture:* the Permissions pane with the **"Grant admin consent for …"** button visible. *Annotate:* arrow to the button. *(If it's greyed out, see [Troubleshooting](#11-troubleshooting).)*

**6.6** A consent dialog opens (same as §5.3). Review the permissions and click **Accept**.

> **📸 Screenshot 11** — *Capture:* the consent dialog launched from the portal. *Annotate:* highlight Accept.

**6.7** Back on the Permissions pane, the granted permissions now appear under the **Admin consent** tab with a green/"Granted" status and your name as the consenter.

> **📸 Screenshot 12** — *Capture:* the Permissions pane showing the granted list with status. *Annotate:* circle one "Granted" status and the "Granted by" / date.

✅ **Done.** Continue to [§8 Verify](#8-verify-it-worked).

---

## 7. Reading the consent screen

The consent dialog uses friendly labels; here's how they map to the technical scopes in §4 so you know exactly what you're approving:

| Consent screen says… | Technical scope | Means |
|---|---|---|
| "Sign you in and read your profile" | `User.Read` | Identify the connecting user |
| "Read your mail" / "Read and write access to your mail" | `Mail.Read` / `Mail.ReadWrite` | View / view-and-modify email |
| "Send mail as you" | `Mail.Send` | Send email |
| "Read your calendars" / "…and write" | `Calendars.Read` / `Calendars.ReadWrite` | View / manage calendar |
| "Read all files you have access to" / "…and write" | `Files.Read.All` / `Files.ReadWrite.All` | OneDrive/SharePoint files |
| "Read items in all site collections" | `Sites.Read.All` | SharePoint sites |
| "Read your chat messages" | `Chat.Read` | Teams chat |
| "Read all users' full profiles" | `User.Read.All` | Org directory lookup |
| "Maintain access to data you have given it access to" | `offline_access` | Refresh tokens (stay connected) |

> **🔎 Trust check.** Look for a **"Verified" blue badge** next to `OSP.net`. If it says **"unverified,"** that's a heads-up to confirm with your HERMES contact before accepting — it doesn't change what's granted, but verified publishers have proven their identity to Microsoft. *(HERMES team: complete [Publisher Verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview) so this badge shows.)*

---

## 8. Verify it worked

**8.1** In Entra admin center → **Identity → Applications → Enterprise applications → `{{HERMES_APP_NAME}}` → Security → Permissions → Admin consent** tab. You should see every requested permission with status **Granted**.

> **📸 Screenshot 13** — *Capture:* the Admin consent tab with the full granted list. *Annotate:* none needed (this is the proof image).

**8.2** Check **Overview** of the same app — note the **Application ID** matches `{{HERMES_CLIENT_ID}}` and an **Object ID** exists (proof the service principal was created in your tenant).

**8.3** Ask your test user to connect HERMES again — they should now complete **without** a consent prompt.

> **📸 Screenshot 14** — *Capture:* HERMES showing "Microsoft 365 connected" for the test user. *Annotate:* circle the connected status.

---

## 9. Optional — limit who can use HERMES

By default, once consented, anyone in your tenant can use HERMES. To restrict it to specific people/groups:

**9.1** Enterprise applications → `{{HERMES_APP_NAME}}` → **Properties** → set **Assignment required?** to **Yes** → **Save**.

**9.2** Go to **Users and groups** → **Add user/group** → select the people or a security group → **Assign**.

> **📸 Screenshot 15** — *Capture:* the **Properties** pane with "Assignment required? = Yes". *Annotate:* highlight the toggle.
> **📸 Screenshot 16** — *Capture:* the **Users and groups** assignment pane with a group added. *Annotate:* circle the added group.

**Conditional Access (optional, advanced).** You can target HERMES with a Conditional Access policy (require MFA, compliant device, specific locations) under **Protection → Conditional Access → New policy → Target resources → select `{{HERMES_APP_NAME}}`**. Note: app-only/background access (`Application` permissions) is **not** governed by user Conditional Access.

---

## 10. How to revoke access later

You can cut HERMES off at any time:

**Option 1 — Remove the app entirely:** Enterprise applications → `{{HERMES_APP_NAME}}` → **Properties** → **Delete**. This removes the service principal and all consent.

**Option 2 — Revoke just the permissions:** the same app → **Security → Permissions** → review and remove granted permissions.

**Option 3 — Disable sign-in (keep the record):** **Properties** → **Enabled for users to sign-in? = No** → Save.

> **📸 Screenshot 17** — *Capture:* the **Properties** pane showing **Delete** and the **Enabled for users to sign-in** toggle. *Annotate:* highlight both.

Revoking is immediate for new tokens; existing access tokens expire within ~1 hour. Tell your HERMES contact (`{{SUPPORT_EMAIL}}`) so they stop attempting to connect.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **AADSTS65001** "user or administrator has not consented" | Consent never granted | Complete §5 or §6 as an admin |
| **AADSTS90094** "admin consent required" | A requested permission is admin-restricted | An admin must grant consent (this guide) |
| **"Grant admin consent" button is greyed out** | Your role can't consent | Sign in as **Global Administrator** (see §3) |
| **AADSTS650051 / "not configured as multi-tenant"** | App is single-tenant on the HERMES side | HERMES team: set app to *"Accounts in any organizational directory"* |
| **AADSTS500113 "no reply address registered"** | `{{REDIRECT_URI}}` not registered | HERMES team: add the redirect URI to the app registration |
| **"Need admin approval" wall, no Accept button** | User consent is disabled and you opened the *user* (not admin) flow | Use the **admin** consent link in §5, or grant via §6 |
| **Publisher shows "unverified"** | Publisher verification not done | Proceed if you trust HERMES; ask HERMES team to verify |
| **Consent blocked by an "admin consent workflow"** | Your tenant routes requests to a reviewer | Approve via **Identity → Applications → Admin consent requests**, or grant directly via §6 |
| **Some permissions granted, some failed** | Mixed admin/non-admin scopes or a transient error | Re-run **Grant admin consent** (§6.5); it's idempotent |

---

## 12. Security & privacy FAQ

- **Does HERMES get our passwords?** No. Authentication is OAuth 2.0 / OpenID Connect; HERMES only receives scoped access tokens issued by Microsoft.
- **Can HERMES see everything?** No — only the exact permissions in §4 that you approved. Read-only profiles can't change, send, or delete anything.
- **Where are tokens stored?** In the HERMES backend (Supabase) infrastructure operated by **OSP.net**; refresh tokens are encrypted at rest. Ask `{{SUPPORT_EMAIL}}` for the data-handling/security brief.
- **Can we see what HERMES did?** Yes — Microsoft logs every access in **Entra → Monitoring → Sign-in logs** (filter by `{{HERMES_APP_NAME}}`) and in your unified audit log.
- **Can we limit it to a pilot group?** Yes — see §9.
- **How do we turn it off?** See §10. Two clicks.

---

## Appendix A — Exact permission scopes

*(HERMES team: keep only the rows you actually request, matching §4.2.)*

**Read-only profile**
```
openid profile email offline_access
User.Read User.ReadBasic.All
Mail.Read MailboxSettings.Read
Calendars.Read OnlineMeetings.Read
Contacts.Read People.Read
Files.Read.All Sites.Read.All Notes.Read.All
Chat.Read ChannelMessage.Read.All Group.Read.All
Tasks.Read Presence.Read.All
```

**Read/Write profile** *(adds the ability to act)*
```
openid profile email offline_access
User.Read User.ReadBasic.All
Mail.ReadWrite Mail.Send MailboxSettings.ReadWrite
Calendars.ReadWrite OnlineMeetings.ReadWrite
Contacts.ReadWrite People.Read
Files.ReadWrite.All Sites.ReadWrite.All Notes.ReadWrite.All
Chat.ReadWrite ChannelMessage.Send Group.ReadWrite.All
Tasks.ReadWrite Presence.Read.All
```

Resource: Microsoft Graph (`https://graph.microsoft.com`). Full reference: <https://learn.microsoft.com/graph/permissions-reference>.

---

## Appendix B — Find your Tenant ID

Entra admin center → **Overview** → copy **Tenant ID** (a GUID). Or visit <https://entra.microsoft.com> → the Tenant ID is shown on the home/overview tile.

> **📸 Screenshot 18** — *Capture:* the Entra Overview tile showing **Tenant ID**. *Annotate:* circle the GUID (you can blur the rest).

---

## Appendix C — What to send back to the HERMES team

After consent, email `{{SUPPORT_EMAIL}}`:
1. ✅ "Admin consent granted for HERMES."
2. Your **Tenant ID** (Appendix B).
3. The **permission profile** you approved (Read-only or Read/Write).
4. (If you set assignment) the group/users allowed to use HERMES.

---

*Guide version 1.0 · Microsoft Entra ID portal labels current as of 2026. Microsoft occasionally renames menu items — if a label moved, search the Entra admin center for "Enterprise applications" or "Permissions."*
