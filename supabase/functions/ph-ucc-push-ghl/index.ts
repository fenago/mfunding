// ph-ucc-push-ghl — the LOAD stage of the PH UCC List Machine: the link between
// skip-trace and the dialer.
//
// DIRECTION — GHL FIRST. THIS IS THE WHOLE POINT OF THE FUNCTION.
//
//   ph_ucc_leads → UPSERT as a TAGGED GoHighLevel contact → HotProspector's
//   integration "Sync Leads" pulls by tag → HP campaigns dial by tag.
//
// It is written this way because the other direction is BROKEN and cost us a
// 1,047-lead incident: loading HP-first via the HP API (AddMultipleLeads) puts
// leads in an intake queue that silently drops them, and an HP-first lead carries
// no GHL contact id, so the dialer's "Gohighlevel Custom Link" errors with "Lead
// data not Synced" and the setter has no playbook. Do NOT reintroduce a direct-to-HP
// path here. HP is a CONSUMER of GHL tags, never the entry point.
//
// TAGS ARE THE PROTOCOL. Every contact this pushes gets:
//   • ucc-lead                — the type tag; the live UCC dialing pool.
//   • ucc-batch-<YYYY-MM-DD>  — the batch tag; what HP's Step 2 sync targets and
//                               what a dialer campaign filters on.
//
// UPSERT ONLY. POST /contacts/upsert dedupes on phone/email inside the location,
// so a merchant already in GHL is enriched and re-tagged, never duplicated. On top
// of the contact we write the three structured UCC custom fields (existing
// positions / current funders / MCA score) so the setter's playbook opens with the
// stacking picture already on screen.
//
// IDEMPOTENT: a lead already stamped with ghl_contact_id is skipped unless the
// caller passes re_push:true. Combined with GHL's upsert-dedupe, a re-run, a
// resumed chunk, or a double-click can never create a second contact.
//
// RESUMABLE: the UI chunks the filtered book and calls this per chunk. Each call
// runs a wall-clock budget and returns whatever it did not reach in
// `unprocessed_ids`, which the client re-invokes with. Nothing is silently dropped.
//
// RATE: ≤5 GHL requests/sec (shared client already retries 429/5xx with backoff).
//
// PUSHING IS FREE. No BatchData / no HP spend. NO outbound comms — this creates and
// tags GHL contacts and stamps the DB, nothing else.
//
// AUTH (mirrors ph-ucc-skiptrace): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, updateContactCustomFields,
  ghlErrorMessage, type GhlConfig,
} from "../_shared/ghl.ts";

const HARD_MAX = 100;        // never process more than this many ids per call (UI chunks below this)
const DEFAULT_RPS = 5;       // GHL requests per second ceiling
const MAX_RPS = 10;
const BUDGET_MS = 60_000;    // wall-clock window; the rest comes back as unprocessed_ids

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

const VALID_EMAIL = (e: unknown): e is string =>
  typeof e === "string" && /^[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}$/.test(e.trim());

/** GHL matches contacts on the E.164 phone, so every push must send the SAME shape
 * the rest of the app sends (+1 + last 10 digits) or the upsert dedupe misses and
 * we create a second contact for a merchant we already have. */
function e164(raw: unknown): string | null {
  const digits = (raw ?? "").toString().replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `+1${digits.slice(-10)}`;
}

/** The sentinel matched_funders value the ingest writes for agent-filed leads. It
 * is NOT a real funder name. */
const AGENT_FILED_SENTINEL = "— agent-filed (funder unknown) —";

interface Lead {
  id: string;
  state: string | null;
  debtor_name: string | null;
  debtor_address: string | null;
  debtor_city: string | null;
  debtor_state: string | null;
  debtor_zip: string | null;
  matched_funders: string[] | null;
  stack_depth: number | null;
  mca_score: number | string | null;
  status: string;
  person_name: string | null;
  phone: string | null;
  email: string | null;
  apollo_business_email: string | null;
  lead_class: string | null;
  ghl_contact_id: string | null;
}

const LEAD_COLS =
  "id,state,debtor_name,debtor_address,debtor_city,debtor_state,debtor_zip," +
  "matched_funders,stack_depth,mca_score,status,person_name,phone,email," +
  "apollo_business_email,lead_class,ghl_contact_id";

/** Real (non-sentinel) funder names for a lead, comma-joined, or null. */
function funderCsv(l: Lead): string | null {
  const fs = (l.matched_funders ?? []).filter((f) => f && f !== AGENT_FILED_SENTINEL);
  return fs.length ? fs.join(", ") : null;
}

/** Structured custom-field array for a lead using the config-driven field ids.
 * Only pushes a field when we HAVE both the id (from get_ghl_config) and a value. */
function uccCustomFields(cfg: GhlConfig, l: Lead): Array<{ id: string; value: string | number }> {
  const out: Array<{ id: string; value: string | number }> = [];
  if (cfg.cfExistingPositions && l.stack_depth != null) {
    out.push({ id: cfg.cfExistingPositions, value: l.stack_depth });
  }
  if (cfg.cfCurrentFunders) {
    const csv = funderCsv(l);
    if (csv) out.push({ id: cfg.cfCurrentFunders, value: csv });
  }
  if (cfg.cfMcaScore && l.mca_score != null) {
    const n = Number(l.mca_score);
    if (Number.isFinite(n)) out.push({ id: cfg.cfMcaScore, value: n });
  }
  return out;
}

type PushOutcome =
  | { ok: true; contactId: string; customFields: boolean }
  | { ok: false; error: string };

/**
 * Push ONE lead into GHL as a tagged contact, then write its UCC custom fields.
 *
 * The custom-field write is a separate PUT on purpose: a bad field id must not
 * take down the contact upsert itself, so a field failure is logged and the lead
 * still counts as pushed (the contact exists and is tagged — HP can sync it).
 */
async function pushOne(
  cfg: GhlConfig, l: Lead, email: string | null, phone: string | null, tags: string[],
): Promise<PushOutcome> {
  const nameParts = (clean(l.person_name) ?? "").split(/\s+/).filter(Boolean);
  const res = await upsertContact(cfg, {
    firstName: nameParts.length ? nameParts[0] : undefined,
    lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
    companyName: clean(l.debtor_name),
    email: email ?? undefined,
    phone: phone ?? undefined,
    address1: clean(l.debtor_address),
    city: clean(l.debtor_city),
    // debtor_state FIRST — `state` is the state the UCC was FILED in, which is often
    // not where the merchant is. Preferring it wrote addresses like
    // "MOUNT HOLLY, CT 08060" (that ZIP is NJ) onto real contacts. The address block
    // has to come from one source: the debtor's own address.
    state: clean(l.debtor_state) ?? clean(l.state),
    postalCode: clean(l.debtor_zip),
    tags,
    source: "UCC Machine",
  });
  const contactId = res.data?.contact?.id ?? null;
  if (!res.ok || !contactId) {
    return {
      ok: false,
      error: (res.ok ? "upsert returned no contact id" : ghlErrorMessage(res.error)).slice(0, 300),
    };
  }

  let customFields = false;
  const fields = uccCustomFields(cfg, l);
  if (fields.length) {
    const cf = await updateContactCustomFields(cfg, contactId, fields);
    customFields = cf.ok;
    if (!cf.ok) {
      console.warn("[ph-ucc-push-ghl] custom-field write failed (contact still pushed)",
        JSON.stringify({ lead_id: l.id, contact_id: contactId, error: ghlErrorMessage(cf.error) }));
    }
  }
  return { ok: true, contactId, customFields };
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

  // Re-push revisits leads that already carry a ghl_contact_id (upsert makes that
  // safe — it re-tags and re-enriches the SAME contact, never a duplicate).
  const rePush = (payload as { re_push?: unknown }).re_push === true;

  const rps = Math.min(Math.max(Number((payload as { rps?: unknown }).rps) || DEFAULT_RPS, 1), MAX_RPS);

  // Batch tag — today's convention, kept: ucc-batch-<YYYY-MM-DD>.
  const batchTagRaw = clean((payload as { batch_tag?: unknown }).batch_tag);
  const batchDate = clean((payload as { batch_date?: unknown }).batch_date);
  const stamp = (batchDate ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  const batchTag = (batchTagRaw ?? `ucc-batch-${stamp}`).toLowerCase();
  const tags = Array.from(new Set(["ucc-lead", batchTag]));

  const started = Date.now();

  // Load the requested leads.
  const { data: leadRows, error: leadErr } = await db
    .from("ph_ucc_leads").select(LEAD_COLS).in("id", leadIds);
  if (leadErr) return json({ error: `lead load failed: ${leadErr.message}` }, 500);
  const leads = (leadRows as unknown as Lead[]) ?? [];

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // ── Partition ──────────────────────────────────────────────────────────────
  let pushed = 0, updated = 0, skipped_no_contact = 0, errored = 0, enriched = 0;
  const perLead: Record<string, unknown>[] = [];
  const toPush: Array<{ lead: Lead; email: string | null; phone: string | null }> = [];

  for (const l of leads) {
    const email = VALID_EMAIL(l.email) ? l.email!.trim().toLowerCase()
      : VALID_EMAIL(l.apollo_business_email) ? l.apollo_business_email!.trim().toLowerCase()
      : null;
    const phone = e164(l.phone);

    // Not dialable and not emailable — GHL has nothing to dedupe on either.
    if (!email && !phone) {
      skipped_no_contact++;
      perLead.push({ lead_id: l.id, debtor: l.debtor_name, result: "skipped_no_contact" });
      continue;
    }
    if (l.ghl_contact_id && !rePush) {
      updated++;
      perLead.push({ lead_id: l.id, debtor: l.debtor_name, result: "already_loaded", ghl_contact_id: l.ghl_contact_id });
      continue;
    }
    toPush.push({ lead: l, email, phone });
  }

  // ── Push in waves of `rps`, each wave taking ≥1s per GHL call it makes ──────
  // Each lead costs at most 2 GHL requests (upsert + custom fields), so a wave of
  // `rps` leads is held to 2s when we're writing custom fields — that keeps the
  // real request rate at or under `rps`/sec either way.
  const callsPerLead = (cfg.cfExistingPositions || cfg.cfCurrentFunders || cfg.cfMcaScore) ? 2 : 1;
  const waveFloorMs = 1000 * callsPerLead;
  let reached = 0;

  for (let i = 0; i < toPush.length; i += rps) {
    if (Date.now() - started > BUDGET_MS) break;
    const waveStart = Date.now();
    const wave = toPush.slice(i, i + rps);

    const results = await Promise.all(wave.map(async (t) => {
      try {
        return { t, out: await pushOne(cfg, t.lead, t.email, t.phone, tags) };
      } catch (e) {
        return { t, out: { ok: false as const, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } };
      }
    }));

    const nowIso = new Date().toISOString();
    for (const { t, out } of results) {
      reached++;
      if (!out.ok) {
        errored++;
        perLead.push({ lead_id: t.lead.id, debtor: t.lead.debtor_name, error: out.error });
        continue;
      }
      if (out.customFields) enriched++;
      // Stamp: the contact id is what makes the setter playbook resolve instantly,
      // pushed_to_ghl_at is what the UI's "already loaded" count reads, and
      // status='loaded' is the funnel stage.
      const { error: uErr } = await db.from("ph_ucc_leads").update({
        ghl_contact_id: out.contactId,
        pushed_to_ghl_at: nowIso,
        loaded_at: nowIso,
        status: "loaded",
      }).eq("id", t.lead.id);
      if (uErr) {
        // GHL has the contact but we failed to record it — LOUD, and counted as an
        // error so a re-run reconciles the row (upsert makes that safe).
        console.error("[ph-ucc-push-ghl] stamp failed",
          JSON.stringify({ lead_id: t.lead.id, contact_id: out.contactId, error: uErr.message }));
        errored++;
        perLead.push({ lead_id: t.lead.id, debtor: t.lead.debtor_name, error: `db stamp: ${uErr.message}` });
        continue;
      }
      pushed++;
      perLead.push({
        lead_id: t.lead.id, debtor: t.lead.debtor_name, result: "pushed",
        ghl_contact_id: out.contactId,
        channel: t.phone ? "phone" : "email_only",
      });
    }

    const elapsed = Date.now() - waveStart;
    if (elapsed < waveFloorMs && i + rps < toPush.length) await sleep(waveFloorMs - elapsed);
  }

  // Anything the budget cut short comes back for the client to re-invoke with.
  const unprocessed_ids = toPush.slice(reached).map((t) => t.lead.id);

  return json({
    ok: true,
    batch_tag: batchTag,
    tags,
    requested: leadIds.length,
    eligible: toPush.length + updated, // contactable leads (to-push + already-loaded)
    pushed,
    updated,
    skipped_no_contact,
    ghl_enriched: enriched, // contacts we also wrote the UCC custom fields onto
    errors: errored,
    unprocessed_ids,
    elapsed_ms: Date.now() - started,
    per_lead: perLead,
  });
});
