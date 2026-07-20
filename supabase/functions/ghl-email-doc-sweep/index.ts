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
import { scrapeInboundEmailDocsForDeal, healOtherEmailScrapedDocs, type EmailDocDeal } from "../_shared/ghlEmailDocs.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Deals we still collect docs for. Mirrors ghl-call-history's open filter.
const CLOSED_STATUSES = ["nurture", "declined", "dead", "funded", "renewal_eligible", "restructure_executed", "servicing"];

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

    const summary = { swept: 0, emailsScraped: 0, docsSynced: 0, bankStatementsAdded: 0, underwritten: 0, failed: [] as string[] };
    for (const d of deals ?? []) {
      const row = d as Record<string, unknown>;
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
        if (r.error) summary.failed.push(`${deal.id}: ${r.error}`);
        if (r.bankStatementsAdded > 0) { await triggerUnderwriting(deal.id); summary.underwritten++; }
      } catch (e) {
        summary.failed.push(`${deal.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return json({ ok: true, mode: "sweep", ...summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
