# 07 — Conventions & Operations

## Code conventions

- **React 19 function components + TypeScript.** No class components.
- **Path alias `@` → `src/`** (`vite.config.ts` + `tsconfig.json`). Both `@/services/x` and relative imports appear in the codebase; prefer `@`.
- **Styling:** Tailwind v4 (via `@tailwindcss/vite`, no `tailwind.config.js` content array) + DaisyUI 5. `clsx` + `tailwind-merge` for conditional classes.
- **Layering — do not break this:**
  ```
  pages/components  →  services/*  →  supabase client / functions.invoke()
  ```
  Components should not call `supabase.from()` directly; add or extend a service. `src/services/*` is the complete inventory of what touches the database.
- **Writes go through `src/supabase/writes.ts`:** `mustWrite(label, query)` throws on error *and* on a zero-row result (catches silent RLS denials, which PostgREST reports as success + 0 rows); `tryWrite(label, query)` logs and swallows. Never `await supabase.from(...).update(...)` bare.
- **Types:** domain unions live in `src/types/` (`deals.ts`, `commissions.ts`, `analytics.ts`). `DealStatus`, `DealType`, `SubmissionStatus`, `PaymentStatus`, `Market` are the canonical unions — they must stay in sync with the CHECK constraints in the DB (see [02](./02-data-model.md)).
- **Edge functions cannot import from `src/`.** Anything shared with the frontend (commission constants, the doc-merge rules) is **hand-mirrored** and drifts silently. Grep both sides when you change one.
- **Lint:** `npm run lint` — ESLint with a custom local rule directory (`eslint-rules/`), `--max-warnings 0`.
- **MCA compliance in copy:** an MCA is a purchase of future receivables, never a "loan". This is enforced by hand in each AI system prompt and each merchant-facing template; there is no shared constant.

## Migrations

- Files live in `supabase/migrations/`, named `YYYYMMDD_description.sql` (date-only prefix).
- **Known drift — read `supabase/migrations/MIGRATIONS_MANIFEST.md`.** The live ledger (`supabase_migrations.schema_migrations`) has more entries than the repo has files, and the ledger uses full `YYYYMMDDHHMMSS` versions while repo files are date-only. They join on `date + name`, not on an exact version string. Two files whose schema was applied via raw `execute_sql` were back-filled into the ledger as bookkeeping-only rows.
- **The live database is the source of truth.** When adding a change: apply it via the Supabase MCP `apply_migration` **and** commit the matching `.sql` file. The full reconciliation (`supabase db pull`) is blocked until a fresh personal access token exists — see [08](./08-security-posture.md).
- Do not rename existing migration files to full-timestamp form; the manifest documents the join convention.

## Deploying edge functions

```bash
supabase functions deploy <slug>          # CLI (needs a valid access token)
# or the Supabase MCP deploy_edge_function tool
```

**Shared files must be included in the deploy payload.** A function importing `../_shared/ghl.ts` will fail at cold start if `_shared/*` was not shipped with it — the platform does not resolve it from a previous deploy.

`supabase/config.toml` is version-controlled so `verify_jwt` is not a hidden dashboard-only setting. Add every new function there. Two functions (`instantly`, `underwrite-deal`) currently have no entry and inherit the dashboard value.

## Secrets

| Where | What | Read by |
|-------|------|---------|
| **Supabase Vault** | `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `LIVE_TRANSFER_SECRET`, the Instantly key | `get_ghl_config()` / `get_instantly_key()` SECURITY DEFINER RPCs, called from edge functions with a service-role client |
| **`llm_provider_keys` table** | LLM API keys (per provider) | `_shared/llm.ts` via service role. RLS on with **zero policies** — unreachable from any client JWT. Written only through `llm-admin`; never read back. |
| **Supabase function secrets** (`supabase secrets set`) | `FIRECRAWL_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | edge functions via `Deno.env` |
| **`.env`** (gitignored) | local dev only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, plus operator tokens | Vite (only the two `VITE_*` values are bundled) |
| **GitHub Actions secrets** | `FUNDER_POLL_SECRET`, `SUPABASE_ANON_KEY` | the scheduled workflows |

Rules: no third-party key may be exposed to the browser (only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are, by design). Never put a secret in `platform_settings` — it is world-readable (`Anyone reads platform settings`, SELECT `true`).

## Scheduled jobs (GitHub Actions — **not** pg_cron)

| Workflow | Schedule | Does |
|----------|----------|------|
| `.github/workflows/supabase-heartbeat.yml` | `17 8 * * *` and `17 20 * * *` | Pings the REST API twice a day. **The project is on the Supabase FREE tier and auto-pauses after ~7 days of inactivity**; when paused every query times out (`Connection terminated due to connection timeout`) even though the dashboard URL still resolves. Resume from the dashboard and wait a few minutes. `scripts/heartbeat.sh` is the manual equivalent. |
| `.github/workflows/funder-reply-poll.yml` | every 10 min | `POST /functions/v1/poll-funder-replies?secret=$FUNDER_POLL_SECRET`; fails the job unless the response contains `"ok":true`. |
| `.github/workflows/funder-reply-reconcile.yml` | scheduled | `funder-reply-reconcile` in cron mode (sends the service-role key as `Bearer` to pass the gateway, plus the shared secret). |
| `.github/workflows/ssl-watchdog.yml` | scheduled | certificate watch. |

## Deploy

Netlify builds from `main`: `npm run build` = `generate-sitemap.mjs` → `tsc` (type-check gate) → `vite build` → `dist/`. A TypeScript error fails the deploy. Canonical host is `https://mfunding.net`; `momentumfunding.com` and `www.*` 301 to it.

## Local development

```bash
npm install
# .env needs VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (the app throws without them)
npm run dev     # Vite dev server against the LIVE Supabase project — there is no local stack
npm run lint
npm run build   # full type-check + production build
```

There is no seeded local database and no test suite in `package.json`. Development runs against production data; RLS is your safety net. Be deliberate with writes.
