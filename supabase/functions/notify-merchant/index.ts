// notify-merchant — EMAIL half of the Wave 4 merchant notification system.
//
// The portal-message half is written by DB triggers (notify_merchant() SQL fn);
// this function sends the matching EMAIL for the events the plan marks
// "actionable" and can add a GHL tag. It is the ONE place merchant notification
// EMAIL copy lives (mirrors the SQL merchant_notice_copy() strings verbatim so
// compliance reviews both together).
//
// POST { deal_id, kind, milestone?, tag? }
//   kind ∈ doc_rejected | offer | renewal | signature_requested | signature_signed
//          doc_requested | doc_approved | stage | submission
//   (arg1/reason are re-derived server-side from the deal where needed.)
//
// Auth (mirrors send-merchant-email): verify_jwt = true + in-code role check —
// signed-in staff (closer/admin/super_admin) only. Closers may only notify on
// their OWN deals. Callers today: renewalService (milestone email + paydown tag)
// and the admin UI (doc-rejected / offer emails). Portal messages are NEVER sent
// from here, so there is no double-message.
//
// Compliance: MCA = purchase of future receivables, NEVER a "loan". Every string
// below is product-safe; "may qualify" never guarantees; VCF gets neutral copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact,
  addContactTags, latestEmailMessageId, sendMarker,
} from "../_shared/ghl.ts";
import { renderMerchantEmail } from "../_shared/merchantEmail.ts";

const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Copy = { subject: string; body: string; path: string };

// Milestone-specific renewal copy — matches the locked language in
// merchant_notice_copy() (SQL). Falls back to the 40% copy.
function renewalCopy(milestone?: number): Copy {
  switch (milestone) {
    case 60:
      return { subject: "Renewal options typically improve from here",
        body: "You are well into paying down your advance. Around this point, renewal options typically improve. If more working capital would help your business, your advisor can walk you through what may be available.",
        path: "/portal" };
    case 75:
      return { subject: "Often the best time to renew",
        body: "You have paid down most of your advance — for many businesses this is the most favorable point to consider additional capital. Reply here or ask your advisor to review your options.",
        path: "/portal" };
    case 100:
      return { subject: "You're paid in full — congratulations",
        body: "You have fully paid off your advance. Thank you for your business. When you are planning your next move, you may qualify for fresh working capital — your advisor is ready whenever you are.",
        path: "/portal" };
    default:
      return { subject: "You may qualify for additional capital",
        body: "You have paid down a good portion of your current advance. You may qualify for additional working capital, often on more favorable terms. Reply here or ask your advisor to explore your options.",
        path: "/portal" };
  }
}

// Centralized merchant-facing EMAIL copy — mirrors merchant_notice_copy() in
// supabase/migrations/20260712_merchant_notifications_*.sql. Canonical producer
// kinds and their aliases are normalized before this switch.
function copyFor(kind: string, isVcf: boolean, arg1?: string | null, milestone?: number): Copy {
  if (kind === "renewal" || kind === "renewal_milestone") return renewalCopy(milestone);
  switch (kind) {
    case "doc_requested":
      return { subject: "A document was requested",
        body: `Your funding specialist requested: ${arg1 ?? "a document"}. Upload it in your portal to keep your file moving.`,
        path: "/portal/documents" };
    case "doc_approved":
      return { subject: "A document was approved",
        body: `Your ${arg1 ?? "document"} was reviewed and approved. Thank you — that is one less thing to worry about.`,
        path: "/portal/documents" };
    case "doc_rejected":
      return { subject: "A document needs another look",
        body: `We were not able to use your ${arg1 ?? "document"}. Please re-upload it in your portal when you get a chance.`,
        path: "/portal/documents" };
    case "offer":
    case "offer_received":
      return { subject: "You have an offer to review",
        body: "An offer has come in on your file. Sign in to your portal to review the details, and your advisor will help you weigh your options.",
        path: "/portal/offers" };
    case "signature_requested":
      return { subject: "A document is ready to sign",
        body: `Your ${arg1 ?? "document"} is ready. Sign in to your portal to read it in full and sign — it only takes a minute.`,
        path: "/portal/documents" };
    case "signature_signed":
    case "signature_completed":
      return { subject: "Thanks for signing",
        body: `We have recorded your signature on ${arg1 ?? "your document"}. Your signed copy is on file — no further action is needed right now.`,
        path: "/portal/documents" };
    case "submission":
      return { subject: "Your file is with our funding partners",
        body: "Good news — your file has been sent to our funding partners for review. We will let you know as soon as we hear back.",
        path: "/portal" };
    case "renewal":
      return { subject: "You may qualify for additional capital",
        body: "You have paid down a good portion of your current advance. You may qualify for additional working capital, often on more favorable terms. Reply here or ask your advisor to explore your options.",
        path: "/portal" };
    case "stage":
    default:
      return { subject: "An update on your file",
        body: isVcf
          ? "There is a new update on your file. Sign in to your portal to see where things stand."
          : "There is a new update on your file. Sign in to your portal to see the latest.",
        path: "/portal" };
  }
}

// Per-kind CTA button label. Falls back to "Open your portal".
function ctaLabelFor(kind: string): string {
  switch (kind) {
    case "doc_requested": return "Upload your document";
    case "doc_rejected": return "Re-upload your document";
    case "doc_approved": return "View your documents";
    case "offer": case "offer_received": return "Review your offer";
    case "signature_requested": return "Review & sign in your portal";
    case "signature_signed": case "signature_completed": return "View your documents";
    case "submission": return "Track your file";
    case "renewal": case "renewal_milestone": return "Explore your options";
    default: return "Open your portal";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { deal_id?: string; kind?: string; milestone?: number; tag?: string; arg1?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.deal_id;
  const kind = (payload.kind ?? "").trim();
  if (!dealId) return json({ error: "deal_id is required" }, 400);
  if (!kind) return json({ error: "kind is required" }, 400);

  const db = serviceClient();

  // --- Auth: signed-in staff (mirror send-merchant-email). ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const role = callerProfile?.role as string | undefined;
  if (!role || !["closer", "admin", "super_admin"].includes(role)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }

  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, deal_type, customer_id, ghl_contact_id, assigned_closer_id")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: "deal not found" }, 404);

  if (role === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  const { data: customer } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id")
    .eq("id", deal.customer_id as string).maybeSingle();
  if (!customer) return json({ error: "This deal has no merchant on file." }, 404);

  const email = (customer.email as string | null) ?? "";
  const isVcf = (deal.deal_type as string) === "vcf";
  const copy = copyFor(kind, isVcf, payload.arg1 ?? null, payload.milestone);

  // Resolve/ensure the GHL contact (email transport + system of record).
  let cfg: Awaited<ReturnType<typeof getGhlConfig>>;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  let contactId = (deal.ghl_contact_id as string | null) ?? (customer.ghl_contact_id as string | null) ?? null;
  if (!contactId && email) {
    const cr = await upsertContact(cfg, {
      email,
      firstName: (customer.first_name as string | null) ?? undefined,
      lastName: (customer.last_name as string | null) ?? undefined,
      companyName: (customer.business_name as string | null) ?? undefined,
      phone: (customer.phone as string | null) ?? undefined,
      tags: ["merchant"],
      source: "Merchant Notification",
    });
    contactId = cr.data?.contact?.id ?? null;
    if (contactId && (customer.ghl_contact_id ?? null) !== contactId) {
      await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
    }
  }

  // --- GHL tag (best-effort). Only an EXPLICIT tag — the canonical paydown-<n>
  // renewal-milestone tags are owned by ghl-sync (action "paydown") so there is
  // exactly one idempotent tagger and no double-fire of the GHL renewal workflow.
  let tagged: string | null = null;
  if (contactId && payload.tag) {
    try { await addContactTags(cfg, contactId, [payload.tag]); tagged = payload.tag; } catch { /* best-effort */ }
  }

  // --- Email (best-effort — the portal message already went via the DB trigger). ---
  let emailed = false;
  let emailNote: string | undefined;
  if (!email) {
    emailNote = "merchant has no email on file";
  } else if (!contactId) {
    emailNote = "could not resolve GHL contact";
  } else {
    const firstName = (customer.first_name as string | null) ?? "there";
    const link = `${APP_URL}${copy.path}`;
    const ctaLabel = ctaLabelFor(kind);
    const html = renderMerchantEmail({
      greeting: `Hi ${firstName},`,
      paragraphs: [copy.body],
      ctaLabel,
      ctaUrl: link,
    });
    const text = `Hi ${firstName},\n\n${copy.body}\n\n${ctaLabel}: ${link}\n\n— The Momentum Funding team`;
    let replyMessageId: string | undefined;
    try { replyMessageId = (await latestEmailMessageId(cfg, contactId)) ?? undefined; } catch { /* thread if we can */ }
    const sr = await sendEmailToContact(cfg, contactId, copy.subject, html, { text, replyMessageId });
    emailed = sr.ok;
    if (!sr.ok) emailNote = sr.error;

    // Audit trail (best-effort — never fail the request over the log).
    try {
      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: dealId, interaction_type: "email",
        subject: `merchant:email — ${copy.subject}`,
        content: `Notification (${kind}) emailed to ${email}` + sendMarker(sr.data),
        logged_by: caller.id,
      });
    } catch { /* best-effort */ }
  }

  return json({ ok: true, dealId, kind, emailed, tagged, email_note: emailNote });
});
