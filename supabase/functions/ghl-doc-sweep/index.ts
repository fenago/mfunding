// ghl-doc-sweep — the signature SAFETY NET.
//
// WHAT THIS IS NOW
// The primary path for a merchant signature is the push hook
// (ghl-event-hook?type=document): a GHL workflow fires the moment a document is
// completed and the signature is recorded in ~2s. This sweep is the nightly-shaped
// reconcile that catches whatever the push missed — a workflow that didn't fire, a
// signature collected before the hook existed, an event dropped in transit. It is
// the only one of the two that reads the WHOLE completed set, which is what earns
// the right to stamp customers.ghl_docs_checked_at.
//
// ONE DEFINITION, TWO CALLERS
// The crawl, the flatten and the recording live in _shared/ghlDocCompletions.ts
// and are called by BOTH this sweep and the hook. They are not two copies kept in
// step by vigilance (_shared/ghlCallSync.ts carries exactly that warning, and it
// is a bug waiting on a calendar) — a row written by the push and a row written by
// the poll are the same row by construction. document_id is the primary key, so
// whichever arrives first records it and fires the side effects exactly once; the
// loser gets a 23505 and counts it as `already_present`.
//
// WHY IT EXISTED IN THE FIRST PLACE
// public.ghl_doc_completions used to be filled ONLY by ghl-docs-status, which runs
// when a human opens a contact's documents. cron.job had no entry for it. Measured
// 2026-09-17: 30 completion rows across 16 customers, while 59 customers had an
// application sent — we had looked at 16 and never looked at 43. Every reader
// rendered "never looked" as "unsigned", which is the failure-reads-as-success
// trap this codebase has paid for four times.
//
// AND WHY THE IDENTITY HALF MATTERS
// Resolving a signature by customers.ghl_contact_id ALONE loses every document
// filed against a merchant's other GHL contact. Miami Concierge Network signed two
// disclosures on 2026-09-18; GHL filed them against the contact our customers row
// did not point at, and they were counted as a bare `unmapped_contacts` number
// nobody reads while every surface told the owner "not signed" with the merchant
// on the phone. recordCompletions() resolves through public.customer_ids_for_ghl()
// — contact ids AND the recipient email GHL already prints on each document — and
// never drops an unresolvable signature: it returns it with a reason.
//
// COST (ghl-standing-consumers-ledger): only COMPLETED documents are read, and
// there are ~41. Two calls read every signature in the account. Hourly that is ~48
// calls/day against a 200k cap, and it scales with signatures ever collected
// (slow), never with the size of the book.
//
// Auth: cron-only. verify_jwt = false; a shared secret (?secret= / x-ghl-secret)
// gates it, exactly like ghl-email-doc-sweep.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig } from "../_shared/ghl.ts";
import {
  crawlCompletedDocs, flattenCompletions, recordCompletions,
} from "../_shared/ghlDocCompletions.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Safety rail: stop rather than loop forever if `total` ever misbehaves. 60 pages
// of 21 is 1,260 completed documents — raise it with the account, not silently.
const MAX_PAGES = 60;

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

    const cfg = await getGhlConfig(db);

    // ── 1. Read every COMPLETED document. Unlike the hook's shallow read, this
    //      one goes to `total` — a complete crawl is what makes absence provable.
    const crawl = await crawlCompletedDocs(cfg, { maxPages: MAX_PAGES });
    const crawlError = crawl.error
      ?? (crawl.complete ? null : `crawl stopped at ${crawl.docs.length} of ${crawl.reportedTotal ?? "?"} after ${MAX_PAGES} pages`);

    // ── 2. Record. Same function the push hook calls, so the two can never drift.
    const completions = flattenCompletions(crawl.docs);
    const rec = await recordCompletions(db, completions, { via: "ghl-doc-sweep" });
    if (rec.error) {
      // The resolve step is load-bearing — without it every signature looks
      // unattributable, which is the lie this function exists to stop telling.
      return json({ ok: false, crawl_complete: false, error: rec.error }, 502);
    }

    // ── 3. PARK WHAT WE COULD NOT PLACE, SO A HUMAN CAN SEE IT.
    //
    // An unresolved signature is a MERCHANT WHO SIGNED AND WHOM NOBODY CREDITED.
    // Returning it in this function's JSON response is not surfacing it — nothing
    // reads a cron response. So it goes on /admin/sync-log, the same place an
    // unplaceable funder reply goes (see the funder-reply-identity-routing
    // convention): never silently attached, never silently dropped.
    //
    // Live proof this is worth doing: Douglas Davis signed a 04B MCA application
    // AND a broker disclosure on 2026-08-28. His GHL contact maps to TWO of our
    // customer rows (United Resource Systems and Rev MD, both his), so nothing
    // could attribute the signature without guessing — and all three of his deals
    // were parked to nurture/dead while four signed documents sat unread.
    //
    // Parking is ONLY for the complete sweep. The push hook reads a handful of
    // pages and keeps its own receipt log; it must not re-park the same backlog
    // on every event.
    let parked = 0;
    if (rec.unresolved.length > 0) {
      // Dedupe by document id — this runs hourly and must not re-park a backlog
      // it already reported. One read, then inserts only for genuinely new ones.
      const { data: seen, error: seenErr } = await db
        .from("ghl_webhook_events")
        .select("payload")
        .eq("event_type", "SignatureUnplaced")
        .limit(1000);
      if (seenErr) {
        console.warn("[ghl-doc-sweep] parked-signature read failed:", seenErr.message);
      } else {
        const already = new Set(
          (seen ?? []).map((r) => (r.payload as { document_id?: string } | null)?.document_id).filter(Boolean),
        );
        for (const u of rec.unresolved) {
          if (already.has(u.documentId)) continue;
          const { error: parkErr } = await db.from("ghl_webhook_events").insert({
            event_type: "SignatureUnplaced",
            ghl_contact_id: u.contactId,
            outcome: "error",
            detail:
              `A merchant SIGNED "${u.docName}" and we could not credit it: ${u.reason}. ` +
              `Signer ${u.recipientEmail ?? "(no email on the recipient record)"} · GHL contact ${u.contactId}. ` +
              `The signature is real and is in VibeReach; it is simply not attached to a deal here. ` +
              `Attach it by putting that contact id on the right merchant (Admin → the customer) — ` +
              `nothing was guessed.`,
            payload: {
              source: "ghl-doc-sweep",
              document_id: u.documentId,
              doc_name: u.docName,
              contact_id: u.contactId,
              recipient_email: u.recipientEmail,
              reason: u.reason,
            },
          });
          if (parkErr) console.warn("[ghl-doc-sweep] park failed:", parkErr.message);
          else parked++;
        }
      }
    }

    // ── 4. THE READABILITY STAMP — only on a crawl that read the whole set.
    //      This is what turns "no completion row" from "unknown" into a real
    //      "not signed" for the chase scope. If the crawl was short or errored,
    //      we say nothing: unreadable is not zero. (The hook can never reach this
    //      branch — it reads 4 pages and reports proves_absence: false.)
    let markedChecked = 0;
    if (crawl.complete && !crawlError) {
      const { data: n, error: markErr } = await db.rpc("ghl_docs_mark_checked", {
        p_checked_at: new Date().toISOString(),
      });
      if (markErr) console.warn("[ghl-doc-sweep] mark-checked failed:", markErr.message);
      else markedChecked = (n as number) ?? 0;
    }

    return json({
      ok: true,
      // Deliberately explicit: a caller reading this must be able to tell a
      // complete read from a partial one without inferring it from counts.
      crawl_complete: crawl.complete && !crawlError,
      crawl_error: crawlError,
      ghl_calls: crawl.ghlCalls,
      ghl_daily_remaining: crawl.dailyRemaining,
      completed_docs_seen: crawl.docs.length,
      completed_docs_reported: crawl.reportedTotal,
      signatures_seen: completions.length,
      recorded_new: rec.recorded,
      signed_at_backfilled: rec.backfilled,
      already_present: rec.alreadyPresent,
      // A signature we could not attach to a merchant, WITH THE REASON. This used
      // to be a bare `unmapped_contacts: 4` — a number nobody can act on, and the
      // exact place Miami Concierge Network's two signatures went to die. The
      // detail is what distinguishes "an owner's test document" from "a real
      // merchant's signature we just lost".
      unresolved: rec.unresolved,
      unresolved_count: rec.unresolved.length,
      // Newly surfaced on /admin/sync-log this run (already-parked ones are not
      // re-reported — this runs hourly).
      unresolved_parked: parked,
      // Contact ids a signature PROVED belong to a merchant, appended to their
      // identity set (never clobbering the primary pointer).
      aliases_recorded: rec.aliasesAdded,
      fresh_signatures: rec.fresh.length,
      timeline_notes: rec.timelineNotes,
      checklist_ticks: rec.checklistTicks,
      customers_marked_checked: markedChecked,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
