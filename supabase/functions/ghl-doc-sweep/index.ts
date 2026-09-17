// ghl-doc-sweep — the signature mirror, as an actual sweep.
//
// WHY THIS EXISTS
// public.ghl_doc_completions was filled ONLY by ghl-docs-status, which runs when
// a human opens a contact's documents. cron.job had no entry for it. Measured
// 2026-09-17: 30 completion rows across 16 customers, while 59 customers had an
// application sent — we had looked at 16 and never looked at 43. Every reader
// rendered "never looked" as "unsigned", which is the failure-reads-as-success
// trap this codebase has paid for four times.
//
// WHAT THE GHL PROPOSALS API ACTUALLY SUPPORTS (probed live, not assumed)
//   GET /proposals/document?locationId=…&limit=21  -> { documents, total: 268 }
//   limit                  caps at 21 (422 above it)
//   offset= / page=        REJECTED — "property should not exist"
//   skip=N                 WORKS — the set is fully walkable
//   contactId= / recipientId= / contact_id=   REJECTED — there is NO per-contact filter
//   status=completed       WORKS, and total drops from 268 to 39
//
// So a targeted per-contact refresh is impossible, and the old caller's
// `limit=20` with no skip could only ever see the 20 newest documents
// LOCATION-WIDE — 248 of 268 were invisible to it no matter how often it ran.
//
// THE DESIGN THAT FALLS OUT OF THAT
// We only care about COMPLETED documents, and there are 39. Two API calls read
// every signature in the account. Hourly that is ~48 calls/day against a 200k
// cap, and the cost scales with signatures ever collected (slow) — never with
// the size of the book. That is the location-wide bounded-query shape the
// ghl-standing-consumers-ledger convention asks for, not the per-record polling
// class it forbids.
//
// It is also STRICTLY BETTER than a targeted sweep would have been: a complete
// crawl means we have seen every signature in the location, so absence is proven
// for every contact at once. That is what earns the right to stamp
// customers.ghl_docs_checked_at across the chase scope — and why the stamp is
// applied ONLY when fetched === reported total. A partial or failed crawl leaves
// it alone, so a failure can never come back as "checked and clean".
//
// Auth: cron-only. verify_jwt = false; a shared secret (?secret= / x-ghl-secret)
// gates it, exactly like ghl-email-doc-sweep.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// GHL caps the proposals list at 21 per page (422 above it).
const PAGE = 21;
// Safety rail: stop rather than loop forever if `total` ever misbehaves.
const MAX_PAGES = 60;

// A completion we only just learned about may be months old (the mirror has
// never swept before). Announcing those to merchants and stamping today's date
// on their deal timeline would be noise about history, so the side effects only
// fire for a genuinely fresh signature.
const SIDE_EFFECT_WINDOW_MS = 48 * 60 * 60 * 1000;

interface GhlRecipient {
  id?: string;
  email?: string;
  hasCompleted?: boolean;
  signedDate?: string;
}
interface GhlDoc {
  _id?: string;
  documentId?: string;
  name?: string;
  status?: string;
  updatedAt?: string;
  recipients?: GhlRecipient[];
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

    const cfg = await getGhlConfig(db);

    // ── 1. Crawl every COMPLETED document, newest first, until we have `total`.
    const docs: GhlDoc[] = [];
    let reportedTotal: number | null = null;
    let calls = 0;
    let crawlComplete = false;
    let crawlError: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const skip = page * PAGE;
      const res = await ghlFetch<{ documents?: GhlDoc[]; total?: number }>(
        cfg,
        "GET",
        `/proposals/document?locationId=${cfg.locationId}&limit=${PAGE}&skip=${skip}&status=completed`,
      );
      calls++;
      if (!res.ok) {
        // UNREADABLE. Keep whatever we got for the upsert (a real signature we
        // can see is still worth recording), but the crawl is NOT complete, so
        // nothing downstream may treat absence as proof.
        crawlError = `documents page ${page} failed (${res.status}): ${res.error ?? ""}`;
        break;
      }
      const got = res.data?.documents ?? [];
      if (typeof res.data?.total === "number") reportedTotal = res.data.total;
      docs.push(...got);
      if (got.length === 0) { crawlComplete = true; break; }
      if (reportedTotal !== null && docs.length >= reportedTotal) { crawlComplete = true; break; }
    }

    // A crawl that ran out of pages without reaching `total` is incomplete.
    if (!crawlError && !crawlComplete) {
      crawlError = `crawl stopped at ${docs.length} of ${reportedTotal ?? "?"} after ${MAX_PAGES} pages`;
    }

    // ── 2. Flatten to one row per COMPLETED RECIPIENT.
    // A document can carry several recipients; only the ones that actually
    // completed are signatures.
    const completions = docs.flatMap((d) => {
      const documentId = d._id ?? d.documentId ?? null;
      if (!documentId) return [];
      return (d.recipients ?? [])
        .filter((r) => r.hasCompleted === true && r.id)
        .map((r) => ({
          document_id: documentId,
          doc_name: d.name ?? "Document",
          contact_id: r.id as string,
          // The merchant's REAL signature time. Falls back to the document's
          // updatedAt only if GHL ever omits it (all 39 live rows carry it).
          signed_at: r.signedDate ?? d.updatedAt ?? null,
        }));
    });

    // ── 3. Resolve contacts -> customers in ONE query (never per-row).
    const contactIds = [...new Set(completions.map((c) => c.contact_id))];
    const byContact = new Map<string, { id: string; business_name: string | null }>();
    if (contactIds.length > 0) {
      const { data: custs, error: custErr } = await db
        .from("customers")
        .select("id, business_name, ghl_contact_id")
        .in("ghl_contact_id", contactIds);
      if (custErr) return json({ error: `customer lookup failed: ${custErr.message}` }, 502);
      for (const c of custs ?? []) {
        byContact.set(c.ghl_contact_id as string, {
          id: c.id as string,
          business_name: (c.business_name as string | null) ?? null,
        });
      }
    }

    // ── 4. Upsert. document_id is the natural key, so re-running is free.
    //     Rows already present get signed_at backfilled (they predate it).
    let recorded = 0;
    let updated = 0;
    let unmappedContacts = 0;
    const newlySigned: Array<{ customerId: string; businessName: string; docName: string; signedAt: string | null }> = [];

    for (const c of completions) {
      const cust = byContact.get(c.contact_id);
      if (!cust) { unmappedContacts++; continue; } // a signer we have no customer for

      const { data: existing, error: selErr } = await db
        .from("ghl_doc_completions")
        .select("document_id, signed_at")
        .eq("document_id", c.document_id)
        .maybeSingle();
      if (selErr) {
        console.warn("[ghl-doc-sweep] completion read failed:", selErr.message);
        continue;
      }

      if (existing) {
        // Known completion — only fill in the signature time if it is missing.
        if (!existing.signed_at && c.signed_at) {
          const { error: upErr } = await db
            .from("ghl_doc_completions")
            .update({ signed_at: c.signed_at })
            .eq("document_id", c.document_id);
          if (upErr) console.warn("[ghl-doc-sweep] signed_at backfill failed:", upErr.message);
          else updated++;
        }
        continue;
      }

      const { error: insErr } = await db.from("ghl_doc_completions").insert({
        document_id: c.document_id,
        customer_id: cust.id,
        doc_name: c.doc_name,
        signed_at: c.signed_at,
      });
      if (insErr) {
        console.warn("[ghl-doc-sweep] completion insert failed:", insErr.message);
        continue;
      }
      recorded++;

      // Only announce a signature that actually just happened — see the note on
      // SIDE_EFFECT_WINDOW_MS. Historical rows are recorded silently.
      const signedMs = c.signed_at ? Date.parse(c.signed_at) : NaN;
      if (Number.isFinite(signedMs) && Date.now() - signedMs <= SIDE_EFFECT_WINDOW_MS) {
        newlySigned.push({
          customerId: cust.id,
          businessName: cust.business_name ?? "The merchant",
          docName: c.doc_name,
          signedAt: c.signed_at,
        });
      }
    }

    // ── 5. Side effects for genuinely fresh signatures: the closer-visible note
    //     and, for an APPLICATION, the funder-submit checklist tick. Each is
    //     best-effort and isolated — none of them may break the sweep.
    let noted = 0;
    let checklistTicks = 0;
    for (const s of newlySigned) {
      const { data: deal } = await db
        .from("deals")
        .select("id")
        .eq("customer_id", s.customerId)
        .neq("status", "declined")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const dealId = deal?.id as string | undefined;
      if (!dealId) continue;

      // 'note' is the only interaction_type allowed for a system event — the
      // activity_log check constraint rejects anything else, silently killing a
      // best-effort insert.
      const { error: logErr } = await db.from("activity_log").insert({
        entity_type: "deal",
        entity_id: dealId,
        interaction_type: "note",
        subject: `merchant:signed — ${s.docName}`,
        content: `${s.businessName} signed "${s.docName}" (seen by the document sweep).`,
      });
      if (logErr) console.warn("[ghl-doc-sweep] activity_log skipped:", logErr.message);
      else noted++;

      // Ask the DATABASE whether this is the application — one definition,
      // shared with every reader (public.is_application_doc_name).
      const { data: isApp, error: isAppErr } = await db.rpc("is_application_doc_name", { p_name: s.docName });
      if (isAppErr) {
        console.warn("[ghl-doc-sweep] doc-name classify failed:", isAppErr.message);
        continue;
      }
      if (isApp === true) {
        const { error: tickErr } = await db.rpc("ghl_mark_checklist_key", { p_deal_id: dealId, p_key: "application" });
        if (tickErr) console.warn("[ghl-doc-sweep] checklist tick skipped:", tickErr.message);
        else checklistTicks++;
      }
    }

    // ── 6. THE READABILITY STAMP — only on a crawl that read the whole set.
    //     This is what turns "no completion row" from "unknown" into a real
    //     "not signed" for the chase scope. If the crawl was short or errored,
    //     we say nothing: unreadable is not zero.
    let markedChecked = 0;
    if (crawlComplete && !crawlError) {
      const { data: n, error: markErr } = await db.rpc("ghl_docs_mark_checked", {
        p_checked_at: new Date().toISOString(),
      });
      if (markErr) {
        console.warn("[ghl-doc-sweep] mark-checked failed:", markErr.message);
      } else {
        markedChecked = (n as number) ?? 0;
      }
    }

    return json({
      ok: true,
      // Deliberately explicit: a caller reading this must be able to tell a
      // complete read from a partial one without inferring it from counts.
      crawl_complete: crawlComplete && !crawlError,
      crawl_error: crawlError,
      ghl_calls: calls,
      completed_docs_seen: docs.length,
      completed_docs_reported: reportedTotal,
      signatures_seen: completions.length,
      recorded_new: recorded,
      signed_at_backfilled: updated,
      unmapped_contacts: unmappedContacts,
      fresh_signatures: newlySigned.length,
      timeline_notes: noted,
      checklist_ticks: checklistTicks,
      customers_marked_checked: markedChecked,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
