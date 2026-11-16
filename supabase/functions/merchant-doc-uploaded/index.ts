// merchant-doc-uploaded — cross-system side effects after a MERCHANT uploads a
// document from the SIGNED-IN portal. Closes audit finding #24 (portal
// bank-statement uploads never triggered the underwriter and left no trail).
//
// Why an edge function: a merchant (profiles.role = 'user') CANNOT insert into
// activity_log (no RLS policy) and CANNOT call underwrite-deal (its in-code role
// check rejects non-staff). Both must happen server-side.
//
// THIS FILE IS NOW ONLY THE DOOR. Everything it used to do inline — content
// classification, the activity trail, the underwriter re-run, and the GHL
// write-back that pulls a complying merchant out of the MCA 05/06 chase — lives
// in _shared/merchantDocArrived.ts, because the logged-OUT lane
// (merchant-upload-doc, /connect-bank/:token) has to do exactly the same things
// and a second hand-maintained copy would drift. Read that file for what the
// side effects are and why.
//
// POST body: { document_id }   (the customer_documents row the merchant created)
//
// Auth (verify_jwt = true, UNCHANGED): the caller must OWN the document's
// customer (customers.user_id = caller) — ops staff are allowed through too.
//
// The pending customer_documents row itself is what lights the admin "Documents
// to review" (NeedsAttention) queue — the existing ops-notify surface — so no
// separate notification write is needed here.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. This
// function emits no merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { merchantDocArrived } from "../_shared/merchantDocArrived.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { document_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const documentId = payload.document_id;
  if (!documentId) return json({ error: "document_id is required" }, 400);

  const db = serviceClient();

  // --- Auth: a signed-in user who OWNS the document's customer (or ops staff). ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  // Load the document (service role) + its customer, for the ownership check.
  const { data: doc, error: docErr } = await db
    .from("customer_documents")
    .select("id, customer_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) return json({ error: "document not found" }, 404);

  const { data: customer } = await db
    .from("customers")
    .select("id, user_id")
    .eq("id", doc.customer_id as string)
    .maybeSingle();
  if (!customer) return json({ error: "customer not found" }, 404);

  const isOwner = (customer.user_id as string | null) === caller.id;
  let isStaff = false;
  if (!isOwner) {
    const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
    isStaff = staff === true;
  }
  if (!isOwner && !isStaff) return json({ error: "Forbidden" }, 403);

  // --- The one definition of "a merchant document arrived". ---
  // The portal fulfils its own deal_doc_requests row through the
  // mark_doc_request_uploaded RPC *before* calling us, so fulfilment stays OFF
  // here; it is the logged-out lane that has no RPC available to it.
  const result = await merchantDocArrived(db, {
    documentId: doc.id as string,
    customerId: doc.customer_id as string,
    viaPhrase: "the portal",
    loggedBy: isOwner ? caller.id : null,
    ghlSource: "Portal Doc Upload",
  });

  return json({ ok: true, underwrite_triggered: result.underwrite_triggered, ghl: result.ghl });
});
