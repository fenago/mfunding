// materialize-closer-doc — merge + FREEZE a single closer document for one
// contractor, then hand back the URL where they read + sign it. Built for the
// substitute W-8BEN self-service flow, but works for any e-signable slug.
//
// POST { slug: string, closerId?: string }
//
// WHY A SIBLING TO send-closer-onboarding-package:
//   • That function is ADMIN-ONLY and emails a package. The W-8BEN is signed by
//     the CONTRACTOR themselves from their own profile page — a non-admin. So we
//     need a self-service materialize path.
//   • This function lets a contractor materialize their OWN doc (closerId omitted
//     → resolved from the caller's closers row), and lets an admin materialize
//     for any closer (closerId provided). Nobody can materialize someone else's.
//
// THE MERGE IS STILL THE POINT and STILL SERVER-SIDE: the W-8BEN placeholders
// ([LEGAL NAME], [CITIZENSHIP COUNTRY], [RESIDENCE ADDRESS], [FOREIGN TIN], …)
// are resolved from profiles + payout_profiles via the service client (which can
// read payout_profiles past its owner-only RLS). If ANY required field is blank
// the merge BLOCKS: nothing is frozen and we return 422 with exactly what's
// missing, so the contractor knows what to fill on their profile first. The
// frozen text — not the mutable template — is what sign_closer_document() hashes.
//
// Auth: verify_jwt (gateway) + in-code check that the caller either OWNS the
// target closer row or is an admin/super_admin. A service_role bearer is NOT a
// user and fails db.auth.getUser — as intended.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import {
  mergeCloserDoc, sha256Hex, buildW8benInputs, type MergeSettings,
} from "../_shared/closerDocMerge.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");
const signUrl = (slug: string) => `${APP_URL}/admin/closer-docs/${slug}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { slug?: string; closerId?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const slug = payload.slug;
  if (!slug) return json({ error: "slug is required" }, 400);

  const db = serviceClient();

  // --- Who is calling? ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = (callerProfile?.role as string | undefined) ?? "";
  const isAdmin = ["admin", "super_admin"].includes(callerRole);

  // --- Resolve the target closer. ---
  //   • closerId given + admin  → that closer.
  //   • otherwise               → the caller's own closers row.
  let closerQuery = db
    .from("closers")
    .select("id, first_name, last_name, user_id");
  if (payload.closerId && isAdmin) {
    closerQuery = closerQuery.eq("id", payload.closerId);
  } else {
    closerQuery = closerQuery.eq("user_id", caller.id);
  }
  const { data: closer, error: cErr } = await closerQuery.maybeSingle();
  if (cErr) return json({ error: `closer lookup failed: ${cErr.message}` }, 500);
  if (!closer) {
    return json({
      error: payload.closerId
        ? "Closer not found."
        : "No contractor record is linked to your account.",
    }, 404);
  }
  // Non-admins may only materialize their own document.
  if (!isAdmin && closer.user_id !== caller.id) {
    return json({ error: "Forbidden" }, 403);
  }

  // --- Load the template (must be e-signable). ---
  const { data: template, error: tErr } = await db
    .from("closer_doc_templates")
    .select("slug, title, body_md, version, esignable")
    .eq("slug", slug).maybeSingle();
  if (tErr) return json({ error: `template: ${tErr.message}` }, 500);
  if (!template) return json({ error: `Unknown document: ${slug}` }, 404);
  if (!template.esignable) return json({ error: `${slug} is not an e-signable document.` }, 400);

  // --- If it's already signed, don't re-freeze. Just point them at it. ---
  const { data: existing } = await db
    .from("closer_documents")
    .select("id, status")
    .eq("closer_id", closer.id).eq("doc_slug", slug).maybeSingle();
  if (existing?.status === "signed") {
    return json({ ok: true, alreadySigned: true, signUrl: signUrl(slug), slug });
  }

  // --- Company merge settings + the contractor's profile & payout rows. ---
  const { data: settingRow } = await db
    .from("platform_settings").select("value").eq("key", "closer_docs").maybeSingle();
  const settings = (settingRow?.value ?? {}) as MergeSettings;

  const { data: profileRow } = await db
    .from("profiles")
    .select("first_name, last_name, display_name, country, address_line1, address_line2, city, state, postal_code")
    .eq("id", closer.user_id).maybeSingle();
  const { data: payoutRow } = await db
    .from("payout_profiles")
    .select("tax_country, foreign_tax_id")
    .eq("profile_id", closer.user_id).maybeSingle();

  // --- Merge. Enrich the closer object with the W-8BEN inputs. ---
  const w8 = buildW8benInputs(profileRow, payoutRow);
  const mergeCloser = {
    first_name: closer.first_name ?? "",
    last_name: closer.last_name ?? "",
    ...w8,
  };
  const res = mergeCloserDoc(template.slug, template.body_md, mergeCloser, settings);
  if (res.missing.length) {
    return json({
      error: "Some required fields on your profile are still blank, so the form was not prepared.",
      blocked: [{ slug: template.slug, title: template.title, missing: res.missing }],
    }, 422);
  }

  // --- Freeze onto the tracker row (create it on demand — the W-8BEN is not part
  //     of the auto-seeded onboarding checklist). ---
  const sha = await sha256Hex(res.content);
  const nowIso = new Date().toISOString();
  const { error: upErr } = await db
    .from("closer_documents")
    .upsert({
      closer_id: closer.id,
      doc_slug: template.slug,
      status: "sent",
      merged_content: res.content,
      merged_sha256: sha,
      template_version: template.version,
      sent_at: nowIso,
      sent_by: caller.id,
      signed_at: null,
    }, { onConflict: "closer_id,doc_slug" });
  if (upErr) return json({ error: `could not stage ${slug}: ${upErr.message}` }, 500);

  // No activity_log write here: entity_type has a CHECK of
  // (customer|lender|marketing_vendor|deal) — 'closer' would fail SILENTLY. The
  // real audit trail is closer_documents.sent_at/sent_by (this freeze) and the
  // append-only closer_document_signatures ledger at signing time.

  return json({ ok: true, signUrl: signUrl(slug), slug, sha256: sha });
});
