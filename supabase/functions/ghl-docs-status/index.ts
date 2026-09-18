// ghl-docs-status — live "docs back from the merchant" status.
//
// Given a GHL contact (passed by staff, or resolved server-side from the caller's
// own customer row for a merchant), returns:
//  - documents: every Documents & Contracts doc where THIS MERCHANT is a
//    recipient (name, status, signed?, when, isExpired, and the PER-RECIPIENT
//    viewer URL) — so the playbook AND the merchant portal can show/open the real
//    signing links.
//  - uploads: files on the merchant's FILE_UPLOAD custom fields (from the Bank
//    Statements & Documents Upload form), with friendly field names.
//
// ⚠ "THIS MERCHANT", NOT "THIS CONTACT ID". Read _shared/merchantIdentity.ts for
// the incident that forced the distinction (Miami Concierge Network, 2026-09-18:
// merchant signs, GHL files it against the second of his three contacts, every
// read asks about the first, app says "Nothing sent yet" to a furious customer).
// Matching is by the merchant's whole contact SET plus the recipient email that
// GHL already prints on each document — so it costs no extra GHL calls.
//
// Read-only. Callable by staff (any contact they pass) or by a merchant (their
// OWN linked contact only — a client-supplied id is ignored for merchants so they
// can never probe another contact).
//
// SECURITY: the per-recipient viewer URLs embed a bearer token (referenceId) —
// anyone with the URL can view + sign. They are ONLY ever returned to the gated
// caller and must never be logged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch,
  listContactFileUploads, listContactFileUploadsResult, type GhlUploadField,
} from "../_shared/ghl.ts";
import {
  loadMerchantIdentity, discoverGhlContacts, recordMerchantContacts,
  recipientMatchesMerchant, type MerchantIdentity,
} from "../_shared/merchantIdentity.ts";

/** Cap on how many of a merchant's contacts we will read uploads from. One GHL
 *  call each; a merchant with one contact (the normal case) costs exactly what
 *  it always did. */
const MAX_UPLOAD_CONTACTS = 4;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Location-wide document-list cache ────────────────────────────────────────
// Paginating the document list (below) fixed a real bug but multiplied this
// function's GHL cost by the page count: measured 226 invocations in 24h, which
// went from 226 GHL calls to ~2,900, and the multiplier GROWS with the number of
// documents the account has ever created. That is the cost-scales-with-the-book
// shape the ghl-standing-consumers-ledger convention exists to contain.
//
// The list is LOCATION-WIDE and identical for every caller, so one crawl can
// serve them all. Portal polling clusters (load + focus + focus…): measured
// bursts of 4-8 calls in the same minute, i.e. ~100 GHL calls for one merchant's
// session, which this collapses to one crawl.
//
// Isolate-local on purpose — nothing is persisted, so the per-recipient signing
// links (bearer tokens) never leave process memory, which already held them.
// That makes it a best-effort reduction rather than a guarantee: several isolates
// each keep their own copy. Good enough, and it cannot leak.
//
// ⚠ ONLY A COMPLETE CRAWL IS EVER CACHED. Serving a cached partial as though it
// were whole is exactly the failure-reads-as-success trap the rest of this file
// is about.
const DOC_CACHE_TTL_MS = 60_000;
let docCache: { at: number; docs: Record<string, unknown>[]; total: number | null } | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ghl_contact_id?: string;
      action?: string;
      url?: string;
      /** Skip the 60s document-list cache (use right after a merchant signs). */
      refresh?: boolean;
      /**
       * Ask GHL which OTHER contacts carry this merchant's emails/phones before
       * reading. Costs one /contacts/search per identifier (capped, and at most
       * once per 12h per merchant). Worth it on a surface that is about to tell
       * someone a document was or wasn't sent; not worth it on a mount-time chip.
       */
      discover?: boolean;
    };

    const db = serviceClient();

    // --- Auth: staff (closer/admin/super_admin) OR a merchant. verify_jwt = true
    //     gates the gateway; this resolves role + which contact we may report on. ---
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    const isStaff = !!role && ["closer", "admin", "super_admin"].includes(role);

    // Resolve the contact this call reports on.
    let contactId: string | undefined;
    let ownCustomerId: string | undefined;
    if (isStaff) {
      // Staff may query any contact — the id is required from the caller.
      contactId = body.ghl_contact_id;
      if (!contactId) return json({ error: "ghl_contact_id is required" }, 400);
    } else {
      // Merchant: ALWAYS resolve from their own customer row. Any client-supplied
      // id is ignored, so a merchant can only ever see their own contact's docs.
      // A merchant can own more than one customer row (one owner, several
      // businesses), so pick the first that has ANY known GHL contact — the
      // primary pointer or, failing that, an alias. Filtering in code rather
      // than PostgREST keeps the "or an alias" half honest.
      const { data: mineRows } = await db
        .from("customers")
        .select("id, ghl_contact_id, ghl_contact_ids")
        .eq("user_id", caller.id)
        .order("created_at", { ascending: true })
        .limit(5);
      const mine = (mineRows ?? []).find((r) =>
        !!r.ghl_contact_id || ((r.ghl_contact_ids as string[] | null) ?? []).length > 0);
      ownCustomerId = (mine?.id as string | undefined) ?? undefined;
      contactId = (mine?.ghl_contact_id as string | null | undefined)
        ?? ((mine?.ghl_contact_ids as string[] | null | undefined) ?? [])[0]
        ?? undefined;
      // No linked GHL contact yet → nothing to show. Distinctly "we have no
      // contact to look in", never "we looked and there was nothing".
      if (!contactId) {
        return json({
          ok: true, documents: [], uploads: [],
          identity_readable: false,
          identity_error: "this merchant has no GHL contact linked yet — nothing was searched",
          merchant_contacts: [],
        });
      }
    }

    const cfg = await getGhlConfig(db);

    // ── WHO IS THIS MERCHANT IN GHL? ───────────────────────────────────────────
    // One resolver, shared with the write side. DB-only and free; it turns the
    // single contact id the caller handed us into the merchant's whole identity
    // (every contact id we have ever resolved + every email + every phone).
    const identity: MerchantIdentity = await loadMerchantIdentity(db, {
      customerId: ownCustomerId ?? null,
      contactId,
    });

    // Opt-in: ask GHL for contacts we have never seen carrying this merchant's
    // addresses. Rate-limited per merchant inside discoverGhlContacts(); anything
    // new is recorded as an ALIAS, never by clobbering the primary pointer.
    let discoveryError: string | null = null;
    if (body.discover && identity.readable && identity.customerId && !identity.partial) {
      try {
        const found = await discoverGhlContacts(cfg, identity);
        if (found.newIds.length > 0) {
          await recordMerchantContacts(db, identity.customerId, found.newIds, { markSynced: found.complete });
          identity.contactIds = [...new Set([...identity.contactIds, ...found.newIds])];
        } else if (found.complete && !found.skipped) {
          await recordMerchantContacts(db, identity.customerId, [], { markSynced: true });
        }
        if (!found.complete) discoveryError = found.error;
      } catch (e) {
        discoveryError = e instanceof Error ? e.message : String(e);
      }
    }

    // ── DOWNLOAD PROXY — the contact's UPLOADED files live behind GHL's private
    // documents/download endpoint (bearer-only), so a bare browser click 401s.
    // Proxy the bytes through here: validate the URL actually belongs to THIS
    // contact's uploads, then fetch with the API token and stream it back. ──
    if (body.action === "download") {
      const reqUrl = String(body.url ?? "");
      if (!reqUrl.startsWith("https://services.leadconnectorhq.com/documents/download/")) {
        return json({ error: "Only GHL document-download URLs can be proxied." }, 400);
      }
      // Validate against EVERY contact this merchant has, not just the linked
      // one — a file uploaded through the duplicate contact is still their file,
      // and refusing it would be the same blind spot in a different costume.
      const proxyIds = (identity.readable && identity.contactIds.length
        ? identity.contactIds
        : [contactId!]).slice(0, MAX_UPLOAD_CONTACTS);
      let match: { name: string; url: string | null } | undefined;
      for (const cid of proxyIds) {
        const ups = await listContactFileUploads(cfg, cid);
        match = ups.flatMap((u) => u.files).find((f) => f.url === reqUrl);
        if (match) break;
      }
      if (!match) return json({ error: "That file doesn't belong to this merchant." }, 403);
      // GHL answers with a 307 to a TIME-LIMITED SIGNED storage URL that needs no
      // auth — hand that URL back and let the browser open it directly. (Verified:
      // the signed target serves 200 with the file's real content-type.)
      const fileRes = await fetch(reqUrl, {
        redirect: "manual",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Version: "2021-07-28" },
      });
      const signed = fileRes.headers.get("location");
      if ((fileRes.status === 307 || fileRes.status === 302 || fileRes.status === 301) && signed) {
        return json({ ok: true, url: signed, name: match.name });
      }
      return json({ error: `GHL download failed (${fileRes.status} — no signed URL returned).` }, 502);
    }

    // 1) E-sign documents for this contact.
    //
    // ⚠ THIS USED TO BE A SINGLE `limit=20` CALL, AND IT HID MOST MERCHANTS' DOCS.
    // /proposals/document has NO per-contact filter (contactId, contact_id and
    // recipientId are all rejected outright), so it lists the LOCATION's
    // documents and we filter to this contact afterwards. With limit=20 and no
    // paging that meant only the 20 newest documents location-wide were ever
    // considered. Measured 2026-09-17: the location holds 268 documents; 61
    // contacts have a document still awaiting signature, and only 8 of them fall
    // inside that window. The other 53 — 44 of whom have a portal login, 15 on a
    // live deal — opened their portal and were shown NOTHING to sign, because
    // their document had aged out of the top 20. The signing link exists; we just
    // never looked far enough back to find it.
    //
    // `limit` caps at 21 (422 above) and `skip=N` works, so the set is walkable.
    // 268 documents is 13 calls; the cap below bounds it as the account grows.
    const PAGE = 21;
    const MAX_PAGES = 30; // 630 documents — raise with the account, not silently
    let rawDocs: Record<string, unknown>[] = [];
    let docsTotal: number | null = null;
    let documentsError: string | null = null;
    let docsCrawlComplete = false;
    let docsFromCache = false;

    // `refresh: true` bypasses the cache — for the moment a merchant returns
    // from signing, where a 60s-stale "not signed" would be the wrong answer to
    // show the person who just signed.
    const cached = !body.refresh && docCache && Date.now() - docCache.at < DOC_CACHE_TTL_MS
      ? docCache
      : null;
    if (cached) {
      rawDocs = cached.docs;
      docsTotal = cached.total;
      docsCrawlComplete = true; // only complete crawls are ever cached
      docsFromCache = true;
    }

    for (let page = 0; !docsFromCache && page < MAX_PAGES; page++) {
      const res = await ghlFetch<{ documents?: Record<string, unknown>[]; total?: number }>(
        cfg,
        "GET",
        `/proposals/document?locationId=${cfg.locationId}&limit=${PAGE}&skip=${page * PAGE}`,
      );
      if (!res.ok) {
        // UNREADABLE. Keep what we have (a link we can see is still usable), but
        // the crawl did not complete, so absence proves nothing downstream.
        documentsError = `docs list failed (${res.status}): ${res.error ?? ""}`;
        break;
      }
      const got = res.data?.documents ?? [];
      if (typeof res.data?.total === "number") docsTotal = res.data.total;
      rawDocs.push(...got);
      if (got.length === 0) { docsCrawlComplete = true; break; }
      if (docsTotal !== null && rawDocs.length >= docsTotal) { docsCrawlComplete = true; break; }
    }
    if (!documentsError && !docsCrawlComplete) {
      documentsError = `docs list truncated at ${rawDocs.length} of ${docsTotal ?? "?"} (raise MAX_PAGES)`;
    }
    // Cache ONLY a crawl that read the whole set — never a partial or errored one.
    if (!docsFromCache && docsCrawlComplete && !documentsError) {
      docCache = { at: Date.now(), docs: rawDocs, total: docsTotal };
    }

    // The merchant flow (Revenue Playbook Rail 1) e-signs the application +
    // Broker Compensation Disclosure (+ the funder agreement at offer stage).
    // These two templates exist in GHL but were NEVER wired into the flow —
    // their consents live inside the application's authorization clause
    // (owner-confirmed Jul 12, 2026). Filter them so stray sends never reach a
    // merchant. If the owner ever finishes + wires them, delete these lines.
    const UNWIRED_TEMPLATES = [
      /TCPA\s*\/\s*Contact Consent/i,
      /Bank Verification\s*&\s*Credit Authorization/i,
    ];

    // Contact ids we matched a document through. Any that our tables did not
    // already know is a REAL duplicate we just learned about — recorded below so
    // the next read finds it without re-deriving it, and surfaced to the caller
    // so a human sees the ambiguity instead of a confident blank.
    const matchedContactIds = new Set<string>();

    const documents = rawDocs
      .filter((d) => !UNWIRED_TEMPLATES.some((re) => re.test((d.name as string) ?? "")))
      .map((d) => {
        const recips = (d.recipients as Record<string, unknown>[] | undefined) ?? [];
        const links = (d.links as Record<string, unknown>[] | undefined) ?? [];
        // THIS MERCHANT's recipient record — by any of their contact ids, or by
        // the email GHL prints on the recipient. The email half is what finds a
        // document filed against a contact our tables never knew about, and it
        // is free: the crawl above already fetched it.
        //
        // ⚠ The recipient's contact id is `recipients[].id` (entityName ==
        // "contacts"). There is NO `recipients[].contactId`.
        const myRecip = identity.readable
          ? recips.find((r) => recipientMatchesMerchant(r as {
              id?: string; entityName?: string; email?: string
            }, identity))
          : recips.find((r) => r.id === contactId);
        // Per-recipient viewer link (bearer token). A record can have several
        // recipients, so pick the link that points at OUR recipient.
        const myLink =
          (myRecip ? links.find((l) => l.recipientId === myRecip.id) : undefined) ??
          links.find((l) => typeof l.recipientId === "string" &&
            identity.contactIds.includes(l.recipientId as string));
        if (myRecip && typeof myRecip.id === "string") matchedContactIds.add(myRecip.id as string);
        return { d, recips, myLink, myRecip };
      })
      .filter(({ myLink, myRecip }) => !!myLink || !!myRecip)
      .map(({ d, recips, myLink, myRecip }) => {
        const recip = (myRecip ?? recips[0] ?? {}) as Record<string, unknown>;
        const referenceId = myLink?.referenceId as string | undefined;
        return {
          // Kept internally for the completion-sync ledger; stripped before the
          // response (the client GhlDocument shape has no id). GHL keys the doc
          // id as `_id` / `documentId` (never `id` — that's the recipient's id).
          id: (d._id as string) ?? (d.documentId as string) ?? null,
          name: (d.name as string) ?? "Document",
          status: (d.status as string) ?? "sent",
          // Completed when THIS contact's recipient record is done, or the whole
          // doc reads completed.
          signed: recip.hasCompleted === true || (d.status as string) === "completed",
          // The merchant's REAL signature time, kept internally for the ledger and
          // stripped from the response. Without it the completion row falls back to
          // completed_seen_at — WHEN WE NOTICED — which is a different fact and the
          // one that reads as months of delay on a signature we only just found.
          signedAt: (recip.signedDate as string | undefined) ?? (d.updatedAt as string) ?? null,
          updatedAt: (d.updatedAt as string) ?? null,
          isExpired: d.isExpired === true,
          // Per-recipient viewer/signing link (fillable or pre-filled). Bearer link
          // — only ever returned to the gated caller, never logged. Null if this
          // contact has no matching link on the record.
          url: referenceId
            ? `https://link.vibereach.io/documents/v1/${referenceId}?locale=en-US`
            : null,
        };
      });

    // 1b) Lazy completion-sync. The portal polls this fn on load + focus — the
    // exact moment a merchant returns from signing a GHL-hosted doc in a new tab
    // (GHL never calls us back). For every doc that reads completed and has NOT
    // been reacted to yet, record it once and fire the feedback loop:
    //   (a) merchant portal message + bell (notify_merchant, canonical copy)
    //   (b) closer-visible activity_log note on the deal timeline
    //   (c) if it's the signed application, tick deals.doc_checklist['application']
    // Every step is best-effort and isolated so a failure never breaks the
    // status response the portal is waiting on.
    try {
      const completed = documents.filter((d) => d.signed && d.id);
      if (completed.length > 0) {
        // The merchant behind this read — resolved from the identity, which
        // already unioned the contact set. (It used to be a fresh
        // .eq("ghl_contact_id", contactId) lookup, which missed exactly the
        // merchant whose documents live on the OTHER contact.)
        const customerId = identity.customerId ?? undefined;
        const businessName = identity.businessName ?? "The merchant";

        if (customerId) {
          // Deal to attach to: the customer's most recent non-declined deal. Fine
          // for now — a merchant with one active deal (the common case) resolves
          // unambiguously; declined deals are skipped so we never light up a dead
          // file. (Note: VCF has no 'declined' status, so its most-recent wins.)
          const { data: deal } = await db
            .from("deals")
            .select("id, deal_type")
            .eq("customer_id", customerId)
            .neq("status", "declined")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const dealId = deal?.id as string | undefined;
          const dealType = (deal?.deal_type as string | undefined) ?? "mca";

          for (const doc of completed) {
            // Record-once: ON CONFLICT DO NOTHING. An empty returned set means
            // another (overlapping focus/visibility) poll already handled it.
            const { data: ins, error: insErr } = await db
              .from("ghl_doc_completions")
              .upsert(
                {
                  document_id: doc.id,
                  customer_id: customerId,
                  doc_name: doc.name,
                  signed_at: doc.signedAt,
                },
                { onConflict: "document_id", ignoreDuplicates: true },
              )
              .select("document_id");
            if (insErr) continue;

            let recorded = (ins?.length ?? 0) > 0;

            // ── ADOPT AN ORPHAN. ────────────────────────────────────────────
            // The sweep now records a signature it cannot attribute as a row with
            // a NULL customer_id (_shared/ghlDocCompletions.ts + migration
            // 20260918e), so the signature is never lost while the merchant is
            // unknown. But ignoreDuplicates means the upsert above does NOTHING
            // against such a row — so without this, a merchant whose signature was
            // orphaned would stay orphaned forever, even as a human sits looking
            // at their documents with the identity resolved on screen.
            //
            // That is the common shape, not an edge case: a live-transfer merchant
            // signs before their customer row exists.
            //
            // `.is("customer_id", null)` is the whole safety of it — this can only
            // ever fill a blank, never move a signature from one merchant to
            // another. Whoever attributed a row knew more than this pass does.
            if (!recorded) {
              const { data: adopted, error: adoptErr } = await db
                .from("ghl_doc_completions")
                .update({
                  customer_id: customerId,
                  unresolved_reason: null,
                  signed_at: doc.signedAt,
                })
                .eq("document_id", doc.id)
                .is("customer_id", null)
                .select("document_id");
              if (adoptErr) {
                console.warn("[ghl-docs-status] orphan adopt failed:", adoptErr.message);
              } else if ((adopted?.length ?? 0) > 0) {
                // Nobody has ever announced this signature — it had no merchant to
                // announce it to. Fall through and fire the side effects now.
                recorded = true;
              }
            }
            if (!recorded) continue; // already attributed by an earlier pass

            // (a) Merchant portal message + bell. Canonical copy from the one
            // reviewed source ('signature_signed' -> "Thanks for signing").
            try {
              const { data: copy } = await db.rpc("merchant_notice_copy", {
                p_kind: "signature_signed",
                p_deal_type: dealType,
                p_arg1: doc.name,
              });
              const row = Array.isArray(copy) ? copy[0] : copy;
              const title = (row?.title as string | undefined) ?? "Thanks for signing";
              const body = (row?.body as string | undefined) ??
                `We have recorded your signature on ${doc.name}. Your signed copy is on file — no further action is needed right now.`;
              await db.rpc("notify_merchant", {
                p_customer_id: customerId,
                p_deal_id: dealId ?? null,
                p_kind: "signature_completed",
                p_title: title,
                p_body: body,
                p_action_path: "/portal/documents",
              });
            } catch (e) {
              console.warn("[ghl-docs-status] notify_merchant skipped:", e instanceof Error ? e.message : e);
            }

            // (b) Closer-visible timeline note. Marker style mirrors the native
            // e-sign path ('merchant:signed — <label>'); 'note' is the only
            // allowed interaction_type for a system event.
            if (dealId) {
              try {
                await db.from("activity_log").insert({
                  entity_type: "deal",
                  entity_id: dealId,
                  interaction_type: "note",
                  subject: `merchant:signed — ${doc.name}`,
                  content: `${businessName} signed "${doc.name}" (via portal/GHL).`,
                  logged_by: caller.id,
                });
              } catch (e) {
                console.warn("[ghl-docs-status] activity_log skipped:", e instanceof Error ? e.message : e);
              }
            }

            // (c) Signed application → tick the funder-submit checklist gate.
            // Match rule lives in ONE place: public.is_application_doc_name().
            // The old inline /application|prefill/i test here did not match
            // '04C MCA PARTIAL', so a merchant who signed that never ticked the
            // gate. Never re-inline the rule — ask the database.
            let isApplicationDoc = false;
            try {
              const { data: isApp, error: isAppErr } =
                await db.rpc("is_application_doc_name", { p_name: doc.name });
              if (isAppErr) throw isAppErr;
              isApplicationDoc = isApp === true;
            } catch (e) {
              console.warn("[ghl-docs-status] doc-name classify failed:", e instanceof Error ? e.message : e);
            }
            if (dealId && isApplicationDoc) {
              try {
                await db.rpc("ghl_mark_checklist_key", { p_deal_id: dealId, p_key: "application" });
              } catch (e) {
                console.warn("[ghl-docs-status] checklist tick skipped:", e instanceof Error ? e.message : e);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[ghl-docs-status] completion-sync skipped:", e instanceof Error ? e.message : e);
    }

    // 1c) READABILITY LEDGER — what makes an absent signature mean "not signed".
    //
    // ghl_doc_completions is filled ONLY here, and only when someone actually
    // opens a contact's documents. So a customer with no completion row may
    // simply never have been looked at, and every reader that renders that as
    // "unsigned" is reporting a failure as a success. customers.ghl_docs_checked_at
    // is the marker that we DID look — processor_application_queue() and
    // deal_application_status() return 'unchecked' until it is set.
    //
    // It is only honest to stamp it when this read could actually have seen this
    // contact's documents. The GHL call above lists the LOCATION's documents
    // capped at 20 (the endpoint 422s above 21) and then filters to the ones this
    // contact is a recipient on — so a full page of 20 that matched nothing
    // proves nothing, and is deliberately NOT stamped.
    try {
      // The crawl above now walks the ENTIRE location document set, so a
      // completed crawl is definitive: if this contact has no signature in it,
      // they have none. (The old heuristic — "fewer than 20 came back, so we saw
      // everything" — is gone with the single-page read that forced it.)
      //
      // It is also only honest when we know WHO we read for. An unreadable
      // identity means we never established which contacts to union across, so
      // stamping "checked" would convert a blind spot into a clean bill of
      // health — the exact move that told the owner "Nothing sent yet".
      if (docsCrawlComplete && !documentsError && identity.readable && identity.customerId) {
        const { error: stampErr } = await db
          .from("customers")
          .update({ ghl_docs_checked_at: new Date().toISOString() })
          .eq("id", identity.customerId);
        if (stampErr) {
          console.warn("[ghl-docs-status] readability stamp failed:", stampErr.message);
        }
      }
    } catch (e) {
      console.warn("[ghl-docs-status] readability stamp skipped:", e instanceof Error ? e.message : e);
    }

    // 1d) Record any contact we matched a document through but did not already
    //     know. Append-only — the primary pointer is never clobbered here; that
    //     is what made the two pointers diverge in the first place.
    const newlyLearned = [...matchedContactIds].filter((id) => !identity.contactIds.includes(id));
    if (newlyLearned.length > 0 && identity.customerId) {
      const { error: recErr } = await recordMerchantContacts(db, identity.customerId, newlyLearned);
      if (recErr) console.warn("[ghl-docs-status] alias record failed:", recErr);
      else identity.contactIds = [...identity.contactIds, ...newlyLearned];
    }

    // 2) Uploaded files on the merchant's FILE_UPLOAD custom fields — across
    //    every contact we know for them. One GHL call each; a merchant with a
    //    single contact (the normal case) costs exactly what it always did.
    const uploadIds = (identity.readable && identity.contactIds.length
      ? identity.contactIds
      : [contactId]).slice(0, MAX_UPLOAD_CONTACTS);
    const uploads: GhlUploadField[] = [];
    let uploadsError: string | null = null;
    for (const cid of uploadIds) {
      try {
        const r = await listContactFileUploadsResult(cfg, cid!);
        uploads.push(...r.fields);
        // UNREADABLE for this contact. Say so — an upload list that is short
        // because a call failed must never read as "they uploaded nothing".
        if (!r.ok) uploadsError = r.error;
      } catch (e) {
        uploadsError = `uploads for contact ${cid} could not be read: ${e instanceof Error ? e.message : e}`;
      }
    }

    // Strip the internal doc id — the client GhlDocument shape doesn't carry it.
    const documentsOut = documents.map(({ id: _id, signedAt: _signedAt, ...rest }) => rest);

    return json({
      ok: true,
      documents: documentsOut,
      uploads,
      uploads_error: uploadsError,
      documents_error: documentsError,
      // Explicit so a caller can tell a fresh read from a ≤60s cached one
      // instead of inferring it. Pass { refresh: true } to force a fresh crawl.
      documents_cached: docsFromCache,
      documents_scanned: rawDocs.length,
      // ── WHAT WAS ACTUALLY SEARCHED ────────────────────────────────────────
      // An empty `documents` means one of two completely different things, and a
      // caller that cannot tell them apart will say "nothing sent yet" about a
      // merchant who signed. identity_readable:false means we never established
      // whose documents to look for — that is UNREADABLE, not zero.
      identity_readable: identity.readable,
      identity_error: identity.readable ? discoveryError : identity.unreadableReason,
      // PARTIAL: we had a contact id to search but could not tie it to exactly
      // one merchant, so the search covered that contact only. Documents below
      // are real; their ABSENCE is not proof about the merchant.
      identity_partial: identity.partial,
      identity_note: identity.scopeNote,
      customer_id: identity.customerId,
      // Every GHL contact this merchant is known by. More than one = the CRM
      // holds duplicates; surfaces should say so rather than imply a single
      // tidy record.
      merchant_contacts: identity.contactIds,
      merchant_contact_count: identity.contactIds.length,
      contacts_searched: identity.contactIds.length || (contactId ? 1 : 0),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
