// instantly-enroll — the SEND side of the GHL <-> Instantly cold-email wiring.
//
// A GHL workflow (trigger: tag `camp-micro-bitty` added) fires a Custom Webhook
// here with the contact. We add the contact to the Instantly pilot campaign —
// but ONLY when the address is PROVABLY deliverable. Push, not poll: zero idle
// cost, ~1 GHL call only on the invalid path (the tag).
//
// ── CONTRACT (for the GHL workflow) ────────────────────────────────────────
//   POST https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/instantly-enroll?secret=<webhook_secret>
//   Body: GHL's standard Custom Webhook body. Custom Data keys we read FIRST:
//     contact_id   {{contact.id}}
//     email        {{contact.email}}
//     first_name   {{contact.first_name}}
//     last_name    {{contact.last_name}}
//     company_name {{contact.company_name}}
//     industry     {{contact.<industry field>}}   (blank → "small business")
//   The standard top-level fields (contact_id, email, first_name, ...) are read as
//   a fallback, so a workflow that sends no Custom Data still works.
//
// ── GATES, IN ORDER ─────────────────────────────────────────────────────────
//   1. secret (fail closed)            → 401
//   2. campaign id configured?         → refused_no_campaign (platform_settings.cold_email
//                                         .micro_bitty_campaign_id is NULL until launch)
//   3. already enrolled (ledger)?      → already_enrolled, no Instantly call
//   4. suppressed (DND / prior bounce / prior unsubscribe)?  → refused_suppressed
//   5. verdict on file: verified → enroll; invalid → tag GHL email-invalid;
//      bounced → refuse; catch_all/risky → refuse; none → verify on the fly via
//      _shared/instantly.ts verifyEmail (the ONE definition), in the BACKGROUND
//      (it takes ~20s; the webhook gets a 202 and the ledger row is finished later).
//
// Every outcome is a row in instantly_enroll_log. Every non-auth outcome is 2xx so
// GHL never retry-storms; idempotency (ledger + unique index + Instantly's own
// skip_if_in_campaign) makes a retry harmless anyway.
//
// Auth: verify_jwt=false at the gateway (GHL cannot mint a Supabase JWT); the
// secret is get_ghl_config().webhook_secret, same as ghl-event-hook / dnd-enforce.
// An `Authorization: Bearer <anon>` header is accepted but not required.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient, addContactTags, type GhlConfig, BUILD_COMMIT } from "../_shared/ghl.ts";
import { getInstantlyKey, verifyEmail } from "../_shared/instantly.ts";
import {
  TAG_EMAIL_INVALID, buildInstantlyLead, decideEnrollment, isPlausibleEmail,
  parseEnrollPayload, timingSafeEqualStr, type EnrollInput,
} from "../_shared/coldEmail.ts";
import { loadSettings, readVerdict, storeVerdict } from "../_shared/coldEmailStore.ts";

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify({ ...(body as object), build: BUILD_COMMIT }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type LogRow = {
  ghl_contact_id?: string | null; email?: string | null; instantly_campaign_id?: string | null;
  is_test?: boolean; decision: string; verification_health?: string | null; verification_source?: string | null;
  instantly_lead_id?: string | null; industry_fallback?: boolean | null; detail?: Record<string, unknown>; error?: string | null;
};

async function insertLog(db: SupabaseClient, row: LogRow): Promise<{ id: string | null; error: string | null; code?: string }> {
  const { data, error } = await db.from("instantly_enroll_log").insert(row).select("id").single();
  if (error) {
    console.error("[instantly-enroll] ledger insert failed", error.message);
    return { id: null, error: error.message, code: (error as { code?: string }).code };
  }
  return { id: data.id as string, error: null };
}

async function updateLog(db: SupabaseClient, id: string, patch: Partial<LogRow>): Promise<{ error: string | null; code?: string }> {
  const { error } = await db.from("instantly_enroll_log").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    console.error("[instantly-enroll] ledger update failed", error.message);
    return { error: error.message, code: (error as { code?: string }).code };
  }
  return { error: null };
}

/** POST /leads. Returns the Instantly lead id. Instantly-side dedupe is
 *  skip_if_in_campaign — a skip comes back without an id, which we record as
 *  already_enrolled rather than guessing. */
async function addLead(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch(`${INSTANTLY_API_BASE}/leads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data, text: text.slice(0, 500) };
}

/** Finish a decision that has a verdict. Shared by the synchronous path and the
 *  background verification path. */
async function act(
  db: SupabaseClient, cfg: GhlConfig | null, logId: string, inp: EnrollInput, campaignId: string,
  health: string | null, decision: ReturnType<typeof decideEnrollment>, source: string,
): Promise<Record<string, unknown>> {
  if (decision === "refuse_invalid") {
    let tagged = false; let tagError: string | null = null;
    if (cfg && inp.contactId) {
      const r = await addContactTags(cfg, inp.contactId, [TAG_EMAIL_INVALID]);
      tagged = r.ok; tagError = r.ok ? null : (r.error ?? `HTTP ${r.status}`);
    } else tagError = cfg ? "no contact id in payload" : "GHL not configured";
    await updateLog(db, logId, {
      decision: "refused_invalid", verification_health: health, verification_source: source,
      detail: { tagged_email_invalid: tagged }, error: tagError,
    });
    return { decision: "refused_invalid", tagged_email_invalid: tagged, tag_error: tagError };
  }
  if (decision !== "enroll") {
    const d = decision === "refuse_bounced" ? "refused_bounced"
      : decision === "refuse_suppressed" ? "refused_suppressed" : "refused_unverifiable";
    await updateLog(db, logId, { decision: d, verification_health: health, verification_source: source });
    return { decision: d, health };
  }

  // ── enroll ──
  let apiKey: string;
  try { apiKey = await getInstantlyKey(db); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateLog(db, logId, { decision: "error", verification_health: health, verification_source: source, error: msg });
    return { decision: "error", error: msg };
  }
  const r = await addLead(apiKey, buildInstantlyLead(campaignId, inp));
  if (!r.ok) {
    await updateLog(db, logId, {
      decision: "error", verification_health: health, verification_source: source,
      error: `Instantly POST /leads HTTP ${r.status}: ${r.text}`,
    });
    return { decision: "error", error: `Instantly HTTP ${r.status}` };
  }
  const leadId = typeof r.data.id === "string" ? r.data.id : null;
  const decisionFinal = leadId ? "enrolled" : "already_enrolled";
  const u = await updateLog(db, logId, {
    decision: decisionFinal, verification_health: health, verification_source: source,
    instantly_lead_id: leadId, detail: { instantly_response_keys: Object.keys(r.data).slice(0, 20) },
  });
  if (u.code === "23505") {
    // A concurrent call already holds the 'enrolled' row for this (email, campaign).
    // Instantly's skip_if_in_campaign made our POST a no-op; record the truth.
    await updateLog(db, logId, { decision: "already_enrolled", verification_health: health, verification_source: source, instantly_lead_id: leadId });
    return { decision: "already_enrolled", instantly_lead_id: leadId };
  }
  return { decision: decisionFinal, instantly_lead_id: leadId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // ── secret gate (FAIL CLOSED) ──
  let cfg: GhlConfig | null = null;
  let expected = "";
  {
    const { data, error } = await db.rpc("get_ghl_config");
    if (error) return json({ error: `config unreadable: ${error.message}` }, 503);
    expected = (data?.webhook_secret as string | undefined) ?? "";
    if (data?.api_key && data?.location_id) cfg = { apiKey: data.api_key as string, locationId: data.location_id as string };
  }
  if (!expected) return json({ error: "server auth not configured" }, 503);
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  if (!provided || !timingSafeEqualStr(provided, expected)) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* empty / non-JSON → refused below */ }
  const inp = parseEnrollPayload(body);
  const base = { ghl_contact_id: inp.contactId || null, email: inp.email || null, is_test: inp.test, industry_fallback: inp.industryWasFallback };

  // ── campaign id ──
  const { settings, error: sErr } = await loadSettings(db);
  if (!settings) {
    await insertLog(db, { ...base, decision: "error", error: sErr });
    return json({ ok: false, decision: "error", error: sErr });
  }
  const campaignId = inp.test ? settings.enroll_test_campaign_id : settings.micro_bitty_campaign_id;
  if (!campaignId) {
    const why = inp.test ? "cold_email.enroll_test_campaign_id is not set" : "cold_email.micro_bitty_campaign_id is not set — pilot not launched";
    await insertLog(db, { ...base, decision: "refused_no_campaign", error: why });
    return json({ ok: false, decision: "refused_no_campaign", reason: why });
  }
  const withCampaign = { ...base, instantly_campaign_id: campaignId };

  if (!inp.email || !isPlausibleEmail(inp.email)) {
    await insertLog(db, { ...withCampaign, decision: "refused_no_email", detail: { raw_email: inp.email } });
    return json({ ok: false, decision: "refused_no_email" });
  }

  // ── idempotency: already enrolled in THIS campaign? ──
  {
    const { data, error } = await db.from("instantly_enroll_log").select("id, instantly_lead_id")
      .eq("email", inp.email).eq("instantly_campaign_id", campaignId).eq("decision", "enrolled").limit(1);
    if (error) {
      await insertLog(db, { ...withCampaign, decision: "error", error: `ledger unreadable: ${error.message}` });
      return json({ ok: false, decision: "error", error: "ledger unreadable" });
    }
    if (data && data.length) {
      await insertLog(db, { ...withCampaign, decision: "already_enrolled", instantly_lead_id: data[0].instantly_lead_id as string | null, detail: { prior_log_id: data[0].id } });
      return json({ ok: true, decision: "already_enrolled" });
    }
  }

  // ── verdict ──
  const v = await readVerdict(db, inp.email, inp.contactId);
  if (v.unreadable.length) {
    // An unreadable store is NOT "no verdict" — refuse rather than enroll blind.
    await insertLog(db, { ...withCampaign, decision: "error", error: `verdict unreadable: ${v.unreadable.join("; ")}` });
    return json({ ok: false, decision: "error", error: "verdict store unreadable" });
  }
  const decision = decideEnrollment(v.health, { suppressed: v.suppressed });
  const source = v.suppressionReason ?? (v.sources.join(", ") || "none on file");
  const log = await insertLog(db, {
    ...withCampaign, decision: decision === "verify_first" ? "pending_verification" : "error",
    verification_health: v.health, verification_source: source, detail: { notes: v.notes },
  });
  if (!log.id) return json({ ok: false, decision: "error", error: `ledger insert failed: ${log.error}` });

  if (decision !== "verify_first") {
    const result = await act(db, cfg, log.id, inp, campaignId, v.health, decision, source);
    return json({ ok: true, log_id: log.id, ...result });
  }

  // ── verify on the fly, in the background (~20s; a webhook should not wait) ──
  const work = (async () => {
    try {
      const key = await getInstantlyKey(db);
      const r = await verifyEmail(key, inp.email);
      const storeErrors = await storeVerdict(db, inp.email, r);
      if (storeErrors.length) console.error("[instantly-enroll] storeVerdict", storeErrors);
      const d2 = decideEnrollment(r.health, { suppressed: false, afterVerification: true });
      await act(db, cfg, log.id!, inp, campaignId, r.health, d2,
        `instantly verify (raw=${r.raw ?? "none"}${r.rateLimited ? ", RATE-LIMITED" : ""}${r.error ? `, ${r.error}` : ""})`);
    } catch (e) {
      await updateLog(db, log.id!, { decision: "error", error: e instanceof Error ? e.message : String(e) });
    }
  })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(work);
    return json({ ok: true, decision: "pending_verification", log_id: log.id }, 202);
  }
  await work;
  const { data: fin } = await db.from("instantly_enroll_log").select("decision, verification_health").eq("id", log.id).maybeSingle();
  return json({ ok: true, log_id: log.id, ...(fin ?? {}) });
});
