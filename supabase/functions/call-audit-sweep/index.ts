// call-audit-sweep — the Call / Transfer Quality audit engine (phone-call sibling of
// the email census). For a date window and scope it:
//   1) ENUMERATES the calls to audit:
//        · campaign path  — every deal whose campaign_id matches (or all attributed
//          deals when campaignId is null) → its GHL contact's TYPE_CALL messages in
//          the window (both directions);
//        · all-inbound    — when all_inbound is set (or campaignId is null), ALSO the
//          INBOUND TYPE_CALL messages across the whole location in the window, even
//          when the call isn't attached to a campaign contact. This is what catches
//          the owner's "answered the phone and was immediately kicked from the
//          conference" incident on a number we never linked to a deal.
//   2) downloads each call's WAV recording from GHL,
//   3) transcribes it with Gemini (inline audio),
//   4) classifies it against the owner's taxonomy (see _shared/callClassify.ts),
//   5) stores the row (transcript included) in call_audit_calls.
//
// RESUMABILITY: a run can span more calls than one edge invocation's wall clock. The
// work is persisted in call_audit_runs.cursor and drained in batches. The MANUAL path
// (staff JWT from the UI) returns after each budgeted batch and the UI re-invokes with
// the runId until done — exactly like the email-verify "Verify all now" loop. The CRON
// path (secret + anon bearer) self-reinvokes via EdgeRuntime.waitUntil until done.
//
// AUTH (house rule #1): admin/super_admin JWT (the audit is an admin surface), OR the
// cron path — ?secret=<GHL webhook_secret> + anon bearer. A service_role bearer is NOT
// accepted for the role check; the cron/self-reinvoke path uses the secret.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, GHL_API_BASE, GHL_API_VERSION, type GhlConfig } from "../_shared/ghl.ts";
import { classifyCall } from "../_shared/callClassify.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Race a promise against a timeout, returning a fallback instead of hanging. ghlFetch
// has no timeout of its own; a single hung GHL request during enumeration would run
// the isolate into the platform wall clock and kill it before it can persist/reinvoke
// (this stalled the location-wide inbound scan). The fallback keeps the batch moving.
const GHL_FETCH_TIMEOUT_MS = 20_000;
async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<T>((res) => { t = setTimeout(() => res(onTimeout), ms); });
  try { return await Promise.race([p, timer]); } finally { if (t) clearTimeout(t); }
}
const FETCH_TIMED_OUT = { ok: false, status: 0, data: null, error: "timeout" } as const;

// ── Tunables ─────────────────────────────────────────────────────────────────
// Each invocation does ONE bounded unit of work (a chunk of enumeration OR a single
// concurrent transcription batch) and returns promptly. This guarantees the isolate
// returns — and fires its self-reinvoke — well before the platform's hard wall clock,
// which is the mistake that stalled the first design (a long transcribe loop was killed
// mid-batch and never reinvoked). Small deterministic batches keep the chain alive.
const WALL_BUDGET_MS = 90_000;        // soft budget for the enumerate chunk
const GHL_PACE_MS = 400;              // ~2.5 req/s to GHL during enumeration
const ENUM_ITEMS_PER_INVOCATION = 25; // contact/inbound-page items per enumerate invocation
// Concurrency is deliberately LOW: base64-encoding a WAV + the JSON request body holds
// ~2.5x the file in memory per in-flight transcription, and a batch of large inbound
// recordings OOM'd the isolate (WORKER_RESOURCE_LIMIT 546), killing the chain. 3 at a
// time with a 4.5 MB cap keeps peak memory well inside the edge isolate's budget.
const TRANSCRIBE_BATCH = 3;           // recordings transcribed CONCURRENTLY per invocation
const RECORDING_TIMEOUT_MS = 30_000;  // per-recording download timeout
const GEMINI_TIMEOUT_MS = 60_000;     // per-transcription timeout
const MAX_INBOUND_PAGES = 20;         // hard cap on the location-wide inbound scan (gap-logged)
const MAX_INVOCATIONS = 250;          // runaway guard on the self-reinvoke chain
const MAX_REC_BYTES = 4_500_000;      // recordings above this skip inline transcription (a >~4 min call, never a kick)
const GEMINI_MODEL = "gemini-2.0-flash";

// ── GHL message shape (TYPE_CALL) ─────────────────────────────────────────────
interface GhlMsg {
  id: string;
  direction?: string;
  status?: string;
  contactId?: string;
  conversationId?: string;
  dateAdded?: string;
  from?: string;
  to?: string;
  messageType?: string;
  meta?: { call?: { duration?: number | null; status?: string | null } };
}

interface QueueContact {
  type: "contact";
  contactId: string;
  campaignId: string | null;
  customerId: string | null;
  dealId: string | null;
  business: string | null;
}
interface QueueInboundPage {
  type: "inbound_page";
  startAfterDate: string | null;
  startAfter: string | null;
  page: number;
}
type QueueItem = QueueContact | QueueInboundPage;

interface RunCursor {
  phase: "enumerate" | "transcribe" | "done";
  queue: QueueItem[];
  invocations: number;
  gaps: string[];
  // Whether a VALID transcription key was found when the run started. When false the
  // run classifies from call metadata only (honest fallback) and says so in the UI.
  transcriptionAvailable?: boolean;
}

// ── Window helpers — interpret the given dates in ET (owner thinks in ET) ──────
function windowBounds(dateFrom: string, dateTo: string): { fromTs: number; toTs: number; fromIso: string; toIso: string } {
  // -04:00 = EDT (July). Covers the full ET day on each end.
  const from = new Date(`${dateFrom}T00:00:00-04:00`);
  const to = new Date(`${dateTo}T23:59:59-04:00`);
  return { fromTs: from.getTime(), toTs: to.getTime(), fromIso: from.toISOString(), toIso: to.toISOString() };
}

// ── Recording download (binary; ghlFetch is JSON-only, so a raw fetch here) ────
async function downloadRecording(
  cfg: GhlConfig,
  msgId: string,
): Promise<{ ok: boolean; bytes: Uint8Array | null; mime: string; status: number }> {
  const url = `${GHL_API_BASE}/conversations/messages/${msgId}/locations/${cfg.locationId}/recording`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RECORDING_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Version: GHL_API_VERSION,
        Accept: "*/*",
        "User-Agent": "curl/8.7.1",
      },
    });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, bytes: null, mime: e instanceof Error && e.name === "AbortError" ? "timeout" : "error", status: 0 };
  }
  if (!res.ok) {
    clearTimeout(timer);
    await res.body?.cancel();
    return { ok: false, bytes: null, mime: "", status: res.status };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  clearTimeout(timer);
  // Sniff the container so Gemini gets the right mime; GHL usually serves WAV.
  let mime = res.headers.get("content-type") || "audio/wav";
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) mime = "audio/wav"; // RIFF
  else if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) mime = "audio/mpeg";            // ID3
  else if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) mime = "audio/mpeg";                       // MPEG frame
  if (mime.includes(";")) mime = mime.split(";")[0].trim();
  return { ok: true, bytes: buf, mime, status: res.status };
}

// ── Gemini transcription (inline audio) ───────────────────────────────────────
async function transcribeAudio(
  key: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ text: string | null; error: string | null }> {
  const b64 = encodeBase64(bytes);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const prompt =
    "You are transcribing a recorded business phone call (a merchant-cash-advance sales / live-transfer call). " +
    "Transcribe the audio to plain English text, verbatim, including the very START of the call. " +
    "If you hear an automated conference message (for example 'you have been kicked from this conference' or " +
    "'disconnected from the conference') or a voicemail greeting, transcribe it exactly as spoken. " +
    "Output ONLY the transcript text — no speaker labels, no timestamps, no commentary.";
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { maxOutputTokens: 4096, temperature: 0 },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) return { text: null, error: `gemini HTTP ${res.status}: ${raw.replace(/\s+/g, " ").slice(0, 200)}` };
    const parsed = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (parsed.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
    return { text: text || "", error: null };
  } catch (e) {
    return { text: null, error: e instanceof Error && e.name === "AbortError" ? "gemini timeout" : (e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Enumeration: one contact's calls in the window ────────────────────────────
async function callsForContact(
  cfg: GhlConfig,
  contactId: string,
  fromTs: number,
  toTs: number,
): Promise<GhlMsg[]> {
  const convRes = await withTimeout(
    ghlFetch<{ conversations?: Array<{ id: string }> }>(
      cfg, "GET",
      `/conversations/search?locationId=${cfg.locationId}&contactId=${encodeURIComponent(contactId)}&limit=20`,
    ),
    GHL_FETCH_TIMEOUT_MS, FETCH_TIMED_OUT,
  );
  await sleep(GHL_PACE_MS);
  const convIds = (convRes.data?.conversations ?? []).map((c) => c.id).filter(Boolean);
  const out: GhlMsg[] = [];
  for (const convId of convIds) {
    const msgRes = await withTimeout(
      ghlFetch<{ messages?: { messages?: GhlMsg[] } }>(cfg, "GET", `/conversations/${convId}/messages?limit=100`),
      GHL_FETCH_TIMEOUT_MS, FETCH_TIMED_OUT,
    );
    await sleep(GHL_PACE_MS);
    if (!msgRes.ok) continue;
    for (const m of msgRes.data?.messages?.messages ?? []) {
      if (m.messageType !== "TYPE_CALL" || !m.id || !m.dateAdded) continue;
      const ts = Date.parse(m.dateAdded);
      if (!Number.isFinite(ts) || ts < fromTs || ts > toTs) continue;
      m.conversationId = m.conversationId ?? convId;
      out.push(m);
    }
  }
  return out;
}

// Insert candidate call rows (classification 'pending'). Idempotent via the
// unique(run_id, ghl_message_id) constraint — re-enumeration never double-inserts.
async function seedCalls(
  db: ReturnType<typeof serviceClient>,
  runId: string,
  msgs: GhlMsg[],
  attach: { campaignId: string | null; customerId: string | null; dealId: string | null; business: string | null },
): Promise<number> {
  if (msgs.length === 0) return 0;
  const rows = msgs.map((m) => ({
    run_id: runId,
    campaign_id: attach.campaignId,
    customer_id: attach.customerId,
    deal_id: attach.dealId,
    ghl_contact_id: m.contactId ?? null,
    ghl_message_id: m.id,
    conversation_id: m.conversationId ?? null,
    direction: m.direction === "outbound" ? "outbound" : "inbound",
    call_date: m.dateAdded ?? null,
    duration_s: typeof m.meta?.call?.duration === "number" ? m.meta.call.duration : null,
    call_status: String(m.meta?.call?.status ?? m.status ?? "unknown"),
    from_number: m.from ?? null,
    to_number: m.to ?? null,
    classification: "pending",
    meta: attach.business ? { business: attach.business } : {},
  }));
  const { error, count } = await db.from("call_audit_calls")
    .upsert(rows, { onConflict: "run_id,ghl_message_id", ignoreDuplicates: true, count: "exact" });
  if (error) { console.error("[call-audit] seedCalls upsert failed:", error.message); return 0; }
  return count ?? 0;
}

// One inbound_page queue item: scan a page of the location's conversations, collect
// INBOUND TYPE_CALL messages in the window, seed them (no campaign attachment). Returns
// the next page cursor (or null when the scan should stop).
async function processInboundPage(
  db: ReturnType<typeof serviceClient>,
  cfg: GhlConfig,
  runId: string,
  item: QueueInboundPage,
  fromTs: number,
  toTs: number,
  cursor: RunCursor,
  startedAt: number,
): Promise<QueueInboundPage | null> {
  const params = new URLSearchParams({ locationId: cfg.locationId, limit: "100", sortBy: "last_message_date", sort: "desc" });
  if (item.startAfterDate) params.set("startAfterDate", item.startAfterDate);
  if (item.startAfter) params.set("startAfter", item.startAfter);
  const res = await withTimeout(
    ghlFetch<{ conversations?: Array<{ id: string; lastMessageDate?: string; dateUpdated?: string }> }>(
      cfg, "GET", `/conversations/search?${params.toString()}`),
    GHL_FETCH_TIMEOUT_MS, FETCH_TIMED_OUT,
  );
  await sleep(GHL_PACE_MS);
  const list = res.data?.conversations ?? [];
  if (!res.ok || list.length === 0) return null;

  // Non-advancing guard: if GHL ignored the cursor and handed back the same first
  // conversation we started after, stop rather than loop the same page forever.
  if (item.startAfter && list[0]?.id === item.startAfter) {
    cursor.gaps.push(`inbound scan stopped — GHL conversation pagination did not advance past page ${item.page}`);
    return null;
  }

  let last: { id: string; date: string } | null = null;
  let sawInRange = false;
  let budgetHit = false;
  for (const c of list) {
    const lmd = c.lastMessageDate ?? c.dateUpdated ?? null;
    const lts = lmd ? Date.parse(lmd) : NaN;
    // Advance the resume cursor to EVERY conversation we look at (in range or not), so a
    // continuation never re-scans what this item already passed.
    if (Number.isFinite(lts)) last = { id: c.id, date: lmd as string };
    // Sorted desc by last activity: a conversation whose last activity precedes the
    // window can only have older calls — skip its message fetch.
    if (Number.isFinite(lts) && lts < fromTs) continue;
    sawInRange = true;
    // Wall-budget guard: stop the (potentially 100-deep) message-fetch loop before the
    // isolate is killed, and resume AFTER the last conversation we processed.
    if (Date.now() - startedAt >= WALL_BUDGET_MS) { budgetHit = true; break; }
    const msgRes = await withTimeout(
      ghlFetch<{ messages?: { messages?: GhlMsg[] } }>(cfg, "GET", `/conversations/${c.id}/messages?limit=100`),
      GHL_FETCH_TIMEOUT_MS, FETCH_TIMED_OUT,
    );
    await sleep(GHL_PACE_MS);
    if (!msgRes.ok) continue;
    const inbound: GhlMsg[] = [];
    for (const m of msgRes.data?.messages?.messages ?? []) {
      if (m.messageType !== "TYPE_CALL" || !m.id || !m.dateAdded) continue;
      if (m.direction === "outbound") continue; // all-inbound scan only
      const ts = Date.parse(m.dateAdded);
      if (!Number.isFinite(ts) || ts < fromTs || ts > toTs) continue;
      m.conversationId = m.conversationId ?? c.id;
      inbound.push(m);
    }
    await seedCalls(db, runId, inbound, { campaignId: null, customerId: null, dealId: null, business: null });
  }

  if (!last) return null;
  // Ran out of budget mid-page → resume at the next page starting AFTER the last conv
  // we processed (advances, so no re-scan). Same page number (still within this "page").
  if (budgetHit) {
    return { type: "inbound_page", startAfterDate: last.date, startAfter: last.id, page: item.page };
  }
  // Whole page done. Stop when it fell entirely before the window or the cap is hit;
  // otherwise page forward from the last conversation.
  if (!sawInRange) return null;
  if (item.page >= MAX_INBOUND_PAGES) {
    cursor.gaps.push(`inbound scan stopped at page cap (${MAX_INBOUND_PAGES}) — older unattached inbound calls not scanned`);
    return null;
  }
  return { type: "inbound_page", startAfterDate: last.date, startAfter: last.id, page: item.page + 1 };
}

// Build the run + its enumeration queue. campaignId null = all attributed deals.
async function createRun(
  db: ReturnType<typeof serviceClient>,
  input: { campaignId: string | null; dateFrom: string; dateTo: string; allInbound: boolean; source: string; createdBy: string | null; transcriptionAvailable: boolean },
): Promise<{ runId: string; cursor: RunCursor }> {
  const { data: run, error } = await db.from("call_audit_runs").insert({
    campaign_id: input.campaignId,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    all_inbound: input.allInbound,
    source: input.source,
    status: "enumerating",
    created_by: input.createdBy,
  }).select("id").single();
  if (error || !run) throw new Error(`could not create run: ${error?.message}`);
  const runId = run.id as string;

  // Campaign-attributed deals → one contact queue item per unique GHL contact.
  const base = db.from("deals").select("id, campaign_id, customer_id, ghl_contact_id").not("ghl_contact_id", "is", null);
  const { data: deals } = input.campaignId
    ? await base.eq("campaign_id", input.campaignId)
    : await base.not("campaign_id", "is", null);

  const custIds = [...new Set((deals ?? []).map((d) => d.customer_id).filter(Boolean) as string[])];
  const nameByCust = new Map<string, string>();
  if (custIds.length) {
    const { data: custs } = await db.from("customers").select("id, business_name, first_name, last_name").in("id", custIds);
    for (const c of custs ?? []) {
      const nm = (c.business_name as string | null)?.trim()
        || [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null;
      if (nm) nameByCust.set(c.id as string, nm);
    }
  }

  const byContact = new Map<string, QueueContact>();
  for (const d of deals ?? []) {
    const cid = d.ghl_contact_id as string;
    if (byContact.has(cid)) continue;
    byContact.set(cid, {
      type: "contact",
      contactId: cid,
      campaignId: (d.campaign_id as string) ?? null,
      customerId: (d.customer_id as string) ?? null,
      dealId: (d.id as string) ?? null,
      business: d.customer_id ? (nameByCust.get(d.customer_id as string) ?? null) : null,
    });
  }

  const queue: QueueItem[] = [...byContact.values()];
  // all-inbound sweep: on when explicitly asked OR when scoping to all campaigns.
  if (input.allInbound || input.campaignId === null) {
    queue.push({ type: "inbound_page", startAfterDate: null, startAfter: null, page: 1 });
  }

  const gaps: string[] = [];
  if (!input.transcriptionAvailable) {
    gaps.push("transcription off — no valid Gemini key (set TRANSCRIPTION_API_KEY); calls classified from metadata only");
  }
  const cursor: RunCursor = { phase: "enumerate", queue, invocations: 0, gaps, transcriptionAvailable: input.transcriptionAvailable };
  await db.from("call_audit_runs").update({ cursor, updated_at: new Date().toISOString() }).eq("id", runId);
  return { runId, cursor };
}

// Compute + persist final rollup totals from the stored rows, plus the transfer
// reconciliation (Synergy intake emails ↔ inbound calls) for the window.
async function finalizeTotals(
  db: ReturnType<typeof serviceClient>,
  runId: string,
  cursor: RunCursor,
  fromIso: string,
  toIso: string,
): Promise<Record<string, unknown>> {
  const { data: rows } = await db.from("call_audit_calls")
    .select("classification, has_recording, direction").eq("run_id", runId);
  const byClass: Record<string, number> = {};
  let withRecording = 0, inbound = 0, outbound = 0;
  for (const r of rows ?? []) {
    const c = (r.classification as string) ?? "pending";
    byClass[c] = (byClass[c] ?? 0) + 1;
    if (r.has_recording) withRecording += 1;
    if (r.direction === "inbound") inbound += 1; else if (r.direction === "outbound") outbound += 1;
  }
  const calls = (rows ?? []).length;
  const totals: Record<string, unknown> = {
    calls,
    with_recording: withRecording,
    with_recording_pct: calls ? Math.round((withRecording / calls) * 1000) / 10 : null,
    inbound,
    outbound,
    by_class: byClass,
    answered_then_kicked: byClass["answered_then_kicked"] ?? 0,
    missed_transfer_voicemail: byClass["missed_transfer_voicemail"] ?? 0,
    mid_call_drop: byClass["mid_call_drop"] ?? 0,
    end_teardown_cosmetic: byClass["end_teardown_cosmetic"] ?? 0,
    clean: byClass["clean"] ?? 0,
    no_recording: byClass["no_recording"] ?? 0,
    transcription_failed: byClass["transcription_failed"] ?? 0,
    transcription_available: cursor.transcriptionAvailable ?? false,
    gaps: cursor.gaps,
  };

  // Transfer reconciliation — Synergy intake emails ↔ this run's inbound calls.
  // Best-effort: a failure must not block the run from completing.
  try {
    const { data: recon, error: rErr } = await db.rpc("call_audit_reconcile", {
      p_run_id: runId, p_from: fromIso, p_to: toIso,
    });
    if (rErr) totals.reconciliation_error = rErr.message;
    else if (recon) totals.reconciliation = recon;
  } catch (e) {
    totals.reconciliation_error = e instanceof Error ? e.message : String(e);
  }

  return totals;
}

// Process one budgeted batch of a run. Mutates cursor; returns whether the run is done.
async function runBatch(
  db: ReturnType<typeof serviceClient>,
  cfg: GhlConfig,
  runId: string,
  cursor: RunCursor,
  dateFrom: string,
  dateTo: string,
  geminiKey: string | null,
): Promise<{ done: boolean; processed: number }> {
  const startedAt = Date.now();
  const { fromTs, toTs, fromIso, toIso } = windowBounds(dateFrom, dateTo);

  // ── ENUMERATE: process a bounded chunk of the queue, then return to reinvoke. ──
  if (cursor.phase === "enumerate") {
    let items = 0;
    while (cursor.queue.length > 0 && items < ENUM_ITEMS_PER_INVOCATION && Date.now() - startedAt < WALL_BUDGET_MS) {
      const item = cursor.queue.shift()!;
      if (item.type === "contact") {
        try {
          const msgs = await callsForContact(cfg, item.contactId, fromTs, toTs);
          await seedCalls(db, runId, msgs, {
            campaignId: item.campaignId, customerId: item.customerId, dealId: item.dealId, business: item.business,
          });
        } catch (e) {
          cursor.gaps.push(`contact ${item.contactId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        try {
          const next = await processInboundPage(db, cfg, runId, item, fromTs, toTs, cursor, startedAt);
          if (next) cursor.queue.push(next);
        } catch (e) {
          cursor.gaps.push(`inbound page ${item.page}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      items++;
      await persistCursor(db, runId, cursor, "enumerating");
    }
    if (cursor.queue.length === 0) { cursor.phase = "transcribe"; await persistCursor(db, runId, cursor, "running"); }
    return { done: false, processed: 0 };
  }

  // ── TRANSCRIBE: one CONCURRENT batch of pending rows, then return to reinvoke. ──
  if (cursor.phase === "transcribe") {
    const { data: pending } = await db.from("call_audit_calls")
      .select("id, ghl_message_id, duration_s")
      .eq("run_id", runId).eq("classification", "pending")
      .order("call_date", { ascending: true }).limit(TRANSCRIBE_BATCH);
    if (!pending || pending.length === 0) {
      cursor.phase = "done";
      const totals = await finalizeTotals(db, runId, cursor, fromIso, toIso);
      await db.from("call_audit_runs").update({ status: "done", totals, cursor, updated_at: new Date().toISOString() }).eq("id", runId);
      return { done: true, processed: 0 };
    }
    await Promise.allSettled(
      pending.map((row) => transcribeAndClassify(db, cfg, row as { id: string; ghl_message_id: string; duration_s: number | null }, geminiKey)),
    );
    await persistCursor(db, runId, cursor, "running");
    return { done: false, processed: pending.length };
  }

  return { done: false, processed: 0 };
}

async function persistCursor(
  db: ReturnType<typeof serviceClient>,
  runId: string,
  cursor: RunCursor,
  status: string,
): Promise<void> {
  await db.from("call_audit_runs").update({ cursor, status, updated_at: new Date().toISOString() }).eq("id", runId);
}

// Download → transcribe → classify → update one call row.
async function transcribeAndClassify(
  db: ReturnType<typeof serviceClient>,
  cfg: GhlConfig,
  row: { id: string; ghl_message_id: string; duration_s: number | null },
  geminiKey: string | null,
): Promise<void> {
  const meta: Record<string, unknown> = {};
  let hasRecording = false;
  let transcript: string | null = null;
  let transcriptionFailed = false;

  // No valid transcription key → metadata-only. Skip the download entirely (these GHL
  // WAVs run up to ~24 MB; fetching them just to set a flag is pure waste when we can't
  // transcribe). Classify from duration: a very short completed call is a "picked up and
  // gone" suspect (this is where an answered-then-kicked would land); anything longer is
  // simply unverified without audio.
  if (!geminiKey) {
    const dur = row.duration_s ?? 0;
    const classification = dur > 0 && dur < 15 ? "suspected_instant_drop" : "short_call_unverified";
    meta.transcription = "off — no valid key; metadata only (recording not fetched)";
    const { error } = await db.from("call_audit_calls").update({
      has_recording: false,
      transcript: null,
      classification,
      matched_quote: null,
      kick_offset_hint: dur ? `call ${dur}s` : null,
      meta,
    }).eq("id", row.id);
    if (error) console.error("[call-audit] row update failed:", row.id, error.message);
    return;
  }

  try {
    const rec = await downloadRecording(cfg, row.ghl_message_id);
    if (rec.ok && rec.bytes && rec.bytes.length > 100) {
      hasRecording = true;
      meta.rec_bytes = rec.bytes.length;
      meta.mime = rec.mime;
      if (rec.bytes.length > MAX_REC_BYTES) {
        transcriptionFailed = true;
        meta.transcription = `skipped — recording ${rec.bytes.length} bytes exceeds inline cap ${MAX_REC_BYTES}`;
      } else if (!geminiKey) {
        transcriptionFailed = true;
        meta.transcription = "skipped — no valid transcription key (set TRANSCRIPTION_API_KEY)";
      } else {
        const tr = await transcribeAudio(geminiKey, rec.bytes, rec.mime);
        if (tr.text != null) {
          transcript = tr.text;
          meta.transcription = "ok";
          meta.model = GEMINI_MODEL;
        } else {
          transcriptionFailed = true;
          meta.transcription = `failed — ${tr.error ?? "unknown"}`;
        }
      }
    } else {
      meta.recording = `none (${rec.status})`;
    }
  } catch (e) {
    meta.recording_error = e instanceof Error ? e.message : String(e);
  }

  const cls = classifyCall({ hasRecording, transcript, durationS: row.duration_s, transcriptionFailed });
  const { error } = await db.from("call_audit_calls").update({
    has_recording: hasRecording,
    transcript,
    classification: cls.classification,
    matched_quote: cls.matchedQuote,
    kick_offset_hint: cls.kickOffsetHint,
    meta,
  }).eq("id", row.id);
  if (error) console.error("[call-audit] row update failed:", row.id, error.message);
}

// Resolve the Gemini API key from the edge env. Several env names exist across the
// project; the diag branch established which authenticates, and that one is preferred
// here. Returns null when none is configured (the pipeline then ships metadata-only).
function resolveGeminiKey(): string | null {
  // Prefer the dedicated slot the owner can set for this feature; fall back to the
  // project's other Gemini keys. (As of build, all of GEMINI_API_KEY /
  // GOOGLE_GEMINI_API_KEY / VITE_GEMINI_API_KEY return HTTP 400 — set a valid key as
  // TRANSCRIPTION_API_KEY to turn transcription on.)
  return Deno.env.get("TRANSCRIPTION_API_KEY")
    ?? Deno.env.get("GEMINI_API_KEY")
    ?? Deno.env.get("GOOGLE_GEMINI_API_KEY")
    ?? Deno.env.get("VITE_GEMINI_API_KEY")
    ?? null;
}

// Validate a Gemini key cheaply (a models GET). Done ONCE per run so the UI can say
// "transcription off — add a valid key" instead of silently metadata-classifying.
async function geminiKeyValid(key: string | null): Promise<boolean> {
  if (!key) return false;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    await r.body?.cancel();
    return r.ok;
  } catch { return false; }
}

// Fire a self-reinvocation (cron path only) so a long run finishes without a client.
function selfReinvoke(runId: string, secret: string): void {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/call-audit-sweep?secret=${encodeURIComponent(secret)}`;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const p = fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ runId, source: "cron" }),
  }).then(() => {}).catch((e) => console.error("[call-audit] self-reinvoke failed:", e));
  // Keep the instance alive just long enough to launch the child invocation.
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceClient();
    const url = new URL(req.url);
    const providedSecret = url.searchParams.get("secret") ?? "";
    const body = (await req.json().catch(() => ({}))) as {
      runId?: string; campaignId?: string | null; dateFrom?: string; dateTo?: string;
      allInbound?: boolean; source?: string;
    };

    // ── Auth: cron/self-reinvoke via secret, else admin/super_admin JWT ─────────
    let createdBy: string | null = null;
    let viaSecret = false;
    if (providedSecret) {
      const { data: gc } = await db.rpc("get_ghl_config");
      const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
      if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
      viaSecret = true;
    } else {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Missing authorization" }, 401);
      const { data: userData, error: userErr } = await db.auth.getUser(token);
      const caller = userData?.user;
      if (userErr || !caller) return json({ error: "Invalid session" }, 401);
      const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
      const role = prof?.role as string | undefined;
      if (!role || !["admin", "super_admin"].includes(role)) return json({ error: "Admin only" }, 403);
      createdBy = caller.id;
    }

    // Diagnostic: which configured Gemini env key actually authenticates? (never
    // returns key values — only the name → HTTP status). Behind the same auth.
    if ((body as { diag?: boolean }).diag) {
      const names = ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "VITE_GEMINI_API_KEY"];
      const out: Record<string, number | string> = {};
      for (const n of names) {
        const k = Deno.env.get(n);
        if (!k) { out[n] = "unset"; continue; }
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`);
          out[n] = r.status;
          await r.body?.cancel();
        } catch (e) { out[n] = e instanceof Error ? e.message : "err"; }
      }
      return json({ ok: true, gemini_key_check: out });
    }

    const geminiKey = resolveGeminiKey();
    const cfg = await getGhlConfig(db);

    // ── Resolve the run: continue an existing one, or create a new one ──────────
    let runId = String(body.runId ?? "").trim();
    let cursor: RunCursor;
    let dateFrom: string, dateTo: string;

    if (runId) {
      const { data: run, error } = await db.from("call_audit_runs")
        .select("id, date_from, date_to, cursor, status").eq("id", runId).maybeSingle();
      if (error || !run) return json({ error: "run not found" }, 404);
      if (run.status === "done") {
        return json({ ok: true, runId, done: true, status: "done", totals: null });
      }
      cursor = (run.cursor as RunCursor) ?? { phase: "enumerate", queue: [], invocations: 0, gaps: [] };
      dateFrom = run.date_from as string;
      dateTo = run.date_to as string;
    } else {
      if (!body.dateFrom || !body.dateTo) return json({ error: "dateFrom and dateTo are required" }, 400);
      const created = await createRun(db, {
        campaignId: body.campaignId ?? null,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
        allInbound: !!body.allInbound,
        source: viaSecret ? "cron" : "manual",
        createdBy,
        transcriptionAvailable: await geminiKeyValid(geminiKey), // validate ONCE at run start
      });
      runId = created.runId;
      cursor = created.cursor;
      dateFrom = body.dateFrom;
      dateTo = body.dateTo;
    }

    cursor.invocations = (cursor.invocations ?? 0) + 1;
    if (cursor.invocations > MAX_INVOCATIONS) {
      cursor.gaps.push(`stopped — exceeded ${MAX_INVOCATIONS} invocations (safety cap)`);
      await db.from("call_audit_runs").update({ status: "error", error: "invocation cap exceeded", cursor }).eq("id", runId);
      return json({ error: "invocation cap exceeded", runId }, 500);
    }

    // Only feed the transcriber a key that validated at run start; otherwise the run
    // classifies from metadata only (and the gaps note already says so).
    const effectiveKey = cursor.transcriptionAvailable ? geminiKey : null;
    const { done, processed } = await runBatch(db, cfg, runId, cursor, dateFrom, dateTo, effectiveKey);

    // Count remaining work so the caller can loop / show progress.
    const { count: pending } = await db.from("call_audit_calls")
      .select("id", { count: "exact", head: true }).eq("run_id", runId).eq("classification", "pending");
    const enumRemaining = cursor.queue.length;

    if (!done && viaSecret) selfReinvoke(runId, providedSecret);

    return json({
      ok: true, runId, done, processed,
      phase: cursor.phase, enum_remaining: enumRemaining, pending: pending ?? 0,
      gemini: cursor.transcriptionAvailable ?? false,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
