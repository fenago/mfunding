// instantly-event-hook — the RETURN side of the GHL <-> Instantly cold-email wiring
// (the cold-email lead router pinned since 2026-07-10, see pinned-lead-routers).
//
// Instantly POSTs a webhook per event. PUSH, never poll: nothing runs unless a
// merchant actually did something, and each event costs ~2-5 GHL calls.
//
// ── ORDER OF OPERATIONS (why it is safe) ───────────────────────────────────
//   1. secret gate (fail closed, 401)
//   2. RAW RECEIPT FIRST: the body is written to instantly_event_log before any
//      interpretation. If that write fails we return 500 so the sender retries —
//      the one case where an error status is correct, because otherwise the event
//      would be lost with nothing recording it.
//   3. idempotency: event_key is UNIQUE. Instantly sends NO event id (see
//      _shared/coldEmail.ts eventKey), so the key is derived from the fields that
//      identify one occurrence. A redelivery hits 23505 → 200 {duplicate:true}.
//   4. classify → act → stamp the receipt (processed | parked | error | ignored).
//      Unknown event types (incl. workspace custom labels) and unreadable bodies are
//      PARKED with the raw payload — never silently dropped.
//
// ── WHAT EACH EVENT DOES ────────────────────────────────────────────────────
//   reply_received / lead_interested → resolve the merchant (customer_ids_for_ghl,
//       the merchantIdentity rules), GHL contact tagged cold-email-replied, a
//       cold_email deal (or reuse of an OPEN deal), an MCA opportunity at New Lead
//       with Source "Cold Email – Micro", a setter task, campaign attribution.
//       A reply that IS an opt-out ("stop") takes the unsubscribe path instead.
//   link_clicked      → GHL task "Clicked Momentum Micro overview — call" (once per lead).
//   lead_unsubscribed → GHL EMAIL DND only. customers.do_not_contact is NOT touched:
//       flipping it fires trg_customers_dnd_close_open_deals, which KILLS every open
//       deal and closes every GHL opportunity (dnd-enforcement). Declining further
//       cold email is not "never contact me by any channel" — a merchant who
//       unsubscribes from a sequence may still be mid-application with a closer.
//   email_bounced     → the address is marked unsendable (customers.email_status +
//       lead_records verdict = bounced) and the receipt itself is a suppression
//       record, so instantly-enroll refuses it forever.
//
// Every non-auth outcome is 2xx so the sender never retry-storms.
// Auth: verify_jwt=false (Instantly cannot mint a Supabase JWT);
// ?secret=<get_ghl_config().webhook_secret>, same as ghl-event-hook.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, ghlFetch, upsertContact, addContactTags, getContact,
  searchContacts, createOpportunity, type GhlConfig, BUILD_COMMIT,
} from "../_shared/ghl.ts";
import {
  OPP_SOURCE, TAG_REPLIED, TAG_UNSUBSCRIBED, classifyEvent, dueIn, eventKey, nameParts, normCompany,
  ownReplyText, parseInstantlyEvent, timingSafeEqualStr, type InstantlyEvent,
} from "../_shared/coldEmail.ts";
import { loadSettings, markBounced, type ColdEmailSettings } from "../_shared/coldEmailStore.ts";
import { recordMerchantContacts } from "../_shared/merchantIdentity.ts";
import { fireAndForgetScore } from "../_shared/scoreLeadInvoke.ts";

const VIA = "instantly-event-hook";
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
const NEW_LEAD_STAGE_ID = "d60d563a-9904-423f-9a8e-0d0df0b12976"; // verified live 2026-11-16
// Statuses where a deal is no longer being worked — a reply then opens a NEW deal.
const CLOSED_STATUSES = ["nurture", "declined", "dead", "funded", "renewal_eligible", "restructure_executed", "servicing"];
const CLICK_TASK_TITLE = "Clicked Momentum Micro overview — call";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify({ ...(body as object), build: BUILD_COMMIT }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Outcome = Record<string, unknown>;
interface Result {
  status: "processed" | "parked" | "error" | "ignored";
  outcome: Outcome;
  error?: string | null;
  customerId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
}

// ── GHL helpers ─────────────────────────────────────────────────────────────

/** The contact this event is about. Our enrollment stamps ghl_contact_id into the
 *  Instantly lead's custom variables, so normally this is free. Fallback: search by
 *  email (1 call). `create` upserts when nothing exists (reply path only — a click or
 *  unsubscribe from someone GHL never had is parked, not invented). */
async function resolveContact(cfg: GhlConfig, ev: InstantlyEvent, create: boolean): Promise<{ id: string | null; how: string; error?: string }> {
  if (ev.ghlContactId) return { id: ev.ghlContactId, how: "custom_variable" };
  const s = await searchContacts(cfg, { query: ev.leadEmail, pageLimit: 5 });
  if (!s.ok) return { id: null, how: "search", error: s.error ?? `HTTP ${s.status}` };
  const hit = (s.data?.contacts ?? []).find((c) => String(c.email ?? "").toLowerCase() === ev.leadEmail);
  if (hit?.id) return { id: String(hit.id), how: "search" };
  if (!create) return { id: null, how: "search", error: "no GHL contact with this email" };
  const n = nameParts(ev.firstName, ev.lastName, ev.leadEmail);
  const u = await upsertContact(cfg, {
    firstName: n.first || null, lastName: n.last || null, email: ev.leadEmail,
    phone: ev.phone || null, companyName: ev.companyName || null, source: OPP_SOURCE,
  });
  const id = u.data?.contact?.id ?? null;
  return id ? { id, how: u.data?.new ? "upsert_created" : "upsert_existing" } : { id: null, how: "upsert", error: u.error ?? `HTTP ${u.status}` };
}

async function createTask(cfg: GhlConfig, contactId: string, title: string, body: string, assignedTo: string | null, dueMinutes: number) {
  const payload: Record<string, unknown> = { title, body, dueDate: dueIn(dueMinutes), completed: false };
  if (assignedTo) payload.assignedTo = assignedTo;
  const r = await ghlFetch<{ task?: { id: string }; id?: string }>(cfg, "POST", `/contacts/${contactId}/tasks`, payload);
  return { ok: r.ok, id: r.data?.task?.id ?? (r.data as { id?: string } | null)?.id ?? null, error: r.ok ? null : (r.error ?? `HTTP ${r.status}`) };
}

/** Has an earlier processed event for this address already done `effect`? */
async function priorEffect(db: SupabaseClient, email: string, action: string, key: string, sinceDays: number): Promise<{ found: boolean; error: string | null }> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await db.from("instantly_event_log").select("id")
    .eq("lead_email", email).eq("action", action).eq("status", "processed")
    .gte("received_at", since).not(`outcome->>${key}`, "is", null).limit(1);
  if (error) return { found: false, error: error.message };
  return { found: (data ?? []).length > 0, error: null };
}

function attributionFor(ev: InstantlyEvent, s: ColdEmailSettings): { campaignId: string | null; note: string } {
  const isMicro = (s.micro_bitty_campaign_id && ev.campaignId === s.micro_bitty_campaign_id) || /momentum\s*micro/i.test(ev.campaignName);
  if (isMicro && s.campaign_record_id) return { campaignId: s.campaign_record_id, note: `attributed to Momentum Micro campaign record via Instantly campaign "${ev.campaignName}"` };
  return { campaignId: null, note: `Instantly campaign "${ev.campaignName || ev.campaignId}" is not mapped to a campaign record — left unattributed` };
}

// ── actions ─────────────────────────────────────────────────────────────────

async function handleReply(db: SupabaseClient, cfg: GhlConfig, ev: InstantlyEvent, s: ColdEmailSettings): Promise<Result> {
  const out: Outcome = {};
  const c = await resolveContact(cfg, ev, true);
  if (!c.id) return { status: "error", outcome: { contact_how: c.how }, error: `GHL contact unresolved: ${c.error}` };
  const contactId = c.id;
  out.contact_how = c.how;

  const tag = await addContactTags(cfg, contactId, [TAG_REPLIED]);
  out.tagged = tag.ok;
  if (!tag.ok) out.tag_error = tag.error ?? `HTTP ${tag.status}`;

  // ── merchant (merchantIdentity rules: contact ids ∪ emails, refuse to guess) ──
  const { data: ids, error: idErr } = await db.rpc("customer_ids_for_ghl", { p_contact_ids: [contactId], p_emails: [ev.leadEmail] });
  if (idErr) return { status: "error", outcome: out, error: `customer_ids_for_ghl failed: ${idErr.message}`, contactId };
  const distinct = [...new Set(((ids ?? []) as Array<{ customer_id: string }>).map((r) => r.customer_id))];

  const own = ownReplyText(ev.replyText).slice(0, 1500);
  const snippet = own || (ev.eventType === "lead_interested" ? "(lead labelled Interested in Instantly)" : "(no reply text)");
  const taskBody = `${ev.eventType === "lead_interested" ? "Marked INTERESTED" : "REPLIED"} to cold email (${ev.campaignName || "Instantly"}).\n\n"${snippet.slice(0, 600)}"${ev.unibox ? `\n\nThread: ${ev.unibox}` : ""}`;

  if (distinct.length > 1) {
    // Two merchants share this contact/email. Attaching to either is a guess that
    // files the reply against the wrong business — park the DEAL half for a human,
    // but still get a setter on the phone (the GHL side is one unambiguous contact).
    const t = await createTask(cfg, contactId, `Cold-email reply — call now (matches ${distinct.length} merchants, pick one)`, taskBody, s.reply_task_assignee_ghl_user_id, s.reply_first_call_sla_minutes);
    return { status: "parked", outcome: { ...out, ambiguous_customers: distinct, task_id: t.id, task_error: t.error }, error: "ambiguous merchant — deal not created", contactId };
  }

  let customerId = distinct[0] ?? null;
  if (!customerId) {
    const n = nameParts(ev.firstName, ev.lastName, ev.leadEmail);
    const { data: cust, error } = await db.from("customers").insert({
      first_name: n.first, last_name: n.last, email: ev.leadEmail, phone: ev.phone || null,
      business_name: ev.companyName || null, industry: ev.industry || null,
      status: "lead", source: "cold_email", temperature: "hot", ghl_contact_id: contactId,
    }).select("id").single();
    if (error) return { status: "error", outcome: out, error: `customer insert failed: ${error.message}`, contactId };
    customerId = cust.id as string;
    out.customer_created = true;
  }
  const rec = await recordMerchantContacts(db, customerId, [contactId]);
  if (rec.error) out.identity_record_error = rec.error;

  // ── deal: reuse an OPEN one, else create a cold_email deal ──
  const attr = attributionFor(ev, s);
  out.attribution = attr.note;
  const { data: open, error: oErr } = await db.from("deals")
    .select("id, deal_number, status, campaign_id, ghl_opportunity_id, assigned_closer_id")
    .eq("customer_id", customerId).not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
    .order("created_at", { ascending: false }).limit(1);
  if (oErr) return { status: "error", outcome: out, error: `open-deal lookup failed: ${oErr.message}`, customerId, contactId };

  let dealId: string; let dealNumber: string | null; let oppId: string | null; let closerId: string | null;
  if (open && open.length) {
    const d = open[0];
    dealId = d.id as string; dealNumber = d.deal_number as string | null;
    oppId = (d.ghl_opportunity_id as string | null) ?? null; closerId = (d.assigned_closer_id as string | null) ?? null;
    out.deal_reused = true;
    if (!d.campaign_id && attr.campaignId) {
      const { error } = await db.from("deals").update({ campaign_id: attr.campaignId }).eq("id", dealId);
      if (error) out.campaign_backfill_error = error.message;
    }
  } else {
    const now = Date.now();
    const { data: deal, error } = await db.from("deals").insert({
      customer_id: customerId, deal_type: "mca", status: "new",
      lead_source: "cold_email",
      lead_source_detail: `${OPP_SOURCE} · ${ev.campaignName || "Instantly"}`,
      campaign_id: attr.campaignId, temperature: "hot",
      first_call_due_at: new Date(now + s.reply_first_call_sla_minutes * 60_000).toISOString(),
      ghl_contact_id: contactId,
      notes: [
        `Cold-email ${ev.eventType === "lead_interested" ? "INTERESTED label" : "reply"} — ${ev.campaignName || "Instantly"}`,
        ev.companyName && `Business: ${ev.companyName}`,
        ev.industry && `Industry: ${ev.industry}`,
        `Reply: ${snippet.slice(0, 600)}`,
        ev.unibox && `Thread: ${ev.unibox}`,
      ].filter(Boolean).join("\n"),
    }).select("id, deal_number, assigned_closer_id").single();
    if (error) return { status: "error", outcome: out, error: `deal insert failed: ${error.message}`, customerId, contactId };
    dealId = deal.id as string; dealNumber = deal.deal_number as string | null;
    closerId = (deal.assigned_closer_id as string | null) ?? null; oppId = null;
    out.deal_created = true;
    fireAndForgetScore(dealId, "cold_email_reply");
  }
  out.deal_number = dealNumber;

  {
    const { error } = await db.from("activity_log").insert({
      entity_type: "deal", entity_id: dealId, interaction_type: "email",
      subject: `cold-email:${ev.eventType === "lead_interested" ? "interested" : "reply"} — ${ev.campaignName || "Instantly"}`,
      content: `${ev.replySubject ? `Subject: ${ev.replySubject}\n` : ""}${snippet}${ev.unibox ? `\n\nUnibox: ${ev.unibox}` : ""}\n\n${attr.note}. Via ${VIA}.`,
    });
    if (error) out.activity_error = error.message;
  }

  // ── GHL opportunity at New Lead (one per contact per pipeline — GHL enforces it) ──
  let oppAssignee: string | null = null;
  if (!oppId) {
    const opp = await createOpportunity(cfg, {
      pipelineId: MCA_PIPELINE_ID, pipelineStageId: NEW_LEAD_STAGE_ID, contactId,
      name: ev.companyName || [ev.firstName, ev.lastName].filter(Boolean).join(" ") || ev.leadEmail,
      source: OPP_SOURCE,
    });
    oppId = opp.data?.opportunity?.id ?? null;
    if (oppId) out.opportunity_created = true;
    if (!oppId && opp.error) {
      // Contact already has an opportunity in this pipeline (purchased-list contacts
      // all do). Reuse it — never move it backwards, never overwrite its Source.
      try {
        const m = JSON.parse(opp.error) as { meta?: { existingId?: string } };
        if (m?.meta?.existingId) { oppId = m.meta.existingId; out.opportunity_reused = true; }
      } catch { /* not JSON */ }
      if (!oppId) out.opportunity_error = opp.error;
    }
    if (oppId) {
      const { error } = await db.from("deals").update({ ghl_opportunity_id: oppId, ghl_contact_id: contactId }).eq("id", dealId);
      if (error) out.deal_link_error = error.message;
    }
  }
  out.opportunity_id = oppId;
  if (oppId) {
    const g = await ghlFetch<{ opportunity?: { assignedTo?: string } }>(cfg, "GET", `/opportunities/${oppId}`);
    oppAssignee = g.data?.opportunity?.assignedTo ?? null;
  }

  // ── setter task — once per lead (reply then interested must not double-task) ──
  const prior = await priorEffect(db, ev.leadEmail, "reply", "task_id", 7);
  if (prior.error) out.prior_check_error = prior.error;
  if (prior.found) out.task_skipped = "a task was already created for this lead in the last 7 days";
  else {
    let closerGhl: string | null = null;
    if (!s.reply_task_assignee_ghl_user_id && !oppAssignee && closerId) {
      const { data: p } = await db.from("profiles").select("ghl_user_id").eq("id", closerId).maybeSingle();
      closerGhl = (p?.ghl_user_id as string | null) ?? null;
    }
    const assignee = s.reply_task_assignee_ghl_user_id ?? oppAssignee ?? closerGhl;
    const t = await createTask(cfg, contactId, `Cold-email reply — call now: ${ev.companyName || ev.leadEmail}`, taskBody, assignee, s.reply_first_call_sla_minutes);
    out.task_id = t.id; out.task_assignee = assignee;
    if (!t.ok) out.task_error = t.error;
  }

  return { status: "processed", outcome: out, customerId, dealId, contactId };
}

async function handleClick(db: SupabaseClient, cfg: GhlConfig, ev: InstantlyEvent, s: ColdEmailSettings): Promise<Result> {
  const prior = await priorEffect(db, ev.leadEmail, "click", "task_id", 30);
  if (prior.error) return { status: "error", outcome: {}, error: `prior-click check failed: ${prior.error}` };
  if (prior.found) return { status: "ignored", outcome: { reason: "click task already created for this lead (30d)" } };
  const c = await resolveContact(cfg, ev, false);
  if (!c.id) return { status: "parked", outcome: { contact_how: c.how }, error: `no GHL contact: ${c.error}` };
  const t = await createTask(cfg, c.id, CLICK_TASK_TITLE,
    `Clicked the Momentum Micro overview link in "${ev.campaignName || "Instantly"}" (step ${ev.step || "?"}). Warm — call.`,
    s.reply_task_assignee_ghl_user_id, 60);
  return t.ok
    ? { status: "processed", outcome: { contact_how: c.how, task_id: t.id }, contactId: c.id }
    : { status: "error", outcome: { contact_how: c.how }, error: `task create failed: ${t.error}`, contactId: c.id };
}

async function handleUnsubscribe(db: SupabaseClient, cfg: GhlConfig, ev: InstantlyEvent, viaReply: boolean): Promise<Result> {
  const out: Outcome = { via_reply: viaReply };
  const c = await resolveContact(cfg, ev, false);
  if (!c.id) {
    // Still a suppression: this receipt row (action=unsubscribe) blocks re-enrollment.
    return { status: "processed", outcome: { ...out, contact_how: c.how, ghl_dnd: "no GHL contact — suppression recorded locally only" } };
  }
  // dndSettings is REPLACED wholesale by PUT (ghl-sync merges first for the same
  // reason) — read, merge Email only, write.
  const cur = await getContact(cfg, c.id);
  if (!cur.ok) return { status: "error", outcome: out, error: `GHL contact read failed: ${cur.error}`, contactId: c.id };
  const prior = ((cur.data?.contact?.dndSettings ?? {}) as Record<string, unknown>);
  const put = await ghlFetch(cfg, "PUT", `/contacts/${c.id}`, {
    dndSettings: { ...prior, Email: { status: "active", message: `Unsubscribed from cold email (${ev.campaignName || "Instantly"})${viaReply ? " by replying" : ""}`, code: "cold-email-unsub" } },
  });
  out.ghl_email_dnd = put.ok;
  if (!put.ok) return { status: "error", outcome: out, error: `GHL DND write failed: ${put.error}`, contactId: c.id };
  const tag = await addContactTags(cfg, c.id, [TAG_UNSUBSCRIBED]);
  out.tagged = tag.ok;

  // Audit on any merchant record we hold — a NOTE, not a do_not_contact flip (see header).
  const { data: custs } = await db.from("customers").select("id").ilike("email", ev.leadEmail);
  for (const cu of custs ?? []) {
    const { error } = await db.from("activity_log").insert({
      entity_type: "customer", entity_id: cu.id, interaction_type: "note",
      subject: "cold-email:unsubscribed",
      content: `Unsubscribed from cold email "${ev.campaignName || "Instantly"}"${viaReply ? ` by replying: "${ownReplyText(ev.replyText).slice(0, 200)}"` : ""}. GHL EMAIL DND set; do_not_contact deliberately NOT set (cold-email opt-out ≠ full DND). Via ${VIA}.`,
    });
    if (error) out.activity_error = error.message;
  }
  return { status: "processed", outcome: out, contactId: c.id, customerId: (custs?.[0]?.id as string | undefined) ?? null };
}

async function handleBounce(db: SupabaseClient, ev: InstantlyEvent): Promise<Result> {
  const r = await markBounced(db, ev.leadEmail, `Instantly: cold email bounced (${ev.campaignName || ev.campaignId})`);
  return {
    status: r.errors.length ? "error" : "processed",
    outcome: { customers_marked: r.customers, lead_records_marked: r.leadRecords },
    error: r.errors.length ? r.errors.join("; ") : null,
  };
}

// ── entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  let cfg: GhlConfig | null = null;
  let expected = "";
  {
    const { data, error } = await db.rpc("get_ghl_config");
    if (error) return json({ error: `config unreadable: ${error.message}` }, 503);
    expected = (data?.webhook_secret as string | undefined) ?? "";
    if (data?.api_key && data?.location_id) cfg = { apiKey: data.api_key as string, locationId: data.location_id as string };
  }
  if (!expected) return json({ error: "server auth not configured" }, 503);
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-instantly-secret") ?? "";
  if (!provided || !timingSafeEqualStr(provided, expected)) return json({ error: "unauthorized" }, 401);

  // ── raw receipt FIRST ──
  const raw = await req.text();
  let body: Record<string, unknown> | null = null;
  try { const p = raw ? JSON.parse(raw) : null; body = p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch { /* unreadable */ }
  const ev = parseInstantlyEvent(body ?? {});
  const key = body
    ? await eventKey(body, ev)
    : await eventKey({}, { ...ev, eventType: "unreadable", leadEmail: "", timestamp: raw.slice(0, 2000) });

  const { data: rcpt, error: rErr } = await db.from("instantly_event_log").insert({
    event_key: key, event_type: ev.eventType || null, lead_email: ev.leadEmail || null,
    instantly_campaign_id: ev.campaignId || null,
    company_norm: normCompany(ev.companyName),   // stop-for-company key read by instantly-enroll
    payload: body ?? { _raw: raw.slice(0, 20000) },
  }).select("id").single();
  if (rErr) {
    if ((rErr as { code?: string }).code === "23505") return json({ ok: true, duplicate: true, event_key: key });
    console.error(`[${VIA}] receipt insert failed`, rErr.message);
    return json({ ok: false, error: "receipt not recorded" }, 500);
  }
  const receiptId = rcpt.id as string;

  const cls = body ? classifyEvent(ev) : { action: "park" as const, reason: "body is not a JSON object — unreadable" };
  let res: Result;
  try {
    const { settings, error: sErr } = await loadSettings(db);
    if (cls.action === "park") res = { status: "parked", outcome: {}, error: cls.reason };
    else if (cls.action === "bounce") res = await handleBounce(db, ev);
    else if (!cfg) res = { status: "error", outcome: {}, error: "GHL not configured" };
    else if (!settings) res = { status: "error", outcome: {}, error: sErr };
    else if (cls.action === "reply") res = await handleReply(db, cfg, ev, settings);
    else if (cls.action === "click") res = await handleClick(db, cfg, ev, settings);
    else res = await handleUnsubscribe(db, cfg, ev, ev.eventType === "reply_received");
  } catch (e) {
    res = { status: "error", outcome: {}, error: e instanceof Error ? e.message : String(e) };
  }

  const { error: uErr } = await db.from("instantly_event_log").update({
    status: res.status, action: cls.action, reason: cls.reason, outcome: res.outcome,
    error: res.error ?? null, processed_at: new Date().toISOString(),
    customer_id: res.customerId ?? null, deal_id: res.dealId ?? null, ghl_contact_id: res.contactId ?? null,
  }).eq("id", receiptId);
  if (uErr) console.error(`[${VIA}] receipt update failed`, uErr.message);

  return json({ ok: res.status !== "error", receipt_id: receiptId, action: cls.action, status: res.status, outcome: res.outcome, error: res.error ?? null });
});
