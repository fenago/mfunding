// lead-enrich-ghl — put everything the purchased file paid for onto the GHL
// contact, in ONE PUT per contact.
//
// Separate from lead-push-ghl on purpose. The push CREATES contacts and its
// watchdog (cron 39) reinvokes lead-push-ghl for any 'running' row in
// lead_push_jobs — pointing that at an enrichment job would call the wrong
// function. So this carries its own ledger (lead_enrich_jobs) and its own
// reinvoke chain.
//
// SELF-DRAINING: rows are chosen by enriched_at IS NULL and stamped on success,
// so a resumed run never redoes work and the working-set index shrinks to
// nothing. Cancel wins: a canceled job is never resurrected.
//
// WHAT IT REFUSES TO SEND, and why (all of this was learned the hard way):
//   • a fabricated revenue scalar — the files state revenue as SENTENCES and the
//     old parse concatenated their digits ("$500,000 TO $1 MILLION" -> 5000001).
//     Only a real scalar >= 1000 goes to annual_gross_revenue; a RANGE sends the
//     picker bucket instead, never a number.
//   • an employee count above 10,000 — the same file ships values to 99,997,704
//     against a median of 14.
//   • free text into an option-list field — `industry` is MULTIPLE_OPTIONS, so
//     the SIC description goes to industry_doc (TEXT) and only the derived
//     bucket may touch a picker.
//   • a placeholder for anything unknown. An OMITTED field leaves what the
//     contact already carries; a placeholder DESTROYS it. That is how a real
//     merchant named Leonor became "Merchant".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, type GhlConfig } from "../_shared/ghl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const APP_URL = (Deno.env.get("APP_PUBLIC_URL") ?? "https://mfunding.net").replace(/\/$/, "");

/** Field ids resolved live 2026-08-15 — see the ghl-custom-field-traps memory.
 * Keys are near-misses of the obvious names, which is why they are pinned here
 * rather than guessed at call time. */
const F = {
  playbook_link: "Pwk3Rg5uzEMBFZ38O4wP",   // URL
  owner_title: "H43TGhc3iqkGUduq5oE6",     // TEXT  contact.owner_title__position
  employees: "hR4DxjGNp2uSRpw8LH30",       // NUMERICAL
  annual_revenue: "E4q0GUonhOKtzyNBIhy6",  // MONETORY contact.annual_gross_revenue
  monthly_money: "XM1zs3a1LuiZcv9IEYlb",   // MONETORY contact.avg_monthly_revenue_
  monthly_bucket: "6jEdAITgdrG5L9ek0aLG",  // MULTIPLE_OPTIONS contact.monthly_revenue
  industry_doc: "8u3WNvasTBqqpZg7v2aq",    // TEXT
  sic_code: "C54mozMmII9G41vxQOe6",        // TEXT
  website: "OBGCHWdcOdl2mSNlDJqb",         // TEXT contact.business_website
  entity: "bg2F006hXRWpFBC0UcJQ",          // SINGLE_OPTIONS contact.business_entity
} as const;

/** Our entity_type -> the picker's options. PC/PA deliberately map to NOTHING:
 * the list has no professional-corporation option and a wrong one is worse than
 * a blank. */
const ENTITY_OPTION: Record<string, string> = {
  "LLC": "LLC", "LLP": "LLP", "Corporation": "Corporation", "Ltd": "Ltd",
};

const BUDGET_MS = 25_000;
const CHUNK = 200;
const DEFAULT_RPS = 4;
/** Leave this much of the location's daily quota for the floor: playbook opens,
 * application pushes, workflows. Bulk work is never worth a setter's call. */
const RESERVE_FLOOR = 60_000;

type Row = {
  id: string; ghl_contact_id: string;
  first_name: string | null; last_name: string | null;
  title: string | null; employees: number | null;
  revenue: number | null; revenue_bucket: string | null;
  revenue_band_low: number | null; revenue_band_high: number | null;
  sic_code: string | null; sic_description: string | null;
  entity_type: string | null; web_domain: string | null; phone: string | null;
};
const COLS = "id,ghl_contact_id,first_name,last_name,title,employees,revenue,"
  + "revenue_bucket,revenue_band_low,revenue_band_high,sic_code,sic_description,"
  + "entity_type,web_domain,phone";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
const clean = (v: string | null): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** The consolidated payload for one contact. Omission is the default. */
function payloadFor(r: Row): Record<string, unknown> | null {
  const cf: { id: string; value: unknown }[] = [];
  const push = (id: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "") cf.push({ id, value: v });
  };

  push(F.playbook_link, `${APP_URL}/admin/playbooks?contact=${r.ghl_contact_id}`);
  push(F.owner_title, clean(r.title));
  push(F.industry_doc, clean(r.sic_description));
  push(F.sic_code, clean(r.sic_code));
  if (r.web_domain) push(F.website, `https://${r.web_domain}`);
  if (r.entity_type && ENTITY_OPTION[r.entity_type]) push(F.entity, ENTITY_OPTION[r.entity_type]);
  if (r.employees != null && r.employees > 0 && r.employees <= 10000) push(F.employees, r.employees);

  // Revenue: a real scalar, or a bucket — never a number invented from a range.
  const scalar = r.revenue != null && Number(r.revenue) >= 1000 ? Number(r.revenue) : null;
  if (scalar != null) {
    push(F.annual_revenue, scalar);
    push(F.monthly_money, Math.round(scalar / 12));
  }
  if (r.revenue_bucket) push(F.monthly_bucket, r.revenue_bucket);

  const body: Record<string, unknown> = {};
  // Names only when we HAVE them; never a placeholder over a real one.
  if (clean(r.first_name)) body.firstName = clean(r.first_name);
  if (clean(r.last_name)) body.lastName = clean(r.last_name);
  if (cf.length) body.customFields = cf;
  return Object.keys(body).length ? body : null;
}

async function patchJob(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await db.from("lead_enrich_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

function reinvoke(secret: string, jobId: string, rps?: number) {
  const p = fetch(`${SUPABASE_URL}/functions/v1/lead-enrich-ghl?secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: "continue", job_id: jobId, ...(rps ? { rps } : {}) }),
  }).then(() => {}).catch((e) => console.error("[lead-enrich-ghl] reinvoke failed:", e));
  try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(p); } catch { /* dev */ }
}

/** Remaining daily quota, read straight off the response headers.
 *
 * Deliberately a RAW fetch, not ghlFetch: GhlResponse carries {ok,status,data,
 * error} and NO headers, so `res.headers.get(...)` would have been undefined
 * forever — the floor check would have silently never fired and this job would
 * have happily run the location dry. A guard that cannot read its own signal is
 * worse than no guard, because it reports safety it never checked. */
async function quotaLeft(cfg: GhlConfig): Promise<number | null> {
  try {
    const res = await fetch(
      `https://services.leadconnectorhq.com/locations/${cfg.locationId}/customFields`,
      { headers: { Authorization: `Bearer ${cfg.apiKey}`, Version: "2021-07-28" } },
    );
    const h = res.headers.get("x-ratelimit-daily-remaining");
    const n = h == null ? NaN : Number(h);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;   // unreadable is not "plenty" — the caller treats null as unknown
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = serviceClient();
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.webhook_secret as string | undefined) ?? "";
  if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action ?? "status");
  const rps = Number(payload.rps) > 0 ? Math.min(Number(payload.rps), 8) : DEFAULT_RPS;

  try {
    if (action === "start") {
      const { data: job, error } = await db.from("lead_enrich_jobs")
        .insert({ status: "running", message: "starting" }).select("id").single();
      if (error || !job) return json({ error: `job create failed: ${error?.message}` }, 500);
      reinvoke(expected, job.id as string, rps);
      return json({ ok: true, job_id: job.id });
    }

    if (action === "status") {
      const { data } = await db.from("lead_enrich_jobs")
        .select("*").order("created_at", { ascending: false }).limit(3);
      return json({ ok: true, jobs: data ?? [] });
    }

    if (action === "cancel") {
      const id = String(payload.job_id ?? "");
      await patchJob(db, id, { status: "canceled", finished_at: new Date().toISOString(), message: "canceled" });
      return json({ ok: true, job_id: id, status: "canceled" });
    }

    if (action === "continue") {
      const jobId = String(payload.job_id ?? "");
      const { data: job } = await db.from("lead_enrich_jobs").select("*").eq("id", jobId).maybeSingle();
      if (!job) return json({ error: "job not found" }, 404);
      if (job.status !== "running") return json({ ok: true, job_id: jobId, status: job.status });

      const cfg = await getGhlConfig(db);
      // The reserve floor is checked BEFORE any work, every window — a bulk job
      // must never be the reason a setter's playbook open fails.
      const left = await quotaLeft(cfg);
      // UNREADABLE IS NOT PLENTY. If the quota can't be read we pause rather
      // than assume headroom — the whole point of the floor is protecting the
      // floor's traffic, and a guess is not protection.
      if (left == null || left < RESERVE_FLOOR) {
        await patchJob(db, jobId, {
          status: "paused", finished_at: new Date().toISOString(),
          message: left == null
            ? "paused — could not READ the GHL daily quota; unreadable is not plenty. Resumable."
            : `paused at the ${RESERVE_FLOOR} reserve floor (daily-remaining ${left}) — resumable`,
        });
        return json({ ok: true, job_id: jobId, paused: "reserve_floor", daily_remaining: left });
      }

      const started = Date.now();
      let updated = 0, errored = 0, skipped = 0;
      const interval = 1000 / rps;
      let lastMsg = "";

      while (Date.now() - started < BUDGET_MS) {
        const { data: rows, error: fErr } = await db.from("lead_records").select(COLS)
          .eq("status", "pushed").not("ghl_contact_id", "is", null)
          .is("enriched_at", null).limit(CHUNK);
        if (fErr) throw new Error(`fetch failed: ${fErr.message}`);
        const batch = (rows ?? []) as unknown as Row[];
        if (!batch.length) {
          await patchJob(db, jobId, {
            status: "complete", finished_at: new Date().toISOString(),
            updated: (job.updated ?? 0) + updated, errored: (job.errored ?? 0) + errored,
            message: `Complete — ${(job.updated ?? 0) + updated} enriched`,
          });
          return json({ ok: true, job_id: jobId, done: true, updated, errored, skipped });
        }

        for (const r of batch) {
          if (Date.now() - started >= BUDGET_MS) break;
          const t0 = Date.now();
          const body = payloadFor(r);
          if (!body) {
            skipped++;
            await db.from("lead_records").update({ enriched_at: new Date().toISOString() }).eq("id", r.id);
            continue;
          }
          const res = await ghlFetch(cfg, "PUT", `/contacts/${r.ghl_contact_id}`, body);
          if (res.ok) {
            updated++;
            await db.from("lead_records").update({ enriched_at: new Date().toISOString() }).eq("id", r.id);
          } else {
            errored++;
            lastMsg = `${res.status}`;
            // A daily-cap 429 is not a slow moment, it is a wall — stop the run.
            // A burst 429 has already been retried by ghlFetch's backoff.
            if (res.status === 429) {
              await patchJob(db, jobId, {
                status: "paused", finished_at: new Date().toISOString(),
                updated: (job.updated ?? 0) + updated, errored: (job.errored ?? 0) + errored,
                message: "paused on 429 — resumable",
              });
              return json({ ok: true, job_id: jobId, paused: "rate_limited", updated, errored });
            }
            await db.from("lead_records")
              .update({ enriched_at: new Date().toISOString(), push_error: `enrich ${res.status}` })
              .eq("id", r.id);
          }
          const dt = Date.now() - t0;
          if (dt < interval) await new Promise((s) => setTimeout(s, interval - dt));
        }

        await patchJob(db, jobId, {
          updated: (job.updated ?? 0) + updated, errored: (job.errored ?? 0) + errored,
          message: `enriched ${(job.updated ?? 0) + updated}${lastMsg ? ` (last error ${lastMsg})` : ""}`,
        });
      }

      reinvoke(expected, jobId, rps);
      return json({ ok: true, job_id: jobId, updated, errored, skipped, continued: true });
    }

    return json({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const jobId = String(payload.job_id ?? "");
    // A statement timeout is a slow window, not a broken job — hand off.
    if (/57014|canceling statement|statement timeout/i.test(msg) && jobId) {
      await patchJob(db, jobId, { message: `window timed out, retrying (${msg.slice(0, 80)})` });
      reinvoke(expected, jobId, rps);
      return json({ ok: true, job_id: jobId, retried_after_timeout: true });
    }
    if (jobId) {
      await patchJob(db, jobId, { status: "error", error: msg.slice(0, 500), finished_at: new Date().toISOString() });
    }
    return json({ error: msg }, 500);
  }
});
