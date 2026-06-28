// partner-signup — PUBLIC intake for the referral partner program.
// Inserts a referral_partner (status 'inactive' = pending review) via service role,
// so no anon RLS on referral_partners is needed. Deployed with verify_jwt = false.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const VALID_TYPES = ["cpa", "bookkeeper", "real_estate_agent", "equipment_vendor", "attorney", "other"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  if (!name || !email) return json({ error: "name and email are required" }, 400);

  const partner_type = VALID_TYPES.includes(String(body.partner_type)) ? String(body.partner_type) : "other";

  const db = serviceClient();
  const { error } = await db.from("referral_partners").insert({
    name,
    email,
    company: (body.company as string) || null,
    phone: (body.phone as string) || null,
    partner_type,
    status: "inactive", // pending review
    notes: (body.notes as string) || null,
  });
  if (error) return json({ error: `could not submit: ${error.message}` }, 500);

  return json({ ok: true });
});
