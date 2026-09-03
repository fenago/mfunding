// setter-daily-audit — the end-of-day, ADMIN-ONLY call-quality audit.
//
// For an ET day (default: today), per setter (via v_wavv_outbound_caller_ids):
//   1) HARD METRICS from wavv_calls: dials, answered, talk seconds, disposition
//      mix, none/unset count, first/last call, per-hour histogram.
//   2) TRANSCRIPT SAMPLE (up to SAMPLE_CAP calls: every human-outcome disposition
//      + the longest recorded calls): fetched straight from WAVV, classified:
//        conversation        — the setter's voice / pitch is on the call
//        vm_dropped          — a voicemail where OUR message was left
//        vm_listened         — a VM greeting played with NO message left (waste)
//        no_transcript/other
//      A call classified `conversation` but dispositioned None/(unset)/Voice
//      Message is a SUSPECTED MISLABEL with a suggested disposition — surfaced
//      in the admin UI with accept/decline (setter_audit_review()).
//   3) Upserts one row per (day, setter) into setter_call_audits.
//
// AUTH: super_admin JWT, or the cron path (?secret= + anon bearer). Results are
// super_admin-visible only (RLS) — setters never see this.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

const WAVV_BASE = "https://api.wavv.com/v3";
const SAMPLE_CAP = 24;
const BUDGET_MS = 100_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const POSITIVES = ["Full App + Statements", "Full Application", "Partial Application", "Appointment Set", "Interested", "Callback"];
const HUMAN_OUTCOMES = [...POSITIVES, "Not Interested", "Do Not Contact"];

const RE_VM = /at the tone|record your message|voicemail|not available|leave (your |a )?(name|message)|forwarded|mailbox|press \d|automated voice/i;
const RE_OURS = /momentum|m funding|mfunding|working capital|good news|available offers/i;

interface CallRow {
  wavv_call_id: string;
  contact_name: string | null;
  phone: string | null;
  seconds: number | null;
  disposition: string | null;
  answered_at: string | null;
  recorded: boolean | null;
  started_at: string;
}

function classify(t: string): "conversation" | "vm_dropped" | "vm_listened" | "other" {
  const isVm = RE_VM.test(t);
  const ours = RE_OURS.test(t);
  if (isVm && ours) return "vm_dropped";
  if (isVm) return "vm_listened";
  if (ours) return "conversation";
  return "other";
}

/** Suggested disposition when a real conversation was mislabeled. */
function suggestFor(t: string): string {
  if (/appointment|call you (back|tomorrow)|schedule/i.test(t)) return "Callback";
  if (/not interested|no,? thank|don'?t call|take me off|remove me/i.test(t)) return "Not Interested";
  return "Not Interested";
}

// ── SCRIPT ANALYSIS (measurable, per conversation) ───────────────────────────
// Scores each transcript against the owner's approved outcome-ladder script:
//   identity_opener — leads with "this is <name> with Momentum/M Funding"
//                     (vs the gatekeeper-bait "I'm looking for <name>")
//   rebuttals       — how many times the setter kept selling AFTER the first
//                     decline ("no thanks / not interested"). 0 = gave up on the
//                     first soft no — the exact weakness in Paola's transcripts.
//   capture_ask     — asked for cell / email / OK-to-text (the fixed first step)
//   ladder_stepdown — offered the next rung (appointment / callback) instead of
//                     just ending the call
interface ScriptRead {
  identity_opener: boolean;
  rebuttals: number;
  gave_up_after_first_no: boolean;
  capture_ask: boolean;
  ladder_stepdown: boolean;
}

const RE_IDENTITY = /this is\s+\w+[^.?!]{0,40}(momentum|m funding|mfunding)/i;
const RE_LOOKING = /i'?m looking for/i;
const RE_DECLINE = /not interested|no,? thank|i'?m (ok|okay|good)|don'?t (want|need)|no,? i'?m/ig;
const RE_SELL = /offer|working capital|funding|qualify|capital|make sense|consider/ig;
const RE_CAPTURE = /best (cell|number|email)|your (cell|email)|text you|ok to text|send you a text|what'?s your email/i;
const RE_STEPDOWN = /appointment|schedule|call you back|specialist|tomorrow|later today|better time/i;

function readScript(t: string): ScriptRead {
  const identity = RE_IDENTITY.test(t);
  // Position of the FIRST decline, then count sell-phrases after it — each one is
  // a rebuttal attempt. Crude but consistent, so it's comparable day over day.
  RE_DECLINE.lastIndex = 0;
  const firstNo = RE_DECLINE.exec(t);
  let rebuttals = 0;
  if (firstNo) {
    const after = t.slice(firstNo.index + firstNo[0].length);
    rebuttals = (after.match(RE_SELL) ?? []).length > 0 ? (after.match(RE_DECLINE) ?? []).length : 0;
  }
  return {
    identity_opener: identity && !RE_LOOKING.test(t.slice(0, 200)),
    rebuttals,
    gave_up_after_first_no: !!firstNo && rebuttals === 0,
    capture_ask: RE_CAPTURE.test(t),
    ladder_stepdown: RE_STEPDOWN.test(t),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  const db = serviceClient();
  const url = new URL(req.url);

  // ── auth: cron secret OR super_admin JWT ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
  let authed = providedSecret !== "" && expected !== "" && providedSecret === expected;
  if (!authed) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data: u } = await db.auth.getUser(token);
      if (u?.user) {
        const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).single();
        authed = prof?.role === "super_admin";
      }
    }
  }
  if (!authed) return json({ error: "Not authorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { date?: string };
  // ET day bounds. Default: today in ET — via Intl (correct regardless of the
  // server's own timezone; a parse+toISOString round-trip is offset-dependent).
  const dayStr = body.date ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const { data: apiKey } = await db.rpc("get_wavv_api_key");
  if (!apiKey || typeof apiKey !== "string") return json({ error: "WAVV_API_KEY missing from the vault" }, 500);

  // Setter → caller-id map.
  const { data: mapRows } = await db
    .from("v_wavv_outbound_caller_ids").select("caller_id, setter_name").not("setter_name", "is", null);
  const setterByCaller = new Map<string, string>();
  for (const m of (mapRows ?? []) as { caller_id: string; setter_name: string }[]) {
    setterByCaller.set(m.caller_id.replace(/\D/g, ""), m.setter_name);
  }

  // All the day's calls (ET window converted via SQL for correctness).
  const { data: calls, error: cErr } = await db.rpc("wavv_calls_for_et_day", { p_day: dayStr }).select();
  let rows: CallRow[];
  if (cErr) {
    // Fallback: fetch by UTC superset and filter here.
    const from = new Date(`${dayStr}T00:00:00-05:00`).toISOString();
    const to = new Date(`${dayStr}T23:59:59-04:00`).toISOString();
    // Page through — PostgREST caps a single response at ~1,000 rows, and a full
    // floor day runs 2,500+ dials.
    const acc: (CallRow & { caller_id: string | null })[] = [];
    const PAGE = 1000;
    for (let off = 0; ; off += PAGE) {
      const { data: raw, error } = await db
        .from("wavv_calls")
        .select("wavv_call_id, contact_name, phone, seconds, disposition, answered_at, recorded, started_at, caller_id")
        .gte("started_at", from).lte("started_at", to)
        .order("started_at", { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) return json({ error: error.message }, 500);
      const page = (raw ?? []) as unknown as (CallRow & { caller_id: string | null })[];
      acc.push(...page);
      if (page.length < PAGE) break;
    }
    rows = acc;
  } else {
    rows = (calls ?? []) as unknown as CallRow[];
  }

  // Group per setter.
  const bySetter = new Map<string, (CallRow & { caller_id?: string | null })[]>();
  for (const r of rows as (CallRow & { caller_id?: string | null })[]) {
    const setter = setterByCaller.get((r.caller_id ?? "").replace(/\D/g, ""));
    if (!setter) continue;
    const list = bySetter.get(setter) ?? [];
    list.push(r);
    bySetter.set(setter, list);
  }

  const results: Record<string, unknown>[] = [];
  for (const [setter, list] of bySetter) {
    // ── metrics ──
    const dispoMix: Record<string, number> = {};
    let answered = 0, talk = 0, noneUnset = 0, humans = 0, positives = 0;
    const hours: Record<string, number> = {};
    for (const r of list) {
      const d = r.disposition ?? "(unset)";
      dispoMix[d] = (dispoMix[d] ?? 0) + 1;
      if (r.answered_at) answered++;
      talk += r.seconds ?? 0;
      if (d === "None" || d === "(unset)") noneUnset++;
      if (r.disposition && HUMAN_OUTCOMES.includes(r.disposition)) humans++;
      if (r.disposition && POSITIVES.includes(r.disposition)) positives++;
      const h = new Date(r.started_at).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit" });
      hours[h] = (hours[h] ?? 0) + 1;
    }

    // ── transcript sample: human-outcome calls + longest recorded ──
    const humansList = list.filter((r) => r.disposition && HUMAN_OUTCOMES.includes(r.disposition) && r.recorded);
    const longest = [...list].filter((r) => r.recorded && (r.seconds ?? 0) >= 20).sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));
    const seen = new Set<string>();
    const sampleCalls = [...humansList, ...longest].filter((r) => {
      if (seen.has(r.wavv_call_id)) return false;
      seen.add(r.wavv_call_id);
      return true;
    }).slice(0, SAMPLE_CAP);

    // Preserve accept/decline verdicts from any earlier run of this same day —
    // a re-run must never wipe the owner's reviews.
    const { data: prior } = await db
      .from("setter_call_audits").select("sample")
      .eq("audit_date", dayStr).eq("setter_name", setter).maybeSingle();
    const priorReview = new Map<string, { review: string; applied_disposition?: string | null }>();
    for (const it of ((prior?.sample ?? []) as Record<string, unknown>[])) {
      if (it.review) priorReview.set(String(it.call_id), { review: String(it.review), applied_disposition: (it.applied_disposition as string | null) ?? null });
    }

    const sample: Record<string, unknown>[] = [];
    let convs = 0, vmDropped = 0, vmListened = 0, mislabels = 0;
    // Script aggregates (over conversation-class calls only).
    let scIdentity = 0, scGaveUp = 0, scCapture = 0, scStepdown = 0, scRebuttals = 0, scWithNo = 0;
    for (const r of sampleCalls) {
      if (Date.now() - started > BUDGET_MS) break;
      let transcript = "";
      try {
        const res = await fetch(`${WAVV_BASE}/calls/${encodeURIComponent(r.wavv_call_id)}/transcript`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const t = await res.json();
          transcript = String(t?.transcript ?? "").trim();
        }
      } catch { /* per-call best effort */ }
      const cls = transcript ? classify(transcript) : "no_transcript";
      if (cls === "conversation") convs++;
      if (cls === "vm_dropped") vmDropped++;
      if (cls === "vm_listened") vmListened++;
      const d = r.disposition ?? "(unset)";
      const suspected =
        (cls === "conversation" && (d === "None" || d === "(unset)" || d === "Voice Message")) ||
        (cls === "vm_listened" && d !== "Voice Message" && d !== "No Answer");
      if (suspected) mislabels++;
      // Script read — conversations only.
      let script: ScriptRead | null = null;
      if (cls === "conversation") {
        script = readScript(transcript);
        if (script.identity_opener) scIdentity++;
        if (script.gave_up_after_first_no) { scGaveUp++; }
        if (script.capture_ask) scCapture++;
        if (script.ladder_stepdown) scStepdown++;
        if (script.gave_up_after_first_no || script.rebuttals > 0) { scWithNo++; scRebuttals += script.rebuttals; }
      }
      const kept = priorReview.get(r.wavv_call_id);
      sample.push({
        call_id: r.wavv_call_id,
        et: new Date(r.started_at).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }),
        contact: r.contact_name, phone: r.phone, seconds: r.seconds,
        disposition: d, class: cls,
        suspected_mislabel: suspected,
        suggested: suspected ? (cls === "vm_listened" ? "Voice Message" : suggestFor(transcript)) : null,
        excerpt: transcript.slice(0, 260),
        ...(script ? { script } : {}),
        ...(kept ? kept : {}),
      });
    }

    const summary =
      `${list.length} dials · ${answered} answered · ${Math.round(talk / 60)}m line-time · ` +
      `${humans} human outcomes (${positives} positive) · ${noneUnset} None/unset. ` +
      `Sample of ${sample.length}: ${convs} conversations, ${vmDropped} VMs dropped, ${vmListened} VM greetings listened (no drop), ${mislabels} suspected mislabels.`;

    const metrics = {
      dials: list.length, answered, talk_seconds: talk, human_outcomes: humans, positives,
      none_unset: noneUnset, dispo_mix: dispoMix, hours,
      sample_size: sample.length, conversations: convs, vm_dropped: vmDropped, vm_listened: vmListened,
      suspected_mislabels: mislabels,
      // Script quality over the analyzed conversations — measurable, comparable.
      script: convs > 0 ? {
        convs_analyzed: convs,
        identity_opener_pct: Math.round((scIdentity / convs) * 100),
        capture_ask_pct: Math.round((scCapture / convs) * 100),
        ladder_stepdown_pct: Math.round((scStepdown / convs) * 100),
        convs_with_a_no: scWithNo,
        gave_up_after_first_no: scGaveUp,
        avg_rebuttals_after_no: scWithNo > 0 ? Math.round((scRebuttals / scWithNo) * 10) / 10 : null,
      } : null,
    };

    await db.from("setter_call_audits").upsert(
      { audit_date: dayStr, setter_name: setter, metrics, sample, summary },
      { onConflict: "audit_date,setter_name" },
    );
    results.push({ setter, ...metrics });
  }

  return json({ ok: true, date: dayStr, setters: results.length, results });
});
