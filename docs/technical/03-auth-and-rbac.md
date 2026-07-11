# 03 — Auth & RBAC

Authentication is Supabase Auth (email/password). The user's role lives in `profiles.role` (`user_role` enum). Authorization is enforced in **three independent layers** — all three must be satisfied:

1. **Route guards** (React) — UX only. Never a security boundary.
2. **RLS** (Postgres) — the real boundary for direct table access from the browser.
3. **In-code role checks in edge functions** — the boundary for privileged/service-role operations.

---

## Roles

| Role | Who | Derived flags (`src/context/UserProfileContext.tsx`) |
|------|-----|------|
| `user` | Merchant / customer | none — portal only |
| `closer` | 1099 sales rep | `isCloser`, `isStaff` |
| `employee` | Internal staff | `isAdmin`, `isStaff` |
| `admin` | Manager | `isAdmin`, `isStaff` |
| `super_admin` | Owner | `isSuperAdmin`, `isAdmin`, `isStaff` |

```
isAdmin      = role ∈ {admin, super_admin, employee}
isSuperAdmin = role === "super_admin"
isCloser     = role === "closer"
isStaff      = isCloser || isAdmin
```

⚠️ **`employee` is folded into `isAdmin` on the client** but has its own SQL helper (`is_employee`) and is **excluded from `is_staff()` in SQL** (see the helper table below). The client and SQL definitions of "staff" are therefore *not* the same set. Treat `is_ops_staff` (admin/super/employee) and `is_staff` (closer/admin/super) as two distinct, deliberately different predicates.

The nav/role model is declared in `src/config/roleAccess.ts`:

| Group | Roles |
|-------|-------|
| `OPS` | closer, employee, admin, super_admin |
| `ADMIN` | employee, admin, super_admin (**no closers**) |
| `SUPER` | super_admin |
| `MERCHANT` | user |

**Impersonation ("view as"):** only a `super_admin` can call `startImpersonation(userId)`; the target profile id is held in `sessionStorage` (`mf_impersonate_uid`) and `profile` becomes the impersonated profile app-wide, while `realProfile` / `effectiveUserId` track the true identity. It is **view-only** — `updateProfile` always writes as the real signed-in user, and RLS still runs as the real JWT.

---

## Route guards (`src/router/`)

| Guard | Requires | Behaviour when denied |
|-------|----------|----------------------|
| `AuthProtectedRoute` | a session (any role) | renders `NotFoundPage` |
| `AdminProtectedRoute` | session + `isStaff` | → `/auth/sign-in` (no session) or `/` (not staff) |
| `AdminOnlyProtectedRoute` | session + `isAdmin` (excludes closers) | same |
| `SuperAdminProtectedRoute` | session + `isSuperAdmin` | same |
| `RenewalsProtectedRoute` | session + `isStaff` + `useRenewalsAccess()` | inline "Renewals aren't enabled for your account" (super_admin always passes; a closer passes only if `closers.renewals_enabled = true`) |
| `AdminIndexRoute` | — (index element, not a guard) | redirects "closer-lens" users to `/admin/playbooks`, everyone else gets `AdminDashboardPage` |

`/admin` is wrapped by `AdminProtectedRoute`; each child adds its own tighter guard or none (= any staff role).

| Guard on child | Example routes |
|----------------|----------------|
| none (any staff) | `deals`, `deals/:id`, `customers`, `documents`, `comms`, `sequences`, `funder-guide`, `playbooks`, `pipeline-playbook`, `lead-tools`, `closer-docs`, `closer-comp`, `my-earnings`, `cold-email` |
| `AdminOnlyProtectedRoute` | `todos`, `lenders*`, `email`, `lead-import`, `lead-partner`, `referrals`, `funder-contacts` |
| `SuperAdminProtectedRoute` | `closers*`, `sub-isos`, `commissions`, `campaigns`, `users`, `marketing*`, `analytics*`, `unit-economics*`, `live-transfer-roi`, `lead-budget`, `lead-sources`, `funder-directory`, `funder-matrix`, `compliance`, `sync-log`, `platform-config`, `underwriting-settings`, `settings*`, `bmc` |
| `RenewalsProtectedRoute` | `renewals` |

`/portal/*` is behind `AuthProtectedRoute` only — **any** authenticated user reaches it; RLS is what actually scopes a merchant to their own rows (`customers.user_id = auth.uid()`).

---

## SECURITY DEFINER helpers

All are `SECURITY DEFINER` (they read `profiles`/`closers`, which the caller may not be able to read directly) and are the building blocks of every policy.

| Function | Signature | Returns true when |
|----------|-----------|-------------------|
| `is_staff(uid)` | uuid | role ∈ **{closer, admin, super_admin}** |
| `is_ops_staff(uid)` | uuid | role ∈ **{admin, super_admin, employee}** |
| `is_admin_or_super(user_id)` | uuid | role ∈ {admin, super_admin} |
| `is_super_admin()` / `is_super_admin(user_id)` | — / uuid | role = super_admin (two overloads; the no-arg one uses `auth.uid()`) |
| `is_closer(uid)` | uuid | role = closer |
| `is_employee(uid)` | uuid | role = employee |
| `has_closer_row(uid)` | uuid | a `closers` row exists with `user_id = uid` (role-independent — an admin who is also a closer) |
| `closer_owns_deal(uid, d_id)` | uuid, uuid | deal's `created_by = uid` **or** `assigned_closer_id = uid` **or** `assigned_closer_id ∈ (select id from closers where user_id = uid)` |
| `closer_owns_customer(uid, cust_id)` | uuid, uuid | customer `created_by`/`assigned_to = uid`, or any of the customer's deals is owned per the rule above |
| `closer_row_owns_deal(uid, d_id)` / `closer_row_owns_customer(uid, cust_id)` | | same ownership test, used with `has_closer_row` so an **admin with a closer row** still sees their own book |
| `next_lead_closer()` | → `(closer_profile_id, closer_name, over_cap, strategy)` | round-robin picker (see [06](./06-subsystems.md)) |
| `stamp_lead_assignment(p_closer_user_id)` | | upserts rotation state |
| `sign_closer_document(p_doc_slug, p_signer_name, p_consent_text)` | → `closer_document_signatures` | the e-signature entry point |
| `get_ghl_config()` / `get_instantly_key()` | → jsonb / text | vault reads (service-role only) |
| `list_assignable_users()` | → table | safe user list for assignment dropdowns |
| `handle_new_user()` | trigger | creates a `profiles` row on auth signup |

The dual `closer_owns_*` / `closer_row_owns_*` pairs exist **because of the split-brain in [02](./02-data-model.md)** — they accept either identifier form.

---

## RLS model

Every table has RLS on. The dominant patterns:

| Pattern | Example policy |
|---------|----------------|
| **Ops staff manage everything** | `deals`: `Admins manage deals` — `ALL` USING/WITH CHECK `is_ops_staff(auth.uid())` |
| **Closer sees only their book** | `deals`: `closer_select_own_deals` (SELECT, `is_closer(uid) AND closer_owns_deal(uid, id)`), `closer_update_own_deals` (UPDATE, same in USING **and** WITH CHECK), `closer_insert_deals` (INSERT, `is_closer(uid)`), plus `closer_row_select_own_deals` for staff-with-a-closer-row |
| **Merchant sees only their own** | `deals`: `Customers view own deals` — `customer_id IN (select id from customers where user_id = auth.uid())` |
| **Super-admin-only money** | `commissions` / `closers`: `Super admins can manage …` (ALL), `Admins can view …` (SELECT), `Closers can view own commissions` (SELECT, `closer_id IN (select id from closers where user_id = auth.uid())`) |
| **Deny-all to clients** | `llm_provider_keys` — RLS on, **zero policies** ⇒ only the service role can touch it. API keys are write-only through the `llm-admin` edge function. |
| **Append-only** | `closer_document_signatures` — only two SELECT policies (self + admin). No INSERT/UPDATE/DELETE policy for anyone; rows are created exclusively by the SECURITY DEFINER `sign_closer_document()` RPC. |

Cross-cutting notes:
- `lenders`: super_admin ALL; admin INSERT/UPDATE/SELECT; **closer SELECT** and **employee SELECT** (closers need the funder network to submit).
- `platform_settings`: `Anyone reads platform settings` (SELECT `true`) — it holds branding + `lead_assignment` strategy; **do not put secrets here**. Writes are super_admin only.
- `profiles`: users read/update their own row; super_admins read/update all.
- `deal_underwriting`: SELECT only (`is_admin_or_super OR closer_owns_deal`) — rows are written by the edge function via service role.

---

## Integrity triggers

### `trg_enforce_deal_closer_assignment` (BEFORE UPDATE ON `deals` → `enforce_deal_closer_assignment()`)

```sql
if new.assigned_closer_id is distinct from old.assigned_closer_id then
  if (select auth.uid()) is null then return new; end if;            -- service role / intakes / cron
  if public.is_admin_or_super((select auth.uid())) then return new; end if;
  if old.assigned_closer_id is null
     and new.assigned_closer_id = (select auth.uid()) then return new; end if;  -- claim an unassigned deal, to yourself only
  raise exception 'Only an admin or super_admin can change the assigned closer on a deal';
end if;
```

**Why a trigger and not RLS?** The closer UPDATE policy on `deals` is `USING closer_owns_deal(uid, id)` **WITH CHECK `closer_owns_deal(uid, id)`**. A WITH CHECK expression that calls a helper which **re-SELECTs the row from the table** sees the *committed* (old) row, not the proposed new one — so it cannot tell that the closer just rewrote `assigned_closer_id` to someone else. The check passes and the steal succeeds. A `BEFORE UPDATE` trigger is the only place that can compare `OLD` and `NEW`, so the closer-reassignment rule lives there. Same reasoning for `prevent_role_self_escalation` on `profiles` (only a super_admin may change a role; service-role contexts with a null `auth.uid()` are exempt).

### Other triggers worth knowing

| Trigger | Table | Effect |
|---------|-------|--------|
| `trg_deals_auto_assign_closer` | `deals` BEFORE INSERT | Round-robin auto-assignment (see [06](./06-subsystems.md)). Wrapped in an exception handler — **it can never block an insert**. |
| `set_deal_number` | `deals` BEFORE INSERT (WHEN `deal_number IS NULL`) | mints `MF-YYYY-NNNN` |
| `set_created_by_deals` / `set_created_by_customers` | BEFORE INSERT | stamps `created_by` |
| `trg_prevent_role_self_escalation` | `profiles` BEFORE UPDATE | only super_admin may change `role` |
| `closers_seed_documents` | `closers` AFTER INSERT | seeds the closer's onboarding checklist from `closer_doc_templates` |
| `trg_set_campaign_code` | `campaigns` BEFORE INSERT | mints e.g. `SYN-RT-2026-001` |
| `*_updated_at` | many | `now()` touch |
