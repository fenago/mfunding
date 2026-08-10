// ghl-send-application — the server piece behind a HotProspector setter's
// "Send Application" button. It sends the merchant the FULLY PRE-FILLED 04B e-sign
// application, sourcing every value from the GHL CONTACT ITSELF (HotProspector fields
// ARE the GHL contact custom fields — the setter's freshly-typed values live there).
//
// This is now a THIN webhook wrapper: it authenticates (shared secret), extracts the
// contact id from the GHL webhook body, then delegates the ENTIRE send flow to
// sendPrefillApplication() in ../_shared/application-fields.ts — the SINGLE source of
// truth shared with send-app-link (the setter's one-press link). Neither function
// forks the flow, so they can never drift (a forked copy is how a merchant ends up
// signing a contract full of raw {{merge tags}} — the 2026-07-13 incident).
//
// AUTH: verify_jwt = false. It is called by a GHL WORKFLOW WEBHOOK, not a staff
// session. Auth is an in-code shared secret (?secret= query param OR x-webhook-secret /
// x-ghl-secret header) checked against the vault's GHL_SEND_APP_SECRET (resolved by
// get_ghl_config as `send_app_secret`; GHL_WEBHOOK_SECRET accepted as a fallback).
//
// BUILDING/DEPLOYING THIS SENDS NOTHING. It only fires when POSTed with a valid
// secret + a contact id.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. This function only
// transports data into GHL merge fields; it makes no product claims.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig } from "../_shared/ghl.ts";
import { sendPrefillApplication } from "../_shared/application-fields.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** GHL workflow webhooks are inconsistent about where the contact id lands. Accept
 * the common shapes leniently: flat contactId/contact_id/id, the nested contact
 * object, and GHL's customData bag. */
function extractContactId(body: Record<string, unknown>): string | null {
  const flat =
    body.contactId ?? body.contact_id ?? body.contactID ?? body.id ??
    (body.contact as Record<string, unknown> | undefined)?.id ??
    (body.customData as Record<string, unknown> | undefined)?.contactId ??
    (body.customData as Record<string, unknown> | undefined)?.contact_id;
  return typeof flat === "string" && flat.trim() ? flat.trim() : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── AUTH: shared secret (query param or header) vs the vault secret. ──
  const providedSecret =
    url.searchParams.get("secret") ??
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-ghl-secret") ??
    "";
  if (!providedSecret) return json({ ok: false, error: "Missing secret" }, 401);
  const { data: gc } = await db.rpc("get_ghl_config");
  const expectedSendApp = (gc?.send_app_secret as string | undefined) ?? "";
  const expectedWebhook = (gc?.webhook_secret as string | undefined) ?? "";
  const secretOk =
    (!!expectedSendApp && providedSecret === expectedSendApp) ||
    (!!expectedWebhook && providedSecret === expectedWebhook);
  if (!secretOk) return json({ ok: false, error: "Forbidden — bad secret" }, 403);

  // ── INPUT: the GHL webhook body carrying the contact id. ──
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ ok: false, error: "invalid JSON body" }, 400); }
  const contactId = extractContactId(body);
  if (!contactId) return json({ ok: false, error: "No contact id in webhook body (expected contactId / contact_id / contact.id)" }, 400);

  // ── GHL config (api key + location) from the vault. ──
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let cfgErr: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { cfgErr = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ ok: false, error: `GHL not configured: ${cfgErr ?? "missing credentials"}` }, 502);

  // ── Delegate the entire send to the shared single-source orchestration. ──
  const r = await sendPrefillApplication(cfg, db, contactId);
  const { status, ...bodyOut } = r;
  return json(bodyOut, status);
});
