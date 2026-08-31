// processor-document-url — mint a short-TTL signed URL for ONE customer document,
// for the Processor workspace (/admin/processor). This is the edge-function half of
// the contract's `processor_document_url(p_document_id)`: a signed URL cannot be
// produced in SQL (no storage signing function), and the customer-documents storage
// RLS money-walls a processor-closer to their own book — so whole-board document
// access must be signed here with the service role AFTER an in-code gate.
//
// Auth: verify_jwt = true at the gateway (this function is NOT listed in config.toml,
// so it defaults to verify_jwt=true). The CALLER is a real processor/ops USER with
// their own JWT; we validate that JWT, then gate on is_processor(uid) OR
// is_ops_staff(uid), then confirm the document belongs to a deal currently in a
// pipeline, and only then sign with the service role. (A raw service_role bearer has
// no user and fails the gate — same doctrine as the RPCs.)
//
// POST { document_id }   (also accepts { p_document_id })
//   → 200 { url, file_name, expires_at }
//   → 401 not signed in | 403 not authorized | 404 doc/deal not found | 400 bad input

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const BUCKET = "customer-documents";
const TTL_SECONDS = 120;

// Pipeline stage sets (must mirror src/data/pipelines.ts). A document is reachable
// only if its customer has a deal sitting in one of these stages.
const MCA_STAGES = [
  "new", "contacted", "qualifying", "application_sent", "docs_collected",
  "bank_statements", "submitted_to_funder", "offer_received", "offer_presented",
  "offer_accepted", "funded", "renewal_eligible", "nurture",
];
const VCF_STAGES = [
  "new_distressed", "hardship_consult", "positions_analysis", "strategy_proposal",
  "agreement_sent", "submitted_to_vcf", "restructure_executed", "servicing",
];
const PIPELINE_STAGES = [...MCA_STAGES, ...VCF_STAGES];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // 1. Identify the caller from their JWT.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Not signed in" }, 401);

    // 2. Gate: processor OR ops staff.
    const [{ data: isProc }, { data: isOps }] = await Promise.all([
      db.rpc("is_processor", { uid: caller.id }),
      db.rpc("is_ops_staff", { uid: caller.id }),
    ]);
    if (!(isProc === true || isOps === true)) return json({ error: "Not authorized" }, 403);

    // 3. Input.
    const body = await req.json().catch(() => ({}));
    const documentId: string | undefined = body?.document_id ?? body?.p_document_id;
    if (!documentId || typeof documentId !== "string") {
      return json({ error: "document_id required" }, 400);
    }

    // 4. Load the document (service role: bypasses RLS; the gate above is the guard).
    const { data: doc, error: docErr } = await db
      .from("customer_documents")
      .select("id, filename, storage_path, customer_id, document_type")
      .eq("id", documentId)
      .maybeSingle();
    if (docErr) return json({ error: `Lookup failed: ${docErr.message}` }, 500);
    if (!doc || !doc.storage_path) return json({ error: "Document not found" }, 404);

    // 5. Validate the document belongs to a customer with a deal currently in a pipeline.
    const { count, error: dealErr } = await db
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", doc.customer_id)
      .in("status", PIPELINE_STAGES);
    if (dealErr) return json({ error: `Validation failed: ${dealErr.message}` }, 500);
    if (!count || count < 1) return json({ error: "Document is not on an in-pipeline deal" }, 404);

    // 6. Sign with the service role.
    const { data: signed, error: signErr } = await db
      .storage.from(BUCKET).createSignedUrl(doc.storage_path, TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      return json({ error: `Sign failed: ${signErr?.message ?? "unknown"}` }, 500);
    }

    return json({
      url: signed.signedUrl,
      file_name: doc.filename,
      expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
