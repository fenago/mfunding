// ingest-ghl-documents — pull a merchant's GHL-uploaded files into our storage.
//
// Merchants upload bank statements/ID/etc. through the GHL secure-upload link, so
// the files live on the GHL contact — NOT in Supabase. Everything server-side that
// reads `customer_documents` (the AI underwriter above all) was therefore blind to
// them. This function is the bridge; `underwrite-deal` also calls the same shared
// helper inline, so "Run underwriting" self-heals without anyone thinking about it.
//
// POST { dealId } or { customerId }
// Auth: signed-in staff (closer/admin/super_admin) OR a service-role bearer.
// Read-only against GHL — it downloads, it never writes/sends anything.
// Idempotent: keyed on customer_documents.external_ref = the GHL file id.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { ingestGhlDocuments, ghlContactIdForCustomer } from "../_shared/ghlDocs.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return (JSON.parse(atob(b64)) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { dealId?: string; customerId?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!body.dealId && !body.customerId) return json({ error: "dealId or customerId is required" }, 400);

  const db = serviceClient();

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceCall = !!token && (token === serviceKey || jwtRole(token) === "service_role");
  if (!isServiceCall) {
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  try {
    let customerId = body.customerId ?? null;
    if (!customerId && body.dealId) {
      const { data: deal, error } = await db
        .from("deals").select("customer_id").eq("id", body.dealId).maybeSingle();
      if (error || !deal) return json({ error: `deal not found: ${body.dealId}` }, 404);
      customerId = deal.customer_id as string;
    }
    if (!customerId) return json({ error: "could not resolve a customer" }, 404);

    const contactId = await ghlContactIdForCustomer(db, customerId);
    if (!contactId) {
      return json({ error: "This merchant has no linked GoHighLevel contact, so there are no uploads to import." }, 422);
    }

    const result = await ingestGhlDocuments(db, customerId, contactId);
    return json({ ok: true, customerId, ghl_contact_id: contactId, ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
