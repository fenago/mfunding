// send-app-link — JSON API behind the setter's one-press "Send Application" control.
//
// WHY JSON (not an HTML page): Supabase's functions gateway force-overrides the
// response Content-Type to text/plain + nosniff on *.supabase.co, so an edge function
// CANNOT serve a browser-rendered HTML page. The confirm PAGE therefore lives in the
// React app (route /send-app on mfunding.net, which CAN render HTML); this function is
// its JSON backend. The two-step (peek → explicit send) still guarantees a link
// preview / prefetch / misclick can never fire a real contract: GET only PEEKS, and
// the send happens only on the explicit POST.
//
// ENDPOINTS (token-gated; the token is the GET-safe SEND_APP_LINK_TOKEN, NEVER the
// master GHL_SEND_APP_SECRET):
//   GET  ?c=<contactId>&k=<token>  → { ok, business, email }        (peek — no send)
//   POST ?c=<contactId>&k=<token>  → runs the shared 04B PREFILL send → full result
//
// The contact id + token may also arrive on the HotProspector-appended path
// (/k/<token>/…/contacts/detail/<id>) so the same function works if the HP
// "Gohighlevel Custom Link" base is ever pointed straight here.
//
// Send flow (email gate, completeness gate, deliverability, enroll 04B, verify) is the
// SINGLE source of truth in ../_shared/application-fields.ts, shared with
// ghl-send-application. Never forked.
//
// AUTH: verify_jwt = false; gate is the link token in-code.
// Compliance: MCA = purchase of future receivables, NOT a loan.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClient, getGhlConfig } from "../_shared/ghl.ts";
import { peekContact, sendPrefillApplication } from "../_shared/application-fields.ts";

// CORS: called from the React app (mfunding.net) via fetch. Allow GET+POST.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const db = serviceClient();

  // c + k may arrive on the query, in the POST body, or on the HP-appended path.
  const path = url.pathname;
  const pathTok = path.match(/\/k\/([^/]+)/)?.[1] ?? "";
  const pathContact = path.match(/\/contacts\/detail\/([^/?#]+)/)?.[1] ?? "";
  let c = url.searchParams.get("c") || pathContact || "";
  let k = url.searchParams.get("k") || pathTok || "";
  const isPost = req.method === "POST";
  if (isPost) {
    // Accept JSON or form-encoded bodies.
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const b = await req.json() as Record<string, unknown>;
        c = (b.c as string) || (b.contactId as string) || c;
        k = (b.k as string) || (b.token as string) || k;
      } else {
        const form = await req.formData();
        c = (form.get("c") as string) || c;
        k = (form.get("k") as string) || k;
      }
    } catch { /* fall back to query/path */ }
  }

  // ── TOKEN GATE — link token ONLY (never the master GHL_SEND_APP_SECRET). ──
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.send_app_link_token as string | undefined) ?? "";
  if (!expected || !k || k !== expected) {
    return json({ ok: false, error: "This link is invalid or expired. Ask an admin for a fresh Send Application link. Nothing was sent." }, 403);
  }
  if (!c) return json({ ok: false, error: "No contact id on this link. Nothing was sent." }, 400);

  // ── GHL config from the vault. ──
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  try { cfg = await getGhlConfig(db); } catch { cfg = null; }
  if (!cfg) return json({ ok: false, error: "Couldn't reach the CRM. Try again in a moment." }, 502);

  // ── GET → PEEK (never sends). Lets the confirm page show the merchant name. ──
  if (!isPost) {
    const p = await peekContact(cfg, c);
    return json({ ok: p.ok, business: p.business, email: p.email, contactId: c, error: p.ok ? undefined : `Couldn't load the contact (${p.error}).` }, p.ok ? 200 : 502);
  }

  // ── POST → RUN THE SEND (shared single-source orchestration). ──
  const r = await sendPrefillApplication(cfg, db, c);
  const { status, ...bodyOut } = r;
  return json(bodyOut, status);
});
