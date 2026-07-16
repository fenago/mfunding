// classify-document — content-classify a single customer_documents row and
// reconcile its document_type.
//
// WHY: the admin/portal uploaders (DocumentUploader.tsx, DocChecklist.tsx) insert
// customer_documents rows CLIENT-side and cannot call the LLM (the provider keys
// are service-role only). This function is the server-side entry point they
// fire-and-forget after an upload, so a mis-typed document (e.g. a bank statement
// dropped into the wrong slot, or an "other" upload) gets read and corrected before
// the underwriter runs — closing the SIS-Financial hole from the upload side.
//
// POST body: { document_id: string, authority?: 'machine' | 'human' }
//   authority 'human' (default for an ops dropdown pick): a SPECIFIC type is never
//   overwritten — a disagreement is only logged. An explicit "other" is still filled.
//   authority 'machine': content corrects "other" or a confident disagreement.
//
// verify_jwt = true. The caller must be ops staff OR own the document's customer.
// Best-effort by nature: classification never throws to the caller (docClassify),
// and a failure here never affects the already-saved upload.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { reconcileDocumentType } from "../_shared/docClassify.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { document_id?: string; authority?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const documentId = payload.document_id;
  if (!documentId) return json({ error: "document_id is required" }, 400);
  const authority: "machine" | "human" = payload.authority === "machine" ? "machine" : "human";

  const db = serviceClient();

  // --- Auth: a signed-in ops staffer, or the owner of the document's customer. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);

  const { data: doc, error: docErr } = await db
    .from("customer_documents")
    .select("id, customer_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) return json({ error: "document not found" }, 404);

  const { data: staff } = await db.rpc("is_ops_staff", { uid: caller.id });
  let allowed = staff === true;
  if (!allowed) {
    const { data: customer } = await db
      .from("customers")
      .select("user_id")
      .eq("id", doc.customer_id as string)
      .maybeSingle();
    allowed = (customer?.user_id as string | null) === caller.id;
  }
  if (!allowed) return json({ error: "Forbidden" }, 403);

  const outcome = await reconcileDocumentType(db, { documentId, authority });
  return json({ ok: true, ...outcome });
});
