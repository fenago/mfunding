// ph-send-packet — the PH setter's one-click "send the packet" action.
//
// A PH setter has a UCC-sourced merchant on the line. This mints the merchant's
// connect-your-bank link (the SAME single-purpose, expiring token every other
// path uses — _shared/bankLink.ts, merchant_bank_link_tokens, reused when the
// merchant already has a live one),
// writes that URL onto the GHL contact's `ph_connect_bank_url` custom field, and
// enrolls the contact into the PH packet workflow so GHL fires the SMS/email that
// carries the link. Everything is logged to the deal/customer activity trail.
//
// NAMING LAW: PH asset — function ph-send-packet, settings key ph_settings,
// custom field ph_connect_bank_url. Touches NOTHING in the MCA/VCF pipelines.
//
// AUTH (verify_jwt = true at the gateway), three in-code paths — mirrors score-lead:
//   • ?secret=<GHL webhook_secret> (+ anon Bearer for the gateway) — trusted
//     automation / cron path (a service_role bearer FAILS the staff role check by
//     house rule, so server-side callers use this).
//   • service_role bearer — internal fire-and-forget invokes.
//   • staff JWT (closer/admin/super_admin) — a setter clicking the button.
//
// PARTIAL-SUCCESS CONTRACT: if ph_settings.packet_workflow_id is unset, we still
// mint the token (a), write the field (b) and read-back verify (c), log the event,
// and return { ok:true, partial:true, ... } with a LOUD structured error telling
// the operator to create the PH 01 workflow. Nothing silently half-works.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. The link + copy is
// neutral "connect your bank" language only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch,
  upsertContact,
  type GhlConfig,
} from "../_shared/ghl.ts";
// Minting, reuse, expiry and the write+read-back verify are ONE definition in
// _shared/bankLink.ts — this function used to carry its own copy of all four.
import { ensureBankLink, writeBankLinkToContact } from "../_shared/bankLink.ts";
// Fallbacks if ph_settings is missing a value (the settings row is the source of truth).
const DEFAULT_CONNECT_FIELD_ID = "OUlkd6rcVZ4ZrYTuPob4"; // contact.ph_connect_bank_url

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return (JSON.parse(atob(b64)) as { role?: string }).role ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron secret OR service-role bearer OR staff JWT ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceCall = !!token && (token === serviceKey || jwtRole(token) === "service_role");
  let callerId: string | null = null;

  if (providedSecret) {
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else if (!isServiceCall) {
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
    callerId = caller.id;
  }

  let body: { customerId?: string; dealId?: string; ghlContactId?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  // ── (a) Resolve customer + deal + ghl_contact_id ──
  let customerId = body.customerId ?? null;
  let dealId = body.dealId ?? null;
  let dealGhl: string | null = null;

  if (dealId) {
    const { data: deal, error: dErr } = await db
      .from("deals").select("id, customer_id, ghl_contact_id").eq("id", dealId).maybeSingle();
    if (dErr) return json({ error: `deal lookup failed: ${dErr.message}` }, 502);
    if (!deal) return json({ error: `deal ${dealId} not found` }, 404);
    customerId = customerId ?? (deal.customer_id as string | null);
    dealGhl = (deal.ghl_contact_id as string | null) ?? null;
  }

  // Resolve customer by id, or (last resort) by an explicit ghlContactId.
  interface CustomerRow {
    id: string; first_name: string | null; last_name: string | null;
    business_name: string | null; email: string | null; phone: string | null;
    ghl_contact_id: string | null;
  }
  let customer: CustomerRow | null = null;

  const CUST_COLS = "id, first_name, last_name, business_name, email, phone, ghl_contact_id";
  if (customerId) {
    const { data } = await db.from("customers").select(CUST_COLS).eq("id", customerId).maybeSingle();
    customer = (data as CustomerRow | null) ?? null;
  } else if (body.ghlContactId) {
    const { data } = await db.from("customers").select(CUST_COLS).eq("ghl_contact_id", body.ghlContactId).maybeSingle();
    customer = (data as CustomerRow | null) ?? null;
  }
  if (!customer) {
    return json({ error: "Could not resolve a customer from customerId / dealId / ghlContactId." }, 400);
  }
  customerId = customer.id;

  // GHL config from the vault.
  let cfg: GhlConfig | null = null;
  let cfgErr = "";
  try { cfg = await getGhlConfig(db); } catch (e) { cfgErr = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${cfgErr || "missing credentials"}` }, 502);

  // Resolve the GHL contact id: explicit > deal > customer. If none exists, ensure
  // one by upserting BY EMAIL (GHL dedupes on it — same self-heal the send engines
  // use), then persist. No contact and no email = we cannot proceed.
  let contactId = body.ghlContactId ?? dealGhl ?? customer.ghl_contact_id ?? null;
  if (!contactId) {
    const email = (customer.email ?? "").trim();
    if (!email) {
      return json({ error: "This merchant has no GHL contact and no email to create one. Add an email, then send." }, 422);
    }
    const cr = await upsertContact(cfg, {
      email,
      firstName: customer.first_name ?? undefined,
      lastName: customer.last_name ?? undefined,
      companyName: customer.business_name ?? undefined,
      phone: customer.phone ?? undefined,
      tags: ["merchant", "ph-setter"],
      source: "PH Setter",
    });
    contactId = cr.data?.contact?.id ?? null;
    if (!contactId) return json({ error: `GHL contact upsert failed: ${cr.error ?? "no contact id"}` }, 502);
  }
  // Persist a resolved/created contact id back onto customer (+ deal) so later
  // comms don't re-resolve.
  if ((customer.ghl_contact_id ?? null) !== contactId) {
    await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customerId);
  }
  if (dealId && dealGhl !== contactId) {
    await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", dealId);
  }

  // ── ph_settings ──
  const { data: settingsRow } = await db
    .from("platform_settings").select("value").eq("key", "ph_settings").maybeSingle();
  const settings = (settingsRow?.value ?? {}) as Record<string, unknown>;
  const connectFieldId = (settings.connect_field_id as string | undefined) || DEFAULT_CONNECT_FIELD_ID;
  const packetWorkflowId = (settings.packet_workflow_id as string | null | undefined) ?? null;

  // ── (b) Mint (or reuse) the connect-bank token ──
  const link = await ensureBankLink(db, { customerId, dealId, createdBy: callerId });
  if (!link.ok || !link.url || !link.token) {
    console.error("[ph-send-packet] ensureBankLink failed", link.error);
    return json({ error: link.error ?? "Could not create the bank-connection link." }, 500);
  }
  const tok = link.token;
  const expiresAt = link.expiresAt;
  const connectUrl = link.url;

  // ── (c) Write the URL onto the GHL contact custom field + READ-BACK VERIFY ──
  // Write failure is fatal (nothing to send); an unconfirmed read-back stays
  // non-fatal HERE and is reported — unchanged behaviour for the PH packet.
  // ph_connect_bank_url holds the FULL URL — deliberately a different shape from
  // the application's bank_statement_link, which holds the bare token (the GHL
  // document redirect forces that; see the shape note in _shared/bankLink.ts).
  const write = await writeBankLinkToContact(cfg, contactId, {
    value: connectUrl, shape: "url", fieldId: connectFieldId,
  });
  if (!write.written) {
    return json({
      error: `Wrote the token but GHL rejected the custom-field write: ${write.error ?? "unknown"}`,
      token: tok, url: connectUrl, expires_at: expiresAt, contact_id: contactId,
    }, 502);
  }
  const fieldVerified = write.verified;
  if (!fieldVerified) {
    console.warn("[ph-send-packet] connect-bank field not confirmed on the contact:", write.error);
  }

  // ── (d) Enroll into the PH packet workflow (loud partial if unset) ──
  let workflowEnrolled = false;
  let partial = false;
  let partialReason: string | undefined;
  if (!packetWorkflowId) {
    partial = true;
    partialReason = "PH 01 workflow not created yet — see runbook step 2 (set ph_settings.packet_workflow_id). " +
      "The connect-bank link was minted and written to the contact, but NOTHING was sent to the merchant.";
    console.error("[ph-send-packet] partial: packet_workflow_id is null", JSON.stringify({ contactId, customerId }));
  } else {
    const wf = await ghlFetch(cfg, "POST", `/contacts/${contactId}/workflow/${packetWorkflowId}`, {});
    workflowEnrolled = wf.ok;
    if (!wf.ok) {
      partial = true;
      partialReason = `Enrollment into PH packet workflow failed: ${wf.error ?? "unknown"}. ` +
        `The link was minted + written; re-run to retry the send.`;
      console.error("[ph-send-packet] workflow enroll failed", wf.status, wf.error?.slice(0, 300));
    }
  }

  // ── (e) Activity log ──
  const entityType = dealId ? "deal" : "customer";
  const entityId = dealId ?? customerId;
  const logContent = partial
    ? `PH packet — connect-bank link minted + written to GHL contact (verified=${fieldVerified}), ` +
      `but NOT fully sent: ${partialReason}`
    : `PH packet sent — connect-bank link minted, written to GHL contact (verified=${fieldVerified}), ` +
      `and enrolled into the PH packet workflow.`;
  const { error: logErr } = await db.from("activity_log").insert({
    entity_type: entityType,
    entity_id: entityId,
    interaction_type: "note",
    subject: "ph:packet-sent",
    content: logContent,
    logged_by: callerId,
  });
  if (logErr) console.error("[ph-send-packet] activity_log insert failed", logErr.message);

  return json({
    ok: true,
    partial,
    ...(partialReason ? { error: partialReason } : {}),
    customer_id: customerId,
    deal_id: dealId,
    contact_id: contactId,
    url: connectUrl,
    token: tok,
    expires_at: expiresAt,
    field_id: connectFieldId,
    field_verified: fieldVerified,
    workflow_enrolled: workflowEnrolled,
    packet_workflow_id: packetWorkflowId,
  });
});
