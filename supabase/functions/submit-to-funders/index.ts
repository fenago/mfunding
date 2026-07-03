// submit-to-funders v2 — send each funder the deal package IN THAT FUNDER'S FORMAT.
//
// v1 emailed every funder ONE generic email and attached nothing. v2 runs a
// per-funder "recipe" (funder_submission_profiles): the funder's submission
// email, subject convention, required body fields (merge tokens), which docs to
// include (as secure expiring links), and a required-stips guard. Portal-only
// funders get a guided portal flow instead of an email. One engine, one row per
// deal × lender, full audit in sent_payload.
//
// Recipes are DATA (edited in the admin UI), not 39 hand-built GHL workflows.
// When a lender has no recipe yet, a generic email template is the fallback so
// nothing breaks — same behavior as v1.
//
// Invoked from the app (playbook Step 6 FunderPicker, deal Submissions tab, and
// the admin recipe editor's "Send test to myself") via
// supabase.functions.invoke("submit-to-funders"). verify_jwt = true.
//
// Compliance: MCA = purchase of future receivables, not a loan. Funder-facing
// copy lives in the recipe templates so this is enforceable per funder.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact,
  listContactFileUploads,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DOC_BUCKET = "customer-documents";
const SIGNED_URL_TTL = 72 * 60 * 60; // 72h expiring links (PII safety)

const money = (n: unknown) =>
  n == null || n === "" ? "—" : `$${Number(n).toLocaleString("en-US")}`;

const tib = (months: unknown) => {
  const m = Number(months);
  if (!m || Number.isNaN(m)) return "—";
  if (m < 12) return `${m} months`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r ? `${y} yr ${r} mo` : `${y} yr`;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Human labels for the doc slugs (which ARE customer_document_type enum values).
const DOC_LABELS: Record<string, string> = {
  application: "Signed application",
  bank_statement: "Bank statements",
  id: "Photo ID",
  voided_check: "Voided check",
  credit_authorization: "Credit authorization",
  business_license: "Business license / proof of ownership",
  personal_guarantee: "Personal guarantee",
  tax_return: "Tax return",
  other: "Other",
};
const docLabel = (slug: string) => DOC_LABELS[slug] ?? slug.replace(/_/g, " ");

interface Recipe {
  lender_id: string;
  method: "email" | "portal" | "email_and_portal";
  to_email: string | null;
  cc_emails: string[] | null;
  subject_template: string | null;
  body_template: string | null;
  attach_docs: string[];
  attachment_mode: "links" | "attachments" | "both";
  max_statement_months: number | null;
  portal_url: string | null;
  portal_steps: string[] | null;
  portal_credentials_hint: string | null;
  required_stips: string[];
  special_instructions: string | null;
  active: boolean;
}

const GENERIC_SUBJECT =
  "Agentic Voice, Inc : Momentum Funding — New MCA Submission — {{business_name}} — {{amount_requested}}";
// Owner is CC'd on every funder submission (also merged with recipe cc_emails).
const ALWAYS_CC = ["socrates73@gmail.com"];
const GENERIC_BODY =
  `New submission from Momentum Funding (ISO) for your review.\n\n` +
  `Business: {{business_name}}\nOwner: {{owner_name}}\nIndustry: {{industry}}\n` +
  `State: {{state}}\nEIN: {{ein}}\nTime in business: {{time_in_business}}\n` +
  `Monthly revenue: {{monthly_revenue}}\nAmount requested: {{amount_requested}}\n` +
  `Use of funds: {{use_of_funds}}\nOwner phone: {{owner_phone}}\nOwner email: {{owner_email}}\n` +
  `Deal #: {{deal_number}}\n\nDocuments:\n{{doc_links}}\n\n` +
  `This is a purchase of future receivables (MCA) — not a loan. Reply with any questions.\n` +
  `— {{closer_name}}, Momentum Funding Submissions`;

/** Build the flat merge-token map from a deal + its customer + the closer. */
function buildTokens(
  deal: Record<string, unknown>,
  c: Record<string, unknown>,
  closer: { name: string; email: string },
): Record<string, string> {
  const owner = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
  return {
    business_name: (c.business_name as string) || "Unknown business",
    dba: (c.business_name as string) || "—",
    owner_name: owner,
    owner_email: (c.email as string) || "—",
    owner_phone: (c.phone as string) || "—",
    ein: (c.ein as string) || "—",
    amount_requested: money(deal.amount_requested ?? c.amount_requested),
    monthly_revenue: money(c.monthly_revenue),
    time_in_business: tib(c.time_in_business),
    industry: (c.industry as string) || (c.business_type as string) || "—",
    use_of_funds: (deal.use_of_funds as string) || (c.use_of_funds as string) || "—",
    state: (c.address_state as string) || "—",
    positions: String(deal.vcf_active_positions ?? "—"),
    deal_number: (deal.deal_number as string) || "—",
    closer_name: closer.name || "Momentum Funding",
    closer_email: closer.email || "—",
    doc_links: "", // filled per-lender (depends on the recipe's attach_docs)
  };
}

/** Render {{token}} placeholders. Unknown tokens are left blank. */
function render(tpl: string, tokens: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k) => tokens[k] ?? "");
}

interface DocRow { document_type: string; filename: string | null; storage_path: string; status: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: {
    dealId?: string;
    lenderIds?: string[];
    notes?: string;
    resubmit?: boolean;
    /** When true, this is a recipe QA send: the engine renders each lender's
     * recipe against a SAMPLE deal and emails ONLY the logged-in admin. It never
     * emails a real funder and never writes deal_submissions. */
    test_email?: boolean;
  };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const lenderIds = (payload.lenderIds ?? []).filter(Boolean);
  const notes = payload.notes;
  const resubmit = !!payload.resubmit;
  const testMode = !!payload.test_email;
  if (lenderIds.length === 0) return json({ error: "lenderIds are required" }, 400);
  if (!testMode && !payload.dealId) return json({ error: "dealId is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: this function emails full merchant PII to funders, so the
  // caller MUST be signed-in staff. Closers may only submit their OWN deals. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role, first_name, last_name").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  // Recipe test sends are an admin QA tool — closers don't get them.
  if (testMode && !["admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — recipe test is admin-only" }, 403);
  }
  const closer = {
    name: [callerProfile?.first_name, callerProfile?.last_name].filter(Boolean).join(" ").trim(),
    email: caller.email ?? "",
  };

  // Load the recipes for the selected lenders (may be empty → generic fallback).
  const { data: profileRows } = await db
    .from("funder_submission_profiles").select("*").in("lender_id", lenderIds);
  const recipeByLender = new Map<string, Recipe>(
    (profileRows ?? []).map((r) => [r.lender_id as string, r as Recipe]),
  );

  // Load the funders (names + email/portal fallbacks).
  const { data: lenders } = await db
    .from("lenders")
    .select("id, company_name, submission_email, submission_portal_url")
    .in("id", lenderIds);
  const lenderById = new Map<string, Record<string, unknown>>(
    (lenders ?? []).map((l) => [l.id as string, l as Record<string, unknown>]),
  );

  // GHL is the email transport. Load creds once.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }

  const nowIso = new Date().toISOString();

  // ---------- TEST MODE: render recipes against a sample deal, email the admin ----------
  if (testMode) {
    const sampleDeal: Record<string, unknown> = {
      deal_number: "TEST-0000", deal_type: "mca", amount_requested: 50000,
      use_of_funds: "Working capital / inventory", vcf_active_positions: 1,
    };
    const sampleCustomer: Record<string, unknown> = {
      first_name: "Sample", last_name: "Merchant", business_name: "Acme Test LLC",
      email: "merchant@example.com", phone: "(555) 010-0000", ein: "12-3456789",
      industry: "Construction", address_state: "IN", time_in_business: 26,
      monthly_revenue: 60000, business_type: "Construction", use_of_funds: "Working capital",
    };
    const results: Array<Record<string, unknown>> = [];
    for (const lenderId of lenderIds) {
      const lender = lenderById.get(lenderId);
      const recipe = recipeByLender.get(lenderId);
      const tokens = buildTokens(sampleDeal, sampleCustomer, closer);
      tokens.doc_links = "(sample) Signed application — https://example.com/signed-app\n(sample) Bank statements — https://example.com/bank-statements";
      const subject = "[TEST] " + render(recipe?.subject_template || GENERIC_SUBJECT, tokens);
      const bodyText = render(recipe?.body_template || GENERIC_BODY, tokens) +
        `\n\n———\nThis is a RECIPE TEST for ${String(lender?.company_name ?? "this funder")}. No funder was contacted.`;
      const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:600px;white-space:pre-wrap">${esc(bodyText)}</div>`;

      let emailSent = false;
      let emailError: string | undefined;
      const to = closer.email; // FORCED to the logged-in admin — never a funder.
      if (!to) emailError = "your account has no email address";
      else if (!cfg) emailError = `GHL not configured: ${ghlError ?? "missing credentials"}`;
      else {
        const cr = await upsertContact(cfg, { email: to, firstName: closer.name || "Admin", tags: ["staff"], source: "Recipe Test" });
        const contactId = cr.data?.contact?.id;
        if (!contactId) emailError = `GHL upsert failed: ${cr.error ?? "no contact id"}`;
        else {
          const sr = await sendEmailToContact(cfg, contactId, subject, htmlBody, { text: bodyText, emailCc: Array.from(new Set([...(recipe?.cc_emails ?? []), ...ALWAYS_CC])) });
          emailSent = sr.ok;
          if (!sr.ok) emailError = `GHL send failed: ${sr.error}`;
        }
      }
      results.push({
        lenderId, name: lender?.company_name, method: recipe?.method ?? "email",
        status: emailSent ? "sent" : "send_failed", to, error: emailError,
        usedRecipe: !!recipe, subject,
      });
    }
    return json({ ok: true, test: true, sentTo: closer.email, results });
  }

  // ---------- NORMAL MODE ----------
  const dealId = payload.dealId!;
  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, deal_number, deal_type, amount_requested, use_of_funds, status, customer_id, ghl_contact_id, vcf_active_positions, vcf_total_balance, vcf_daily_debit, vcf_current_funders, vcf_hardship_reason")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  const { data: customer } = await db.from("customers").select("*").eq("id", deal.customer_id).maybeSingle();
  const c = (customer ?? {}) as Record<string, unknown>;

  // All docs on file for this deal's customer, grouped by type.
  const { data: docRows } = await db
    .from("customer_documents")
    .select("document_type, filename, storage_path, status")
    .eq("customer_id", deal.customer_id);
  const docsByType = new Map<string, DocRow[]>();
  for (const d of (docRows ?? []) as DocRow[]) {
    const arr = docsByType.get(d.document_type) ?? [];
    arr.push(d);
    docsByType.set(d.document_type, arr);
  }

  // --- Merchant docs uploaded GHL-side. Bank statements and stips usually come
  // in through the GHL upload form and live on the contact's FILE_UPLOAD custom
  // fields, NOT Supabase storage. Fetch them once (contact-level, same for every
  // funder) and split into bank vs. other-stips. The leadconnectorhq download
  // URLs are public (307 → short-lived signed GCS link), so we hand them to the
  // funder directly — no server-side proxy needed. ---
  const ghlBank: Array<{ name: string; url: string }> = [];
  const ghlStips: Array<{ name: string; url: string }> = [];
  const ghlContactId = (deal.ghl_contact_id as string | null) ?? (c.ghl_contact_id as string | null) ?? null;
  if (ghlContactId && cfg) {
    try {
      for (const f of await listContactFileUploads(cfg, ghlContactId)) {
        const bucket = /bank/i.test(f.field) ? ghlBank : ghlStips;
        for (const file of f.files) if (file.url) bucket.push({ name: file.name, url: file.url });
      }
    } catch { /* best-effort — Supabase docs still attach if GHL peek fails */ }
  }
  // GHL uploads count toward the stips guard too (mirrors the FunderPicker's
  // package check): a bank field satisfies bank_statement; any other stip field
  // satisfies id / voided_check (the upload form can't tag the exact type).
  const ghlPresentTypes = new Set<string>();
  if (ghlBank.length) ghlPresentTypes.add("bank_statement");
  if (ghlStips.length) { ghlPresentTypes.add("id"); ghlPresentTypes.add("voided_check"); }

  const results: Array<Record<string, unknown>> = [];

  for (const lenderId of lenderIds) {
    const lender = lenderById.get(lenderId) ?? { id: lenderId, company_name: "Funder" };
    const name = (lender.company_name as string) ?? "Funder";
    const recipe = recipeByLender.get(lenderId);
    const method = recipe?.method ?? (lender.submission_email ? "email" : (lender.submission_portal_url ? "portal" : "email"));

    // --- Idempotency: skip a lender that already has an active submission. ---
    const { data: existing } = await db.from("deal_submissions")
      .select("id, status, submitted_at, portal_confirmed_at, error")
      .eq("deal_id", dealId).eq("lender_id", lenderId).maybeSingle();
    const existingActive = existing &&
      existing.status !== "withdrawn" &&
      !existing.error &&
      (existing.submitted_at || existing.portal_confirmed_at);
    if (existingActive && !resubmit) {
      results.push({ lenderId, name, method, status: "already_submitted", submissionId: existing!.id });
      continue;
    }

    // --- Stips guard: every required stip must be on file before we send. ---
    const requiredStips = recipe?.required_stips ?? [];
    const missing = requiredStips.filter((slug) => !(docsByType.get(slug)?.length) && !ghlPresentTypes.has(slug));
    if (missing.length > 0) {
      results.push({ lenderId, name, method, status: "blocked", blocked: missing, blockedLabels: missing.map(docLabel) });
      continue;
    }

    // --- Gather docs as expiring signed links (Phase 6 real attachments = later). ---
    const attachSlugs = recipe?.attach_docs?.length ? recipe.attach_docs : ["application", "bank_statement"];
    const docLinkLines: string[] = [];
    const docLinkHtml: string[] = [];
    let appLinkCount = 0; // app-side signed-application copies actually linked
    for (const slug of attachSlugs) {
      const list = docsByType.get(slug) ?? [];
      for (const d of list) {
        const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, SIGNED_URL_TTL);
        const url = signed?.signedUrl;
        if (!url) continue;
        const label = `${docLabel(slug)}${d.filename ? ` (${d.filename})` : ""}`;
        docLinkLines.push(`${label} — ${url}`);
        docLinkHtml.push(`<li><a href="${url}">${esc(label)}</a></li>`);
        if (slug === "application") appLinkCount++;
      }
    }

    // Merge in the GHL-side merchant uploads, grouped and labelled. Only include
    // a group the recipe actually asked for: bank statements when the recipe
    // wants bank_statement, the stips bundle when it wants any non-bank stip.
    const wantsBank = attachSlugs.includes("bank_statement");
    const wantsStips = attachSlugs.some((s) => !["application", "signed_application", "bank_statement"].includes(s));
    const pushGroup = (heading: string, files: Array<{ name: string; url: string }>) => {
      if (!files.length) return;
      docLinkLines.push(`${heading} (${files.length}):`);
      for (const f of files) docLinkLines.push(`  ${f.name} — ${f.url}`);
      docLinkHtml.push(
        `<li>${esc(heading)} (${files.length}):<ul style="margin:2px 0">` +
        files.map((f) => `<li><a href="${f.url}">${esc(f.name)}</a></li>`).join("") + `</ul></li>`,
      );
    };
    if (wantsBank) pushGroup("Bank statements", ghlBank);
    if (wantsStips) pushGroup("Stips documents", ghlStips);

    // Signed application PDFs live in GHL Documents & Contracts (e-sign), which is
    // API scope-blocked — we cannot fetch them. If the recipe wants the signed
    // application and no app-side copy exists, say so honestly and warn the closer.
    let docsWarning: string | undefined;
    const wantsApp = attachSlugs.some((s) => s === "application" || s === "signed_application");
    if (wantsApp && appLinkCount === 0) {
      docLinkLines.push("Signed application: attached separately / available on request");
      docLinkHtml.push(`<li>Signed application: attached separately / available on request</li>`);
      docsWarning = "signed application not auto-attached — forward it from GHL";
    }

    const docLinksText = docLinkLines.length ? docLinkLines.join("\n") : "(documents will be sent on request)";

    // Portal-only funders: no funder email — return the guided portal flow.
    const isPortalOnly = method === "portal";

    // --- Render the recipe (subject + body) ---
    const tokens = buildTokens(deal as Record<string, unknown>, c, closer);
    tokens.doc_links = docLinksText;
    const subject = render(recipe?.subject_template || GENERIC_SUBJECT, tokens);
    let bodyText = render(recipe?.body_template || GENERIC_BODY, tokens);
    if (recipe?.special_instructions) bodyText += `\n\n${recipe.special_instructions}`;
    if (notes) bodyText += `\n\nNotes: ${notes}`;
    const bodyHtml =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:600px">` +
      `<div style="white-space:pre-wrap">${esc(render(recipe?.body_template || GENERIC_BODY, tokens))}</div>` +
      (docLinkHtml.length ? `<ul style="margin:8px 0">${docLinkHtml.join("")}</ul>` : "") +
      (recipe?.special_instructions ? `<p style="margin:8px 0;color:#334155">${esc(recipe.special_instructions)}</p>` : "") +
      (notes ? `<p style="margin:8px 0"><strong>Notes:</strong> ${esc(notes)}</p>` : "") +
      `</div>`;

    const to = recipe?.to_email || (lender.submission_email as string) || "";
    const cc = recipe?.cc_emails ?? [];

    const sentPayload: Record<string, unknown> = {
      method, to, cc, subject, body: bodyText,
      docLinks: docLinkLines, attachSlugs, attachment_mode: recipe?.attachment_mode ?? "links",
      docsWarning, usedRecipe: !!recipe, renderedAt: nowIso,
      // links mode only in this phase; note if a recipe asked for real attachments.
      note: (recipe?.attachment_mode && recipe.attachment_mode !== "links")
        ? "attachment_mode requested files but engine sent secure links (Phase 6 pending)"
        : undefined,
    };

    // ---- PORTAL branch ----
    if (isPortalOnly) {
      const submissionId = await upsertSubmission(db, dealId, lenderId, {
        status: "pending", submission_method: "portal",
        sent_payload: sentPayload, notes: notes ?? null, error: null, submitted_at: null,
      }, existing?.id as string | undefined, caller.id);
      const portalUrl = recipe?.portal_url || (lender.submission_portal_url as string) || null;
      results.push({
        lenderId, name, method, status: "portal_pending", submissionId,
        portal: { url: portalUrl, steps: recipe?.portal_steps ?? [], hint: recipe?.portal_credentials_hint ?? null },
        warning: docsWarning,
      });
      await logActivity(db, dealId, lenderId, name, { portal: true, portalUrl, subject });
      continue;
    }

    // ---- EMAIL branch (email or email_and_portal) ----
    let emailSent = false;
    let emailError: string | undefined;
    if (!to) {
      emailError = "no submission email on file (set to_email on the recipe or submission_email on the funder)";
    } else if (!cfg) {
      emailError = `GHL not configured: ${ghlError ?? "missing credentials"}`;
    } else {
      const cr = await upsertContact(cfg, { email: to, firstName: name, tags: ["funder"], source: "Funder Submission" });
      const funderContactId = cr.data?.contact?.id;
      if (!funderContactId) emailError = `GHL upsert failed: ${cr.error ?? "no contact id"}`;
      else {
        const sr = await sendEmailToContact(cfg, funderContactId, subject, bodyHtml, {
          text: bodyText,
          emailCc: Array.from(new Set([...(recipe?.cc_emails ?? []), ...ALWAYS_CC])),
        });
        emailSent = sr.ok;
        if (!sr.ok) emailError = `GHL send failed: ${sr.error}`;
      }
    }

    // email_and_portal → email sent AND a portal flow is surfaced too.
    const portalOut = method === "email_and_portal"
      ? { url: recipe?.portal_url || (lender.submission_portal_url as string) || null, steps: recipe?.portal_steps ?? [], hint: recipe?.portal_credentials_hint ?? null }
      : undefined;

    const submissionId = await upsertSubmission(db, dealId, lenderId, {
      // Only ever write existing SubmissionStatus values into `status` so the UI
      // config never breaks: 'submitted' on success, 'pending' when the send failed.
      status: emailSent ? "submitted" : "pending",
      submission_method: method === "email_and_portal" ? "email_and_portal" : "email",
      sent_payload: sentPayload,
      submitted_at: emailSent ? nowIso : null,
      error: emailError ?? null,
      notes: notes ?? null,
    }, existing?.id as string | undefined, caller.id);

    await logActivity(db, dealId, lenderId, name, { to, emailSent, emailError, subject });

    results.push({
      lenderId, name, method, submissionId,
      status: emailSent ? "sent" : "send_failed",
      to, error: emailError, portal: portalOut, warning: docsWarning,
    });
  }

  const anySent = results.some((r) => r.status === "sent" || r.status === "portal_pending");
  return json({
    ok: true,
    dealId,
    total: results.length,
    sentCount: results.filter((r) => r.status === "sent").length,
    via: "ghl",
    warning: ghlError
      ? `GHL credentials unavailable (${ghlError}) — funders were NOT emailed; submissions are recorded.`
      : anySent ? undefined : "No funder emails were sent — check each funder's recipe / submission email.",
    results,
  });
});

/** Insert or update the deal_submissions row; returns its id. */
async function upsertSubmission(
  db: SupabaseClient,
  dealId: string,
  lenderId: string,
  fields: Record<string, unknown>,
  existingId: string | undefined,
  callerId: string,
): Promise<string | undefined> {
  if (existingId) {
    await db.from("deal_submissions").update(fields).eq("id", existingId);
    return existingId;
  }
  const { data: ins } = await db.from("deal_submissions")
    .insert({ deal_id: dealId, lender_id: lenderId, submitted_by: callerId, ...fields })
    .select("id").maybeSingle();
  return ins?.id as string | undefined;
}

/** Best-effort activity_log entry (never breaks the submit flow). */
async function logActivity(
  db: SupabaseClient,
  dealId: string,
  lenderId: string,
  name: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.from("activity_log").insert({
      entity_type: "deal", entity_id: dealId, interaction_type: "system",
      subject: `submit-to-funder:${name}`,
      content: JSON.stringify({ lenderId, via: "ghl", ...detail }),
    });
  } catch { /* best-effort */ }
}
