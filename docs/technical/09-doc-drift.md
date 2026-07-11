# 09 — Doc Drift & Known Discrepancies

Places where the older planning documents (`CLAUDE.md`, `plan_goals.md`, `research/platform_reqs/*`) contradict the live code or the live database. **In every row, the code/DB wins.** This page exists so a reader who has already absorbed `CLAUDE.md` can un-learn the wrong parts.

## Old docs vs. reality

| # | `CLAUDE.md` / planning docs say | Reality (code + DB) | Evidence |
|---|-------------------------------|---------------------|----------|
| 1 | "**The sales funnel — 9 stages**" | The MCA pipeline has **11 ordered stages** (`bank_statements` and `offer_accepted` were added), plus `renewal_eligible` and three shared parked/terminal states (`nurture`, `declined`, `dead`). And there is a **whole second product line**: **VCF (debt relief) with its own 8 stages**. `deals.status` is one text column with a 23-value CHECK. | `deals_status_check`; `DEAL_STAGES` in `src/types/deals.ts:238` |
| 2 | Product list is MCA / term loan / LOC / SBA / equipment | `deal_type` also includes **`vcf`**, which has its own intake (`/debt-relief` → `vcf-intake`), its own fields (`vcf_*`), its own GHL pipeline (`nsmH6jIeVA0SsZMMq4LC`), and its own unit-economics page. | `deals_deal_type_check`; `supabase/functions/vcf-intake/` |
| 3 | "Closer split (company leads) **35%** default" | The DB default is **30** (`closers.company_lead_split default 30`) and `COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT = 30`. Migration `20260711_closers_company_lead_split_default_30.sql` superseded the earlier `…_default_35`. | `src/types/commissions.ts:49` |
| 4 | Renewal split 30% / self-gen 65% | The TS constants say 30 / 65, but the **DB column defaults are `renewal_split = 35` and `self_gen_split = 70`**. These two sources of truth disagree; the closer's row wins whenever it exists. Do not quote a "the" split — read the closer's row. | `information_schema.columns` on `closers` |
| 5 | Roles: "user, admin, super_admin" | Five roles: **`user, closer, employee, admin, super_admin`**. And "staff" means two different things: SQL `is_staff()` = closer/admin/super (**excludes employee**), while SQL `is_ops_staff()` = admin/super/**employee** (excludes closer). The client's `isStaff` = closer + admin + employee + super. | `user_role` enum; `is_staff` / `is_ops_staff` source |
| 6 | "**Plaid integration** (bank verification, transaction analysis)", "60-second bank verification", `apply.mfunding.com` | **Plaid is not implemented.** No Plaid edge function, no Plaid SDK in `package.json`; `plaid_connections` and `bank_analyses` are empty; only a `VITE_PLAID_ENABLED` feature flag exists. The live path is: merchant emails/uploads bank-statement PDFs → `underwrite-deal` reads them with Claude. There is no `apply.mfunding.com` — `/apply` is a route on the main site. | `src/config.ts`; `supabase/functions/` listing; row counts |
| 7 | "**AI:** Google Gemini 2.0" | AI runs through a **pluggable provider layer** (`_shared/llm.ts`) defaulting to **Anthropic** (`claude-sonnet-4-6`), with 7 supported providers and per-task overrides in `llm_settings.task_overrides`. The underwriter is Anthropic-only by necessity (native PDF document blocks). The Gemini key that was in the client bundle is **compromised** ([08](./08-security-posture.md)). | `_shared/llm.ts`; `llm_settings` |
| 8 | Website is `mfunding.com`; GHL landing pages at `funding.mfunding.com/[city]` | The live site is **`mfunding.net`** (Momentum Funding), deployed to Netlify; `momentumfunding.com` 301s to it. The React app hosts the marketing site, calculators, assessments, and the admin/portal — the "all campaign landing pages live in GHL" decision is not what shipped. | `netlify.toml`; `src/router/index.tsx` |
| 9 | "Route structure" section (admin routes list) | Badly out of date. The real admin surface is ~50 routes including `playbooks`, `pipeline-playbook`, `closer-docs`, `closer-comp`, `my-earnings`, `funder-directory`, `funder-matrix`, `funder-contacts`, `cold-email`, `lead-import`, `lead-partner`, `campaigns`, `underwriting-settings`, `platform-config`, `unit-economics-vcf`, … | `src/router/index.tsx` |
| 10 | "**Database:** … 39 lenders, 11 marketing vendors" | 121 lenders, 107 lender programs, 35 funder submission profiles, 13 marketing vendors. Several tables listed in `CLAUDE.md` are missing whole subsystems (closer docs + e-sign, campaigns, underwriting, lead intake, LLM settings). | `list_tables` |
| 11 | "SMS/email automation sequences (all 6 follow-up sequences)" in GHL; SMS throughout | Per the project's own operating memory, **email only, no SMS**. `follow_up_sequences` has 0 rows. The 6 named sequences are a plan, not a running system. | table row counts |
| 12 | "Sub-ISO white-label portal", "Sub-ISO override" revenue | `sub_isos` has **0 rows** and there is no Sub-ISO portal. The commission engine *does* implement Sub-ISO override math (`calculateCommission`), so the code is ready; the business isn't running it. | `sub_isos` row count |
| 13 | Commission "paid 5 business days after funder pays" as a flow | The implemented lifecycle is `pending → approved → funder_paid → closer_paid → completed`, plus `on_hold` (with `hold_reason`) and `clawback`. Approval is a real, super-admin-gated step that the old docs don't mention. | `commissions_payment_status_check` |

## Internal contradictions inside the live system

These are not doc drift — the **code disagrees with itself**. They are open bugs; see [08](./08-security-posture.md).

| Thing | Conflict |
|-------|----------|
| **The closer's identity** | `deals.assigned_closer_id` → `profiles(id)`; `commissions.closer_id` → `closers(id)`. Two bugs already. Documented loudly in [02](./02-data-model.md). |
| **Referral lead-source split** | `splitForDeal` says referral = self-gen (65%); the two funded-payout paths say referral = company (30%). Both live deals are referrals. |
| **Commission constants** | Duplicated by hand between `src/types/commissions.ts` and `supabase/functions/ghl-webhook/index.ts` (edge functions can't import from `src/`), with a comment acknowledging they are "kept in sync by hand". |
| **Doc-merge rules** | `_shared/closerDocMerge.ts` (server, authoritative), `src/lib/closerDocMerge.ts` (client preview mirror), and a third re-implementation of the placeholder regex inside `sign_closer_document()` in PL/pgSQL. Three copies of one rule. |
| **Migration ledger** | Repo files ≠ live ledger. See `supabase/migrations/MIGRATIONS_MANIFEST.md` and [07](./07-conventions-and-operations.md). |
| **`funder_paid` bucketing** | Counted as "pending" on one screen and "approved payout" on another. |
