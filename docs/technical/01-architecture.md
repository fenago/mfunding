# 01 — Architecture Overview

## Stack (verified against `package.json`, `vite.config.ts`, `netlify.toml`)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React **19**, Vite **6**, TypeScript **5.7**, Tailwind **4** (`@tailwindcss/vite`), DaisyUI **5** | SPA, `react-router-dom` v7 (data router, `createBrowserRouter`) |
| Charts | Recharts 3 | Analytics dashboards |
| Other FE libs | `@dnd-kit` (kanban), `framer-motion`, `xlsx` (lead-list import/export), `react-helmet-async` (SEO) |
| Backend | Supabase — Postgres + RLS, Edge Functions (Deno), Storage, **Vault** | Project ref `ehibjeonqpqskhcvizow`, region us-east-2, **free tier** |
| CRM / comms | GoHighLevel (LeadConnector API `2021-07-28`), white-labeled "VibeReach" | Location `t7NmVR4WCy927j4Zon4b` |
| Cold email | Instantly.ai v2 API | Read-only proxy in the admin UI |
| LLM | Pluggable provider layer (Anthropic default) | See [05](./05-integrations.md) |
| Scraping | Firecrawl | Lender/vendor website extraction |
| Hosting | Netlify (deploy from `main`) | `vercel.json` exists but Netlify is the live path |

Build: `npm run build` → `node scripts/generate-sitemap.mjs && tsc && vite build`. Chunking is manual (`vendor-react`, `vendor-charts`, `vendor-xlsx`, `vendor-motion`) to keep public marketing pages light.

Netlify config: 301s `momentumfunding.com` and `www.mfunding.net` → `https://mfunding.net`; SPA fallback `/* → /index.html`; security headers (`X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`).

## Topology

```
                 ┌───────────────────────────────────────────────┐
   merchants ───▶│ mfunding.net (React SPA on Netlify)           │
   staff     ───▶│  public pages · /portal/* · /admin/*          │
                 └──────┬──────────────────────┬─────────────────┘
                        │ supabase-js (anon    │ supabase.functions.invoke()
                        │ key + user JWT, RLS) │ (user JWT)
                        ▼                      ▼
        ┌───────────────────────────┐  ┌──────────────────────────────┐
        │ Supabase Postgres         │  │ Supabase Edge Functions      │
        │  RLS + SECURITY DEFINER   │◀─┤  (Deno; service-role client) │
        │  helpers + triggers       │  │  _shared/{ghl,llm,           │
        │  Storage buckets          │  │           closerDocMerge}.ts │
        │  Vault (GHL/Instantly …)  │  └───────┬──────────────────────┘
        └───────────────────────────┘          │
                        ▲                      │ REST
                        │ webhooks             ▼
                        │             ┌──────────────────────────────┐
                        └─────────────┤ GoHighLevel ("VibeReach")    │
                                      │  contacts · opportunities ·  │
                                      │  conversations/email ·       │
                                      │  e-sign docs · workflows     │
                                      └──────────────────────────────┘
   GitHub Actions (cron) ──▶ poll-funder-replies / funder-reply-reconcile / heartbeat
```

## Responsibility split — what lives where

| Concern | Owner | Why |
|---------|-------|-----|
| Contacts, conversations, **all outbound/inbound email** | **GHL** | GHL is the transport *and* the record. `sales@send.mfunding.net` is the dedicated sending domain. There is no separate ESP. |
| Opportunities / visual pipeline, follow-up workflows, e-signature documents (MCA 04 / 04B) | **GHL** | Workflow + doc-merge engine. Supabase mirrors stage into `deals.status`. |
| Deals, customers, submissions, commissions, underwriting, lenders, campaigns, analytics | **Supabase** | System of record for money, funder network, and reporting. |
| Merchant/staff UI, admin dashboards, calculators, playbooks, portals | **React app** | |
| Privileged operations & third-party secrets | **Edge functions** | The browser never holds a GHL / Instantly / LLM / Firecrawl key. |

Key IDs (hardcoded in `supabase/functions/ghl-sync/index.ts:60-61` and mirrored in other functions):

| Pipeline | GHL id |
|----------|--------|
| MCA | `bG9ZEh4eP9x60E1CyaMx` |
| VCF (debt relief) | `nsmH6jIeVA0SsZMMq4LC` |

## Frontend structure

```
src/
  router/       route table + guards (index.tsx, *ProtectedRoute.tsx)
  pages/        admin/ (largest), portal/, auth/, calculators/, assessments/,
                business-loans/, real-estate/, + public marketing pages
  components/   admin/ analytics/ customers/ landing/ lenders/ marketing/
                real-estate/ business-loans/ seo/ shared/ ui/
  services/     one module per domain; the ONLY place that talks to Supabase/edge fns
  context/      SessionContext (auth session), UserProfileContext (role + impersonation)
  config/       roleAccess.ts (role→nav model), commsTemplates.ts
  types/        deals.ts, commissions.ts, analytics.ts
  supabase/     client (index.ts) + write helpers (writes.ts: mustWrite/tryWrite)
  lib/          shared pure logic (incl. closerDocMerge.ts — client mirror of the server merge)
```

Client env (`src/config.ts`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (both required — the app throws without them), and the optional flag `VITE_PLAID_ENABLED`. **No third-party API keys are read by the client** any more (see [08](./08-security-posture.md)).

Chunk-reload resilience: admin/portal pages are lazy-loaded through `lazyWithReload` (`src/router/index.tsx`), which force-reloads once (debounced via `sessionStorage` key `mf_chunk_reload_ts`) when a dynamic import 404s after a deploy.

## Request paths

1. **Staff UI reads/writes** — `supabase-js` with the user's JWT; RLS decides visibility. All DB access is funneled through `src/services/*`.
2. **Privileged action** — `supabase.functions.invoke('<fn>')` with the user JWT; the function re-checks the caller's role from `profiles` and then uses a **service-role** client.
3. **Public intake** — anonymous `POST` to `mca-intake` / `vcf-intake` / `contact-intake` / `partner-signup` (`verify_jwt = false`), which write to Postgres and best-effort sync to GHL.
4. **Inbound from GHL** — `ghl-webhook` (shared-secret, fail-closed) mirrors contact/opportunity/message/email-open events into `customers`, `deals`, `deal_submissions`.
5. **Scheduled** — GitHub Actions (not pg_cron): `funder-reply-poll.yml` (every 10 min), `funder-reply-reconcile.yml`, `supabase-heartbeat.yml` (2×/day), `ssl-watchdog.yml`.
