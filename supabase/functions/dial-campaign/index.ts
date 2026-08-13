// dial-campaign — create and wire DIAL CAMPAIGNS. The tag is the join key.
//
// A dial campaign is one TAG bound to one campaigns row, and that tag is what
// joins three systems:
//   our app  — lead-push-ghl writes it into lead_records.push_tags
//   GHL      — the tag lands on the contact
//   HP       — the HP campaign's "Tags to Dial" targets it, so the dialer calls
//              exactly the leads this campaign pushed
// and deals.campaign_id then carries it into the existing KPI model.
//
// DIAL CAMPAIGNS ARE CAMPAIGNS. They are rows in public.campaigns, so the
// existing code-minting trigger, CampaignsPage and every KPI join apply to them
// unchanged. Nothing here forks a parallel entity.
//
// WHAT THIS TOUCHES IN GHL: exactly one thing — it CREATES THE TAG (an empty
// location-level label). That is not a contact push: no contact is created,
// updated, messaged or added to a dial list. It exists because HP's tag picker
// reads a cached copy of GHL's tag list, so a tag that has never existed in GHL
// cannot be selected as a campaign's "Tags to Dial". Explicitly authorized by
// the main session; the no-contact-push policy is otherwise fully in force.
//
// WHAT IT DOES NOT DO: it never creates or edits a HotProspector campaign.
// HP campaign edits made via API silently revert — HP campaigns are UI-only. All
// HP access here is READ-ONLY (FetchAllCampaigns), and hp_campaign_id is linked
// manually because HP does not expose a campaign's tags (see 'hp_campaigns').
//
// AUTH: verify_jwt at the gateway PLUS an in-code admin/super_admin check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, createLocationTag,
} from "../_shared/ghl.ts";
import {
  getHotProspectorConfig, hotProspectorToken, hotProspectorRequest,
} from "../_shared/hotprospector.ts";

/** Dial campaigns reuse the channel value the table already uses for this
 * concept (PH-UCC-2026-001 "PH Setters — UCC Dialing"). Adding a second spelling
 * would split one concept across two values and halve every channel KPI. */
const DIAL_CHANNEL = "outbound_dial";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const clean = (v: unknown): string | null => {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
};

/** The default tag for a campaign: dial-<list>-<mmdd>. The UI may override it;
 * whatever arrives is normalized and validated server-side regardless. */
function defaultTag(label: string): string {
  const mmdd = new Date().toISOString().slice(5, 10).replace("-", "");
  return `dial-${label}-${mmdd}`;
}

/** The checklist the owner works through to make a dial campaign live. These are
 * HP UI steps on purpose — HP campaigns cannot be wired over the API. */
function dialChecklist(tag: string, tagWasCreated: boolean): unknown[] {
  return [
    {
      key: "hp_refresh_meta",
      label: `HotProspector → Refresh Meta (pulls the new "${tag}" tag from GHL into HP's cached picker)`,
      done: false,
      note: tagWasCreated
        ? "Required — the tag was just created in GHL and HP will not see it until Refresh Meta runs."
        : "The tag already existed in GHL; refresh anyway if it is missing from HP's picker.",
    },
    {
      key: "hp_integrations_sync",
      label: `HotProspector → Integrations → Step 2: add tag "${tag}", then Sync Leads`,
      done: false,
    },
    {
      key: "hp_campaign_tags_to_dial",
      label: `HotProspector → campaign → "Tags to Dial" = "${tag}" (UI only — API edits silently revert)`,
      done: false,
    },
    {
      key: "link_hp_campaign",
      label: "Link the HP campaign here (Campaigns → link) so dial stats attribute to this campaign",
      done: false,
    },
  ];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();

  // ── Auth: signed-in admin/super_admin only ──
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
  const role = prof?.role as string | undefined;
  if (!role || !["admin", "super_admin"].includes(role)) {
    return json({ error: "Forbidden — admin only" }, 403);
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* none */ }
  const action = String(payload.action ?? "create");

  try {
    // ── validate_tag: live validation for the UI's tag field ──
    if (action === "validate_tag") {
      const raw = clean(payload.tag) ?? "";
      const { data: norm } = await db.rpc("normalize_dial_tag", { p_raw: raw });
      const { data: problem } = await db.rpc("dial_tag_problem", {
        p_tag: raw, p_campaign_id: clean(payload.campaign_id),
      });
      return json({ ok: true, normalized: norm ?? null, problem: problem ?? null, valid: !problem });
    }

    // ── hp_campaigns: READ-ONLY list for the UI's link picker ──
    // HP returns campaign_id + CampaignTitle and NOTHING ELSE — no "Tags to
    // Dial" — and no per-campaign detail method exists, so the owner links the
    // HP campaign by hand. Verified by probe: FetchCampaign, getCampaignDetail,
    // FetchCampaignDetails and getCampaignSettings all 404.
    if (action === "hp_campaigns") {
      let hpCfg;
      try { hpCfg = await getHotProspectorConfig(db); }
      catch (e) { return json({ error: `HP not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }
      const auth = await hotProspectorToken(hpCfg);
      if (!auth.ok || !auth.token) return json({ error: `HP auth failed: ${auth.error ?? "no token"}` }, 502);
      const res = await hotProspectorRequest(auth.token, "FetchAllCampaigns");
      if (!res.ok) return json({ error: `FetchAllCampaigns failed: HTTP ${res.status}` }, 502);
      // HP wraps its response object in a single-element ARRAY (sometimes — the
      // poller has hit this too, hence its unwrap()). Unwrap the same way rather
      // than trusting one observed shape; reading res.data.result directly
      // returned an empty list against a perfectly healthy account.
      const raw = (Array.isArray(res.data) ? (res.data[0] ?? {}) : (res.data ?? {})) as Record<string, unknown>;
      // An unexpected body must NOT render as "no campaigns". HP also answers 200
      // with an unparseable body when it throttles, which would show the owner an
      // empty picker over a healthy account — the same empty-state-over-real-data
      // failure this project has hit repeatedly. Say what happened instead.
      if (!Array.isArray(raw.result)) {
        console.error("[dial-campaign] FetchAllCampaigns unexpected shape",
          JSON.stringify({ status: res.status, keys: Object.keys(raw), body: JSON.stringify(res.data).slice(0, 400) }));
        return json({
          error: "HotProspector returned an unreadable campaign list (no result array). "
            + "This is usually throttling — HP allows roughly 3 calls a minute. Try again shortly.",
          hp_status: res.status,
          hp_keys: Object.keys(raw),
          hp_message: typeof raw.message === "string" ? raw.message : null,
        }, 502);
      }
      const list = raw.result as Record<string, unknown>[];
      // Which HP campaigns are already claimed, so the UI can grey them out.
      const { data: linked } = await db.from("campaigns")
        .select("id,code,name,hp_campaign_id").not("hp_campaign_id", "is", null);
      const claimed = new Map((linked ?? []).map((c) => [String(c.hp_campaign_id), c]));
      return json({
        ok: true,
        campaigns: list.map((c) => ({
          hp_campaign_id: String(c.campaign_id ?? ""),
          hp_campaign_name: String(c.CampaignTitle ?? ""),
          linked_to: claimed.get(String(c.campaign_id ?? "")) ?? null,
        })),
        note: "HP exposes only campaign_id + CampaignTitle. It does NOT expose a campaign's Tags to Dial, so linking is manual.",
      });
    }

    // ── link_hp: attach an HP campaign to one of ours ──
    if (action === "link_hp") {
      const campaignId = clean(payload.campaign_id);
      if (!campaignId) return json({ error: "campaign_id required" }, 400);
      const hpId = clean(payload.hp_campaign_id);           // null clears the link
      const { data, error } = await db.from("campaigns").update({
        hp_campaign_id: hpId,
        hp_campaign_name: hpId ? clean(payload.hp_campaign_name) : null,
      }).eq("id", campaignId).select("id,code,name,dial_tag,hp_campaign_id,hp_campaign_name").single();
      if (error) return json({ error: `link failed: ${error.message}` }, 500);
      return json({ ok: true, campaign: data });
    }

    // ── set_tag: give an EXISTING campaign a dial tag (or change it) ──────────
    //
    // Needed because a campaign created before dial tags existed can never be
    // pushed into: no tag means nothing to push and nothing for the dialer to
    // target, and `campaigns` writes are super_admin-only so the UI cannot fix it
    // directly. PH-UCC-2026-001 is exactly this case.
    //
    // CHANGING a tag that already has leads pushed under it is REFUSED, not
    // warned about. The old tag stays on those lead_records.push_tags forever, so
    // the campaign's attribution would silently split across two tags and every
    // per-campaign number would quietly under-count. The remedy already exists and
    // is named in the error: re-push the slice with retag:true to carry the new
    // tag onto those leads, then set it here.
    if (action === "set_tag") {
      const campaignId = clean(payload.campaign_id);
      if (!campaignId) return json({ error: "campaign_id required" }, 400);
      const rawTag = clean(payload.tag);
      if (!rawTag) return json({ error: "tag required", field: "tag" }, 400);

      const { data: camp, error: cErr } = await db.from("campaigns")
        .select("id,code,name,dial_tag,setup_checklist").eq("id", campaignId).maybeSingle();
      if (cErr || !camp) return json({ error: "campaign not found" }, 404);

      const { data: normTag } = await db.rpc("normalize_dial_tag", { p_raw: rawTag });
      const tag = normTag as string | null;
      // p_campaign_id excludes THIS campaign, so re-saving its own tag is fine.
      const { data: problem } = await db.rpc("dial_tag_problem", {
        p_tag: rawTag, p_campaign_id: campaignId,
      });
      if (problem) return json({ error: problem, tag, field: "tag" }, 400);
      if (tag === camp.dial_tag) {
        return json({ ok: true, unchanged: true, campaign: camp });
      }

      // Refuse a CHANGE that would split existing attribution.
      if (camp.dial_tag) {
        const { count } = await db.from("lead_records")
          .select("id", { count: "exact", head: true })
          .contains("push_tags", [camp.dial_tag]);
        if ((count ?? 0) > 0) {
          return json({
            error: `${count} lead(s) were already pushed under "${camp.dial_tag}". `
              + `Changing the tag now would split this campaign's attribution across two tags. `
              + `Re-push that slice with retag:true carrying "${tag}" first, then change it here.`,
            field: "tag", leads_under_old_tag: count, old_tag: camp.dial_tag,
          }, 409);
        }
      }

      // Create the tag in GHL BEFORE writing the column, same order as create: a
      // GHL refusal must not leave a campaign pointing at a tag that doesn't exist.
      let cfg;
      try { cfg = await getGhlConfig(db); }
      catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }
      const tagRes = await createLocationTag(cfg, tag!);
      if (!tagRes.ok) return json({ error: `GHL tag create failed: ${tagRes.error}`, tag }, 502);

      // The checklist labels EMBED the tag, and a tag change invalidates the HP
      // wiring (HP is still pointed at the old tag), so the HP steps are re-seeded
      // as not-done rather than left claiming work that no longer applies.
      const { data: updated, error: uErr } = await db.from("campaigns").update({
        dial_tag: tag,
        setup_checklist: dialChecklist(tag!, tagRes.created),
      }).eq("id", campaignId)
        .select("id,code,name,channel,status,dial_tag,setup_checklist").single();
      if (uErr) {
        if (uErr.message.includes("campaigns_dial_tag_uidx")) {
          return json({ error: `${tag} was claimed by another campaign moments ago`, tag, field: "tag" }, 409);
        }
        return json({ error: `tag update failed: ${uErr.message}` }, 500);
      }
      return json({
        ok: true,
        campaign: updated,
        ghl_tag: { name: tag, created: tagRes.created },
        previous_tag: camp.dial_tag,
        checklist_reseeded: true,
        next: "The HP checklist was reset — the dialer is still pointed at the old tag until you rework it.",
      });
    }

    // ── create ──
    if (action === "create") {
      const name = clean(payload.name);
      if (!name) return json({ error: "name is required" }, 400);

      const rawTag = clean(payload.tag) ?? defaultTag(
        (clean(payload.list_label) ?? name).slice(0, 24),
      );
      const { data: normTag, error: nErr } = await db.rpc("normalize_dial_tag", { p_raw: rawTag });
      if (nErr) return json({ error: `tag normalize failed: ${nErr.message}` }, 500);
      const tag = normTag as string | null;
      const { data: problem, error: pErr } = await db.rpc("dial_tag_problem", {
        p_tag: rawTag, p_campaign_id: null,
      });
      if (pErr) return json({ error: `tag validation failed: ${pErr.message}` }, 500);
      if (problem) return json({ error: problem, tag, field: "tag" }, 400);

      // ── Create the TAG in GHL first ──
      // Deliberately BEFORE the campaign row: if GHL refuses, we have not left a
      // campaign behind whose tag does not exist in the system it must join to.
      let cfg;
      try { cfg = await getGhlConfig(db); }
      catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }
      const tagRes = await createLocationTag(cfg, tag!);
      if (!tagRes.ok) return json({ error: `GHL tag create failed: ${tagRes.error}`, tag }, 502);

      const { data: created, error: cErr } = await db.from("campaigns").insert({
        name,
        channel: DIAL_CHANNEL,
        status: clean(payload.status) ?? "planned",
        partner: clean(payload.partner) ?? "House",
        dial_tag: tag,
        dial_source: (payload.dial_source as Record<string, unknown>) ?? {},
        market: clean(payload.market),
        notes: clean(payload.notes),
        budget: Number(payload.budget) > 0 ? Number(payload.budget) : 0,
        leads_target: Number(payload.leads_target) > 0 ? Number(payload.leads_target) : null,
        start_date: clean(payload.start_date),
        setup_checklist: dialChecklist(tag!, tagRes.created),
        created_by: caller.id,
      }).select("id,code,name,channel,status,dial_tag,dial_source,setup_checklist,created_at").single();
      if (cErr) {
        // The unique index is the last line of defence against a race between
        // two creates that both passed validation.
        if (cErr.message.includes("campaigns_dial_tag_uidx")) {
          return json({ error: `${tag} was claimed by another campaign moments ago`, tag, field: "tag" }, 409);
        }
        return json({ error: `campaign create failed: ${cErr.message}` }, 500);
      }

      return json({
        ok: true,
        campaign: created,
        ghl_tag: { name: tag, created: tagRes.created },
        next: "Work the setup_checklist: Refresh Meta in HP, add the tag in Integrations Step 2 + Sync Leads, set the HP campaign's Tags to Dial, then link the HP campaign here.",
      });
    }

    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dial-campaign] FAILED", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
