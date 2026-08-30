// ph-ucc-apollo-enrich — OPTIONAL, OFF-BY-DEFAULT business-email enrichment pass.
//
// SECONDARY to BatchData skip-trace. Apollo.io is queried by debtor business name to
// find a BUSINESS email + the owner's title, stored in the apollo_* columns (distinct
// from the BatchData consumer email in ph_ucc_leads.email). Apollo's hit rate on these
// small UCC merchants is LOW (it missed the Aurora merchant BatchData found), so it is
// gated OFF: this pass no-ops unless ph_settings.apollo_enrich_enabled = true. The owner
// opts in per run. It NEVER dials, NEVER emails, NEVER loads to GHL.
//
// APOLLO NOTES: the search API often returns an "email_not_unlocked@domain.com"
// placeholder instead of a real address unless the plan reveals it. We store an email
// ONLY when it is a real, non-placeholder address; otherwise we still record the owner
// title + apollo_checked_at so the lead isn't re-queried every run.
//
// AUTH (mirrors ph-ucc-skiptrace): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const APOLLO_BASE = "https://api.apollo.io/api/v1";
const DEFAULT_LIMIT = 10;
const HARD_MAX_LIMIT = 50;
const BUDGET_MS = 55_000;
const OWNER_TITLES = ["owner", "founder", "co-founder", "president", "ceo", "managing member", "principal", "partner"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};
// A usable business email is a real address, NOT Apollo's locked placeholder.
function realEmail(s: unknown): string | null {
  const v = (s ?? "").toString().trim().toLowerCase();
  if (!v.includes("@")) return null;
  if (v.includes("email_not_unlocked") || v.includes("domain.com") || v.startsWith("noreply@")) return null;
  return v;
}

// Pull the typed, filterable fields off an Apollo person object (which nests its
// organization). Every field Apollo returned is preserved losslessly in apollo_raw;
// these are the promoted columns the UI can filter on. Any absent field → null.
function apolloTyped(p: any) {
  const org = p?.organization ?? p?.account ?? {};
  return {
    business_email: realEmail(p?.email),
    owner_title:    clean(p?.title),
    company:        clean(org?.name),
    industry:       clean(org?.industry ?? p?.industry),
    employees:      (() => { const n = num(org?.estimated_num_employees ?? org?.num_employees); return n == null ? null : Math.round(n); })(),
    annual_revenue: num(org?.annual_revenue ?? org?.organization_revenue),
    linkedin_url:   clean(p?.linkedin_url ?? org?.linkedin_url),
    website:        clean(org?.website_url ?? org?.primary_domain ?? p?.website_url),
    apollo_city:    clean(p?.city ?? org?.city),
    apollo_state:   clean(p?.state ?? org?.state),
  };
}

async function apollo(apiKey: string, path: string, body: unknown) {
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, body: parsed as Record<string, unknown> };
}

type Lead = { id: string; debtor_name: string | null; debtor_state: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron/GET */ }

  // ── Gate: OFF by default. Only runs when the owner flips apollo_enrich_enabled. ──
  const { data: settings } = await db.from("platform_settings").select("value").eq("key", "ph_settings").maybeSingle();
  const enabled = (settings?.value as Record<string, unknown> | undefined)?.apollo_enrich_enabled === true;
  const forceGate = payload.force_gate === true || url.searchParams.get("force_gate") === "true";
  if (!enabled && !forceGate) {
    return json({ ok: true, skipped: true, reason: "ph_settings.apollo_enrich_enabled is false (secondary enrichment is opt-in)" });
  }

  // TARGETED SET (mirrors ph-ucc-skiptrace): pass `lead_ids: string[]` to enrich an
  // EXACT set (the UI's filtered lead book passes the ids it shows, in batches). Hard-
  // capped to HARD_MAX_LIMIT here too, so no caller can push more than the ceiling into
  // a single call. The eligibility safety (traced_at + status + no double-spend) still
  // applies to every id below, so an ineligible/already-checked id is silently dropped.
  const leadIdsRaw = (payload as { lead_ids?: unknown }).lead_ids;
  const leadIds = Array.isArray(leadIdsRaw)
    ? leadIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, HARD_MAX_LIMIT)
    : null;

  // When lead_ids is present the default cap is the set size; otherwise DEFAULT_LIMIT.
  const rawLimit = num(payload.limit ?? url.searchParams.get("limit")) ?? (leadIds ? leadIds.length : DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(HARD_MAX_LIMIT, Math.floor(rawLimit)));
  const force = payload.force === true || url.searchParams.get("force") === "true";

  const { data: apiKey, error: keyErr } = await db.rpc("get_ph_apollo_key");
  if (keyErr || !apiKey || typeof apiKey !== "string") {
    return json({ ok: false, error: "PH_APOLLO_API_KEY missing from vault" }, 500);
  }

  // Enrich traced leads (a business context exists) that Apollo hasn't seen yet.
  let q = db.from("ph_ucc_leads")
    .select("id,debtor_name,debtor_state")
    .not("traced_at", "is", null)
    .in("status", ["needs_scrub", "email_only", "no_match"])
    .not("debtor_name", "is", null)
    .order("freshness_days", { ascending: true, nullsFirst: false })
    .limit(limit);
  // Explicit set from the UI's filtered lead book — enrich exactly these ids (the
  // status/traced_at/debtor_name safety above and the idempotent apollo_checked_at
  // guard below still hold, so an ineligible or already-checked id is never charged).
  if (leadIds && leadIds.length) q = q.in("id", leadIds);
  if (!force) q = q.is("apollo_checked_at", null);
  const { data: leads, error: leadErr } = await q;
  if (leadErr) return json({ error: `lead select failed: ${leadErr.message}` }, 500);
  const rows = (leads as Lead[]) ?? [];
  if (rows.length === 0) return json({ ok: true, checked: 0, message: "No leads awaiting Apollo enrichment." });

  const started = Date.now();
  let checked = 0, withEmail = 0, withTitle = 0, errored = 0;
  const perLead: Record<string, unknown>[] = [];

  for (const lead of rows) {
    if (Date.now() - started > BUDGET_MS) break;
    const name = clean(lead.debtor_name);
    if (!name) continue;

    try {
      // People search scoped to the org name; ask for owner-type titles. Apollo returns
      // people[] (and often contacts[]); take the first with an owner-ish title.
      const r = await apollo(apiKey, "/mixed_people/search", {
        q_organization_name: name,
        person_titles: OWNER_TITLES,
        per_page: 1,
        page: 1,
      });
      const nowIso = new Date().toISOString();
      if (!r.ok) {
        errored++;
        // Still stamp checked_at so a hard error (e.g. 422 bad name) isn't retried forever.
        await db.from("ph_ucc_leads").update({ apollo_checked_at: nowIso }).eq("id", lead.id);
        perLead.push({ lead_id: lead.id, debtor: name, error: `apollo ${r.status}`, detail: r.body });
        continue;
      }
      const people: any[] = (r.body as any)?.people ?? (r.body as any)?.contacts ?? [];
      const p = people[0] ?? null;
      // FULL person+organization object → apollo_raw (lossless: nothing Apollo
      // returned for this person is dropped). Typed columns are promoted below.
      const apolloRaw = p ? { person: p, organization: p?.organization ?? p?.account ?? null } : null;
      const t = p ? apolloTyped(p) : {
        business_email: null, owner_title: null, company: null, industry: null,
        employees: null, annual_revenue: null, linkedin_url: null, website: null,
        apollo_city: null, apollo_state: null,
      };
      const bizEmail = t.business_email;
      const title = t.owner_title;

      const { error: uErr } = await db.from("ph_ucc_leads").update({
        apollo_business_email: bizEmail,
        apollo_owner_title: title,
        apollo_raw: apolloRaw,
        apollo_company: t.company,
        apollo_industry: t.industry,
        apollo_employees: t.employees,
        apollo_revenue: t.annual_revenue,
        apollo_linkedin_url: t.linkedin_url,
        apollo_website: t.website,
        apollo_checked_at: nowIso,
      }).eq("id", lead.id);
      if (uErr) { errored++; perLead.push({ lead_id: lead.id, debtor: name, error: `update: ${uErr.message}` }); continue; }

      // Mirror onto any smart_list_members that point at this UCC lead (source='ph_ucc',
      // source_id = lead.id as text) so the member view carries the Apollo enrichment too
      // and nothing is lost on the smart_list cascade. Best-effort, LOUD on failure.
      const { error: mErr } = await db.from("smart_list_members").update({
        apollo_raw: apolloRaw,
        business_email: bizEmail,
        owner_title: title,
        company: t.company,
        industry: t.industry,
        employees: t.employees,
        annual_revenue: t.annual_revenue,
        linkedin_url: t.linkedin_url,
        website: t.website,
        apollo_city: t.apollo_city,
        apollo_state: t.apollo_state,
        apollo_checked_at: nowIso,
      }).eq("source", "ph_ucc").eq("source_id", lead.id);
      if (mErr) console.error("[ph-ucc-apollo-enrich] smart_list_members mirror failed", JSON.stringify({ lead_id: lead.id, error: mErr.message }));

      checked++;
      if (bizEmail) withEmail++;
      if (title) withTitle++;
      perLead.push({ lead_id: lead.id, debtor: name, business_email: bizEmail ? "found" : null, owner_title: title, company: t.company });
    } catch (e) {
      errored++;
      perLead.push({ lead_id: lead.id, debtor: name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    ok: true, provider: "apollo",
    requested_limit: limit, requested_ids: leadIds ? leadIds.length : null,
    checked, enriched: withEmail, with_business_email: withEmail, with_owner_title: withTitle,
    errored, elapsed_ms: Date.now() - started, per_lead: perLead,
  });
});
