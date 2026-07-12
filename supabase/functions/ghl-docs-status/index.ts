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
          name: (d.name as string) ?? "Document",
          status: (d.status as string) ?? "sent",
          signed: recip.hasCompleted === true,
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

    // 2) Uploaded files on the contact's FILE_UPLOAD custom fields.
    const uploads = await listContactFileUploads(cfg, contactId);

    return json({ ok: true, documents, uploads, documents_error: documentsError });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
