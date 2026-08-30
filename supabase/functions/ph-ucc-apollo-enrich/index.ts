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
import {
  corsHeaders, serviceClient,
  getGhlConfig, getContact, listCustomFields, findFieldByName, updateContactCustomFields,
  type GhlConfig, type GhlCustomField,
} from "../_shared/ghl.ts";

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

type ApolloTyped = ReturnType<typeof apolloTyped>;
const NULL_TYPED: ApolloTyped = {
  business_email: null, owner_title: null, company: null, industry: null,
  employees: null, annual_revenue: null, linkedin_url: null, website: null,
  apollo_city: null, apollo_state: null,
};

// ONE Apollo call + parse, SHARED by the lead path and the smart-list member path so the
// two entry points can never diverge. Searches by organization name; returns the FULL
// person+organization object (lossless apollo_raw) plus the promoted typed columns.
async function enrichBusiness(
  apiKey: string, name: string,
): Promise<{ ok: boolean; status: number; error?: string; apolloRaw: unknown; t: ApolloTyped }> {
  const r = await apollo(apiKey, "/mixed_people/search", {
    q_organization_name: name, person_titles: OWNER_TITLES, per_page: 1, page: 1,
  });
  if (!r.ok) return { ok: false, status: r.status, error: JSON.stringify(r.body).slice(0, 300), apolloRaw: null, t: NULL_TYPED };
  const people: any[] = (r.body as any)?.people ?? (r.body as any)?.contacts ?? [];
  const p = people[0] ?? null;
  const apolloRaw = p ? { person: p, organization: p?.organization ?? p?.account ?? null } : null;
  const t = p ? apolloTyped(p) : NULL_TYPED;
  return { ok: true, status: r.status, apolloRaw, t };
}

// The smart_list_members patch for an Apollo result. ONE builder shared by the ph_ucc
// mirror and the generalized member path so the member view can't drift.
function apolloMemberPatch(apolloRaw: unknown, t: ApolloTyped, nowIso: string) {
  return {
    apollo_raw: apolloRaw,
    business_email: t.business_email,
    owner_title: t.owner_title,
    company: t.company,
    industry: t.industry,
    employees: t.employees,
    annual_revenue: t.annual_revenue,
    linkedin_url: t.linkedin_url,
    website: t.website,
    apollo_city: t.apollo_city,
    apollo_state: t.apollo_state,
    apollo_checked_at: nowIso,
  };
}

// ── Generalized smart-list member path (any source) ─────────────────────────────
type MemberRow = { id: string; source: string; source_id: string; snapshot: Record<string, unknown> | null; apollo_checked_at: string | null };

// Lazily-resolved GHL context: cfg (for reading a source='ghl' contact's company) plus
// the REUSED custom-field ids for write-back (never creates fields, per ghl-custom-field-traps).
type GhlApolloCtx = {
  cfg: GhlConfig | null;
  ids: { business_email?: string; owner_title?: string; company?: string; industry?: string; website?: string };
  matched: Record<string, string>;
  missing: string[];
  error: string | null;
};

async function resolveGhlApolloCtx(db: SupabaseClient): Promise<GhlApolloCtx> {
  const ctx: GhlApolloCtx = { cfg: null, ids: {}, matched: {}, missing: [], error: null };
  try { ctx.cfg = await getGhlConfig(db); } catch (e) { ctx.error = e instanceof Error ? e.message : String(e); return ctx; }
  const res = await listCustomFields(ctx.cfg);
  if (!res.ok || !res.data) { ctx.error = `listCustomFields failed: ${res.error ?? res.status}`; return ctx; }
  const fields: GhlCustomField[] = res.data.customFields ?? [];
  const find = (...terms: string[]): GhlCustomField | undefined => {
    for (const t of terms) { const f = findFieldByName(fields, t); if (f) return f; }
    return undefined;
  };
  const put = (key: keyof GhlApolloCtx["ids"], f: GhlCustomField | undefined) => {
    if (f) { ctx.ids[key] = f.id; ctx.matched[key] = f.name; } else ctx.missing.push(key);
  };
  put("business_email", find("business email", "company email"));
  put("owner_title", find("owner title", "job title", "title"));
  put("company", find("company name"));
  put("industry", find("industry"));
  put("website", find("website", "web site"));
  return ctx;
}

async function writeGhlApolloContact(
  ctx: GhlApolloCtx, contactId: string, t: ApolloTyped,
): Promise<{ ok: boolean; error: string | null }> {
  if (!ctx.cfg) return { ok: false, error: ctx.error ?? "GHL not configured" };
  const fields: Array<{ id: string; value: string | number }> = [];
  if (ctx.ids.business_email && t.business_email != null) fields.push({ id: ctx.ids.business_email, value: t.business_email });
  if (ctx.ids.owner_title && t.owner_title != null) fields.push({ id: ctx.ids.owner_title, value: t.owner_title });
  if (ctx.ids.company && t.company != null) fields.push({ id: ctx.ids.company, value: t.company });
  if (ctx.ids.industry && t.industry != null) fields.push({ id: ctx.ids.industry, value: t.industry });
  if (ctx.ids.website && t.website != null) fields.push({ id: ctx.ids.website, value: t.website });
  if (fields.length === 0) return { ok: true, error: null };
  const res = await updateContactCustomFields(ctx.cfg, contactId, fields);
  if (!res.ok) return { ok: false, error: res.error ?? `status ${res.status}` };
  return { ok: true, error: null };
}

// Resolve the Apollo INPUT (organization name) from a member's real source row. Returns
// null when the row is gone; empty string caller treats as no_input (nothing to search).
async function resolveApolloName(db: SupabaseClient, m: MemberRow, ghlCfg: GhlConfig | null): Promise<string | null> {
  const sid = m.source_id;
  if (m.source === "ph_ucc") {
    const { data } = await db.from("ph_ucc_leads").select("debtor_name").eq("id", sid).maybeSingle();
    return data ? clean(data.debtor_name) : null;
  }
  if (m.source === "lead_records") {
    const { data } = await db.from("lead_records").select("company").eq("id", sid).maybeSingle();
    return data ? clean(data.company) : null;
  }
  if (m.source === "customers") {
    const { data } = await db.from("customers").select("business_name").eq("id", sid).maybeSingle();
    return data ? clean(data.business_name) : null;
  }
  if (m.source === "ghl") {
    if (!ghlCfg) return null;
    const got = await getContact(ghlCfg, sid);
    const c = got.data?.contact as Record<string, unknown> | undefined;
    return c ? clean(c.companyName) : null;
  }
  return null;
}

// Enrich an EXACT set of smart_list_members across ANY source. Apollo needs a business
// name (no address) — a member whose source row has none is SKIPPED and reported
// (no_input), never charged. Idempotent via apollo_checked_at unless force. Returns the
// JSON Response.
async function enrichMembers(
  db: SupabaseClient, apiKey: string, memberIds: string[], force: boolean, limit: number,
): Promise<Response> {
  let mq = db.from("smart_list_members")
    .select("id,source,source_id,snapshot,apollo_checked_at")
    .in("id", memberIds)
    .limit(limit);
  if (!force) mq = mq.is("apollo_checked_at", null);
  const { data: memberData, error: memberErr } = await mq;
  if (memberErr) return json({ ok: false, error: `member select failed: ${memberErr.message}` }, 500);
  const members = (memberData as MemberRow[]) ?? [];
  if (members.length === 0) return json({ ok: true, checked: 0, message: "No members awaiting Apollo enrichment." });

  // Resolve GHL context once up front, only if a source='ghl' member is present.
  const ghlNeeded = members.some((m) => m.source === "ghl");
  const ghlCtx: GhlApolloCtx | null = ghlNeeded ? await resolveGhlApolloCtx(db) : null;
  if (ghlCtx?.error) console.error("[ph-ucc-apollo-enrich] GHL context unavailable", JSON.stringify({ error: ghlCtx.error }));

  const started = Date.now();
  let checked = 0, withEmail = 0, withTitle = 0, noInput = 0, errored = 0;
  let srcWriteback = 0, ghlWriteback = 0;
  const perMember: Record<string, unknown>[] = [];

  for (const m of members) {
    if (Date.now() - started > BUDGET_MS) break;
    const name = await resolveApolloName(db, m, ghlCtx?.cfg ?? null);
    if (!name) {
      noInput++;
      perMember.push({ member_id: m.id, source: m.source, skipped: "no_input" });
      continue;
    }

    try {
      const res = await enrichBusiness(apiKey, name);
      const nowIso = new Date().toISOString();
      if (!res.ok) {
        errored++;
        // Stamp checked_at so a hard error (e.g. 422) isn't retried forever.
        await db.from("smart_list_members").update({ apollo_checked_at: nowIso }).eq("id", m.id);
        perMember.push({ member_id: m.id, source: m.source, debtor: name, error: `apollo ${res.status}`, detail: res.error });
        continue;
      }
      const { apolloRaw, t } = res;

      // Write the member row (by id).
      const { error: mErr } = await db.from("smart_list_members")
        .update(apolloMemberPatch(apolloRaw, t, nowIso)).eq("id", m.id);
      if (mErr) { errored++; perMember.push({ member_id: m.id, source: m.source, debtor: name, error: `member update: ${mErr.message}` }); continue; }

      // Durable write-back to the source row (survives the smart_list cascade).
      if (m.source === "ph_ucc") {
        const { error: lErr } = await db.from("ph_ucc_leads").update({
          apollo_business_email: t.business_email, apollo_owner_title: t.owner_title,
          apollo_raw: apolloRaw, apollo_company: t.company, apollo_industry: t.industry,
          apollo_employees: t.employees, apollo_revenue: t.annual_revenue,
          apollo_linkedin_url: t.linkedin_url, apollo_website: t.website, apollo_checked_at: nowIso,
        }).eq("id", m.source_id);
        if (lErr) console.error("[ph-ucc-apollo-enrich] ph_ucc_leads write-back failed", JSON.stringify({ id: m.source_id, error: lErr.message }));
        else srcWriteback++;
      } else if (m.source === "lead_records") {
        // Dedicated enrichment cols on lead_records: apollo_raw + business_email + owner_title.
        const { error: lErr } = await db.from("lead_records").update({
          apollo_raw: apolloRaw, business_email: t.business_email, owner_title: t.owner_title,
        }).eq("id", m.source_id);
        if (lErr) console.error("[ph-ucc-apollo-enrich] lead_records write-back failed", JSON.stringify({ id: m.source_id, error: lErr.message }));
        else srcWriteback++;
      } else if (m.source === "customers") {
        // Non-destructive: apollo_raw always; typed cols only when Apollo returned a value.
        const patch: Record<string, unknown> = { apollo_raw: apolloRaw };
        if (t.owner_title != null) patch.owner_title = t.owner_title;
        if (t.website != null) patch.website = t.website;
        if (t.industry != null) patch.industry = t.industry;
        if (t.annual_revenue != null) patch.annual_revenue = t.annual_revenue;
        if (t.employees != null) patch.employees = t.employees;
        const { error: lErr } = await db.from("customers").update(patch).eq("id", m.source_id);
        if (lErr) console.error("[ph-ucc-apollo-enrich] customers write-back failed", JSON.stringify({ id: m.source_id, error: lErr.message }));
        else srcWriteback++;
      } else if (m.source === "ghl") {
        // GHL is the CRM system of record — write to REUSED custom fields (never create).
        if (ghlCtx) {
          const w = await writeGhlApolloContact(ghlCtx, m.source_id, t);
          if (!w.ok) console.error("[ph-ucc-apollo-enrich] GHL contact write-back failed", JSON.stringify({ contact_id: m.source_id, error: w.error }));
          else ghlWriteback++;
        }
      }

      checked++;
      if (t.business_email) withEmail++;
      if (t.owner_title) withTitle++;
      perMember.push({ member_id: m.id, source: m.source, debtor: name, business_email: t.business_email ? "found" : null, owner_title: t.owner_title, company: t.company });
    } catch (e) {
      errored++;
      perMember.push({ member_id: m.id, source: m.source, debtor: name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    ok: true, provider: "apollo", mode: "members",
    requested_ids: memberIds.length, candidates: members.length,
    checked, enriched: withEmail, with_business_email: withEmail, with_owner_title: withTitle,
    no_input: noInput, errored, source_writeback: srcWriteback, ghl_writeback: ghlWriteback,
    ghl_field_map: ghlNeeded ? (ghlCtx && ghlCtx.cfg ? { matched: ghlCtx.matched, missing_skipped: ghlCtx.missing } : { unavailable: ghlCtx?.error }) : null,
    elapsed_ms: Date.now() - started, per_member: perMember,
  });
}

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

  // ── Generalized member path: enrich an EXACT set of smart_list_members of ANY source
  // (ph_ucc, lead_records, customers, ghl). Hard-capped to HARD_MAX_LIMIT here too. The
  // apollo_enrich_enabled gate above already ran, so this path honors the same opt-in.
  const memberIdsRaw = (payload as { smart_list_member_ids?: unknown }).smart_list_member_ids;
  const memberIds = Array.isArray(memberIdsRaw)
    ? memberIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, HARD_MAX_LIMIT)
    : null;
  if (memberIds && memberIds.length) {
    try {
      const memberLimit = Math.max(1, Math.min(HARD_MAX_LIMIT, memberIds.length));
      return await enrichMembers(db, apiKey, memberIds, force, memberLimit);
    } catch (e) {
      console.error("[ph-ucc-apollo-enrich] member path FAILED", e instanceof Error ? e.message : String(e));
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
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
      // ONE Apollo call + parse, SHARED with the member path via enrichBusiness.
      const res = await enrichBusiness(apiKey, name);
      const nowIso = new Date().toISOString();
      if (!res.ok) {
        errored++;
        // Still stamp checked_at so a hard error (e.g. 422 bad name) isn't retried forever.
        await db.from("ph_ucc_leads").update({ apollo_checked_at: nowIso }).eq("id", lead.id);
        perLead.push({ lead_id: lead.id, debtor: name, error: `apollo ${res.status}`, detail: res.error });
        continue;
      }
      const { apolloRaw, t } = res;
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
      const { error: mErr } = await db.from("smart_list_members")
        .update(apolloMemberPatch(apolloRaw, t, nowIso))
        .eq("source", "ph_ucc").eq("source_id", lead.id);
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
