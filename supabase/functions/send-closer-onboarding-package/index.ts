// send-closer-onboarding-package — merge the closer's onboarding documents,
// freeze them, and email the closer ONE message with their signing links.
//
// POST { closerId, slugs?: string[] }   (slugs default to every e-signable doc)
//
// THE MERGE IS THE POINT. The raw templates are full of [COMPANY] / [CLOSER NAME]
// / [COMMISSION %] / [DRAW AMOUNT] placeholders — unsignable. This function
// substitutes the closer's real row + the company settings, SERVER-SIDE, and:
//
//   • If ANY selected document still has an unresolved placeholder, NOTHING is
//     sent. It returns 422 with exactly what's missing and where to fix it. A
//     closer must never receive a contract with a raw [BRACKET] in it.
//   • Otherwise the merged text is FROZEN onto closer_documents (merged_content
//     + merged_sha256) and the status flips to 'sent'. That frozen text — not
//     the mutable template — is what the closer reads and what the signature
//     ledger hashes. A signature against a template that can later change is
//     worthless.
//
// Email goes through GHL (sales@send.mfunding.net), the company's system of
// record for email — same path as send-merchant-email. No new ESP.
//
// Auth: verify_jwt (default true) + an in-code admin/super_admin check. Closers
// cannot send themselves a package.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact, sendMarker,
} from "../_shared/ghl.ts";
import { mergeCloserDoc, sha256Hex, type MergeSettings } from "../_shared/closerDocMerge.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Where the closer clicks to read + sign. */
const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");
const signUrl = (slug: string) => `${APP_URL}/admin/closer-docs/${slug}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { closerId?: string; slugs?: string[] };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const closerId = payload.closerId;
  if (!closerId) return json({ error: "closerId is required" }, 400);

  const db = serviceClient();

  // --- Authz: this emails a real contractor a real contract. Managers only. ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — admins only" }, 403);
  }

  // --- Load the closer, the company settings, and the templates. ---
  const { data: closer, error: cErr } = await db
    .from("closers")
    .select("id, first_name, last_name, email, phone, company_lead_split, self_gen_split, renewal_split, draw_amount, draw_start_date, draw_end_date, start_date, user_id")
    .eq("id", closerId).maybeSingle();
  if (cErr || !closer) return json({ error: `closer not found: ${cErr?.message ?? closerId}` }, 404);
  if (!closer.email) return json({ error: "This closer has no email address on file." }, 422);

  const { data: settingRow } = await db
    .from("platform_settings").select("value").eq("key", "closer_docs").maybeSingle();
  const settings = (settingRow?.value ?? {}) as MergeSettings;

  let q = db.from("closer_doc_templates").select("slug, title, body_md, version, esignable, sort_order").eq("esignable", true);
  if (payload.slugs?.length) q = q.in("slug", payload.slugs);
  const { data: templates, error: tErr } = await q.order("sort_order");
  if (tErr) return json({ error: `templates: ${tErr.message}` }, 500);
  if (!templates?.length) return json({ error: "No e-signable documents selected." }, 400);

  // --- Merge everything FIRST. One unresolved placeholder blocks the whole send. ---
  const merged: { slug: string; title: string; content: string; sha: string; version: number }[] = [];
  const blocked: { slug: string; title: string; missing: unknown[] }[] = [];

  for (const t of templates) {
    const res = mergeCloserDoc(t.slug, t.body_md, closer, settings);
    if (res.missing.length) {
      blocked.push({ slug: t.slug, title: t.title, missing: res.missing });
      continue;
    }
    merged.push({
      slug: t.slug,
      title: t.title,
      content: res.content,
      sha: await sha256Hex(res.content),
      version: t.version,
    });
  }

  if (blocked.length) {
    return json({
      error: "Some documents still have unfilled fields. Nothing was sent.",
      blocked,
    }, 422);
  }

  // --- Freeze the merged content onto the tracker rows. ---
  const nowIso = new Date().toISOString();
  for (const m of merged) {
    const { error: upErr } = await db
      .from("closer_documents")
      .update({
        merged_content: m.content,
        merged_sha256: m.sha,
        template_version: m.version,
        status: "sent",
        sent_at: nowIso,
        sent_by: caller.id,
        signed_at: null,
      })
      .eq("closer_id", closerId)
      .eq("doc_slug", m.slug)
      .select();
    if (upErr) return json({ error: `could not stage ${m.slug}: ${upErr.message}` }, 500);
  }

  // --- Email the links through GHL. ---
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) {
    return json({
      error: `Documents were prepared, but GHL is not configured so no email went out: ${ghlError ?? "missing credentials"}`,
      prepared: merged.map((m) => m.slug),
    }, 502);
  }

  const cr = await upsertContact(cfg, {
    email: closer.email,
    firstName: closer.first_name,
    lastName: closer.last_name,
    phone: closer.phone ?? undefined,
    tags: ["closer", "onboarding"],
    source: "Closer Onboarding",
  });
  const contactId = cr.data?.contact?.id ?? null;
  if (!contactId) return json({ error: `GHL upsert failed: ${cr.error ?? "no contact id"}` }, 502);

  const firstName = closer.first_name ?? "there";
  const subject =
    merged.length === 1
      ? `Please review and sign: ${merged[0].title}`
      : `Your onboarding documents — ${merged.length} to sign`;

  const items = merged
    .map((m) => `<li style="margin:0 0 10px"><a href="${signUrl(m.slug)}" style="color:#0369a1;font-weight:600">${esc(m.title)}</a></li>`)
    .join("");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:600px;line-height:1.6">
<p>Hi ${esc(firstName)},</p>
<p>Your onboarding ${merged.length === 1 ? "document is" : "documents are"} ready. Please open ${merged.length === 1 ? "it" : "each one"}, read it in full, and sign at the bottom of the page.</p>
<ul style="padding-left:18px">${items}</ul>
<p>You'll need to be signed in to your Momentum Funding account. Signing takes a minute — type your full legal name and confirm you agree to be bound by the document.</p>
<p>If anything looks wrong, reply to this email before signing.</p>
<p style="margin-top:24px">— Momentum Funding</p>
</div>`;

  const textLines = merged.map((m) => `• ${m.title}: ${signUrl(m.slug)}`).join("\n");
  const text = `Hi ${firstName},\n\nYour onboarding ${merged.length === 1 ? "document is" : "documents are"} ready to sign:\n\n${textLines}\n\nSign in to your Momentum Funding account to read and sign. If anything looks wrong, reply before signing.\n\n— Momentum Funding`;

  const sr = await sendEmailToContact(cfg, contactId, subject, html, { text });
  if (!sr.ok) {
    return json({
      error: `Documents were prepared, but the email failed to send: ${sr.error}`,
      prepared: merged.map((m) => m.slug),
    }, 502);
  }

  // Audit trail (best-effort — never fail the send over the log).
  try {
    await db.from("activity_log").insert({
      entity_type: "closer",
      entity_id: closerId,
      interaction_type: "email",
      subject: `closer:onboarding-package — ${merged.length} doc(s) sent`,
      content: `Sent to ${closer.email}: ${merged.map((m) => m.slug).join(", ")}` + sendMarker(sr.data),
      logged_by: caller.id,
    });
  } catch { /* best-effort */ }

  return json({
    ok: true,
    to: closer.email,
    sent: merged.map((m) => ({ slug: m.slug, title: m.title, sha256: m.sha })),
    messageId: sr.data?.messageId ?? null,
  });
});
