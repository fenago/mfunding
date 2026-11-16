// merchant-upload-doc — the SERVER side of the logged-out statement-collection
// page (/connect-bank/:token). It does two things for a merchant who holds a
// valid bank-link token and has no login at all:
//
//   action "status"  (JSON)      → what we actually HOLD for this merchant, read
//                                  back out of customer_documents, plus the
//                                  business name / deal number they should put
//                                  in an email subject line.
//   file upload      (multipart) → store the file in the customer-documents
//                                  bucket, create the customer_documents row,
//                                  and then run the SAME side effects an
//                                  authenticated portal upload runs
//                                  (_shared/merchantDocArrived.ts) — including
//                                  the GHL write-back that pulls the merchant
//                                  out of the MCA 05/06 chase sequences.
//
// WHY A FUNCTION AND NOT A DIRECT BROWSER WRITE
// -----------------------------------------------------------------------------
// There is no `anon` policy on storage.objects for the customer-documents bucket
// and no `anon` INSERT policy on public.customer_documents (verified against
// pg_policies 2026-11-01 — every policy there is `authenticated` or role-gated).
// A logged-out merchant therefore CANNOT write either one from the browser. The
// service role has to do it, with the link token as the proof of entitlement.
//
// WHY THE ROW MATTERS MORE THAN THE FILE
// -----------------------------------------------------------------------------
// submit-to-funders' stips gate (index.ts ~line 1038) is satisfied by exactly two
// things: a `customer_documents` row of the required type, or a GHL form upload
// (`ghlPresentTypes`). It never consults `bank_analyses` and never consults
// `plaid_items`. So a bank CONNECTION alone does not unblock a submission, and a
// file in the bucket with no row is invisible to the one gate that counts. That
// is why the insert is not best-effort here: if the row fails, the stored object
// is deleted again and the merchant is told the upload did not go through. A
// silent half-success would read to ops as "nothing was ever sent".
//
// verify_jwt = false: auth is enforced IN CODE via resolvePlaidCaller — the same
// resolver plaid-create-link-token / plaid-exchange use, so "is this token valid"
// has ONE definition. A token names exactly one customer and expires.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. No copy in
// here says "loan".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { resolvePlaidCaller } from "../_shared/plaidAuth.ts";
import { merchantDocArrived } from "../_shared/merchantDocArrived.ts";

const BUCKET = "customer-documents";

/** Mirrors the browser cap in src/data/docRequests.ts (the bucket itself allows 50MB). */
const MAX_BYTES = 10 * 1024 * 1024;

/** The bucket's own allowed_mime_types — rejecting here gives a readable message
 *  instead of storage's raw "mime type not supported". */
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** customer_document_type values a merchant may file from this page. Anything
 *  else is an ops classification, not a merchant's choice. */
const ALLOWED_TYPES = new Set(["bank_statement", "id", "voided_check", "other"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A storage key is safe, short, and keeps the extension so the funder-facing
 *  attachment still looks like a PDF. Path convention `customer/<uuid>/…` —
 *  matches plaid-pull and resolves through storage_path_customer_id(), which
 *  understands BOTH conventions in this bucket. Never assume foldername[1]. */
function storageKey(customerId: string, filename: string): string {
  const safe = filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(-80) || "upload";
  return `customer/${customerId}/${Date.now()}-${safe}`;
}

/**
 * Keep a promise alive past the response without making the merchant wait on it.
 *
 * The side-effect chain (content classify → checklist → GHL chase-stop →
 * underwriter) is seconds at best and underwrite-deal alone has blown the 150s
 * gateway limit on big-document deals. Awaiting it would leave the merchant's
 * file row spinning and then show "Not sent" for a file that really landed —
 * a worse lie than the one we are fixing. So the response reports ONLY the two
 * things it can prove (the stored object and the customer_documents row), and
 * the side effects run behind it; their outcomes land in activity_log under
 * subject 'portal:ghl-writeback', which is where ops reads "did the chase stop?".
 */
function background(p: Promise<unknown>): void {
  const safe = p.catch((e) =>
    console.warn("[merchant-upload-doc] background side effects threw:", e instanceof Error ? e.message : e)
  );
  try {
    (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
      ?.waitUntil(safe);
  } catch { /* local dev has no EdgeRuntime — the promise still runs inline */ }
}

/** What we can PROVE we hold for this customer. `null` means the read failed —
 *  the caller must render that as "we couldn't check", never as "nothing". */
async function docsOnFile(
  db: ReturnType<typeof serviceClient>,
  customerId: string,
): Promise<{ bank_statements: number; other_docs: number } | null> {
  const { data, error } = await db
    .from("customer_documents")
    .select("document_type")
    .eq("customer_id", customerId);
  if (error || !data) return null;
  let bank = 0;
  let other = 0;
  for (const row of data as Array<{ document_type: string }>) {
    if (row.document_type === "bank_statement") bank++;
    else other++;
  }
  return { bank_statements: bank, other_docs: other };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const contentType = req.headers.get("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  // ── Read the caller's claim first (link_ref), then resolve it. ──
  let linkRef = "";
  let docType = "bank_statement";
  let action = "status";
  let form: FormData | null = null;

  if (isMultipart) {
    try {
      form = await req.formData();
    } catch {
      return json({ error: "We couldn't read that upload. Please try again." }, 400);
    }
    linkRef = String(form.get("link_ref") ?? "");
    docType = String(form.get("document_type") ?? "bank_statement");
    action = "upload";
  } else {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    linkRef = String(body.link_ref ?? "");
    action = String(body.action ?? "status");
  }

  if (!linkRef) return json({ error: "This link is missing its token." }, 400);

  const ctx = await resolvePlaidCaller(db, req, { link_ref: linkRef });
  if (!ctx.ok || !ctx.customerId) return json({ error: ctx.error ?? "Forbidden" }, ctx.status);
  const customerId = ctx.customerId;

  // ── action "status": the honest read-back the page's copy depends on. ──
  if (action === "status") {
    const { data: cust } = await db
      .from("customers")
      .select("business_name, first_name, last_name")
      .eq("id", customerId)
      .maybeSingle();

    let dealNumber: string | null = null;
    if (ctx.dealId) {
      const { data: deal } = await db
        .from("deals")
        .select("deal_number")
        .eq("id", ctx.dealId)
        .maybeSingle();
      dealNumber = (deal?.deal_number as string | null) ?? null;
    }

    const held = await docsOnFile(db, customerId);
    return json({
      ok: true,
      business_name: (cust?.business_name as string | null) ?? null,
      contact_name: [cust?.first_name, cust?.last_name].filter(Boolean).join(" ") || null,
      deal_number: dealNumber,
      // null → UNREADABLE. The page must not print "nothing on file" for this.
      on_file: held,
    });
  }

  if (action !== "upload" || !form) return json({ error: "Unknown action." }, 400);

  // ── Upload: one file per request, so the body stays small and a failure is
  //    attributable to a single named file in the UI. ──
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file was attached." }, 400);
  if (!ALLOWED_TYPES.has(docType)) docType = "other";

  if (file.size === 0) return json({ error: `"${file.name}" is empty — please pick the file again.` }, 400);
  if (file.size > MAX_BYTES) {
    return json({ error: `"${file.name}" is over 10MB. Please send a smaller photo or PDF.` }, 400);
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return json({
      error: `We can't accept "${file.name}" (${mime}). A photo (JPG, PNG, HEIC) or a PDF works best.`,
    }, 400);
  }

  const path = storageKey(customerId, file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) {
    return json({ error: `We couldn't store "${file.name}" — ${upErr.message}` }, 502);
  }

  const { data: inserted, error: insErr } = await db
    .from("customer_documents")
    .insert({
      customer_id: customerId,
      document_type: docType,
      filename: file.name.slice(0, 200),
      storage_path: path,
      file_size: file.size,
      mime_type: mime,
      description: "Uploaded by the merchant from their secure document link (no login).",
    })
    .select("id")
    .maybeSingle();

  if (insErr || !inserted) {
    // The row is the thing submit-to-funders reads. A stored file with no row is
    // invisible to it, so we do not keep the file and we do not claim success.
    await db.storage.from(BUCKET).remove([path]);
    return json({
      error:
        `"${file.name}" did not go through — we could not record it against your file. ` +
        `Please try again, or email it to sales@send.mfunding.net.`,
    }, 502);
  }

  // ── The file landed. Now everything an AUTHENTICATED upload does. ──
  //
  // This is the whole point of this lane. A merchant who complies here was still
  // being chased: the measured case is a merchant who signed at 19:49, was told
  // at 19:50 "your documents are in… you don't need to do anything else right
  // now", and was emailed "we still need your bank statements" at 20:24 and
  // again at exactly +48h. Storing the file without cancelling the chase
  // reproduces that.
  //
  // ONE definition, shared with merchant-doc-uploaded (the signed-in portal):
  // content classification, the activity trail, the deal_doc_requests flip, the
  // GHL tag + MCA 05/06 chase-stop + contact note, and the underwriter re-run.
  // Best-effort relative to THIS upload: it is already committed and nothing
  // below may undo it or be reported as part of its success.
  //
  // `fulfillOutstandingRequest` is TRUE only here. The portal flips its own
  // checklist row through mark_doc_request_uploaded (which needs auth.uid(), so
  // this lane cannot call it) — and without the flip the chase-stop cannot fire
  // at all: every bank_statement request in the live table sits at 'requested'.
  //
  // `dealId` comes from the link token, which names exactly one deal. That is
  // better than the shared fallback ("most recently updated deal"), because
  // deals.updated_at is not a freshness signal — the nightly score job rewrites
  // every row.
  background(merchantDocArrived(db, {
    documentId: (inserted as { id: string }).id,
    customerId,
    dealId: ctx.dealId ?? null,
    viaPhrase: "their secure document link (no login)",
    // No auth user on this lane — the token is the credential, so activity_log
    // .logged_by stays null rather than borrowing somebody else's id.
    loggedBy: null,
    ghlSource: "Doc Link Upload",
    fulfillOutstandingRequest: true,
  }));

  const held = await docsOnFile(db, customerId);
  return json({
    ok: true,
    document_id: (inserted as { id: string }).id,
    filename: file.name,
    document_type: docType,
    on_file: held,
  });
});
