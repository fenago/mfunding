// request-blank-application — merchant-triggered "send me a fresh BLANK fillable
// application" fallback, for when the pre-filled one is wrong.
//
// Merchant-gated exactly like ghl-docs-status: the caller's own GHL contact is
// resolved server-side from auth.uid() → customers.user_id → ghl_contact_id. A
// staffless / unlinked caller is refused gracefully. Rate-limited: if the contact
// already has a PENDING blank application we don't stack another. On success we
// send the MCA_Merchant_Funding_Application template as a per-recipient document
// and return its viewer URL (built from the recipient's referenceId).
//
// SECURITY: the returned URL embeds a bearer token — returned only to the gated
// caller, never logged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";
import { recordSentDocument } from "../_shared/documentIndex.ts";

// MCA_Merchant_Funding_Application (the blank fillable variant).
const TEMPLATE_ID = "6a457dd566f3ba043829e318";
// Fallback GHL user to attribute the send to when we can't map the closer.
const FALLBACK_USER_ID = "UW2IiJjoAK1pTDRdeLz2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// NOTE: the "is this the blank application?" rule used to live here as a local
// regex. It now lives ONLY in public.merchant_pending_blank_application()
// (`~* 'application'` AND NOT `~* 'prefill'`), which is what actually gates the
// send. Deleted rather than left behind: a second copy that nobody calls is a
// copy that silently disagrees the day someone does call it.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceClient();

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, message: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ ok: false, message: "Invalid session" }, 401);

    // Resolve the merchant's own contact — never trust a client-supplied id.
    // A merchant can own several customer rows (one owner, several businesses),
    // and a row can know a contact only as an ALIAS — the primary pointer moves
    // around (see _shared/merchantIdentity.ts). Take the first row that knows any
    // contact at all, rather than requiring the primary to be set.
    const { data: custRows } = await db
      .from("customers")
      .select("id, ghl_contact_id, ghl_contact_ids")
      .eq("user_id", caller.id)
      .order("created_at", { ascending: true })
      .limit(5);
    const cust = (custRows ?? []).find((r) =>
      !!r.ghl_contact_id || ((r.ghl_contact_ids as string[] | null) ?? []).length > 0);
    const contactId = (cust?.ghl_contact_id as string | null | undefined)
      ?? ((cust?.ghl_contact_ids as string[] | null | undefined) ?? [])[0]
      ?? undefined;
    if (!contactId) {
      return json({ ok: false, message: "We couldn't find your account details — please contact your specialist." });
    }

    const cfg = await getGhlConfig(db);

    // ── RATE LIMIT: don't stack blank applications on the same merchant. ──────
    //
    // This used to read the twenty newest documents LOCATION-WIDE and look for
    // this merchant's pending application among them, with no date guard at all.
    // Measured against the document index: 45 pending applications across 32
    // contacts sit outside that window, so for 32 merchants the guard answered
    // "nothing pending" FOREVER and every click minted another one. Same shape as
    // the 20-document window that told 44 merchants they had nothing to sign.
    //
    // It also depended on GHL returning documents newest-first, which is an
    // undocumented default — /proposals/document takes no sort parameter, and
    // this repo sends explicit sort params to five other GHL endpoints. Correct
    // for incidental reasons.
    //
    // The index answers it properly: complete (receipt-verified), scoped to the
    // merchant's whole CONTACT SET rather than one pointer, and refreshed on every
    // staff/portal read — so minutes old, not hours. Zero GHL calls.
    const { data: guardRows, error: guardErr } = await db.rpc(
      "merchant_pending_blank_application",
      { p_customer_id: cust!.id },
    );
    const guard = (Array.isArray(guardRows) ? guardRows[0] : guardRows) as
      | { verdict: string; pending_docs: number; evidence_age_seconds: number | null }
      | null
      | undefined;

    // A pending document we can SEE. This message is TRUE in this branch, and
    // only in this branch.
    if (guard?.verdict === "pending") {
      return json({
        ok: false,
        message: "You already have a blank application ready to fill out — check your documents or your email.",
      });
    }

    // ── UNREADABLE / STALE: refuse the mint, and say WHAT IS TRUE. ────────────
    // The old code could only say "you already have one", which to a merchant
    // holding nothing is a flat lie — and is the class of sentence this whole
    // day was spent removing. We do not mint, because we cannot rule out a
    // pending one and a duplicate is a real cost to them; and we do not pretend
    // the refusal is about their documents when it is about our read.
    if (guardErr || !guard || guard.verdict !== "clear") {
      console.warn("[request-blank-application] guard not clear:", guardErr?.message ?? guard?.verdict);
      return json({
        ok: false,
        message:
          "We couldn't check your documents just now, so we haven't sent another application — " +
          "this isn't a problem with your account. Please try again in a minute, or message your specialist and they'll send one straight over.",
        // For staff reading the network tab; never rendered to the merchant.
        reason: guardErr ? `guard unreadable: ${guardErr.message}` : `guard verdict: ${guard?.verdict ?? "none"}`,
      });
    }

    // The merchant's most recent deal, for the activity note + (best-effort) closer.
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("customer_id", cust!.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // No profile→GHL-user mapping exists today, so attribute to the fallback user.
    const userId = FALLBACK_USER_ID;

    const sendRes = await ghlFetch<{ links?: Record<string, unknown>[] }>(
      cfg, "POST", "/proposals/templates/send",
      { locationId: cfg.locationId, templateId: TEMPLATE_ID, contactId, userId },
    );
    if (!sendRes.ok) {
      return json({ ok: false, message: "We couldn't send a fresh application right now — please try again in a minute." });
    }

    const link = (sendRes.data?.links ?? [])[0] ?? {};
    const referenceId = link.referenceId as string | undefined;
    const url = referenceId ? `https://link.vibereach.io/documents/v1/${referenceId}?locale=en-US` : null;

    // ── INDEX WHAT WE JUST CREATED, IMMEDIATELY. ─────────────────────────────
    // The guard above reads an index refreshed by crawls and portal reads. The
    // case it most has to get right is the merchant who clicks twice in a row,
    // and that one cannot wait for a crawl: the second click must see the
    // document the first click made. So the send records its own row.
    // Best-effort — the merchant already has their application; a failed index
    // write must not turn a successful send into an error.
    const newDocId = (link.documentId as string | undefined) ?? (link._id as string | undefined);
    if (newDocId) {
      const rec = await recordSentDocument(db, {
        documentId: newDocId,
        contactId: (link.recipientId as string | undefined) ?? contactId,
        docName: "MCA_Merchant_Funding_Application",
        docStatus: "sent",
      });
      if (!rec.ok) console.warn("[request-blank-application] index write failed:", rec.error);
    } else {
      // No document id came back, so the next click cannot see this one in the
      // index and could mint a duplicate. Say so in the log rather than assume.
      console.warn("[request-blank-application] send returned no documentId — this mint is not indexed");
    }

    // Activity note on the deal (best-effort; never blocks the response).
    if (deal?.id) {
      try {
        await db.from("activity_log").insert({
          entity_type: "deal",
          entity_id: deal.id,
          interaction_type: "note",
          subject: "Fresh application requested",
          content: "merchant requested a fresh blank application from the portal",
          logged_by: caller.id,
        });
      } catch (e) {
        console.warn("[request-blank-application] activity_log insert failed (non-blocking):", e);
      }
    }

    return json({ ok: true, url });
  } catch (e) {
    return json({ ok: false, message: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
