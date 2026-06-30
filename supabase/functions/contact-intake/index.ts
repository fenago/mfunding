// contact-intake — PUBLIC intake for the website Contact form.
// Records the message in contact_submissions AND pushes the person into GHL as a
// contact (tagged "website-contact") so inbound inquiries reach the CRM instead of
// dying in a table nobody watches (audit #9). Returns a clear ok/failure so the
// form never shows a false "success".
//
// Deployed with verify_jwt = false (public form). Validates input itself.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, upsertContact, addContactTags } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid JSON" }, 400); }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const message = String(body.message ?? "").trim();
  const tcpaConsent = body.tcpa_consent === true;
  if (!name || !email || !message) {
    return json({ ok: false, error: "name, email, and message are required" }, 400);
  }

  const db = serviceClient();

  // 1) Persist the message. This is the source of record — if it fails, the
  //    submission genuinely failed and the user must be told (no false success).
  const { error: insErr } = await db.from("contact_submissions").insert({
    name, email, phone: phone || null, subject: subject || null, message,
  });
  if (insErr) {
    console.error("contact-intake: contact_submissions insert failed", insErr);
    return json({ ok: false, error: "could not save your message" }, 500);
  }

  // 2) Best-effort: push into GHL so it lands in Conversations / triggers follow-up.
  let ghlSynced = false;
  let ghlWarning: string | undefined;
  try {
    const cfg = await getGhlConfig(db);
    const [firstName, ...rest] = name.split(/\s+/);
    const cr = await upsertContact(cfg, {
      firstName: firstName || name,
      lastName: rest.join(" ") || undefined,
      email,
      phone: phone || undefined,
      source: "Website Contact Form",
      tags: ["website-contact"],
    });
    const contactId = cr.data?.contact?.id;
    if (contactId) {
      ghlSynced = true;
      // Tag the GHL contact so the team can triage and so SMS-consent automations
      // only fire for people who actually opted in (audit #13).
      const tags: string[] = [];
      if (subject) tags.push(`topic:${subject}`.slice(0, 60));
      if (tcpaConsent) tags.push("sms-consent");
      if (tags.length) { try { await addContactTags(cfg, contactId, tags); } catch { /* non-fatal */ } }
    } else {
      ghlWarning = cr.error || "GHL upsert returned no contact id";
    }
  } catch (e) {
    ghlWarning = e instanceof Error ? e.message : String(e);
  }
  if (!ghlSynced) console.error("contact-intake: GHL sync failed", { email, ghlWarning });

  // The message is saved either way; ghl_synced tells ops if CRM push needs a retry.
  return json({ ok: true, ghl_synced: ghlSynced, ghl_warning: ghlWarning });
});
