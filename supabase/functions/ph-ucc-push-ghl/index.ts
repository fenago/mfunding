// ph-ucc-push-ghl — the LOAD stage of the PH UCC List Machine: the missing link
// between skip-trace and the dialer.
//
// DIRECTION (this is the important part): leads are loaded DIRECTLY into
// HotProspector's dialer store via the HP API (AddMultipleLeads) — the RELIABLE
// direction — and HP's own HP→GHL sync carries them UP to GHL. The old approach
// (upsert a GHL contact and rely on GHL→HP sync) did NOT reliably land leads in
// HP: a pushed GHL contact stayed invisible to the dialer even after HP's "Sync
// Leads" ran. So we stopped depending on GHL→HP and load HP-first. The function
// name is kept ("push-ghl") only to avoid breaking the client's invoke() call.
//
// WHAT IT DOES per call (the UI chunks the filtered lead book and calls this per
// chunk):
//   • Ensures a PER-BATCH HP GROUP exists ("UCC <date>") — an HP dialer campaign
//     targets a GROUP, so the per-batch group is the reliable batch target.
//   • Resolves batch-common TAGS (ucc-lead, ucc-batch-<date>) to numeric HP tag
//     ids (AddMultipleLeads takes numeric tagId, not names).
//   • Bulk-adds the chunk's DIALABLE leads (phone OR email) to that group in ONE
//     AddMultipleLeads call, carrying per-lead UCC context in additional_Info.
//   • Stamps ph_ucc_leads: pushed_to_hp_at + hp_group_id + loaded_at +
//     status='loaded'. That stamp makes a re-push IDEMPOTENT — an already-loaded
//     lead is skipped, never re-queued as a duplicate.
//
// RESILIENCE: the HP client retries BOTH HTTP transients (429/5xx/network) AND
// HP's app-level transient — HTTP 200 with {"response":"false","message":"…Redis
// is unavailable…"} (the lead queue being briefly down) — with exponential
// backoff. One chunk's failure never aborts the run (the client loops all chunks
// continue-on-error).
//
// PUSHING IS FREE. No BatchData / no spend. NO outbound comms — this only
// creates HP leads/group/tags and stamps the DB.
//
// AUTH (mirrors ph-ucc-skiptrace): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import {
  getHotProspectorConfig, hotProspectorToken,
  addMultipleLeads, ensureHpGroup, ensureHpTags, type HpLeadRow,
} from "../_shared/hotprospector.ts";

const HARD_MAX = 100;  // never process more than this many ids per call (UI chunks below this)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

const VALID_EMAIL = (e: unknown): e is string =>
  typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** The sentinel matched_funders value the ingest writes for agent-filed leads. It
 * is NOT a real funder name. */
const AGENT_FILED_SENTINEL = "— agent-filed (funder unknown) —";

type ConfTier = "confirmed" | "high" | "medium" | "low";

/** Resolve a lead's confidence tier — same contract as the UI's leadConfidence(). */
function confidenceTier(l: Lead): ConfTier {
  const c = l.confidence;
  if (c === "confirmed" || c === "high" || c === "medium" || c === "low") return c;
  if (l.lead_class === "agent_masked") {
    const d = l.stack_depth ?? 0;
    if (d >= 3) return "high";
    if (d === 2) return "medium";
    return "low";
  }
  return "confirmed";
}

interface Lead {
  id: string;
  state: string | null;
  debtor_name: string | null;
  debtor_state: string | null;
  matched_funders: string[] | null;
  stack_depth: number | null;
  latest_filing_date: string | null;
  freshness_days: number | null;
  mca_score: number | string | null;
  score: number | string | null;
  status: string;
  person_name: string | null;
  phone: string | null;
  email: string | null;
  apollo_business_email: string | null;
  lead_class: string | null;
  agent_name: string | null;
  confidence: string | null;
  pushed_to_hp_at: string | null;
}

const LEAD_COLS =
  "id,state,debtor_name,debtor_state,matched_funders,stack_depth,latest_filing_date," +
  "freshness_days,mca_score,score,status,person_name,phone,email,apollo_business_email," +
  "lead_class,agent_name,confidence,pushed_to_hp_at";

/** One human-readable context line for HP's additional_Info field. */
function additionalInfo(l: Lead, batchTag: string): string {
  const funders = (l.matched_funders ?? []).filter((f) => f && f !== AGENT_FILED_SENTINEL);
  const st = clean(l.state) ?? clean(l.debtor_state);
  const mca = l.mca_score == null ? null : Number(l.mca_score);
  const parts = [
    `UCC lead (${confidenceTier(l)})`,
    st ? `state ${st.toUpperCase()}` : null,
    l.stack_depth != null ? `${l.stack_depth} position(s)` : null,
    mca != null && Number.isFinite(mca) ? `MCA score ${mca.toFixed(2)}` : null,
    l.latest_filing_date ? `latest filing ${l.latest_filing_date}` : null,
    l.freshness_days != null ? `${l.freshness_days}d old` : null,
    l.lead_class === "agent_masked"
      ? (l.agent_name ? `agent-filed via ${l.agent_name} (funder unknown)` : "agent-filed (funder unknown)")
      : (funders.length ? `funders: ${funders.join(", ")}` : null),
    `batch ${batchTag}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Build the AddMultipleLeads row for one lead. */
function hpRowFor(l: Lead, email: string | null, phone: string | null, batchTag: string): HpLeadRow {
  const nameParts = (clean(l.person_name) ?? "").split(/\s+/).filter(Boolean);
  const row: HpLeadRow = {
    company: clean(l.debtor_name) ?? undefined,
    state: clean(l.state) ?? clean(l.debtor_state) ?? undefined,
    source: "UCC Machine",
    additional_Info: additionalInfo(l, batchTag),
  };
  if (nameParts.length) row.first_name = nameParts[0];
  if (nameParts.length > 1) row.last_name = nameParts.slice(1).join(" ");
  if (phone) row.phone = phone;
  if (email) row.email = email;
  return row;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted secret OR signed-in staff (mirrors ph-ucc-skiptrace) ──
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
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }

  // Explicit id set from the UI's filtered lead book. Hard-capped per call.
  const idsRaw = (payload as { lead_ids?: unknown }).lead_ids;
  const leadIds = Array.isArray(idsRaw)
    ? Array.from(new Set(idsRaw.filter((x): x is string => typeof x === "string" && x.length > 0))).slice(0, HARD_MAX)
    : [];
  if (leadIds.length === 0) return json({ error: "lead_ids[] is required" }, 400);

  // Batch tag / date → per-batch HP group title "UCC <date>".
  const batchTagRaw = clean((payload as { batch_tag?: unknown }).batch_tag);
  const batchDate = clean((payload as { batch_date?: unknown }).batch_date);
  const stamp = (batchDate ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  const batchTag = batchTagRaw ?? `ucc-batch-${stamp}`;
  const groupTitle = `UCC ${stamp}`;

  const started = Date.now();

  // Load the requested leads.
  const { data: leadRows, error: leadErr } = await db
    .from("ph_ucc_leads").select(LEAD_COLS).in("id", leadIds);
  if (leadErr) return json({ error: `lead load failed: ${leadErr.message}` }, 500);
  const leads = (leadRows as unknown as Lead[]) ?? [];

  // ── HotProspector auth ──
  let hpCfg;
  try { hpCfg = await getHotProspectorConfig(db); }
  catch (e) { return json({ error: `HP not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }
  const auth = await hotProspectorToken(hpCfg);
  if (!auth.ok || !auth.token) {
    return json({ error: `HP auth failed: ${auth.error ?? "no token"}`, status: auth.status }, 502);
  }
  const hpToken = auth.token;

  // Ensure the per-batch group + batch-common tags exist.
  const groupId = await ensureHpGroup(hpToken, groupTitle);
  if (!groupId) return json({ error: `could not resolve/create HP group "${groupTitle}"` }, 502);
  const tagIds = await ensureHpTags(hpToken, ["ucc-lead", batchTag]);

  // Partition the requested leads.
  let pushed = 0, updated = 0, skipped_no_contact = 0, errored = 0;
  const perLead: Record<string, unknown>[] = [];
  const toSubmit: Array<{ lead: Lead; row: HpLeadRow }> = [];
  const seen = new Set<string>(); // dedupe within this call by phone/email

  for (const l of leads) {
    const email = VALID_EMAIL(l.email) ? l.email!.trim()
      : VALID_EMAIL(l.apollo_business_email) ? l.apollo_business_email!.trim()
      : null;
    const phone = clean(l.phone);

    if (!email && !phone) {
      skipped_no_contact++;
      perLead.push({ lead_id: l.id, debtor: l.debtor_name, result: "skipped_no_contact" });
      continue;
    }
    // Idempotent: already loaded into HP — skip (never re-queue a duplicate).
    if (l.pushed_to_hp_at) {
      updated++;
      perLead.push({ lead_id: l.id, debtor: l.debtor_name, result: "already_loaded" });
      continue;
    }
    const dedupeKey = (phone ?? "") + "|" + (email ?? "");
    const row = hpRowFor(l, email, phone, batchTag);
    if (!seen.has(dedupeKey)) { seen.add(dedupeKey); toSubmit.push({ lead: l, row }); }
    else { toSubmit.push({ lead: l, row: { ...row, additional_Info: (row.additional_Info ?? "") } }); }
  }

  // ── Bulk-add to HP (ONE queued call), dedupe the wire payload by contact ──
  const nowIso = new Date().toISOString();
  if (toSubmit.length > 0) {
    // Unique wire rows (collapse leads that share a phone/email).
    const wireSeen = new Set<string>();
    const wireRows: HpLeadRow[] = [];
    for (const { row } of toSubmit) {
      const k = (row.phone ?? "") + "|" + (row.email ?? "");
      if (wireSeen.has(k)) continue;
      wireSeen.add(k);
      wireRows.push(row);
    }

    const res = await addMultipleLeads(hpToken, wireRows, groupId, tagIds);
    const ok = res.ok && ((): boolean => {
      const o = Array.isArray(res.data) ? res.data[0] : res.data;
      const r = (o as Record<string, unknown> | null)?.response;
      return r === "true" || r === true;
    })();

    if (ok) {
      // Stamp every requested lead (including our-side duplicates) as loaded.
      const ids = toSubmit.map((t) => t.lead.id);
      const { error: uErr } = await db.from("ph_ucc_leads").update({
        pushed_to_hp_at: nowIso,
        loaded_at: nowIso,
        hp_group_id: groupId,
        status: "loaded",
      }).in("id", ids);
      if (uErr) {
        // HP got the leads but we failed to stamp — report as errored so a re-run
        // reconciles (idempotent: HP dedupe + our stamp guard prevent a double).
        errored += toSubmit.length;
        for (const t of toSubmit) perLead.push({ lead_id: t.lead.id, debtor: t.lead.debtor_name, error: `db stamp: ${uErr.message}` });
      } else {
        pushed += toSubmit.length;
        for (const t of toSubmit) perLead.push({
          lead_id: t.lead.id, debtor: t.lead.debtor_name, result: "pushed",
          channel: t.row.phone ? "phone" : "email_only",
        });
      }
    } else {
      const o = Array.isArray(res.data) ? res.data[0] : res.data;
      const msg = (o as Record<string, unknown> | null)?.message ?? res.error ?? "AddMultipleLeads failed";
      errored += toSubmit.length;
      for (const t of toSubmit) perLead.push({ lead_id: t.lead.id, debtor: t.lead.debtor_name, error: String(msg).slice(0, 200) });
    }
  }

  return json({
    ok: true,
    batch_tag: batchTag,
    hp_group_title: groupTitle,
    hp_group_id: groupId,
    hp_tag_ids: tagIds,
    requested: leadIds.length,
    eligible: toSubmit.length + updated, // dialable leads (to-submit + already-loaded)
    pushed,
    updated,
    skipped_no_contact,
    errors: errored,
    unprocessed_ids: [], // one bulk call — nothing is left mid-run
    elapsed_ms: Date.now() - started,
    per_lead: perLead,
  });
});
