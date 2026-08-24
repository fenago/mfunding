// wavv-disposition-sync — turn WAVV call dispositions into opportunity moves.
//
// WHY. Setters disposition every call in the WAVV dialer; WAVV stamps the
// outcome onto the GHL contact as a `wavv-*` tag (verified live 2026-08-17:
// wavv-not-interested / wavv-bad-number / wavv-do-not-contact / wavv-no-answer /
// wavv-left-voicemail / wavv-none / wavv-canceled / wavv-call-blocked). The
// owner wants the Opportunities board to reflect those outcomes automatically.
// GHL's public API cannot CREATE workflows, and the workflow-builder UI resists
// automation — so this function IS the automation: a small tag-drain that maps
// dispositions onto the contact's MCA opportunity.
//
// ── DRAIN PATTERN — COST SCALES WITH NEW DISPOSITIONS, NOT THE BOOK ─────────
// After a contact is processed its wavv-* tag is REMOVED (DELETE /contacts/
// {id}/tags), so it drops out of the search filter. Each run therefore touches
// only calls dispositioned since the last run. This is the ledger-approved
// shape: NOT per-record polling. Standing cost ≈ one search per mapped tag per
// run (6 calls/10min ≈ 900/day) + ~3 calls per newly dispositioned contact.
// The disposition itself is not lost by removing the tag: WAVV keeps it in its
// own log, and the opportunity's stage/status now carries the outcome.
//
// ── SAFETY RAILS ────────────────────────────────────────────────────────────
// • NEVER moves any opportunity INTO New Lead (the MCA 01 email-gate stage).
// • Idempotent: skips opps already at the target stage/status.
// • Quota floor: reads x-ratelimit-daily-remaining off every response via
//   ghlFetch's rate info; PARKS below the floor. UNREADABLE IS NOT PLENTY —
//   ghlFetch surfaces the header; if it can't be read for a whole run we stop
//   after the current page rather than assume headroom.
// • wavv-do-not-contact ⇒ contact.dnd = true FIRST (the durable TCPA
//   suppression GHL actually enforces), then the opp is lost.
//
// MAPPING (stage ids are the live MFunding MCA Pipeline values; the MAPPING
// array below is the single source of truth — owner "option A" ruling 8/17):
//   wavv-not-interested       → status lost  (WAVV natively losses it at
//                                             disposition time; ours is a backstop)
//   wavv-bad-number           → status lost
//   wavv-do-not-contact       → DND + status lost
//   wavv-full-app-statements  → stage  Docs Collected   (ladder rung 1)
//   wavv-full-application     → stage  Application Sent (ladder rung 2)
//   wavv-appointment-set      → stage  Qualifying       (ladder rung 3)
//   wavv-interested           → stage  Qualifying (legacy tag from before the
//                               8/22 rename of Interested → Full Application)
//   wavv-callback             → stage  Contacted
//   no-answer / left-voicemail / none / canceled / call-blocked → no action
//   (lead stays in New Lead for redial; their tags are left untouched).

import { serviceClient, getGhlConfig, ghlFetch, type GhlConfig } from "../_shared/ghl.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const LOCATION = "t7NmVR4WCy927j4Zon4b";
const MCA_PIPELINE = "bG9ZEh4eP9x60E1CyaMx";
const STAGE_NEW_LEAD = "d60d563a-9904-423f-9a8e-0d0df0b12976"; // never a target
const STAGE_CONTACTED = "bc68ac6f-d45d-4d56-b1c8-c10a7ec4fdf7";
const STAGE_QUALIFYING = "27960f79-0b08-48ac-8fee-f4a9bf7748e3";
const STAGE_APPLICATION_SENT = "2071ceb6-b0cf-4700-b57b-f8a3ef4b15bf";
const STAGE_DOCS_COLLECTED = "c49fa9f8-a155-4d14-a597-2b23fd937b32";
// 10k, not the bulk-job 60k: this drain spends ~3 calls per NEW disposition
// (a few hundred/day on a busy floor), so it cannot meaningfully compete with
// interactive traffic — but the board staying live DURING the dial day is the
// whole point of the feature. The floor still guards true exhaustion.
const DAILY_FLOOR = 10_000;
const PAGE_LIMIT = 50;
const MAX_CONTACTS_PER_RUN = 300; // ~900 GHL calls worst case; a busy floor day

type Action =
  | { kind: "stage"; stageId: string }
  | { kind: "lost" }
  | { kind: "dnc" };

// Tag names verified against the live WAVV Manager → Call Dispositions config
// (owner screenshot 2026-08-17): Interested→wavv-interested, Callback→
// wavv-callback, Appointment Set→wavv-appointment-set, plus the negative set.
//
// OWNER RULING 8/17 ("go with option A"): WAVV natively sets negative-outcome
// opportunities to LOST at disposition time (verified: lastStatusChangeAt ==
// call time). Not-interested cards therefore leave the open board and live
// under the Lost filter — we do NOT resurrect them to Contacted. The lost
// actions below are idempotent BACKSTOPS for calls WAVV misses; the sweep's
// real jobs are the DNC hard-suppression and the POSITIVE forward moves
// (WAVV does not advance stages — we do).
// OWNER RULING 8/22 (outcome-ladder dispositions): the WAVV dispositions
// "None" and "Interested" were repurposed to the two application outcomes —
// "Full App + Statements" (tag wavv-full-app-statements) → Docs Collected and
// "Full Application" (tag wavv-full-application) → Application Sent. The old
// wavv-interested mapping stays as a legacy drain for tags stamped before the
// rename; wavv-none never had an action and still doesn't.
const MAPPING: Array<{ tag: string; action: Action }> = [
  { tag: "wavv-not-interested", action: { kind: "lost" } },
  { tag: "wavv-bad-number", action: { kind: "lost" } },
  { tag: "wavv-do-not-contact", action: { kind: "dnc" } },
  { tag: "wavv-full-app-statements", action: { kind: "stage", stageId: STAGE_DOCS_COLLECTED } },
  { tag: "wavv-full-application", action: { kind: "stage", stageId: STAGE_APPLICATION_SENT } },
  { tag: "wavv-interested", action: { kind: "stage", stageId: STAGE_QUALIFYING } }, // legacy pre-rename tag
  { tag: "wavv-appointment-set", action: { kind: "stage", stageId: STAGE_QUALIFYING } },
  { tag: "wavv-callback", action: { kind: "stage", stageId: STAGE_CONTACTED } },
];

// Compile-time guard against the one unforgivable mistake.
for (const m of MAPPING) {
  if (m.action.kind === "stage" && m.action.stageId === STAGE_NEW_LEAD) {
    throw new Error("MAPPING must never target New Lead — that stage fires MCA 01");
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function webhookSecret(db: SupabaseClient): Promise<string> {
  const { data } = await db.rpc("get_ghl_config");
  return (data?.webhook_secret as string | undefined) ?? "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = serviceClient();
  const url = new URL(req.url);

  // Auth: trusted secret (cron) OR admin/super_admin JWT — same as siblings.
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  if (provided) {
    const expected = await webhookSecret(db);
    if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!prof?.role || !["admin", "super_admin"].includes(prof.role as string)) {
      return json({ error: "Forbidden — admin only" }, 403);
    }
  }

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // Diagnostic: return the raw opportunity lookup exactly as this function sees
  // it (used to chase the moved:0 anomaly on 2026-08-18). No writes.
  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (payload.action === "probe" && typeof payload.contact_id === "string") {
    const od = await ghlFetch<unknown>(
      cfg, "GET", `/opportunities/search?location_id=${LOCATION}&contact_id=${payload.contact_id}`,
    );
    return json({ ok: od.ok, status: od.status, data: od.data, error: od.error });
  }

  // Rate headers ride every ghlFetch response; track the freshest daily figure.
  let dailyRemaining: number | null = null;
  const onRL = () => {};
  const track = <T,>(r: { rate?: { dailyRemaining: number | null } } & T): T => {
    const dr = (r as { rate?: { dailyRemaining: number | null } }).rate?.dailyRemaining;
    if (typeof dr === "number") dailyRemaining = dr;
    return r;
  };
  const floored = () => dailyRemaining !== null && dailyRemaining < DAILY_FLOOR;

  // ── REAL-TIME PUSH: one contact, right now ──────────────────────────────────
  // A GHL workflow ("SETTER disposition → stage") fires the instant WAVV stamps a
  // wavv-* tag and POSTs {action:"push", contact_id, tag}. This does the same
  // move the polling loop does, but for a single contact in ~2s — so the board
  // reflects a disposition in real time and the 10-min poll can drop to a nightly
  // safety net. ~3-4 GHL calls per event; ZERO idle cost (nothing runs unless a
  // real disposition happened). Same MAPPING, same never-target-New-Lead guard.
  // GHL's workflow Webhook action nests the action's Custom Data under a
  // `customData` object and sends the contact id top-level as `contact_id`
  // (it may also appear as contactId / customData.contact_id depending on the
  // GHL version). Read all of these so the push works from a real GHL webhook
  // AND from a hand-crafted {action,contact_id} body.
  const cd = (payload.customData ?? {}) as Record<string, unknown>;
  const pushRequested = payload.action === "push" || cd.action === "push";
  const pushContactId =
    (typeof payload.contact_id === "string" && payload.contact_id) ||
    (typeof payload.contactId === "string" && (payload.contactId as string)) ||
    (typeof cd.contact_id === "string" && (cd.contact_id as string)) ||
    (typeof cd.contactId === "string" && (cd.contactId as string)) ||
    (typeof payload.id === "string" && (payload.id as string)) ||
    "";
  const pushTag =
    (typeof payload.tag === "string" && (payload.tag as string)) ||
    (typeof cd.tag === "string" && (cd.tag as string)) ||
    "";
  if (pushRequested) {
    const contactId = pushContactId;
    if (!contactId) {
      return json({ ok: false, error: "push: no contact id in payload", payload_keys: Object.keys(payload) }, 200);
    }
    let tags: string[] = [];
    if (pushTag && MAPPING.some((m) => m.tag === pushTag)) {
      tags = [pushTag];
    } else {
      // No/other tag supplied — read the contact and act on any mapped tag it has.
      const cr = track(await ghlFetch<{ contact?: { tags?: string[] } }>(
        cfg, "GET", `/contacts/${contactId}`, undefined, onRL));
      const have = new Set(cr.data?.contact?.tags ?? []);
      tags = MAPPING.filter((m) => have.has(m.tag)).map((m) => m.tag);
    }
    if (tags.length === 0) {
      return json({ ok: true, pushed: contactId, matched: 0, note: "no mapped disposition tag on contact" });
    }
    const od = track(await ghlFetch<{ opportunities?: Array<{ id: string; pipelineId: string; pipelineStageId: string; status: string }> }>(
      cfg, "GET", `/opportunities/search?location_id=${LOCATION}&contact_id=${contactId}`, undefined, onRL));
    const opps = (od.data?.opportunities ?? []).filter((o) => o.pipelineId === MCA_PIPELINE);
    const result = { moved: 0, lost: 0, dnd: 0, tag_removed: 0, errors: 0 };
    for (const tag of tags) {
      const action = MAPPING.find((m) => m.tag === tag)!.action;
      let ok = od.ok;
      if (!od.ok) result.errors++;
      if (ok && action.kind === "dnc") {
        const r = track(await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, { dnd: true }, onRL));
        if (r.ok) result.dnd++; else { result.errors++; ok = false; }
      }
      if (ok) {
        for (const o of opps) {
          if (action.kind === "stage") {
            if (o.pipelineStageId === action.stageId) continue;
            const r = track(await ghlFetch(cfg, "PUT", `/opportunities/${o.id}`, { pipelineStageId: action.stageId }, onRL));
            if (r.ok) { result.moved++; o.pipelineStageId = action.stageId; } else { result.errors++; ok = false; }
          } else {
            // "lost" AND "dnc" both close the opp (dnc = DND on the contact,
            // set above, PLUS the opp goes Lost). The polling path uses the same
            // plain else — the push path must too, or do-not-contact leaves the
            // card open (bug caught by the 8/23 do-not-contact end-to-end test).
            if (o.status === "lost") continue;
            const r = track(await ghlFetch(cfg, "PUT", `/opportunities/${o.id}`, { status: "lost" }, onRL));
            if (r.ok) { result.lost++; o.status = "lost"; } else { result.errors++; ok = false; }
          }
        }
      }
      // Remove the tag only on full success — a failure leaves it for the nightly
      // reconcile sweep to retry, exactly like the polling path.
      if (ok) {
        const r = track(await ghlFetch(cfg, "DELETE", `/contacts/${contactId}/tags`, { tags: [tag] }, onRL));
        if (r.ok) result.tag_removed++; else result.errors++;
      }
    }
    return json({ ok: true, pushed: contactId, tags, result, daily_remaining: dailyRemaining });
  }

  const stats: Record<string, { processed: number; moved: number; lost: number; dnd: number; tag_removed: number; errors: number }> = {};
  let touched = 0;
  let parked = false;

  for (const { tag, action } of MAPPING) {
    const s = (stats[tag] = { processed: 0, moved: 0, lost: 0, dnd: 0, tag_removed: 0, errors: 0 });
    // Drain: always page 1 — processed contacts leave the filter via tag removal.
    // A guard caps runaway loops if tag removal ever silently fails.
    let guard = 0;
    while (guard < 10 && touched < MAX_CONTACTS_PER_RUN && !parked) {
      guard++;
      const search = track(await ghlFetch<{ contacts?: Array<{ id: string; dnd?: boolean }>; total?: number }>(
        cfg, "POST", "/contacts/search",
        { locationId: LOCATION, pageLimit: PAGE_LIMIT, filters: [{ field: "tags", operator: "eq", value: tag }] },
        onRL,
      ));
      if (floored()) { parked = true; break; }
      if (!search.ok || !search.data) { s.errors++; break; }
      const contacts = search.data.contacts ?? [];
      if (contacts.length === 0) break;

      let progressed = 0;
      for (const c of contacts) {
        if (touched >= MAX_CONTACTS_PER_RUN || parked) break;
        touched++;
        s.processed++;
        let ok = true;

        // 1) Find the MCA opportunity (bad-number leads may legitimately have none).
        const od = track(await ghlFetch<{ opportunities?: Array<{ id: string; pipelineId: string; pipelineStageId: string; status: string }> }>(
          cfg, "GET", `/opportunities/search?location_id=${LOCATION}&contact_id=${c.id}`, undefined, onRL,
        ));
        if (floored()) { parked = true; break; }
        const opps = (od.data?.opportunities ?? []).filter((o) => o.pipelineId === MCA_PIPELINE);
        if (!od.ok) { s.errors++; ok = false; }

        // 2) DNC: durable suppression on the CONTACT comes first.
        if (ok && action.kind === "dnc" && !c.dnd) {
          const r = track(await ghlFetch(cfg, "PUT", `/contacts/${c.id}`, { dnd: true }, onRL));
          if (r.ok) s.dnd++; else { s.errors++; ok = false; }
          if (floored()) { parked = true; break; }
        }

        // 3) Opportunity move (idempotent).
        if (ok) {
          for (const o of opps) {
            if (action.kind === "stage") {
              if (o.pipelineStageId === action.stageId) continue;
              const r = track(await ghlFetch(cfg, "PUT", `/opportunities/${o.id}`, { pipelineStageId: action.stageId }, onRL));
              if (r.ok) s.moved++; else { s.errors++; ok = false; }
            } else {
              if (o.status === "lost") continue;
              const r = track(await ghlFetch(cfg, "PUT", `/opportunities/${o.id}`, { status: "lost" }, onRL));
              if (r.ok) s.lost++; else { s.errors++; ok = false; }
            }
            if (floored()) { parked = true; break; }
          }
        }

        // 4) Remove the wavv tag ONLY when every step above succeeded — a failed
        //    contact stays in the filter and is retried next run.
        if (ok && !parked) {
          const r = track(await ghlFetch(cfg, "DELETE", `/contacts/${c.id}/tags`, { tags: [tag] }, onRL));
          if (r.ok) { s.tag_removed++; progressed++; } else s.errors++;
          if (floored()) { parked = true; break; }
        }
      }
      // If nothing progressed (all errors), stop this tag rather than spin.
      if (progressed === 0) break;
    }
  }

  const summary = {
    ok: true,
    parked_at_floor: parked,
    daily_remaining: dailyRemaining,
    touched,
    stats,
  };

  // Persist the last run so cron firings (whose HTTP responses vanish into
  // pg_net) leave an inspectable trail — same pattern as wavv_sync.
  await db.from("platform_settings").upsert({
    key: "wavv_disposition_sync",
    value: { ...summary, last_run_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  return json(summary);
});
