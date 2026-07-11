# 2. Roles & Who Sees What

There are exactly **five roles**. Every account has one. The role decides which screens open and
which data comes back — and the database enforces it, not just the menus. A closer cannot see
another closer's earnings even if they guess the URL.

---

## 2.1 The five roles

| Role | Who it is | The one-line version |
|---|---|---|
| **super_admin** | The owner. | Everything. Finances, analytics, the funder network, configuration, user management. |
| **admin** | Staff / managers. | The full operational pipeline **plus** the funder network (add/manage lenders). No owner-only finances, analytics, or config. |
| **employee** | Internal staff. | The same screens as Admin. |
| **closer** | 1099 independent contractor sales reps. | The full operational pipeline. **No** company finances, no funder-network management, no settings. They see **their own** earnings and **their own** onboarding documents — nobody else's. |
| **user** | Your customers (merchants). | The customer portal only. No admin access of any kind. |

A note on **admin vs. employee**: today they have identical route access. `admin` exists as the
label for managers; `employee` for other internal staff.

---

## 2.2 The access map

This is the real map, taken from the platform's own role configuration. ● = can open it.

| Screen | user | closer | employee | admin | super_admin |
|---|:--:|:--:|:--:|:--:|:--:|
| **Customer Portal** | | | | | |
| Portal Dashboard | ● | | | | |
| My Documents | ● | | | | |
| My Estimates | ● | | | | |
| Inbox / Messages | ● | | | | |
| **Home** | | | | | |
| Admin Dashboard | | ● | ● | ● | ● |
| Task Board | | | ● | ● | ● |
| **Pipeline** | | | | | |
| Customers | | ● | ● | ● | ● |
| Deals | | ● | ● | ● | ● |
| Renewals\* | | ● | ● | ● | ● |
| Doc Review | | ● | ● | ● | ● |
| Comms | | ● | ● | ● | ● |
| **Lead Sourcing** | | | | | |
| Lead Partner (Synergy) | | | | | ● |
| Marketing Vendors | | | | | ● |
| Vendor Scorecard | | | | | ● |
| Live Transfer Leads | | | | | ● |
| Lead Lists & Data | | | | | ● |
| Lead Sources | | | | | ● |
| **Marketing & Outreach** | | | | | |
| Campaigns | | | | | ● |
| Sequences | | ● | ● | ● | ● |
| Lead Tools | | ● | ● | ● | ● |
| Referrals | | | ● | ● | ● |
| **Team & Partners** | | | | | |
| Closers (manage) | | | | | ● |
| Closer Documents\*\* | | ● | ● | ● | ● |
| Sub-ISOs | | | | | ● |
| **Funder Network** | | | | | |
| Lenders (add/manage) | | | ● | ● | ● |
| Funder Guide (read) | | ● | ● | ● | ● |
| **Finance** | | | | | |
| My Earnings\*\*\* | | ● | ● | ● | ● |
| Commissions (company-wide) | | | | | ● |
| Unit Economics (MCA) | | | | | ● |
| Unit Economics (VCF) | | | | | ● |
| Live Transfer ROI | | | | | ● |
| Closer Comp (plan + calculator) | | ● | ● | ● | ● |
| Business Model | | | | | ● |
| **Insights** | | | | | |
| Analytics | | | | | ● |
| Real-Time | | | | | ● |
| **Playbooks & Training** | | | | | |
| Revenue Playbooks | | ● | ● | ● | ● |
| Pipeline Playbook | | ● | ● | ● | ● |
| Resources / Articles | | ● | ● | ● | ● |
| **System** | | | | | |
| Users & Roles | | | | | ● |
| Compliance | | | | | ● |
| Integrations | | | | | ● |
| GHL Sync Log | | | | | ● |
| Platform Config | | | | | ● |
| Settings | | | | | ● |

\* **Renewals** is additionally gated *per closer* by the **Renewals enabled** switch on their
closer record. A closer with it switched off cannot open the Renewals screen at all.

\*\* **Closer Documents** is open to closers **on purpose** — a closer has to be able to open and
sign their own paperwork. A closer sees **only their own** documents and their own signing status.
Admins and the owner see every closer's checklist and can send the package.

\*\*\* **My Earnings** is scoped to the signed-in person. A closer sees only their own commissions
and their own open deals. An admin or owner with no closer record attached sees an empty-state
pointing them at the company-wide Commissions screen.

---

## 2.3 Three things the role map doesn't show

**1. "Mine" vs "All" on My Day.** Admins and the owner get a Mine/All toggle on the My Day queue.
A pure closer does not — they are permanently scoped to their own book plus anything unassigned.
(The owner's My Day defaults to **All**; everyone else defaults to **Mine**.)

**2. Reassigning a deal is admin+.** Only an `admin` or `super_admin` can change which closer owns
a deal. A closer *can* **claim** an unassigned deal for themselves from the deal context bar.

**3. Impersonation ("View as").** From **Users & Roles**, the owner can view the app as any other
user — useful for "the closer says the button isn't there." It's a real session switch, banner and
all.

---

## 2.4 Adding a person

1. Have them sign up themselves at **`/auth/sign-up`** on the live site.
2. Open **`/admin/users`** (super admin only). They'll be in the list with the default `user` role.
3. Change their role in the dropdown on their row.
4. If they are a **closer**: go to **`/admin/closers`**, create their closer record, and set their
   splits. Linking the closer record to their login is what makes deals, commissions, and analytics
   attribute to them. **A closer record with no login attached cannot be assigned leads and cannot
   see their earnings.**
5. Send their onboarding document package — see [07-closer-onboarding.md](./07-closer-onboarding.md).

Also available on the Users screen: edit their details, reset their password, pause/resume access,
force log-out, and delete the account. You cannot change your own role.
