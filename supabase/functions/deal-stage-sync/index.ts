// deal-stage-sync — ONE pipeline position, whichever system moved it.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// Owner ruling 2026-09-14: "if they move it, regardless of where it's moved
// from, we need it to be the same in the pipeline."
//
// GHL → us was already covered: the ghl-webhook stage mirror maps an
// opportunity's stage onto deals.status. The other direction was not. Only ONE
// writer pushed to GHL — updateDealStatus() in the client, via ghl-sync. Every
// other writer of deals.status was silent:
//   • processor_move_to_nurture (fixed 9/13, but only by patching its one caller)
//   • the processor gate RPCs (processor_log_contact / qa_decision / mark_ready)
//   • the customer_documents "statements landed" trigger
//   • the call mirror's new → contacted advance
//   • any SQL backfill or manual correction
// Patching each caller is how the drift happened in the first place. So the
// guarantee lives in the DATABASE: a trigger on deals.status calls this function
// for every status change, from any writer, forever.
//
// ── LOOP SAFETY ──────────────────────────────────────────────────────────────
// The webhook mirror writes deals.status when GHL moves an opportunity, which
// fires the trigger, which calls this — a potential ping-pong. It terminates in
// ONE hop because we READ the opportunity first and do nothing when it already
// sits on the target stage, which is exactly the case for a GHL-originated
// change. GHL only echoes on a real change, so a no-op ends the cycle. Cost:
// 1 GHL read per status change, 2 when we actually move it.
//
// ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
// It moves the opportunity's STAGE and nothing else. It never creates an
// opportunity, never changes won/lost status, never touches the contact. A deal
// with no ghl_opportunity_id is a no-op success — there is nothing to keep in
// step. Terminal opportunities (won/lost/abandoned) are left alone: their stage
// label is history, and rewriting it would resurrect closed work on the GHL board.
//
// Auth: shared secret only (?secret= / x-ghl-secret vs get_ghl_config()'s
// webhook_secret), same fail-closed gate as ghl-event-hook and dnd-enforce.
// verify_jwt=false at the gateway — the caller is a Postgres trigger.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

/** deals.status → GHL stage id. Mirrors STAGE_BY_STATUS in ghl-sync and the
 *  reverse map in ghl-webhook; those three are the same ladder seen from three
 *  directions and must be changed together. */
const MCA_STAGE: Record<string, string> = {
  new: "d60d563a-9904-423f-9a8e-0d0df0b12976",
  contacted: "bc68ac6f-d45d-4d56-b1c8-c10a7ec4fdf7",
  qualifying: "27960f79-0b08-48ac-8fee-f4a9bf7748e3",
  application_sent: "2071ceb6-b0cf-4700-b57b-f8a3ef4b15bf",
  docs_collected: "c49fa9f8-a155-4d14-a597-2b23fd937b32",
  bank_statements: "72d926b3-ee88-4ee5-8ca2-ddb7071b2fc5",
  submitted_to_funder: "47d3f297-bf23-40a3-8e2b-48fa6c04e809",
  offer_received: "5881c6a8-a84a-4753-be7f-6b8cd3f7d5be",
  offer_presented: "718d76bc-58c9-4913-a68d-e0345ed0b515",
  offer_accepted: "7e3cfb93-8e6e-428c-be99-9dfc77f300e6",
  funded: "69995f02-4f20-41b9-8206-bbaaf7060c10",
  renewal_eligible: "bfd0515e-7dfd-4527-8460-1edef442311a",
  // declined and dead have no dedicated GHL stage; like ghl-sync they park on
  // Nurture / Re-engage. The webhook's PARKED_STATUSES guard stops that echoing
  // back as `nurture`.
  nurture: "d4c4ce2d-75af-4766-82cf-c3ff56f0137b",
  declined: "d4c4ce2d-75af-4766-82cf-c3ff56f0137b",
  dead: "d4c4ce2d-75af-4766-82cf-c3ff56f0137b",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth (the ONLY non-2xx path) ──
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
  if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

  const actions: Record<string, unknown> = {};
  let ok = false;
  let contactId: string | null = null;

  const finish = async (status = 200) => {
    const { error } = await db.from("ghl_event_hook_log").insert({
      type: "deal_stage_sync", contact_id: contactId, actions, ok,
    });
    if (error) console.error("[deal-stage-sync] receipt log insert failed:", error.message);
    return json({ ok, ...actions }, status);
  };

  try {
    let body: { deal_id?: string } = {};
    try { body = await req.json(); } catch { /* fall through */ }
    const dealId = (body.deal_id ?? "").trim();
    if (!dealId) {
      actions.reason = "no deal_id";
      return await finish();
    }

    const { data: deal, error: dErr } = await db
      .from("deals")
      .select("id, deal_number, status, deal_type, ghl_opportunity_id, ghl_contact_id")
      .eq("id", dealId).maybeSingle();
    if (dErr) { actions.reason = `deal lookup failed: ${dErr.message}`; return await finish(); }
    if (!deal) { actions.reason = "deal not found"; return await finish(); }

    contactId = (deal.ghl_contact_id as string | null) ?? null;
    actions.deal_number = deal.deal_number;
    actions.status = deal.status;

    const oppId = (deal.ghl_opportunity_id as string | null) ?? "";
    if (!oppId) {
      // Nothing to keep in step. Not a failure — plenty of deals have no
      // opportunity yet, and inventing one here would be a side effect nobody asked for.
      ok = true;
      actions.reason = "no ghl_opportunity_id — nothing to sync";
      return await finish();
    }

    // VCF deals live in a different pipeline with different stage ids; this
    // function only knows the MCA ladder. Say so rather than guessing a stage.
    if ((deal.deal_type as string) !== "mca") {
      ok = true;
      actions.reason = `deal_type ${deal.deal_type} — MCA ladder only, skipped`;
      return await finish();
    }

    const target = MCA_STAGE[String(deal.status)];
    if (!target) {
      actions.reason = `no GHL stage mapped for status "${deal.status}"`;
      return await finish();
    }

    const cfg = await getGhlConfig(db);

    const od = await ghlFetch<{ opportunity?: { id: string; status: string; pipelineStageId: string } }>(
      cfg, "GET", `/opportunities/${oppId}`,
    );
    if (!od.ok || !od.data?.opportunity) {
      actions.reason = `opportunity unreadable (${od.status}) — NOT assumed missing`;
      return await finish();
    }
    const opp = od.data.opportunity;

    // LOOP BREAKER — already where we want it (the normal case when GHL is the
    // one that moved it and the webhook mirror just wrote our row).
    if (opp.pipelineStageId === target) {
      ok = true;
      actions.reason = "already on target stage — no write (loop breaker)";
      return await finish();
    }

    // A closed opportunity's stage is history. Moving it would put finished work
    // back on the GHL board.
    if (opp.status !== "open") {
      ok = true;
      actions.reason = `opportunity is ${opp.status} in GHL — stage left as historical`;
      actions.skipped_stage_move = true;
      return await finish();
    }

    const pr = await ghlFetch(cfg, "PUT", `/opportunities/${oppId}`, { pipelineStageId: target });
    actions.moved = pr.ok;
    actions.from_stage = opp.pipelineStageId;
    actions.to_stage = target;
    if (!pr.ok) actions.error = `${pr.status}: ${pr.error ?? "unknown"}`;
    ok = pr.ok;
    return await finish();
  } catch (e) {
    actions.reason = e instanceof Error ? e.message : String(e);
    return await finish();
  }
});
