# Overnight Build — Morning Briefing (2026-06-27)

Autonomous backlog run. Everything below is **typechecked, built, committed, and pushed to `main`** (Netlify auto-deploys). VCF files were deliberately left untouched (you're working those in the other session).

---

## ✅ Shipped this session

| Feature | Where | Notes |
|---|---|---|
| **Loss-reason analytics** | `/admin/analytics/deals` | "Why deals don't fund" — recoverable (🟢) vs dead (🔴), counts + $ |
| **ghl-sync pipeline-ID hardening** | edge fn | targets MCA/VCF pipeline by known ID, stage-match fallback |
| **Security hardening** | DB + repo | both ERROR advisors cleared; `search_path` pinned; `.mcp.json` untracked + gitignored |
| **Merchant portal deal status** | `/portal` | live pipeline + status + plain-English next step |
| **Compliance disclosure engine** | `/admin/compliance` | 9 enacted states, researched templates (broker stance), TX inactive |
| **Funder-criteria UI** | `/admin/lenders` | confirmed already complete |
| **Renewal monitoring** | `/admin/renewals` | funded deals by paydown %, milestone badges, "Save + push to GHL" |
| **Document review queue** | `/admin/documents` | view (signed URL) + approve/reject |
| **Lead Sources management** | `/admin/lead-sources` | cost-per-lead, spend, ROI, cost-per-funded (flags > $1,500) |
| **Referral Partners** | `/admin/referrals` | CPAs/bookkeepers/vendors, referrals, funded, rewards paid |
| **"Needs attention" widget** | `/admin` | surfaces renewal/doc queues |
| **GHL webhook event log** | `/admin/sync-log` | every inbound event logged; smoke-tested OK |

New tables: `compliance_disclosures`, `referral_partners`, `ghl_webhook_events`, plus `lead_sources` now has a UI.

---

## 🔴 Manual follow-ups (only you can do these)

1. **Rotate the leaked `sbp_` Supabase token** in the dashboard + purge from git history (still in old commits — treat as compromised). I untracked/gitignored the file.
2. **Compliance disclosures** at `/admin/compliance` are **researched TEMPLATES, not final legal text** — have a compliance attorney finalize. The funder issues the official per-transaction disclosure; MFunding (broker) ensures delivery + provides broker disclosures.
3. **Register the GHL webhook** (Settings → Webhooks, with `?secret=<vault value>`) to activate Gap A/B. Watch `/admin/sync-log` to confirm events arrive.
4. **GHL automations** — the per-stage email workflows (your `GHL_Pipeline_And_Automations.md` track) still need building in GHL.
5. **Minor:** local `.env` `GHL_WEBHOOK_SECRET` doesn't match the vault. The function uses the vault, so nothing's broken, but fix the `.env` copy to avoid confusion.

## ⏸️ Not done — needs external keys (blocked, not skipped)
- Google Workspace (OAuth), Plaid (bank verify), Stripe (Sub-ISO billing), Experian/Ocrolus (underwriting enrich). All scaffolding/UI exists where applicable; they just need credentials.

## 🔒 Remaining advisor WARNs (low risk / by design)
Anonymous `funding_applications` insert (by design), `avatars` bucket listing, leaked-password protection (Auth dashboard toggle), a few RAG-function `search_path` warnings.
