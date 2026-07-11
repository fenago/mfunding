# MFunding / Momentum Funding — Technical Documentation

Engineer-facing reference for the platform. Everything here was derived from the **live code** (`src/`, `supabase/functions/`, `supabase/migrations/`) and the **live database** (Supabase project ref `ehibjeonqpqskhcvizow`) on **2026-07-11**.

> **Source-of-truth rule.** Where the older planning docs (`CLAUDE.md`, `plan_goals.md`, `research/platform_reqs/*`) disagree with the code or the database, **the code and the database win**. Known contradictions are catalogued in [09 — Doc drift & known discrepancies](./09-doc-drift.md). Do not treat `CLAUDE.md` as a spec.

## Index

| # | Doc | Contents |
|---|-----|----------|
| 01 | [Architecture overview](./01-architecture.md) | System topology, the React/Supabase/GHL split, deploy pipeline, request paths |
| 02 | [Data model](./02-data-model.md) | Real tables, enums, FKs, the **`assigned_closer_id` vs `closer_id` split-brain**, both stage sets (MCA + VCF) |
| 03 | [Auth & RBAC](./03-auth-and-rbac.md) | Roles, route guards, RLS model, SECURITY DEFINER helpers, integrity triggers |
| 04 | [Edge functions](./04-edge-functions.md) | Every function: purpose, auth model, inputs/outputs, external calls |
| 05 | [Integrations](./05-integrations.md) | GHL/VibeReach, Instantly, the LLM provider layer, Plaid, Firecrawl |
| 06 | [Key subsystems](./06-subsystems.md) | Commission engine, lead assignment, AI deal assistant, closer doc merge + e-sign ledger, underwriter, funder submission |
| 07 | [Conventions & operations](./07-conventions-and-operations.md) | Path alias, services/types layout, migrations & the known ledger drift, deploying functions, secrets/vault, heartbeat |
| 08 | [Security posture](./08-security-posture.md) | What was hardened, what is still **OPEN** (key rotation still owed by the owner) |
| 09 | [Doc drift & known discrepancies](./09-doc-drift.md) | Every place the old docs contradict reality |

## The 60-second version

- **Frontend:** React 19 + Vite + TypeScript + Tailwind v4 + DaisyUI, deployed to **Netlify** from `main` (`netlify.toml`, `npm run build` = sitemap → `tsc` → `vite build`). Canonical domain **mfunding.net**.
- **Backend:** **Supabase** (Postgres + RLS + Edge Functions (Deno) + Storage + Vault). Free tier — a GitHub Actions heartbeat keeps it from auto-pausing.
- **CRM / email system of record:** **GoHighLevel**, white-labeled as *VibeReach*, location `t7NmVR4WCy927j4Zon4b`. All merchant/funder email, e-sign documents, pipelines/opportunities, and follow-up automation live there. The React app is a management/analytics layer on top, not a replacement.
- **Two product lines:** `deals.deal_type` ∈ `mca | term_loan | line_of_credit | sba | equipment_financing | vcf`. **MCA** (working capital) and **VCF** (debt relief) each have their own stage set and their own GHL pipeline.
- **Roles:** `user | closer | employee | admin | super_admin` (`user_role` enum).
