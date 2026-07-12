// merchant-doc-uploaded — cross-system side effects after a MERCHANT uploads a
// document from the portal. Closes audit finding #24 (portal bank-statement
// uploads never triggered the underwriter and left no trail).
//
// Why an edge function: a merchant (profiles.role = 'user') CANNOT insert into
// activity_log (no RLS policy) and CANNOT call underwrite-deal (its in-code role
// check rejects non-staff). Both must happen server-side. This mirrors the
// server-side pattern the GHL webhook already uses when statements arrive that way.
//
// POST body: { document_id }   (the customer_documents row the merchant just created)
//
// Flow:
//   1. Auth (verify_jwt = true): resolve the caller; they must OWN the document's
//      customer (customers.user_id = caller) — ops staff are allowed through too.
//   2. Write an activity_log 'document_uploaded' row against the customer.
//   3. If it's a bank statement, re-run the AI underwriter (auto mode, service
//      role) against the customer's most recent deal — the SAME path form/GHL
//      uploads use. Deduped server-side by docs_hash, so double-fires are cheap.
//
// The pending customer_documents row itself is what lights the admin "Documents to
// review" (NeedsAttention) queue — the existing ops-notify surface — so no separate
// notification write is needed here.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. This function
// emits no merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fire-and-forget: re-run the AI underwriter for the customer's most recent deal
// when a bank statement lands. Best-effort — never blocks the response. Invoked
// with the service-role key so underwrite-deal treats it as a trusted auto call.
// (Mirror of triggerUnderwriting() in ghl-webhook/index.ts.)
async function triggerUnderwriting(
  db: ReturnType<typeof serviceClient>,
  customerId: string,
): Promise<boolean> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return false;
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!deal?.id) return false;
    await fetch(`${url}/functions/v1/underwrite-deal`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ dealId: deal.id, mode: "auto" }),
    });
    return true;
  } catch {
    return false; // best-effort — underwriting must never break the upload flow
  }
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

  // Load the document (service role) + its customer.
  const { data: doc, error: docErr } = await db
    .from("customer_documents")
    .select("id, customer_id, document_type, filename")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) return json({ error: "document not found" }, 404);

  const { data: customer } = await db
    .from("customers")
    .select("id, user_id, business_name")
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

  const docType = (doc.document_type as string) ?? "other";
  const filename = (doc.filename as string) ?? "document";

  // --- 1) Activity trail (merchant can't write activity_log directly). ---
  // interaction_type 'document_uploaded' is an allowed activity_log value;
  // entity_type 'customer' is allowed. Best-effort — never fail the request on it.
  const { error: logErr } = await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: doc.customer_id,
    interaction_type: "document_uploaded",
    subject: `Merchant uploaded ${docType.replace(/_/g, " ")}`,
    content: `Merchant uploaded "${filename}" (${docType}) via the portal.`,
    logged_by: isOwner ? caller.id : null,
  });
  if (logErr) console.warn("[merchant-doc-uploaded] activity_log insert failed:", logErr.message);

  // --- 2) Bank statement → AI underwriter (auto, same path as form/GHL uploads). ---
  let underwriteTriggered = false;
  if (docType === "bank_statement") {
    underwriteTriggered = await triggerUnderwriting(db, doc.customer_id as string);
  }

  return json({ ok: true, underwrite_triggered: underwriteTriggered });
});
