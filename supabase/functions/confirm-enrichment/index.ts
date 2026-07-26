// confirm-enrichment — the closer/admin CONFIRMS the "found online (unverified)"
// research and it lands on the merchant's real record.
//
// POST { enrichmentId, fields: string[] }
//   fields ⊆ ["street","city","state","zip","phone","website","ein"]
//   → writes each confirmed value onto public.customers, stamps the research row
//     verified_at/verified_by/verified_fields, logs a customer_interactions note
//     (old → new for each field), and pushes the same fields to the merchant's
//     GHL contact. Returns exactly what was written where.
//
// TRUTH DISCIPLINE: this is the one place research web-data is allowed to mutate a
// merchant record, and only on an explicit human confirm. A no_match run has no
// values worth trusting → we refuse it. The GHL push is best-effort in the sense
// that a GHL failure never rolls back the Supabase write, BUT the failure is
// returned LOUDLY (ghl_error) so the card can surface it — never a silent success.
//
// Field-by-field rules (owner spec):
//   street/city/state/zip → customers.address_street/_city/_state/_zip (overwrite)
//   phone  → customers.phone ONLY if empty; otherwise appended to
//            customers.additional_phones (never clobber a known-good number)
//   website→ customers has NO website column, so it is NOT stored on the record;
//            it is pushed to the GHL contact's website field and reported as such
//   ein    → customers.ein (overwrite) — Supabase only, no standard GHL field
//
// Auth mirrors enrich-business/sync-lead-to-ghl: verify_jwt = true at the gateway
// PLUS an in-code role check (closer/admin/super_admin); a closer may only confirm
// research on a deal assigned to them (closer_owns_deal RPC).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, ghlErrorMessage,
} from "../_shared/ghl.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

const last10 = (phone: string | null | undefined): string | null => {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

// The only fields a confirm may touch. Each maps a research found_* value to a
// customers column (null = no record column, handled specially) and a GHL key.
type FieldKey = "street" | "city" | "state" | "zip" | "phone" | "website" | "ein";
const FIELD_SPECS: Record<FieldKey, {
  found: (r: Record<string, unknown>) => string | null;
  customerCol: string | null;   // null → not stored on customers (website)
  ghlKey: string | null;        // null → not pushed to GHL (ein)
  label: string;
}> = {
  street:  { found: (r) => str(r.found_street),  customerCol: "address_street", ghlKey: "address1",   label: "street" },
  city:    { found: (r) => str(r.found_city),    customerCol: "address_city",   ghlKey: "city",       label: "city" },
  state:   { found: (r) => str(r.found_state),   customerCol: "address_state",  ghlKey: "state",      label: "state" },
  zip:     { found: (r) => str(r.found_zip),     customerCol: "address_zip",    ghlKey: "postalCode", label: "ZIP" },
  phone:   { found: (r) => str(r.found_phone),   customerCol: "phone",          ghlKey: "phone",      label: "phone" },
  website: { found: (r) => str(r.found_website), customerCol: null,             ghlKey: "website",    label: "website" },
  ein:     { found: (r) => str(r.found_ein),     customerCol: "ein",            ghlKey: null,         label: "EIN" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { enrichmentId?: string; fields?: unknown };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const enrichmentId = payload.enrichmentId;
  if (!enrichmentId) return json({ error: "enrichmentId is required" }, 400);

  const requested = Array.isArray(payload.fields)
    ? [...new Set(payload.fields.map(String))].filter((f): f is FieldKey => f in FIELD_SPECS)
    : [];
  if (requested.length === 0) return json({ error: "no confirmable fields supplied" }, 400);

  const db = serviceClient();

  // --- Authn/Authz (mirror enrich-business) ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role, display_name, first_name, last_name, email").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  const callerName =
    str(callerProfile?.display_name) ??
    ([str(callerProfile?.first_name), str(callerProfile?.last_name)].filter(Boolean).join(" ") ||
      str(callerProfile?.email) || "staff");

  // --- Load the research row ---
  const { data: row, error: rErr } = await db
    .from("business_enrichment").select("*").eq("id", enrichmentId).maybeSingle();
  if (rErr || !row) return json({ error: `research run not found: ${rErr?.message ?? enrichmentId}` }, 404);
  if (row.status !== "completed") return json({ error: "this research run hasn't completed yet" }, 409);
  if (row.match_verdict === "no_match") {
    return json({ error: "This run found no matching business — there is nothing safe to confirm." }, 422);
  }
  const dealId = row.deal_id as string | null;
  const customerId = row.customer_id as string | null;
  if (!customerId) return json({ error: "this research run isn't linked to a merchant" }, 422);

  if (callerRole === "closer") {
    if (!dealId) return json({ error: "Forbidden — this research isn't tied to a deal you own" }, 403);
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  // --- Load the merchant ---
  const { data: customer, error: cErr } = await db
    .from("customers")
    .select("id, phone, additional_phones, address_street, address_city, address_state, address_zip, ein, ghl_contact_id")
    .eq("id", customerId).maybeSingle();
  if (cErr || !customer) return json({ error: `merchant not found: ${cErr?.message ?? customerId}` }, 404);

  // ── Build the customers patch + the audit diff, applying the per-field rules ──
  const patch: Record<string, unknown> = {};
  const applied: Array<{ field: FieldKey; label: string; value: string; where: string; from: string | null }> = [];
  const skipped: Array<{ field: FieldKey; label: string; reason: string }> = [];
  const ghlPush: Record<string, unknown> = {};
  let additionalPhones = Array.isArray(customer.additional_phones)
    ? [...(customer.additional_phones as string[])] : [];

  for (const key of requested) {
    const spec = FIELD_SPECS[key];
    const value = spec.found(row as Record<string, unknown>);
    if (!value) { skipped.push({ field: key, label: spec.label, reason: "nothing found for this field" }); continue; }

    if (key === "phone") {
      const existing = str(customer.phone);
      if (!existing) {
        // No known number → this becomes the primary phone (and goes to GHL).
        patch.phone = value;
        applied.push({ field: key, label: spec.label, value, where: "customers.phone", from: existing });
        ghlPush.phone = value;
      } else if (last10(existing) === last10(value)) {
        skipped.push({ field: key, label: spec.label, reason: "same as the number already on file" });
      } else if (additionalPhones.some((p) => last10(p) === last10(value))) {
        skipped.push({ field: key, label: spec.label, reason: "already saved as an additional phone" });
      } else {
        // Known good primary stays; the web number is added, not substituted.
        additionalPhones = [...additionalPhones, value];
        patch.additional_phones = additionalPhones;
        applied.push({ field: key, label: spec.label, value, where: "customers.additional_phones", from: existing });
        // Do NOT push to GHL primary phone — we didn't make it primary here.
      }
      continue;
    }

    if (key === "website") {
      // No customers column for website → GHL contact only, reported honestly.
      ghlPush.website = value;
      applied.push({ field: key, label: spec.label, value, where: "GHL contact only (no record field)", from: null });
      continue;
    }

    // Straightforward overwrite columns (street/city/state/zip/ein).
    const col = spec.customerCol!;
    const from = str((customer as Record<string, unknown>)[col]);
    patch[col] = value;
    applied.push({ field: key, label: spec.label, value, where: `customers.${col}`, from });
    if (spec.ghlKey) ghlPush[spec.ghlKey] = value;
  }

  if (applied.length === 0) {
    return json({ error: "Nothing to apply — every requested field was empty or already on file.", skipped }, 422);
  }

  // ── Write customers (the source of truth) ──
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error: updErr } = await db.from("customers").update(patch).eq("id", customerId);
    if (updErr) return json({ error: `saving to the merchant record failed: ${updErr.message}` }, 500);
  }

  // ── Stamp verification on the research row (merge field keys across confirms) ──
  const priorFields: string[] = Array.isArray(row.verified_fields) ? (row.verified_fields as string[]) : [];
  const mergedFields = [...new Set([...priorFields, ...applied.map((a) => a.field)])];
  const nowIso = new Date().toISOString();
  const { error: vErr } = await db.from("business_enrichment")
    .update({ verified_at: nowIso, verified_by: caller.id, verified_fields: mergedFields })
    .eq("id", enrichmentId);
  if (vErr) console.error("[confirm-enrichment] verify stamp failed:", vErr.message);

  // ── Audit note (old → new for each applied field) — house rule: check .error ──
  const diffLine = applied
    .map((a) => `${a.label}: '${a.from ?? ""}' → '${a.value}' (${a.where})`)
    .join("; ");
  const { error: noteErr } = await db.from("customer_interactions").insert({
    customer_id: customerId,
    interaction_type: "note",
    subject: "Business research confirmed",
    content: `${callerName} confirmed research findings — ${diffLine}.` +
      (skipped.length ? ` Skipped: ${skipped.map((s) => `${s.label} (${s.reason})`).join(", ")}.` : ""),
    logged_by: caller.id,
  });
  if (noteErr) console.error("[confirm-enrichment] audit note failed:", noteErr.message);

  // ── GHL sync — push the same confirmed fields to the merchant's contact ──
  let ghlSynced = false;
  let ghlError: string | null = null;
  const ghlFieldKeys = Object.keys(ghlPush);
  if (ghlFieldKeys.length === 0) {
    // Nothing GHL-mappable was applied (e.g. only EIN, or only an additional phone).
    ghlSynced = true;
  } else if (!customer.ghl_contact_id) {
    ghlError = "No GHL contact is linked to this merchant yet, so nothing was pushed to GHL. The values are saved on the record.";
  } else {
    try {
      const cfg = await getGhlConfig(db);
      const contactId = customer.ghl_contact_id as string;
      let res = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, ghlPush);
      if (!res.ok && ghlPush.phone !== undefined) {
        // A phone uniqueness collision is non-fatal (another contact squats on it):
        // retry without the phone so the address/website still land in GHL.
        const parsed = (() => { try { return JSON.parse(res.error ?? "{}"); } catch { return {}; } })() as
          { meta?: { matchingField?: string } };
        if (parsed?.meta?.matchingField === "phone") {
          const { phone: _drop, ...noPhone } = ghlPush;
          if (Object.keys(noPhone).length > 0) {
            res = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, noPhone);
            if (res.ok) {
              ghlSynced = true;
              ghlError = "Synced the address to GHL, but NOT the phone — that number is already used by another GHL contact.";
            }
          } else {
            ghlError = "The phone number is already used by another GHL contact, so it was not pushed to GHL.";
          }
        }
      }
      if (res.ok) ghlSynced = true;
      else if (!ghlError) ghlError = `GHL update failed: ${ghlErrorMessage(res.error)}`;
    } catch (e) {
      ghlError = `GHL sync error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return json({
    ok: true,
    enrichment_id: enrichmentId,
    verified_at: nowIso,
    verified_by: caller.id,
    verified_by_name: callerName,
    verified_fields: mergedFields,
    applied,
    skipped,
    ghl_synced: ghlSynced,
    ghl_fields: ghlFieldKeys,
    ghl_error: ghlError,
  });
});
