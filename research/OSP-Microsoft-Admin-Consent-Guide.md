# OSP.net → Microsoft 365 — Administrator Consent Guide

**Audience:** Your organization's Microsoft 365 / Microsoft Entra ID administrator
**Goal:** Approve OSP.net so your people can securely connect it to **their own** Microsoft 365 (email, calendar, files) — without each user being stopped by a consent prompt
**Time required:** ~5–10 minutes
**You must be:** A **Global Administrator** (recommended) — see [Prerequisites](#3-prerequisites)

> **One-time setup.** You do this **once**. After it's done, the people you allow can connect OSP.net to their own Microsoft 365 without each being prompted to approve.

> ### ❗ Does approving this give OSP.net access to all our employees or all our data? **No.**
> This is the #1 question admins ask, so here is exactly what approval does and does **not** do:
>
> - **What data OSP.net can see — only the individual user's own.** OSP.net connects **per person**. When someone connects it, OSP.net acts *as that one user* and can only ever see **that user's own** mailbox, calendar, and files — nothing they couldn't already see themselves. Approving it does **not** give OSP.net standing access to anyone else's mailbox. Any employee who never connects OSP.net shares **nothing**.
> - **Who is allowed to connect — your choice.** Microsoft's button is labeled *"Grant admin consent for your organization."* That phrase is about **removing the per-user approval prompt** — it does **not** mean "share everyone's data." By default it lets people in your org *choose* to connect (each still only to their own data). If you want only **one specific user** — or a small pilot group — to be able to connect at all, switch on **"Assignment required"** and assign just those people (2 minutes — [§9](#9-optional--limit-who-can-use-ospnet)). Then no one else can connect.
>
> **In short:** approving means *"stop prompting my users one by one,"* not *"open the whole company's data."* OSP.net only ever touches the data of the specific person who connects it.
>
> *(This describes OSP.net's per-user "delegated" access — the standard for an assistant like this. A background "application" mode would behave differently; OSP.net connects per user.)*

---

## Table of contents

1. [What you are approving](#1-what-you-are-approving)
2. [Why this needs an administrator](#2-why-this-needs-an-administrator)
3. [Prerequisites](#3-prerequisites)
4. [What OSP.net can access (permissions)](#4-what-ospnet-can-access-permissions)
5. [Path A — One-click consent (recommended)](#5-path-a--one-click-consent-recommended)
6. [Path B — Manual consent in the Entra admin center](#6-path-b--manual-consent-in-the-entra-admin-center)
7. [Reading the consent screen](#7-reading-the-consent-screen)
8. [Verify it worked](#8-verify-it-worked)
9. [Optional — limit who can use OSP.net](#9-optional--limit-who-can-use-ospnet)
10. [How to revoke access later](#10-how-to-revoke-access-later)
11. [Troubleshooting](#11-troubleshooting)
12. [Security & privacy FAQ](#12-security--privacy-faq)
- [Appendix A — Exact permission scopes](#appendix-a--exact-permission-scopes)
- [Appendix B — Find your Tenant ID](#appendix-b--find-your-tenant-id)
- [Appendix C — What to send back to the OSP.net team](#appendix-c--what-to-send-back-to-the-ospnet-team)

---

## 1. What you are approving

OSP.net is a multi-tenant application. When you approve it, Microsoft creates a record of OSP.net inside **your** directory (an *Enterprise Application*, also called a *service principal*) and notes that your organization has **pre-approved** a specific, named list of Microsoft Graph permissions — so each user doesn't have to approve them one at a time.

Approving does **not**:
- give OSP.net your (or anyone's) password — it never sees passwords,
- give OSP.net standing access to other employees' data — it only ever acts **as the individual person who connects it**, on **that person's own** data,
- give blanket "access to everything" (only the exact permissions listed in [§4](#4-what-ospnet-can-access-permissions)),
- prevent you from revoking it later in two clicks ([§10](#10-how-to-revoke-access-later)).

Approving **does**:
- let a user who connects OSP.net receive an OAuth token scoped to those exact permissions, for **their own** mailbox / calendar / files,
- remove the individual consent prompt, so connecting becomes one click for each user,
- (optionally) let you restrict *who* is allowed to connect to specific people or a pilot group ([§9](#9-optional--limit-who-can-use-ospnet)).


---

## 2. Why this needs an administrator

Any one of these makes administrator approval mandatory — OSP.net typically hits the **bold** one:

1. **Tenant consent policy.** Most organizations disable end-user consent (Entra default for many tenants is *"Do not allow user consent"* or *"verified publishers, limited permissions only"*). When that's on, **every** app — even low-risk ones — needs an admin to consent on the organization's behalf.
2. **Admin-restricted permissions.** Some Graph permissions (anything organization-wide, e.g. `*.All`, directory reads) are flagged *"Admin consent required"* and can never be granted by a regular user.
3. **Application (app-only) permissions.** If an app is configured to run in the background with no signed-in user, those permissions always require admin consent. *(OSP.net connects per user, so this isn't usually the trigger — reason #1 above is.)*

If a user has already tried to connect and seen an error like **AADSTS65001** ("user or administrator has not consented") or **AADSTS90094** ("admin consent required"), that's reason #1, #2, or #3 above. This guide resolves it.

---

## 3. Prerequisites

**Role.** To approve OSP.net on the organization's behalf (so users aren't each prompted), you must sign in as one of:
- **Global Administrator** ✅ *recommended — works for every permission, no edge cases*
- **Privileged Role Administrator**
- **Cloud Application Administrator** or **Application Administrator** *(can grant most app consents, but some highly-privileged permissions still require Global Administrator)*

> If you're not sure which role you have: Entra admin center → **Identity → Users → (your account) → Assigned roles**.

**You also need:**
- The OSP.net **consent link** (`https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=a446e50d-874d-4534-acf2-f383f15fb569&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&redirect_uri=https%3A%2F%2Ffgsvbhebxnimjlxfjfdx.supabase.co%2Fauth%2Fv1%2Fcallback&state=osp-onboarding`) — or the app name `OSP.net` / client ID `a446e50d-874d-4534-acf2-f383f15fb569`.
- ~5–10 minutes.
- (Helpful) Your **Tenant ID** handy to send back to the OSP.net team — see [Appendix B](#appendix-b--find-your-tenant-id).

**Two portals, same place.** You can use either — they're the same directory:
- **Microsoft Entra admin center** → <https://entra.microsoft.com> *(newer, recommended; "Azure Active Directory" was renamed "Microsoft Entra ID")*
- **Azure portal** → <https://portal.azure.com> → search **"Microsoft Entra ID"**

---

## 4. What OSP.net can access (permissions)

### 4.1 The two access tiers

You will be granting **one** of these profiles (`Read-only or Read/Write`). Pick based on what OSP.net needs to do:

- **🔵 Read-only** — OSP.net can **see** data (read email, view calendar, open files) but **cannot change, send, or delete** anything. Lowest risk. Choose this if OSP.net only summarizes, searches, and answers questions.
- **🟠 Read/Write** — OSP.net can **also create, edit, send, and delete** (reply to email, book meetings, save files). Choose this if OSP.net takes actions on your behalf.

> You can start Read-only and upgrade later (re-run consent with the Read/Write app configuration).

### 4.2 Permission matrix — every Microsoft 365 work & productivity tool OSP.net connects to

This is the **complete** set of Microsoft 365 surfaces an assistant like OSP.net uses. Each has a **Read-only** scope and a **Read/Write** scope, and a plain-English "what it enables." Keep the rows that match what OSP.net does and drop the rest.

Legend: 🔒 = organization-wide, **always requires this admin consent** · 🔄 = needs `offline_access` to stay connected.

**A. Communication & scheduling**

| Tool / surface | 🔵 Read-only | 🟠 Read/Write | What it enables |
|---|---|---|---|
| **Outlook — Email** | `Mail.Read` | `Mail.ReadWrite` | Read-only: read & search messages, folders, attachments. Read/Write: also draft, reply, move, flag, delete. |
| **Outlook — Send email** | *(n/a)* | `Mail.Send` | Send email as the user. Omit if OSP.net must never send. |
| **Outlook — Mailbox settings** | `MailboxSettings.Read` | `MailboxSettings.ReadWrite` | Read-only: working hours, time zone, auto-reply status. Read/Write: set out-of-office, mail rules, language. |
| **Calendar** | `Calendars.Read` | `Calendars.ReadWrite` | Read-only: view events & free/busy. Read/Write: create, reschedule, accept/decline, cancel meetings. |
| **Teams / online meetings** | `OnlineMeetings.Read` | `OnlineMeetings.ReadWrite` | Read-only: read meeting details. Read/Write: generate Teams meeting join links for events OSP.net books. |
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

> **OSP.net default set (this deployment):** profile = `Read-only or Read/Write`.
> *(OSP.net team: list the exact rows you request so the admin sees precisely what's coming. A typical "productive assistant" starter set:)*
> **Read-only:** `User.Read`, `Mail.Read`, `MailboxSettings.Read`, `Calendars.Read`, `Contacts.Read`, `People.Read`, `Files.Read.All`, `Sites.Read.All`, `Notes.Read.All`, `Chat.Read`, `Tasks.Read`, `Presence.Read.All`, `offline_access`, `openid`, `profile`, `email`.
> **Read/Write (adds the ability to act):** swap in `Mail.ReadWrite` + `Mail.Send`, `MailboxSettings.ReadWrite`, `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`, `Contacts.ReadWrite`, `Files.ReadWrite.All`, `Sites.ReadWrite.All`, `Notes.ReadWrite.All`, `Chat.ReadWrite`, `Tasks.ReadWrite`.

### 4.3 Delegated vs Application — which OSP.net uses

- **Delegated — this is what OSP.net uses.** OSP.net acts **as the signed-in user** and can only ever see what *that* user is already allowed to see. Safer, narrower, and the reason approval doesn't expose other employees' data.
- **Application (app-only) — not used by OSP.net.** An app in this mode acts as **itself** (a background service) and can access data **across the tenant** with **no** signed-in user. Listed here only for completeness; if OSP.net ever switched to it, the "per-user only" guarantee above would change.

---

## 5. Path A — One-click consent (recommended)

This is the fastest route and the one to give every admin. The link both **registers** OSP.net in your tenant and **records your consent** in one step.

### The link

```
https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=a446e50d-874d-4534-acf2-f383f15fb569&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&redirect_uri=https%3A%2F%2Ffgsvbhebxnimjlxfjfdx.supabase.co%2Fauth%2Fv1%2Fcallback&state=osp-onboarding
```

If the OSP.net team hasn't pre-built it, it follows this shape:

```
https://login.microsoftonline.com/organizations/adminconsent
  ?client_id=a446e50d-874d-4534-acf2-f383f15fb569
  &redirect_uri=https://fgsvbhebxnimjlxfjfdx.supabase.co/auth/v1/callback
  &state=ospnet-onboarding
```

*(One line, no spaces. `organizations` = "any work/school tenant"; you can replace it with your own Tenant ID to lock it to just your org.)*

### Steps

**5.1** In a browser where you can sign in as administrator, open `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=a446e50d-874d-4534-acf2-f383f15fb569&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&redirect_uri=https%3A%2F%2Ffgsvbhebxnimjlxfjfdx.supabase.co%2Fauth%2Fv1%2Fcallback&state=osp-onboarding`.


**5.2** Sign in (and complete MFA if prompted) **as the admin**.

**5.3** Microsoft shows the **"Permissions requested — Accept for your organization"** dialog. It lists:
- the app name `OSP.net` and publisher `OSP.net`,
- a checkbox/notice that this is **on behalf of your organization**,
- **every permission** from [§4](#4-what-ospnet-can-access-permissions) in plain language.

Review it against the matrix in §4 (see [§7](#7-reading-the-consent-screen) for how to read it).


**5.4** Click **Accept**.


**5.5** Your browser redirects to the OSP.net success page (`https://fgsvbhebxnimjlxfjfdx.supabase.co/auth/v1/callback`). You'll see a confirmation like "OSP.net is now connected to your organization."


✅ **Done.** Skip to [§8 Verify](#8-verify-it-worked). (Path B is only if you prefer to do it manually in the portal.)

---

## 6. Path B — Manual consent in the Entra admin center

Use this if your security policy requires you to review/approve apps inside the portal, or if OSP.net already exists in your tenant (e.g. a user tried to connect first) and you just need to grant consent.

> **Note:** A custom app like OSP.net won't be in the Microsoft app gallery. If OSP.net isn't listed under Enterprise applications yet, use **Path A** once to provision it, then manage it here.

**6.1** Go to **<https://entra.microsoft.com>** and sign in as administrator.


**6.2** In the left menu, expand **Identity → Applications → Enterprise applications**.


**6.3** In the **Enterprise applications** list, search for **`OSP.net`** and click it.


**6.4** In the app's left menu choose **Security → Permissions** (on some tenants: **Manage → Permissions**).


**6.5** Click **Grant admin consent for `<Your Organization>`** (button across the top).


**6.6** A consent dialog opens (same as §5.3). Review the permissions and click **Accept**.


**6.7** Back on the Permissions pane, the granted permissions now appear under the **Admin consent** tab with a green/"Granted" status and your name as the consenter.


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

> **🔎 Trust check.** Look for a **"Verified" blue badge** next to `OSP.net`. If it says **"unverified,"** that's a heads-up to confirm with your OSP.net contact before accepting — it doesn't change what's granted, but verified publishers have proven their identity to Microsoft. *(OSP.net team: complete [Publisher Verification](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview) so this badge shows.)*

---

## 8. Verify it worked

**8.1** In Entra admin center → **Identity → Applications → Enterprise applications → `OSP.net` → Security → Permissions → Admin consent** tab. You should see every requested permission with status **Granted**.


**8.2** Check **Overview** of the same app — note the **Application ID** matches `a446e50d-874d-4534-acf2-f383f15fb569` and an **Object ID** exists (proof the service principal was created in your tenant).

**8.3** Ask your test user to connect OSP.net again — they should now complete **without** a consent prompt.


---

## 9. Optional — limit who can use OSP.net

By default, once consented, anyone in your tenant can use OSP.net. To restrict it to specific people/groups:

**9.1** Enterprise applications → `OSP.net` → **Properties** → set **Assignment required?** to **Yes** → **Save**.

**9.2** Go to **Users and groups** → **Add user/group** → select the people or a security group → **Assign**.


**Conditional Access (optional, advanced).** You can target OSP.net with a Conditional Access policy (require MFA, compliant device, specific locations) under **Protection → Conditional Access → New policy → Target resources → select `OSP.net`**. Note: app-only/background access (`Application` permissions) is **not** governed by user Conditional Access.

---

## 10. How to revoke access later

You can cut OSP.net off at any time:

**Option 1 — Remove the app entirely:** Enterprise applications → `OSP.net` → **Properties** → **Delete**. This removes the service principal and all consent.

**Option 2 — Revoke just the permissions:** the same app → **Security → Permissions** → review and remove granted permissions.

**Option 3 — Disable sign-in (keep the record):** **Properties** → **Enabled for users to sign-in? = No** → Save.


Revoking is immediate for new tokens; existing access tokens expire within ~1 hour. Tell your OSP.net contact (`your OSP.net contact`) so they stop attempting to connect.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **AADSTS65001** "user or administrator has not consented" | Consent never granted | Complete §5 or §6 as an admin |
| **AADSTS90094** "admin consent required" | A requested permission is admin-restricted | An admin must grant consent (this guide) |
| **"Grant admin consent" button is greyed out** | Your role can't consent | Sign in as **Global Administrator** (see §3) |
| **AADSTS650051 / "not configured as multi-tenant"** | App is single-tenant on the OSP.net side | OSP.net team: set app to *"Accounts in any organizational directory"* |
| **AADSTS500113 "no reply address registered"** | `https://fgsvbhebxnimjlxfjfdx.supabase.co/auth/v1/callback` not registered | OSP.net team: add the redirect URI to the app registration |
| **"Need admin approval" wall, no Accept button** | User consent is disabled and you opened the *user* (not admin) flow | Use the **admin** consent link in §5, or grant via §6 |
| **Publisher shows "unverified"** | Publisher verification not done | Proceed if you trust OSP.net; ask OSP.net team to verify |
| **Consent blocked by an "admin consent workflow"** | Your tenant routes requests to a reviewer | Approve via **Identity → Applications → Admin consent requests**, or grant directly via §6 |
| **Some permissions granted, some failed** | Mixed admin/non-admin scopes or a transient error | Re-run **Grant admin consent** (§6.5); it's idempotent |

---

## 12. Security & privacy FAQ

- **Does OSP.net get our passwords?** No. Authentication is OAuth 2.0 / OpenID Connect; OSP.net only receives scoped access tokens issued by Microsoft.
- **Can OSP.net see everything?** No — only the exact permissions in §4 that you approved. Read-only profiles can't change, send, or delete anything.
- **Where are tokens stored?** In the OSP.net backend (Supabase) infrastructure operated by **OSP.net**; refresh tokens are encrypted at rest. Ask `your OSP.net contact` for the data-handling/security brief.
- **Can we see what OSP.net did?** Yes — Microsoft logs every access in **Entra → Monitoring → Sign-in logs** (filter by `OSP.net`) and in your unified audit log.
- **Can we limit it to a pilot group?** Yes — see §9.
- **How do we turn it off?** See §10. Two clicks.

---

## Appendix A — Exact permission scopes

*(OSP.net team: keep only the rows you actually request, matching §4.2.)*

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


---

## Appendix C — What to send back to the OSP.net team

After consent, email `your OSP.net contact`:
1. ✅ "Admin consent granted for OSP.net."
2. Your **Tenant ID** (Appendix B).
3. The **permission profile** you approved (Read-only or Read/Write).
4. (If you set assignment) the group/users allowed to use OSP.net.

---

*Guide version 1.0 · Microsoft Entra ID portal labels current as of 2026. Microsoft occasionally renames menu items — if a label moved, search the Entra admin center for "Enterprise applications" or "Permissions."*
