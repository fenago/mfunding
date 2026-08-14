// ghl-email-doc-sweep — every 5 minutes, pull attachments merchants EMAILED us
// onto their deal, viewed or not.
//
// Merchants routinely reply to our email with their bank statements / ID /
// application attached instead of using the upload form (Kanthaka Group forwarded
// 25 statement PDFs straight to sales@send.mfunding.net). Those attachments live
// ONLY on the GHL email record, so ingestGhlDocuments (which reads FILE_UPLOAD
// custom fields) never saw them and the underwriter had nothing to read.
//
// This is the email twin of ghl-call-history's sweep: for every OPEN deal linked
// to a GHL contact it walks the contact's inbound emails and, for each email
// genuinely FROM that merchant (sender matched to customers.email /
// additional_emails), downloads the attachments into customer-documents, inserts
// customer_documents rows, content-classifies them, and writes ONE activity_log
// note per email on the deal. New bank statements fire the auto-underwrite hook.
//
// Idempotent: the record-once ledger (ghl_email_doc_log, PK = email-record id) is
// CLAIMED before processing, so overlapping sweeps / a future inbound-email
// webhook can reuse scrapeInboundEmailDocsForDeal() and never double-log a note.
//
// Why a sweep and not a webhook (mirrors the call-sweep rationale): inbound-email
// webhooks aren't reliably configured for merchant contacts, and attachment URLs
// never appear in a webhook payload — they live only on the email record, which
// must be fetched from the API regardless. So the sweep is the robust ingestion
// path; the shared module keeps a webhook path one call away if one is added.
//
// Auth: cron-only. verify_jwt=false; a shared secret (?secret= / x-ghl-secret)
// gates it, exactly like ghl-call-history's sweep branch.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig } from "../_shared/ghl.ts";
import { ghlFetch } from "../_shared/ghl.ts";
import { scrapeInboundEmailDocsForDeal, healOtherEmailScrapedDocs, type EmailDocDeal } from "../_shared/ghlEmailDocs.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deals we still collect docs for. Mirrors ghl-call-history's open filter.
const CLOSED_STATUSES = ["nurture", "declined", "dead", "funded", "renewal_eligible", "restructure_executed", "servicing"];

/**
 * Is this failure GHL refusing us for rate reasons? (The scraper reports it as
 * "conversations search failed (429)".)
 */
const isRateLimited = (msg: string): boolean => /\b429\b/.test(msg) || /rate.?limit|too many requests/i.test(msg);

// ── ACTIVITY GATE ─────────────────────────────────────────────────────────────
// The sweep used to POLL PER CONTACT: one conversations/search for every open
// deal, every cycle, forever. Measured on 2026-08-14: 223 GHL calls and 59
// seconds to sweep 117 deals and find NOTHING — 64,224 calls/day at */5, a third
// of the location's entire 200k daily cap, spent re-asking about emails already
// in the ledger. Worse, it scaled with the size of the book: every new customer
// made every future cycle more expensive.
//
// One location-wide query answers the same question. /conversations/search
// sorted by last_message_date returns every conversation newest-first with its
// contactId, so a single call names everyone who has had ANY activity since the
// last run; only those deals need the per-contact treatment. Verified live: the
// ordering is monotonic desc, limit=100 reaches back three weeks on this account
// (375 conversations total), and only 1 conversation fell inside the last hour.
// So the common cycle costs ~1 call instead of 223, and it gets CHEAPER relative
// to the book as we grow rather than more expensive.
//
// Recency is the filter, deliberately NOT lastMessageType: a merchant can email
// an attachment and then get an SMS from us, which flips lastMessageType to SMS
// while the email still needs scraping. Recency catches both.
const LOOKBACK_MS = 60 * 60 * 1000;   // 4x the */15 cadence — missed cycles self-heal
const CONV_PAGE = 100;

/**
 * Contact ids with conversation activity since `sinceMs`.
 * Returns null to mean "cannot prove I saw the whole window — sweep everything",
 * which is the only safe answer when the window might extend past one page.
 */
async function contactsActiveSince(
  cfg: Parameters<typeof scrapeInboundEmailDocsForDeal>[2],
  sinceMs: number,
): Promise<Set<string> | null> {
  const r = await ghlFetch<{ conversations?: Array<{ contactId?: string; lastMessageDate?: number }> }>(
    cfg,
    "GET",
    `/conversations/search?locationId=${cfg.locationId}&sortBy=last_message_date&sort=desc&limit=${CONV_PAGE}`,
  );
  if (!r.ok) throw new Error(`conversations search failed (${r.status})`);
  const convs = r.data?.conversations ?? [];
  const recent = convs.filter((c) => typeof c.lastMessageDate === "number" && c.lastMessageDate >= sinceMs);
  // A full page entirely inside the window means the window probably continues
  // past it. Rather than silently skip the deals we could not see, fall back to
  // the old exhaustive behavior for this cycle. (startAfterDate is accepted and
  // then IGNORED by this endpoint — verified live — so paging by date is not an
  // option and the page boundary is the real limit.)
  if (convs.length >= CONV_PAGE && recent.length === convs.length) return null;
  return new Set(recent.map((c) => String(c.contactId ?? "")).filter(Boolean));
}

// Fire-and-forget underwrite re-run when new bank statements arrive (auto mode,
// deduped server-side by docs_hash). Mirrors ghl-webhook's triggerUnderwriting.
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
  } catch { /* best-effort — underwriting must never break the sweep */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceClient();

    // ── Shared-secret gate (cron only) ──
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

    // ── HEALING MODE (?reclassify=1): re-run content classification over
    // email-scraped docs still typed "other" (a transient rate-limit can leave a
    // statement mislabeled). Re-underwrites any deal whose docs gained a bank
    // statement. On-demand only — not scheduled. ──
    if (url.searchParams.get("reclassify") === "1") {
      const heal = await healOtherEmailScrapedDocs(db);
      let underwritten = 0;
      for (const customerId of heal.customersWithNewBank) {
        const { data: deal } = await db.from("deals")
          .select("id").eq("customer_id", customerId)
          .order("updated_at", { ascending: false }).limit(1).maybeSingle();
        if (deal?.id) { await triggerUnderwriting(deal.id as string); underwritten++; }
      }
      return json({ ok: true, mode: "reclassify", underwritten, ...heal });
    }

    const cfg = await getGhlConfig(db);

    // Open deals linked to a GHL contact, with their merchant emails.
    const { data: deals, error: dErr } = await db.from("deals")
      .select("id, ghl_contact_id, customer_id, customers!inner(email, additional_emails)")
      .not("ghl_contact_id", "is", null)
      .not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
    if (dErr) return json({ error: dErr.message }, 500);

    // Which of those deals actually had activity worth looking at? ?full=1 skips
    // the gate (backfills / healing runs); ?lookback_minutes= widens the window
    // after an outage so a long gap is caught up in one deliberate run.
    const full = url.searchParams.get("full") === "1";
    const lookbackMin = Number(url.searchParams.get("lookback_minutes") ?? "");
    const lookbackMs = Number.isFinite(lookbackMin) && lookbackMin > 0
      ? lookbackMin * 60 * 1000
      : LOOKBACK_MS;
    let active: Set<string> | null = null;
    let gate = "full (requested)";
    if (!full) {
      try {
        active = await contactsActiveSince(cfg, Date.now() - lookbackMs);
        gate = active === null
          ? "full (activity window exceeded one page)"
          : `active-only (${active.size} contact(s) in the last ${Math.round(lookbackMs / 60000)}min)`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // The gate is ONE call. If it is rate-limited, an exhaustive sweep would
        // only make it worse — skip the cycle, the next one picks it up.
        if (isRateLimited(msg)) {
          return json({ ok: true, mode: "sweep", aborted: "rate_limited", stage: "activity_gate", swept: 0 });
        }
        gate = `full (activity gate failed: ${msg.slice(0, 120)})`;
      }
    }

    const summary = { swept: 0, emailsScraped: 0, docsSynced: 0, bankStatementsAdded: 0, underwritten: 0, failed: [] as string[] };
    // ABORT-ON-RATE-LIMIT. ghlFetch already backs off exponentially (5 attempts,
    // Retry-After honored), so a rate-limited deal costs ~7.5s and 5 calls before
    // it gives up. Continuing to the next deal after that multiplies a wall we
    // already know about: on 2026-08-14 the location hit its 200k/day cap and
    // this loop spent ~585 doomed calls and 15 MINUTES per run — long enough that
    // the 5-minute cron stacked three concurrent sweeps, each re-burning the
    // budget the moment it came back. A sweep is periodic and idempotent, so
    // skipping a cycle costs nothing: the next run picks up exactly the same
    // unseen emails. Bail on the first rate-limit and let the schedule retry.
    let rateLimited = false;
    let skippedQuiet = 0;
    for (const d of deals ?? []) {
      const row = d as Record<string, unknown>;
      if (active && !active.has(String(row.ghl_contact_id ?? ""))) { skippedQuiet++; continue; }
      const cust = (row.customers ?? {}) as { email?: string | null; additional_emails?: string[] | null };
      const emails = [cust.email, ...(cust.additional_emails ?? [])]
        .filter((e): e is string => typeof e === "string" && e.includes("@"))
        .map((e) => e.trim().toLowerCase());
      if (!emails.length) continue; // no address to match a sender against
      summary.swept++;
      const deal: EmailDocDeal = {
        id: row.id as string,
        customerId: row.customer_id as string,
        ghlContactId: row.ghl_contact_id as string,
        emails,
      };
      try {
        const r = await scrapeInboundEmailDocsForDeal(db, deal, cfg);
        summary.emailsScraped += r.emailsScraped;
        summary.docsSynced += r.docsSynced;
        summary.bankStatementsAdded += r.bankStatementsAdded;
        if (r.error) {
          summary.failed.push(`${deal.id}: ${r.error}`);
          if (isRateLimited(r.error)) { rateLimited = true; break; }
        }
        if (r.bankStatementsAdded > 0) { await triggerUnderwriting(deal.id); summary.underwritten++; }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.failed.push(`${deal.id}: ${msg}`);
        if (isRateLimited(msg)) { rateLimited = true; break; }
      }
    }
    if (rateLimited) {
      console.warn(`[ghl-email-doc-sweep] aborted on rate limit after ${summary.swept} deal(s) — next cycle will resume`);
    }
    return json({
      ok: true, mode: "sweep", gate, skippedQuiet, ...summary,
      ...(rateLimited ? { aborted: "rate_limited" } : {}),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
