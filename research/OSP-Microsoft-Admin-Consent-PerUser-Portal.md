# Connect OSP.net to Microsoft 365 — Per-User Method (Portal)

**Who does this:** A Microsoft 365 administrator (**Global Administrator**).
**How long:** ~5 minutes.
**Use this method when:** you want **only specific people** to be able to use OSP.net — **not** the whole organization.

> How this differs from the one-click link: the link opens OSP.net to anyone in your org (each only to their own data). This portal method lets you **pick exactly which users** can connect, and lock everyone else out.

---

## Before you start

OSP.net has to already show up in your organization's app list. It gets added there the first time **anyone clicks "Connect Microsoft" inside OSP.net** (even if they were blocked), **or** the first time you run the approval link. If you reach **Step 3** and don't see OSP.net, do one of those once, then come back.

---

## Step 1 — Open the Microsoft Entra admin center

Go to this address and sign in with your **Global Administrator** account:

```
https://entra.microsoft.com
```

---

## Step 2 — Open "Enterprise applications"

At the **very top of the page** there's a search bar. Type **Enterprise applications** and click it in the dropdown.

*(Or use this direct link — it lands you in the same place:)*

```
https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview
```

---

## Step 3 — Find and open OSP.net

In the **"Search by application name"** box, type **OSP.net** and click it in the list.

*(Don't see it? Read **Before you start** at the top — it isn't in your tenant yet.)*

---

## Step 4 — Approve the permissions (one time)

1. On the **left-hand menu**, click **Security**, then **Permissions**.
2. Click the button at the top: **Grant admin consent for `<Your Organization>`**.
3. A window opens listing what OSP.net can access. Click **Accept**.

> This approves the Microsoft permissions OSP.net needs. You only do it once.

---

## Step 5 — Turn on "only assigned users can use it"

1. On the **left-hand menu**, click **Properties**.
2. Find **Assignment required?** and switch it to **Yes**.
3. Click **Save** at the top.

> This is the switch that makes it **per-user**: now only people you specifically add can connect. Everyone else is locked out.

---

## Step 6 — Add the specific people who are allowed

1. On the **left-hand menu**, click **Users and groups**.
2. Click **+ Add user/group** at the top.
3. Under **Users**, click **None Selected**.
4. Search for the person's name or email, **check the box** next to them, then click **Select**.
   *(You can also pick a security group to allow a whole team at once.)*
5. Click **Assign**.

Repeat Step 6 to add more people.

---

## Done

Only the people you assigned can now connect OSP.net to their Microsoft 365. Everyone else in the organization cannot.

---

## To add or remove people later

Go back to the same app → **Users and groups**:
- **Add someone:** **+ Add user/group** → pick them → **Assign**.
- **Remove someone:** check the box next to their name → **Remove** at the top.

---

## To remove OSP.net entirely

Same app → **Properties** → **Delete** (top of the page). That cuts off all access immediately.

---

*Questions? Contact your OSP.net representative.*
