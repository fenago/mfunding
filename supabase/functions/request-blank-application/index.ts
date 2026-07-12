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

/** Is this doc the BLANK fillable application (application-family, not the prefill)? */
function isBlankApplication(name: string): boolean {
  return /application/i.test(name) && !/prefill/i.test(name);
}

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
    const { data: cust } = await db
      .from("customers")
      .select("id, ghl_contact_id")
      .eq("user_id", caller.id)
      .not("ghl_contact_id", "is", null)
      .limit(1)
      .maybeSingle();
    const contactId = (cust?.ghl_contact_id as string | null | undefined) ?? undefined;
    if (!contactId) {
      return json({ ok: false, message: "We couldn't find your account details — please contact your specialist." });
    }

    const cfg = await getGhlConfig(db);

    // Rate-limit: don't stack blank applications on the same contact.
    const listRes = await ghlFetch<{ documents?: Record<string, unknown>[] }>(
      cfg, "GET", `/proposals/document?locationId=${cfg.locationId}&limit=20`,
    );
    const hasPendingBlank = (listRes.data?.documents ?? []).some((d) => {
      if (!isBlankApplication(String(d.name ?? ""))) return false;
      const recips = (d.recipients as Record<string, unknown>[] | undefined) ?? [];
      const mine = recips.find((r) => r.id === contactId);
      return !!mine && mine.hasCompleted !== true && String(d.status ?? "") !== "completed";
    });
    if (hasPendingBlank) {
      return json({
        ok: false,
        message: "You already have a blank application ready to fill out — check your documents or your email.",
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

    const referenceId = (sendRes.data?.links ?? [])[0]?.referenceId as string | undefined;
    const url = referenceId ? `https://link.vibereach.io/documents/v1/${referenceId}?locale=en-US` : null;

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
