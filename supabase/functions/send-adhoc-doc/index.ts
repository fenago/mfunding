// send-adhoc-doc — ad-hoc, ANY-TIME delivery of a standalone document to a deal's
// merchant: today the broker agreement / TCPA contact-consent; tomorrow whatever
// else gets registered. The closer picks the document and sends — no stage
// prerequisite, no application required.
//
// STRICTLY ADDITIVE beside push-application-to-ghl, on purpose: this function
// NEVER touches the three application paths' workflows or tags. An ad-hoc consent
// send while an application is mid-flight must not cancel that application — the
// crossing/cleanup logic in the app sender is for documents that REPLACE each
// other, and these don't.
//
// Registry: platform_settings key "adhoc_docs" →
//   { docs: [{ key, label, workflow_id, doc_pattern, tag }] }
// Each entry is delivered by an ENROLLMENT-ONLY GHL workflow (NO trigger — the
// 2026-07-13 rule: a stage trigger cannot know which document was asked for;
// delivery is the code's job). An entry with an empty workflow_id is visible in
// the UI but not sendable until the owner creates the workflow and saves its id.
//
// POST { dealId, docKey, mintAnyway? } — staff JWT; closers only their own deals.
// Always remove→enroll ("send anytime" must re-fire on repeat sends), then read
// the created document BACK from GHL and refuse to claim success for a template
// this run did not see.
//
// mintAnyway: a dead email must not mean a dead deal. Normally we refuse to fire a
// document at an address we know bounces. With mintAnyway the closer overrides ONLY
// that email-deliverability guard (every other guard — above all the business-name
// raw-tag protection — stays absolute): the document is minted, its accompanying
// email bounces harmlessly, and we hand back the per-recipient signing link so the
// closer can TEXT it instead. signing_url is also returned on every normal success.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, addContactTags,
  lastEmailFailure, bounceMessage, type GhlConfig,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AdhocDocDef {
  key: string;
  label: string;
  workflow_id: string;
  /** Case-insensitive regex source matched against the created document's name. */
  doc_pattern: string;
  /** Optional contact tag stamped after a confirmed send (e.g. consent-sent). */
  tag?: string;
}

interface GhlDoc {
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  recipients?: Array<{ id?: string; email?: string }>;
  links?: Array<{ recipientId?: string; referenceId?: string }>;
}

// The per-recipient viewer/signing link for THIS contact, derived exactly as
// ghl-docs-status does: the record's links[] entry whose recipientId is ours →
// its referenceId → the bearer viewer URL. Null when the record carries no link
// for this contact. This link exists the moment the document is minted, regardless
// of whether the accompanying email delivered — which is the whole point of
// mintAnyway: a dead mailbox still yields a link the closer can text.
// SECURITY: this is a bearer link (whoever holds it can view + sign); it is only
// ever returned to the gated caller and must never be logged.
function signingUrlFor(doc: GhlDoc, contactId: string): string | null {
  const myLink = (doc.links ?? []).find((l) => l.recipientId === contactId);
  const referenceId = myLink?.referenceId;
  return referenceId ? `https://link.vibereach.io/documents/v1/${referenceId}?locale=en-US` : null;
}

// Read back what GHL actually minted for this contact since the send started.
// Mirrors push-application-to-ghl's verifyDocumentSent, minus the application
// companion-doc special-casing (an ad-hoc doc has no companion).
async function verifyAdhocSent(
  cfg: GhlConfig, contactId: string, email: string, expected: RegExp, sinceMs: number,
): Promise<{ verification: "confirmed" | "wrong_template" | "unconfirmed"; template: string | null; signingUrl: string | null }> {
  const wantEmail = email.trim().toLowerCase();
  const deadline = Date.now() + 15_000;
  let delay = 1_500;
  for (;;) {
    await sleep(delay);
    const res = await ghlFetch<{ documents?: GhlDoc[] }>(
      cfg, "GET", `/proposals/document?locationId=${cfg.locationId}&limit=20`,
    );
    if (res.ok) {
      const mine = (res.data?.documents ?? []).filter((d) => {
        const ts = Date.parse(d.createdAt ?? d.updatedAt ?? "");
        if (!Number.isFinite(ts) || ts < sinceMs) return false;
        return (d.recipients ?? []).some(
          (r) => r.id === contactId || (r.email ?? "").trim().toLowerCase() === wantEmail,
        );
      });
      const right = mine.find((d) => expected.test(d.name ?? ""));
      if (right) return { verification: "confirmed", template: right.name ?? null, signingUrl: signingUrlFor(right, contactId) };
      const wrong = mine[0];
      if (wrong) return { verification: "wrong_template", template: wrong.name ?? null, signingUrl: null };
    }
    if (Date.now() >= deadline) return { verification: "unconfirmed", template: null, signingUrl: null };
    delay = Math.min(Math.round(delay * 1.6), 4_000);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { dealId?: string; docKey?: string; mintAnyway?: boolean };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const { dealId, docKey } = payload;
  // mintAnyway: override ONLY the email-deliverability guard (dead mailbox) so the
  // document mints and its signing link can be texted. Never bypasses any other guard.
  const mintAnyway = payload.mintAnyway === true;
  if (!dealId || !docKey) return json({ error: "dealId and docKey are required" }, 400);

  const db = serviceClient();

  // Authn/Authz — same contract as push-application-to-ghl: signed-in staff only;
  // a closer may only send on their OWN deals.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
  const role = prof?.role as string | undefined;
  if (!role || !["closer", "admin", "super_admin"].includes(role)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  if (role === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  // Registry lookup.
  const { data: reg } = await db.from("platform_settings").select("value").eq("key", "adhoc_docs").maybeSingle();
  const docs = ((reg?.value as { docs?: AdhocDocDef[] } | null)?.docs ?? []);
  const def = docs.find((d) => d.key === docKey);
  if (!def) return json({ error: `Unknown document "${docKey}" — not in the adhoc_docs registry.` }, 404);
  if (!def.workflow_id) {
    return json({
      error: `"${def.label}" isn't wired up yet — create its enrollment-only GHL workflow (NO trigger; one Send-Documents action) and save the workflow id in the adhoc_docs setting.`,
      not_configured: true,
    }, 422);
  }

  // Deal + merchant. The contact must already exist in GHL (every intake/app path
  // creates it); an unlinked deal has bigger problems than an ad-hoc doc.
  const { data: deal, error: dErr } = await db
    .from("deals").select("id, deal_number, customer_id, ghl_contact_id")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);
  const contactId = deal.ghl_contact_id as string | null;
  if (!contactId) return json({ error: "This deal has no GHL contact yet — push it to GHL first (opening the deal in the playbook does this)." }, 422);
  const { data: cust } = await db.from("customers").select("email, first_name, last_name, business_name").eq("id", deal.customer_id).maybeSingle();
  const email = (cust?.email ?? "").trim();
  if (!email) return json({ error: "The merchant has no email on file — a document can't be delivered." }, 422);

  const cfg = await getGhlConfig(db);
  if (!cfg) return json({ error: "GHL is not configured" }, 502);

  // Email deliverability guard — same rule as the application paths: never fire a
  // document email at an address we already know bounces. (lastEmailFailure ALWAYS
  // returns an outcome object — judge by .bounced, not truthiness.) EXCEPTION —
  // mintAnyway: the closer knows the email is dead and wants the document minted
  // anyway so its per-recipient signing link can be TEXTED. The email still fires
  // and bounces harmlessly; the link is what matters, and it exists once minted.
  const failure = await lastEmailFailure(cfg, contactId, email);
  const mintedDespiteBadEmail = mintAnyway && failure.bounced;
  if (failure.bounced && !mintAnyway) {
    return json({ error: bounceMessage(email, failure), email_undeliverable: true }, 422);
  }

  // ── Guarantee the doc's merge tags resolve BEFORE the document mints. ──
  // The Business Name custom field ({{contact.business_name}}) is normally
  // written by the APPLICATION push — an ad-hoc agreement send can precede that,
  // and GHL prints an empty merge field as its literal {{tag}} on the signed
  // document (the 2026-07-13 lesson). So: no business name on file → refuse;
  // have one → write it to the contact (custom field + native company name)
  // and refuse if the write fails.
  const BUSINESS_NAME_FIELD = "uUpbL8PP2iGbGKkof7jX"; // contact.business_name (TEXT)
  const bizName = (cust?.business_name ?? "").trim();
  if (!bizName) {
    return json({
      error: "No business name on file for this merchant — the document would print a raw merge tag. Add it via Edit lead info, then send again.",
    }, 422);
  }
  const fieldPush = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, {
    companyName: bizName,
    customFields: [{ id: BUSINESS_NAME_FIELD, value: bizName }],
  });
  if (!fieldPush.ok) {
    return json({ error: `Could not stamp the business name onto the GHL contact (${fieldPush.error ?? "update failed"}) — refusing to mint a document with unresolved merge tags. Nothing was sent.` }, 502);
  }

  // Deliver: always remove→enroll so a repeat ad-hoc send re-fires instead of
  // no-oping on "already in workflow". NEVER touches the application workflows.
  const sendStartedMs = Date.now();
  await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/workflow/${def.workflow_id}`, {}); // best-effort
  const wf = await ghlFetch(cfg, "POST", `/contacts/${contactId}/workflow/${def.workflow_id}`, {});
  if (!wf.ok) {
    return json({ error: `Could not enroll the merchant into the "${def.label}" workflow: ${wf.error ?? "enrollment failed"} — the document was NOT sent.` }, 502);
  }

  // Verify what actually went out.
  const expected = new RegExp(def.doc_pattern, "i");
  const { verification, template, signingUrl } = await verifyAdhocSent(cfg, contactId, email, expected, sendStartedMs);
  if (verification === "wrong_template") {
    return json({
      error: `GHL sent "${template ?? "an unrecognized document"}" instead of ${def.label} — check the workflow's Send-Documents action. Do NOT retry until it's fixed (a retry mints another wrong document).`,
      verification, template,
    }, 502);
  }

  if (def.tag) await addContactTags(cfg, contactId, [def.tag]); // best-effort

  const who = cust?.business_name || [cust?.first_name, cust?.last_name].filter(Boolean).join(" ") || email;
  await db.from("activity_log").insert({
    entity_type: "deal", entity_id: dealId,
    interaction_type: "note",
    subject: "adhoc-doc:sent",
    content: `Ad-hoc document sent: ${def.label} → ${who} <${email}>. ` +
      (verification === "confirmed"
        ? `Verified: GHL created "${template}".`
        : `Enrollment succeeded but the created document could not be confirmed within 15s — check GHL Documents for this contact.`) +
      (mintedDespiteBadEmail ? " (email known bad — link minted for texting)" : ""),
  }).then(() => {}, () => {});

  // signing_url: the per-recipient link for this document (null if not extractable
  // — e.g. unconfirmed within the window). Returned on every success so the closer
  // can text it; the whole reason mintAnyway exists.
  return json({ ok: true, verification, template, label: def.label, signing_url: signingUrl });
});
