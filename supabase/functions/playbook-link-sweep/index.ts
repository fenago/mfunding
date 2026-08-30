// playbook-link-sweep — make sure EVERY merchant with a deal carries the
// "Open Playbook" deep link on their GHL contact.
//
// The push path stamps playbook_link at birth, so the purchased book is covered.
// Merchants who arrive any OTHER way are not: live transfers, the GHL webhook,
// mca-intake, vcf-intake, bulk imports. Rodney McGuire came in tagged
// live-transfer/synergy, had a deal, and his Open Playbook field was empty —
// a setter looking at him had no way back into the Playbook.
//
// A CRON OVER DEALS, not a hook in each creation path. There are a dozen ways a
// deal gets made and more will be added; hooking every one is a promise nobody
// keeps. Reading deals catches all of them, including the paths that do not
// exist yet.
//
// Self-draining and bounded: it selects only deals whose playbook_link_at is
// NULL, so a healthy run does nothing and costs one query. Idempotent — setting
// the same field value twice is harmless — so a crash mid-run loses nothing.
//
// Auth: cron-only, gated on the GHL webhook secret like the other sweeps.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");
/** The location's "Playbook Link" URL field. */
const PLAYBOOK_FIELD_ID = "Pwk3Rg5uzEMBFZ38O4wP";
/** Per run. Small because the steady state is a handful of new deals an hour;
 * a large backlog just takes a few runs, which is free. */
const MAX_PER_RUN = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceClient();
    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

    const { data: deals, error } = await db
      .from("deals")
      .select("id, ghl_contact_id")
      .not("ghl_contact_id", "is", null)
      .is("playbook_link_at", null)
      .limit(MAX_PER_RUN);
    if (error) return json({ error: error.message }, 500);
    const rows = (deals ?? []) as { id: string; ghl_contact_id: string }[];
    if (!rows.length) return json({ ok: true, stamped: 0, failed: 0 });

    const cfg = await getGhlConfig(db);
    let stamped = 0, failed = 0;
    const errors: string[] = [];

    // One contact can back several deals; stamp it once, mark them all.
    const byContact = new Map<string, string[]>();
    for (const d of rows) {
      const list = byContact.get(d.ghl_contact_id) ?? [];
      list.push(d.id);
      byContact.set(d.ghl_contact_id, list);
    }

    for (const [contactId, dealIds] of byContact) {
      const value = `${APP_URL}/admin/setter-performance?tab=operations&contact=${contactId}`;
      const res = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, {
        customFields: [{ id: PLAYBOOK_FIELD_ID, value }],
      });
      if (!res.ok) {
        failed++;
        if (errors.length < 5) errors.push(`${contactId}: ${res.status}`);
        // A rate limit means STOP, not "try the next 199 and fail them too" —
        // the same lesson the doc sweep learned. The next run picks these up.
        if (res.status === 429) {
          return json({ ok: true, stamped, failed, aborted: "rate_limited", errors });
        }
        continue;
      }
      const { error: upErr } = await db.from("deals")
        .update({ playbook_link_at: new Date().toISOString() })
        .in("id", dealIds);
      if (upErr) {
        // The CONTACT is stamped; only our bookkeeping failed. Report it rather
        // than counting a success — the next run will simply stamp it again,
        // which is harmless.
        failed++;
        if (errors.length < 5) errors.push(`${contactId}: stamped but not recorded (${upErr.message})`);
        continue;
      }
      stamped += dealIds.length;
    }

    return json({ ok: true, stamped, failed, ...(errors.length ? { errors } : {}) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
