// ghl-docs-status — live "docs back from the merchant" status.
//
// Given a GHL contact (passed by staff, or resolved server-side from the caller's
// own customer row for a merchant), returns:
//  - documents: every Documents & Contracts doc where this contact is a recipient
//    (name, status, signed?, when, isExpired, and the PER-RECIPIENT viewer URL) —
//    so the playbook AND the merchant portal can show/open the real signing links.
//  - uploads: files on the contact's FILE_UPLOAD custom fields (from the Bank
//    Statements & Documents Upload form), with friendly field names.
//
// Read-only. Callable by staff (any contact they pass) or by a merchant (their
// OWN linked contact only — a client-supplied id is ignored for merchants so they
// can never probe another contact).
//
// SECURITY: the per-recipient viewer URLs embed a bearer token (referenceId) —
// anyone with the URL can view + sign. They are ONLY ever returned to the gated
// caller and must never be logged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, listContactFileUploads } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as { ghl_contact_id?: string };

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
    if (isStaff) {
      // Staff may query any contact — the id is required from the caller.
      contactId = body.ghl_contact_id;
      if (!contactId) return json({ error: "ghl_contact_id is required" }, 400);
    } else {
      // Merchant: ALWAYS resolve from their own customer row. Any client-supplied
      // id is ignored, so a merchant can only ever see their own contact's docs.
      const { data: mine } = await db
        .from("customers")
        .select("ghl_contact_id")
        .eq("user_id", caller.id)
        .not("ghl_contact_id", "is", null)
        .limit(1)
        .maybeSingle();
      contactId = (mine?.ghl_contact_id as string | null | undefined) ?? undefined;
      // No linked GHL contact yet → nothing to show (not an error).
      if (!contactId) return json({ ok: true, documents: [], uploads: [] });
    }

    const cfg = await getGhlConfig(db);

    // 1) E-sign documents for this contact.
    // NOTE: the proposals/document API caps `limit` at 21 (422s above that).
    const docsRes = await ghlFetch<{ documents?: Record<string, unknown>[] }>(
      cfg, "GET", `/proposals/document?locationId=${cfg.locationId}&limit=20`,
    );
    const documentsError = docsRes.ok ? null : `docs list failed (${docsRes.status}): ${docsRes.error ?? ""}`;

    const documents = (docsRes.data?.documents ?? [])
      .map((d) => {
        const recips = (d.recipients as Record<string, unknown>[] | undefined) ?? [];
        const links = (d.links as Record<string, unknown>[] | undefined) ?? [];
        // Per-recipient viewer link (bearer token) for THIS contact. A record can
        // have multiple recipients, so pick the link whose recipientId is ours.
        const myLink = links.find((l) => l.recipientId === contactId);
        // This contact's recipient record (completion state) — match by contact id,
        // falling back to the recipient the matched link points at.
        const myRecip =
          recips.find((r) => r.id === contactId) ??
          (myLink ? recips.find((r) => r.id === myLink.recipientId) : undefined);
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
        // Resolve the customer behind this GHL contact (works for staff + merchant
        // polls alike — the contact id is authoritative).
        const { data: cust } = await db
          .from("customers")
          .select("id, business_name")
          .eq("ghl_contact_id", contactId)
          .limit(1)
          .maybeSingle();
        const customerId = cust?.id as string | undefined;
        const businessName = (cust?.business_name as string | undefined) ?? "The merchant";

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
                { document_id: doc.id, customer_id: customerId, doc_name: doc.name },
                { onConflict: "document_id", ignoreDuplicates: true },
              )
              .select("document_id");
            if (insErr || !ins || ins.length === 0) continue; // already handled (or insert failed)

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
            // Match rule: the doc name mentions "application" or "prefill"
            // (covers MCA_Merchant_Funding_Application and "04B MCA PREFILL").
            if (dealId && /application|prefill/i.test(doc.name)) {
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

    // 2) Uploaded files on the contact's FILE_UPLOAD custom fields.
    const uploads = await listContactFileUploads(cfg, contactId);

    // Strip the internal doc id — the client GhlDocument shape doesn't carry it.
    const documentsOut = documents.map(({ id: _id, ...rest }) => rest);

    return json({ ok: true, documents: documentsOut, uploads, documents_error: documentsError });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
