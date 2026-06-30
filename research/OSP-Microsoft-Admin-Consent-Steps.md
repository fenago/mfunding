# Connect OSP.net to Microsoft 365 — Admin Approval

**Who does this:** A Microsoft 365 administrator (Global Administrator).
**How long:** 2 minutes. You do it **once**.

---

## Step 1 — Click this link

Sign in with your **admin** account when it asks.

```
https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=a446e50d-874d-4534-acf2-f383f15fb569&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&redirect_uri=https%3A%2F%2Ffgsvbhebxnimjlxfjfdx.supabase.co%2Fauth%2Fv1%2Fcallback&state=osp-onboarding
```


---

## Step 2 — Click **Accept**

A window appears listing what OSP.net can access. Click the blue **Accept** button at the bottom.


---

## Step 3 — Done

That's it. Your users can now connect OSP.net.

*If you land on a blank or error page after clicking Accept — **ignore it.** The approval was already saved the moment you clicked Accept.*

---

### 👉 Important: that link **is** where you set the permissions.

You do **not** open any menus or settings pages. Clicking the link opens Microsoft's approval screen, and **Accept** switches the permissions on for your organization.

---

### Only if the link won't open (rare)

1. Go to **https://entra.microsoft.com** and sign in as admin.
2. In the **search bar at the top**, type **Enterprise applications** and open it.
3. Search **OSP.net** → click it.
4. On the left, click **Permissions**.
5. Click **Grant admin consent** → **Accept**.


---

*Questions? Contact your OSP.net representative.*
