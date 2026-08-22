// ghl-event-hook — the PUSH replacement for the polling sweeps' speed role.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// Today a call or a merchant reply reaches Supabase only when a cron sweep
// happens to look: ghl-call-history and ghl-email-doc-sweep POLL GHL per record
// (~89k calls/day combined against a 200k/day location cap), and their cost
// scales with the size of the BOOK rather than with the amount of new
// information. This function inverts that. A GHL workflow POSTs here the moment
// a call completes or a merchant replies, and we do ONE TARGETED fetch for that
// single contact — cost scales with events, which is what we actually care about.
//
// ── COEXISTENCE IS THE WHOLE DESIGN ──────────────────────────────────────────
// The sweeps keep running unchanged. This function writes to the SAME tables
// with the SAME dedupe keys, so a hook-written row and a sweep-written row are
// indistinguishable and can never duplicate each other:
//   calls  → ghl_call_log (PK = GHL message id) + activity_log + deal telemetry,
//            via _shared/ghlCallSync.ts (faithful copy of the sweep's internals —
//            see that file's header for the drift warning).
//   emails → ghl_email_doc_log (PK = GHL email-record id, CLAIMED before any
//            work) + customer_documents + activity_log, via the sweep's own
//            _shared/ghlEmailDocs.ts — literally the same code, not a copy.
// Whichever path arrives first claims the record; the other finds it claimed and
// does nothing. Running both is redundancy, not double-counting.
//
// ── A WEBHOOK MUST NOT STORM, AND MUST NOT STARVE INTERACTIVE TRAFFIC ────────
// Every outcome except a failed auth check returns 2xx. GHL retries non-2xx, and
// a retry storm against an endpoint that spends GHL budget is how you take the
// whole location down. "Nothing to do" is a normal answer, recorded as ok:false
// with a reason in ghl_event_hook_log — never as an error.
// Work is capped (~3-8 GHL calls per event) and gated on the daily quota: below
// DAILY_FLOOR we skip the fetch entirely and log {reason:"budget"}. The sweeps
// still cover anything skipped, which is exactly why skipping is safe.
//
// Auth: shared secret only (?secret= / x-ghl-secret vs get_ghl_config()'s
// webhook_secret), same gate as ghl-email-doc-sweep and wavv-disposition-sync.
// verify_jwt=false at the gateway — GHL cannot send a Supabase JWT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, type GhlConfig } from "../_shared/ghl.ts";
import { fetchContactCalls, syncCallsForDeal } from "../_shared/ghlCallSync.ts";
import { scrapeInboundEmailDocsForDeal, type EmailDocDeal } from "../_shared/ghlEmailDocs.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const VIA = "ghl-event-hook";

// Below this many calls left on the location's 200k/day budget, the hook does no
// GHL work at all. An event is a nice-to-have latency win; a closer's contact
// search failing at 4pm is not. The sweeps pick up whatever we skip.
const DAILY_FLOOR = 5_000;

// Per-event caps. A workflow fires on ONE thing that just happened, so the newest
// conversation and a shallow message page always contain it.
const MAX_CONVERSATIONS = 1;
const MESSAGES_PER_CONVERSATION = 20;
const MAX_USER_LOOKUPS = 3;
const DEFAULT_WINDOW_HOURS = 24;

// Deals the sweeps consider "still working" — mirrored so the hook prefers the
// same deal the sweep would have picked for this contact.
const CLOSED_STATUSES = ["nurture", "declined", "dead", "funded", "renewal_eligible", "restructure_executed", "servicing"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Read the POST body liberally. GHL workflow webhook actions send JSON, but a
 * hand-wired Zapier/relay step can send form-encoded — neither should 500. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text().catch(() => "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch { /* fall through */ }
  try {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
    return out;
  } catch { return {}; }
}

/** GHL puts the contact id in a different place depending on which workflow
 * action, trigger and payload template built the request. Take it from any of
 * them rather than demanding one shape. */
function extractContactId(body: Record<string, unknown>): string | null {
  const custom = (body.customData ?? {}) as Record<string, unknown>;
  const contact = (body.contact ?? {}) as Record<string, unknown>;
  const candidates = [
    body.contact_id, body.contactId,
    contact.id, contact.contact_id, contact.contactId,
    custom.contact_id, custom.contactId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

type EventType = "call" | "email" | "generic";

interface DealRow {
  id: string;
  customer_id: string | null;
  status: string | null;
  email: string | null;
  additional_emails: string[] | null;
}

/**
 * The deal this contact's event belongs to. Prefers an OPEN deal (the set the
 * sweeps work on); falls back to the most recently updated closed one so a late
 * call on a just-funded deal still lands on its timeline, which is what the
 * ghl-call-history panel path does when staff open the card.
 */
async function resolveDeal(db: SupabaseClient, contactId: string): Promise<DealRow | null> {
  const { data, error } = await db.from("deals")
    .select("id, customer_id, status, updated_at, customers(email, additional_emails)")
    .eq("ghl_contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`deal lookup failed: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const pick = rows.find((r) => !CLOSED_STATUSES.includes(String(r.status ?? ""))) ?? rows[0];
  const cust = (pick.customers ?? {}) as { email?: string | null; additional_emails?: string[] | null };
  return {
    id: pick.id as string,
    customer_id: (pick.customer_id as string | null) ?? null,
    status: (pick.status as string | null) ?? null,
    email: cust.email ?? null,
    additional_emails: cust.additional_emails ?? null,
  };
}

/** Fire-and-forget underwrite re-run when new bank statements arrive. Identical
 * to ghl-email-doc-sweep's hook (auto mode, deduped server-side by docs_hash). */
async function triggerUnderwriting(dealId: string): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return;
    await fetch(`${url}/functions/v1/underwrite-deal`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ dealId, mode: "auto" }),
    });
  } catch { /* best-effort — underwriting must never break the hook */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth (the ONLY non-2xx path besides a malformed method) ──
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
  if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

  const rawType = (url.searchParams.get("type") ?? "generic").toLowerCase();
  const type: EventType = rawType === "call" ? "call" : rawType === "email" ? "email" : "generic";

  // One receipt per POST, always written, whatever happens after this point.
  const actions: Record<string, unknown> = {};
  let ok = false;
  let contactId: string | null = null;

  const finish = async (status = 200) => {
    const { error } = await db.from("ghl_event_hook_log").insert({
      type, contact_id: contactId, actions, ok,
    });
    if (error) console.error("[ghl-event-hook] receipt log insert failed:", error.message);
    return json({ ok, type, contact_id: contactId, ...actions }, status);
  };

  try {
    const body = await readBody(req);
    contactId = extractContactId(body);
    if (!contactId) {
      actions.reason = "no contact id";
      actions.body_keys = Object.keys(body).slice(0, 20);
      return await finish();
    }

    if (type === "generic") {
      // A ping / a workflow wired before its type was decided. Prove receipt,
      // spend nothing. This is a success: the event arrived and was understood.
      ok = true;
      actions.reason = "generic event — receipt only, no fetch";
      return await finish();
    }

    const deal = await resolveDeal(db, contactId);
    if (!deal) {
      // Both ledgers require a deal_id, and the sweeps only ever touch deals, so
      // there is genuinely nothing to mirror. Common and harmless: most GHL
      // contacts are un-worked purchased leads with no deal row.
      actions.reason = "no deal for contact";
      return await finish();
    }
    actions.deal_id = deal.id;
    actions.deal_status = deal.status;

    let cfg: GhlConfig;
    try {
      cfg = await getGhlConfig(db);
    } catch (e) {
      actions.reason = "ghl not configured";
      actions.error = e instanceof Error ? e.message : String(e);
      return await finish();
    }

    // ── Budget probe ────────────────────────────────────────────────────────
    // One conversation search does double duty: it reports the location's
    // remaining daily quota off the response headers AND hands the call path its
    // conversation ids (so it never repeats the search). If the quota is below
    // the floor we stop here, having spent exactly one call.
    const probe = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
      cfg, "GET",
      `/conversations/search?locationId=${cfg.locationId}&contactId=${encodeURIComponent(contactId)}&sortBy=last_message_date&sort=desc&limit=5`,
    );
    let ghlCalls = 1;
    const dailyRemaining = probe.rate?.dailyRemaining ?? null;
    // UNREADABLE IS NOT PLENTY, and it is not empty either — say which it was.
    // We proceed on unreadable rather than park: one event costs at most a
    // handful of calls, and parking the whole push path on a missing header
    // would silently return us to poll-only latency. The null is recorded so a
    // run of them is visible instead of being read as headroom.
    actions.daily_remaining = dailyRemaining;
    actions.budget_readable = dailyRemaining !== null;
    if (dailyRemaining !== null && dailyRemaining < DAILY_FLOOR) {
      actions.skipped = "budget";
      actions.reason = `daily remaining ${dailyRemaining} < floor ${DAILY_FLOOR}`;
      actions.ghl_calls = ghlCalls;
      return await finish();
    }
    if (!probe.ok) {
      actions.reason = "ghl conversation search failed";
      actions.error = `status ${probe.status}`;
      actions.ghl_calls = ghlCalls;
      return await finish();
    }
    const conversationIds = (probe.data?.conversations ?? [])
      .map((c) => c.id).filter(Boolean).slice(0, MAX_CONVERSATIONS);
    if (!conversationIds.length) {
      ok = true; // nothing to mirror is a complete outcome, not a failure
      actions.reason = "contact has no conversation";
      actions.ghl_calls = ghlCalls;
      return await finish();
    }

    if (type === "call") {
      const hours = Number(url.searchParams.get("window_hours") ?? "") || DEFAULT_WINDOW_HOURS;
      const sinceMs = Date.now() - hours * 60 * 60 * 1000;
      const { calls, ghlCalls: spent } = await fetchContactCalls(cfg, {
        conversationIds,
        messagesPerConversation: MESSAGES_PER_CONVERSATION,
        maxUserLookups: MAX_USER_LOOKUPS,
        sinceMs,
      });
      ghlCalls += spent;
      actions.window_hours = hours;
      actions.calls_seen = calls.length;
      if (calls.length) {
        const r = await syncCallsForDeal(db, deal.id, contactId, calls, VIA);
        actions.calls_synced = r.synced;
        actions.calls_refreshed = r.refreshed;
        actions.inbound_recorded = r.inboundRecorded;
        if (r.syncError) actions.error = r.syncError;
        ok = !r.syncError;
      } else {
        ok = true; // the window held no calls — the mirror ran, found nothing
        actions.calls_synced = 0;
      }
      actions.ghl_calls = ghlCalls;
      return await finish();
    }

    // ── type === "email" ────────────────────────────────────────────────────
    const emails = [deal.email, ...(deal.additional_emails ?? [])]
      .filter((e): e is string => typeof e === "string" && e.includes("@"))
      .map((e) => e.trim().toLowerCase());
    if (!emails.length || !deal.customer_id) {
      // The scraper matches an email's sender against the merchant's addresses;
      // with none on file it can't tell a merchant reply from a robot.
      actions.reason = "no merchant email on file to match a sender against";
      actions.ghl_calls = ghlCalls;
      return await finish();
    }
    const target: EmailDocDeal = {
      id: deal.id,
      customerId: deal.customer_id,
      ghlContactId: contactId,
      emails,
    };
    const r = await scrapeInboundEmailDocsForDeal(db, target, cfg);
    actions.emails_examined = r.emailsExamined;
    actions.emails_scraped = r.emailsScraped;
    actions.docs_synced = r.docsSynced;
    actions.bank_statements_added = r.bankStatementsAdded;
    actions.attachments_failed = r.failed;
    if (r.error) actions.error = r.error;
    ok = !r.error;
    if (r.bankStatementsAdded > 0) {
      await triggerUnderwriting(deal.id);
      actions.underwrite_triggered = true;
    }
    // The scraper does its own conversation search + per-record fetches; we
    // report the probe we know about rather than guessing its internal count.
    actions.ghl_calls = `${ghlCalls}+scraper`;
    return await finish();
  } catch (e) {
    // Still 2xx: an exception here is our bug, and making GHL retry into it
    // would turn one bug into a storm.
    actions.reason = "unhandled error";
    actions.error = e instanceof Error ? e.message : String(e);
    ok = false;
    return await finish();
  }
});
