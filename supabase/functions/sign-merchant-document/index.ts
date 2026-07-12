// sign-merchant-document — a MERCHANT e-signs a document that was sent to them.
//
// POST { document_id, typed_legal_name, consent }
//
// Why an edge function and not a pure SQL RPC (like the closer flow): signing a
// merchant document has to (a) drop a storage artifact of the exact signed text
// and (b) insert a customer_documents row with document_type = 'application' so
// submit-to-funders' hard gate passes. Neither is doable from SQL. So this fn
// does the storage write, then calls sign_merchant_document() (SECURITY DEFINER,
// service-role only) which appends the append-only signature row, flips the
// document to 'signed', and inserts the app-side 'application' copy — ATOMICALLY.
//
// The signature ledger has no INSERT policy for anyone below service role, so a
// merchant can never forge a signature via REST; the ONLY path is this function,
// which builds the record from the server's view of who the caller is (verified
// JWT), the frozen content, and the request's real IP + user-agent.
//
// Auth: verify_jwt = true + in-code ownership check (customers.user_id = caller).
//
// Compliance: MCA = purchase of future receivables, never a "loan". This fn emits
// no merchant-facing product copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { sha256Hex } from "../_shared/merchantDocMerge.ts";
import { renderTextPdf } from "../_shared/textPdf.ts";

const DOC_BUCKET = "customer-documents";

// The consent sentence the merchant agrees to. Stored verbatim in the ledger.
const CONSENT_TEXT =
  "I have read this document in full and I agree to be bound by it. I intend my typed name below to be my legal electronic signature.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { document_id?: string; typed_legal_name?: string; consent?: boolean };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const documentId = payload.document_id;
  const typedName = (payload.typed_legal_name ?? "").trim();
  const consent = payload.consent === true;
  if (!documentId) return json({ error: "document_id is required" }, 400);
  if (!typedName) return json({ error: "Type your full legal name to sign." }, 400);
  if (!consent) return json({ error: "You must agree to the consent statement to sign." }, 400);

  const db = serviceClient();

  // --- Auth: signed-in user who OWNS the document's customer. ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  // Load the document (service role) + verify ownership + state before we write.
  const { data: doc, error: docErr } = await db
    .from("merchant_documents")
    .select("id, deal_id, customer_id, name, merged_content, content_sha256, status")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) return json({ error: "document not found" }, 404);

  const { data: customer } = await db
    .from("customers")
    .select("id, user_id")
    .eq("id", doc.customer_id as string)
    .maybeSingle();
  if (!customer) return json({ error: "customer not found" }, 404);
  if ((customer.user_id as string | null) !== caller.id) {
    return json({ error: "This document does not belong to you." }, 403);
  }

  if (doc.status === "signed") return json({ error: "This document has already been signed." }, 409);
  if (doc.status !== "sent") return json({ error: "This document is not ready to sign." }, 422);

  // Belt-and-braces integrity check before we do anything irreversible.
  const merged = doc.merged_content as string;
  const calc = await sha256Hex(merged);
  if (calc !== (doc.content_sha256 as string)) {
    return json({ error: "Document integrity check failed." }, 409);
  }

  // Capture IP + user-agent server-side (never from the browser body).
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const userAgent = req.headers.get("user-agent");

  // --- 1) Render the signed document to a PDF and write it to storage. This is
  // the funder-ready artifact submit-to-funders attaches (the bucket accepts
  // PDF/image/Word only). The AUTHORITATIVE signed record is still the frozen
  // text + SHA-256 in the ledger; this PDF is its rendition + the signature block.
  // Do it FIRST; if it fails we sign nothing. ---
  const signedAtIso = new Date().toISOString();
  const footerLines = [
    "",
    "ELECTRONIC SIGNATURE",
    `Signed by: ${typedName}`,
    `Date (UTC): ${signedAtIso}`,
    ip ? `IP address: ${ip}` : "IP address: (not captured)",
    `Document SHA-256: ${doc.content_sha256}`,
    `Consent: ${CONSENT_TEXT}`,
  ];
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderTextPdf({ title: doc.name as string, body: merged, footerLines });
  } catch (e) {
    return json({ error: `could not render the signed document: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `customer/${doc.customer_id}/signed-application-${documentId}-${stamp}.pdf`;
  const { error: upErr } = await db.storage
    .from(DOC_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) return json({ error: `could not store the signed document: ${upErr.message}` }, 500);

  // --- 2) Atomic DB writes: ledger row + status flip + customer_documents copy. ---
  const filename = `Signed application - ${doc.name}.pdf`;
  const { data: sig, error: rpcErr } = await db.rpc("sign_merchant_document", {
    p_document_id: documentId,
    p_signer_user_id: caller.id,
    p_typed_legal_name: typedName,
    p_consent: consent,
    p_consent_text: CONSENT_TEXT,
    p_ip: ip,
    p_user_agent: userAgent,
    p_storage_path: storagePath,
    p_filename: filename,
    p_file_size: pdfBytes.byteLength,
    p_mime_type: "application/pdf",
  });
  if (rpcErr) {
    // Clean up the orphan artifact so a retry doesn't accumulate copies.
    try { await db.storage.from(DOC_BUCKET).remove([storagePath]); } catch { /* best-effort */ }
    return json({ error: rpcErr.message }, 400);
  }

  // --- 3) Closer-facing trail (best-effort). ---
  try {
    await db.from("activity_log").insert({
      entity_type: "deal", entity_id: doc.deal_id,
      interaction_type: "note",
      subject: "merchant:signed — application",
      content: `Merchant e-signed "${doc.name}". Signed application is now on file for funder submission.`,
      logged_by: caller.id,
    });
  } catch { /* best-effort */ }

  return json({
    ok: true,
    document_id: documentId,
    status: "signed",
    signed_at: (sig as { signed_at?: string } | null)?.signed_at ?? new Date().toISOString(),
    signed_application_on_file: true,
  });
});
