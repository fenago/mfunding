// ghl-docs-status — live "docs back from the merchant" status for the playbook.
//
// Given a GHL contact id, returns:
//  - documents: every Documents & Contracts doc where this contact is a recipient
//    (name, status, signed?, when) — so the playbook can show "Application ✅ signed"
//  - uploads: files sitting on the contact's FILE_UPLOAD custom fields (from the
//    Bank Statements & Documents Upload form), with friendly field names.
//
// Read-only; invoked from the app (authenticated staff).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, listContactFileUploads } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { ghl_contact_id } = await req.json().catch(() => ({}));
    if (!ghl_contact_id) return json({ error: "ghl_contact_id is required" }, 400);

    const db = serviceClient();

    // --- Auth: staff (closer/admin/super_admin), OR the merchant asking about
    //     their OWN GHL contact. verify_jwt = true gates the gateway; this adds
    //     the role/ownership check. ---
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    const isStaff = !!role && ["closer", "admin", "super_admin"].includes(role);
    if (!isStaff) {
      const { data: owned } = await db
        .from("customers").select("id")
        .eq("ghl_contact_id", ghl_contact_id)
        .eq("user_id", caller.id)
        .limit(1).maybeSingle();
      if (!owned) return json({ error: "Forbidden" }, 403);
    }

    const cfg = await getGhlConfig(db);

    // 1) E-sign documents for this contact.
    const docsRes = await ghlFetch<{ documents?: Record<string, unknown>[] }>(
      cfg, "GET", `/proposals/document?locationId=${cfg.locationId}&limit=20`,
    );
    const documentsError = docsRes.ok ? null : `docs list failed (${docsRes.status}): ${docsRes.error ?? ""}`;
    const documents = (docsRes.data?.documents ?? [])
      .filter((d) => {
        const recips = (d.recipients as Record<string, unknown>[] | undefined) ?? [];
        return recips.some((r) => r.id === ghl_contact_id);
      })
      .map((d) => {
        const r = ((d.recipients as Record<string, unknown>[]) ?? [])[0] ?? {};
        const id = (d._id ?? d.id) as string | undefined;
        return {
          name: d.name ?? "Document",
          status: d.status ?? "sent",
          signed: r.hasCompleted === true,
          updatedAt: d.updatedAt ?? null,
          // Public viewer link — for completed docs this shows the signed version.
          url: id ? `https://link.vibereach.io/documents/v1/${id}` : null,
        };
      });

    // 2) Uploaded files on the contact's FILE_UPLOAD custom fields (friendly
    //    field names → files). Shared with submit-to-funders so both rails agree.
    const uploads = await listContactFileUploads(cfg, ghl_contact_id);

    return json({ ok: true, documents, uploads, documents_error: documentsError });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
