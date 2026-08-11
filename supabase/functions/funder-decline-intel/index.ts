// funder-decline-intel — turn every funder "no" into permanent box intel.
//
// Five idempotent phases, all of them run on each invocation (cron, hourly):
//
//   1. BACKFILL — seed funder_replies from the full bodies that already exist
//      elsewhere: deal_submissions.response_data->>'raw', keyed to the GHL email
//      record so it can't double-count against the recovered copy.
//   2. RECOVER  — re-fetch from GHL the full bodies of funder emails the mirror
//      logged (truncated) before this table existed. One pass over the ledger.
//   3. PARSE    — classify every unparsed funder_replies row (LLM through the
//      project's callLLM provider layer, deterministic heuristic as the backstop).
//      A row only leaves the queue once it has an answer; a provider outage means
//      it's retried next hour, never silently dropped.
//   4. ROLLUP   — aggregate parsed declines per funder and write
//      lenders.category.criteria.decline_history.
//   5. SELFHEAL — the one phase that CHANGES the published box: a "we don't fund
//      <state>" decline adds the merchant's state to criteria.restricted_states and
//      sets states_coverage="restricted", so the underwriter hard-excludes that
//      funder for the next merchant in that state. Add-only, never removes.
//
// ⚠️ criteria.decline_signal is HUMAN-CURATED (the owner wrote it for Green Note,
// Nationwide, Funderial, FundKite). This function NEVER reads back over it or
// writes it. Auto output goes to the separate keys decline_history and
// decline_history_meta only.
//
// Auth mirrors vendor-conversation-sweep: cron sends ?secret=<GHL webhook_secret>
// with an anon bearer; a signed-in closer/admin/super_admin can also run it by hand.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";
import { captureFunderReply, parseFunderReply, type DeclineCategory } from "../_shared/funderDecline.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Cap the LLM work per invocation so one run can never blow the edge-function
// timeout or the token budget. The queue drains across runs.
const PARSE_BATCH = 25;

// ── Phase 1: backfill ────────────────────────────────────────────────────────
// The only full bodies that survived the old truncation are the ones the poller
// stashed on the submission it matched. Pull them into funder_replies so the
// history starts with real data instead of an empty table.
async function backfill(db: SupabaseClient): Promise<{
  seeded: number; skipped: number; keyed_to_email: number; merged: number; error: string | null;
}> {
  const { data, error } = await db.from("deal_submissions")
    .select("id, deal_id, lender_id, response_data, response_at, submitted_at, lender:lenders!lender_id ( company_name )")
    .not("response_data->>raw", "is", null);
  if (error) return { seeded: 0, skipped: 0, keyed_to_email: 0, merged: 0, error: error.message };

  let seeded = 0, skipped = 0, keyedToEmail = 0, merged = 0;
  for (const row of data ?? []) {
    const rd = (row.response_data ?? {}) as Record<string, unknown>;
    const raw = String(rd.raw ?? "").trim();
    if (!raw || !row.lender_id) { skipped++; continue; }

    // KEY ON THE EMAIL, NOT THE SUBMISSION. The same funder email also reaches us
    // through the GHL mirror (the `recover` phase), and the two copies are never
    // byte-identical — GHL keeps the pleasantries and signature the poller stripped.
    // The deal's activity_log line for this reply quotes the raw's first 180 chars
    // AND carries the email-record id, so it maps this body to its [emsg:<id>].
    // Keying on that makes the two paths collide on the unique dedupe_key instead of
    // double-counting one decline.
    const lenderName = (row.lender as { company_name?: string } | null)?.company_name ?? "";
    let eid: string | null = null;
    if (row.deal_id && lenderName) {
      const { data: logs } = await db.from("activity_log")
        .select("content").eq("entity_type", "deal").eq("entity_id", row.deal_id as string)
        .eq("subject", `ghl:funder-reply — ${lenderName}`)
        .like("content", "%[emsg:%");
      const head = raw.slice(0, 60);
      const all = new Set<string>();
      for (const lg of logs ?? []) {
        const c = String((lg as { content?: string }).content ?? "");
        const id = c.match(/\[emsg:([^\]]+)\]/)?.[1];
        if (id) all.add(id);
        if (!eid && head && c.includes(head)) eid = id ?? null;
      }
      // Some older lines were written by the reconciler and carry a summary rather
      // than the raw's opening words, so the prefix test misses. When this funder has
      // exactly ONE reply logged on this deal there is nothing to disambiguate.
      if (!eid && all.size === 1) eid = [...all][0];
    }
    const dedupeKey = eid ? `emsg:${eid}` : `sub:${row.id}`;
    if (eid) keyedToEmail++;

    const { data: ins, error: insErr } = await db.from("funder_replies")
      .upsert({
        lender_id: row.lender_id as string,
        deal_id: (row.deal_id as string) ?? null,
        deal_submission_id: row.id as string,
        source: "backfill",
        ghl_email_record_id: eid,
        dedupe_key: dedupeKey,
        direction: "inbound",
        from_email: typeof rd.from === "string" ? rd.from : null,
        received_at: (row.response_at as string | null) ?? (row.submitted_at as string | null),
        full_body: raw,
      }, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (insErr) return { seeded, skipped, keyed_to_email: keyedToEmail, merged, error: insErr.message };
    if (ins?.length) seeded++; else skipped++;

    if (eid) {
      // The recovered copy of this email may already be here without the deal link —
      // give it one, then drop any earlier submission-keyed row for the same email so
      // the rollup counts this decline exactly once.
      await db.from("funder_replies")
        .update({ deal_id: (row.deal_id as string) ?? null, deal_submission_id: row.id as string })
        .eq("dedupe_key", dedupeKey).is("deal_id", null);
      const { data: dropped } = await db.from("funder_replies")
        .delete().eq("dedupe_key", `sub:${row.id}`).select("id");
      merged += dropped?.length ?? 0;
    }
  }
  return { seeded, skipped, keyed_to_email: keyedToEmail, merged, error: null };
}

// ── Phase 1b: recover ────────────────────────────────────────────────────────
// Inbound funder emails the mirror already logged (and truncated) BEFORE
// funder_replies existed. Their full bodies are still in GHL: the ledger holds the
// conversation-message id → meta.email.messageIds → the email record → the body.
// Two GHL calls per message, so it's bounded per run and each message is marked
// considered (whether or not a body came back) and never re-fetched.
const RECOVER_BATCH = 30;

function plainTextOf(raw: string): string {
  return String(raw ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// NEAR-DUPLICATE GUARD. The same funder email can reach us twice by different
// routes: the poller stashed a cleaned copy on the submission (backfill), and the
// mirror ledger points at the raw GHL record (recover). The two texts are not
// byte-identical — one Reliant decline arrived as 159 chars and 316 chars because
// the GHL copy kept "we appreciate your business" and the signature — so dedupe_key
// can't catch it and a rollup would count one decline twice. Compare on the
// alphanumeric-only text: if either side's first 80 chars appear in the other, it's
// the same email and we keep the copy we already have (which carries the deal link).
function normForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isNearDuplicate(incoming: string, existing: string[]): boolean {
  const a = normForCompare(incoming);
  if (a.length < 40) return existing.some((e) => normForCompare(e) === a);
  const aHead = a.slice(0, 80);
  return existing.some((raw) => {
    const b = normForCompare(raw);
    if (b.length < 40) return false;
    return b.includes(aHead) || a.includes(b.slice(0, 80));
  });
}

async function recover(db: SupabaseClient): Promise<{
  considered: number; recovered: number; duplicates: number; error: string | null;
}> {
  const { data: rows, error } = await db.from("ghl_conversation_log")
    .select("ghl_message_id, entity_id, message_at")
    .eq("entity_type", "lender").eq("channel", "email").eq("direction", "inbound")
    .is("funder_body_recovered_at", null)
    .order("message_at", { ascending: false })
    .limit(RECOVER_BATCH);
  if (error) return { considered: 0, recovered: 0, duplicates: 0, error: error.message };
  if (!rows?.length) return { considered: 0, recovered: 0, duplicates: 0, error: null };

  // What we already hold for these funders — the near-duplicate guard's reference set.
  const lenderIds = [...new Set(rows.map((r) => r.entity_id as string))];
  const { data: known } = await db.from("funder_replies")
    .select("lender_id, full_body").in("lender_id", lenderIds);
  const seen = new Map<string, string[]>();
  for (const k of known ?? []) {
    const list = seen.get(k.lender_id as string) ?? [];
    list.push(k.full_body as string);
    seen.set(k.lender_id as string, list);
  }

  const cfg = await getGhlConfig(db);
  let considered = 0, recovered = 0, duplicates = 0;
  for (const r of rows) {
    const msgId = r.ghl_message_id as string;
    const lenderId = r.entity_id as string;
    try {
      const mRes = await ghlFetch<{ message?: Record<string, unknown> } & Record<string, unknown>>(
        cfg, "GET", `/conversations/messages/${msgId}`,
      );
      const m = (mRes.data?.message ?? mRes.data ?? {}) as Record<string, unknown>;
      const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
      for (const eid of ids.slice(0, 3)) {
        const eRes = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
          cfg, "GET", `/conversations/messages/email/${eid}`,
        );
        const em = (eRes.data?.emailMessage ?? eRes.data ?? {}) as Record<string, unknown>;
        if (String(em.direction ?? "").toLowerCase() !== "inbound") continue;
        const body = plainTextOf(String(em.body ?? em.text ?? ""));
        if (!body) continue;
        const already = seen.get(lenderId) ?? [];
        if (isNearDuplicate(body, already)) { duplicates++; continue; }
        const cap = await captureFunderReply(db, {
          lenderId, source: "recover", fullBody: body,
          emailRecordId: String(eid),
          subject: typeof em.subject === "string" ? em.subject : null,
          fromEmail: typeof em.from === "string" ? em.from : null,
          receivedAt: (r.message_at as string | null) ?? null,
        });
        if (cap.captured) {
          recovered++;
          already.push(body);
          seen.set(lenderId, already); // guard the rest of THIS batch too
        }
      }
    } catch { /* one bad message must not stall the batch */ }
    // Mark considered either way — a message with no recoverable body is not worth
    // two GHL calls on every future run.
    await db.from("ghl_conversation_log")
      .update({ funder_body_recovered_at: new Date().toISOString() })
      .eq("ghl_message_id", msgId);
    considered++;
  }
  return { considered, recovered, duplicates, error: null };
}

// ── Phase 2: parse ───────────────────────────────────────────────────────────
async function parsePending(db: SupabaseClient): Promise<{
  parsed: number; declines: number; deferred: number; errors: string[];
}> {
  const { data: rows, error } = await db.from("funder_replies")
    .select("id, lender_id, subject, full_body")
    .is("parsed_at", null)
    .order("created_at", { ascending: true })
    .limit(PARSE_BATCH);
  if (error) return { parsed: 0, declines: 0, deferred: 0, errors: [error.message] };
  if (!rows?.length) return { parsed: 0, declines: 0, deferred: 0, errors: [] };

  // One name lookup for the batch (the model reads better with the funder named).
  const lenderIds = [...new Set(rows.map((r) => r.lender_id as string))];
  const { data: lenders } = await db.from("lenders").select("id, company_name").in("id", lenderIds);
  const nameOf = new Map((lenders ?? []).map((l) => [l.id as string, l.company_name as string]));

  let parsed = 0, declines = 0, deferred = 0;
  const errors: string[] = [];
  for (const r of rows) {
    const res = await parseFunderReply(db, {
      subject: r.subject as string | null,
      body: r.full_body as string,
      lenderName: nameOf.get(r.lender_id as string) ?? null,
    });
    if (!res) { deferred++; continue; } // no answer — leave queued for the next run
    const { error: upErr } = await db.from("funder_replies").update({
      parsed_at: new Date().toISOString(),
      parse_method: res.method,
      parse_model: res.model,
      parse_confidence: res.confidence,
      is_decline: res.is_decline,
      reason_categories: res.reason_categories,
      verbatim_quote: res.verbatim_quote || null,
      parsed: res as unknown as Record<string, unknown>,
    }).eq("id", r.id as string);
    if (upErr) { errors.push(`${r.id}: ${upErr.message}`); continue; }
    parsed++;
    if (res.is_decline) declines++;
  }
  return { parsed, declines, deferred, errors };
}

// ── Phase 3: rollup ──────────────────────────────────────────────────────────

// A single decline is a data point, not a rule — say so on the row itself.
function confidenceFor(count: number): string {
  if (count >= 5) return "high";
  if (count >= 3) return "medium";
  if (count === 2) return "low";
  return "single_datapoint";
}

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Where the observed declines disagree with the funder's PUBLISHED box. This is the
 * whole payoff — a funder's marketing box and its actual underwriting are different
 * documents, and the declines are the ground truth. Every line names the count so a
 * human can weigh it; nothing here overrides the published fields.
 */
function contradictions(
  crit: Record<string, unknown>,
  counts: Map<DeclineCategory | string, number>,
): string[] {
  const out: string[] = [];
  const c = (k: string) => counts.get(k) ?? 0;
  const plural = (n: number) => `${n} decline${n === 1 ? "" : "s"}`;

  const posNote = str(crit.positions_note);
  const maxPos = num(crit.max_positions);
  if (c("too_many_positions") > 0) {
    if (/no max position/i.test(posNote)) {
      out.push(`Published "NO MAX POSITIONS", but ${plural(c("too_many_positions"))} citing existing positions.`);
    } else if (maxPos != null && maxPos >= 3) {
      out.push(`Published max_positions ${maxPos}, but ${plural(c("too_many_positions"))} citing existing positions — the effective cap may be lower.`);
    }
  }

  const states = arr(crit.restricted_states);
  if (c("state_restricted") > 0 && states != null && states.length === 0) {
    out.push(`Published no restricted states, but ${plural(c("state_restricted"))} citing the merchant's state.`);
  }

  const inds = arr(crit.restricted_industries);
  if (c("industry_restricted") > 0 && inds != null && inds.length === 0) {
    out.push(`Published no restricted industries, but ${plural(c("industry_restricted"))} citing the merchant's industry.`);
  }

  const minRev = num(crit.min_monthly_revenue);
  if (c("low_revenue") > 0 && minRev != null) {
    out.push(`Published min_monthly_revenue $${minRev.toLocaleString("en-US")} — ${plural(c("low_revenue"))} still citing low revenue, so the working floor is likely higher.`);
  }

  const minTib = num(crit.min_tib_months);
  if (c("tib_too_short") > 0 && minTib != null) {
    out.push(`Published min_tib_months ${minTib} — ${plural(c("tib_too_short"))} still citing time in business.`);
  }

  const collectionsGap = c("open_collections") + c("prior_default") + c("open_lien_or_judgment");
  if (collectionsGap > 0 && crit.collections_policy == null) {
    out.push(`No published collections/default policy, but ${plural(collectionsGap)} citing collections, a prior default, or a lien/judgment.`);
  }

  const fico = num(crit.fico_floor);
  if (c("low_fico") > 0 && fico != null) {
    out.push(`Published fico_floor ${fico} — ${plural(c("low_fico"))} still citing credit.`);
  }

  return out;
}

async function rollup(db: SupabaseClient): Promise<{
  funders: number; entries: number; contradictions: number; errors: string[];
}> {
  const { data: agg, error } = await db.rpc("funder_decline_rollup");
  if (error) return { funders: 0, entries: 0, contradictions: 0, errors: [error.message] };
  const rows = (agg ?? []) as Array<{
    lender_id: string; reason_category: string; cnt: number; last_seen: string; last_quote: string | null;
  }>;
  if (!rows.length) return { funders: 0, entries: 0, contradictions: 0, errors: [] };

  const byLender = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byLender.get(r.lender_id) ?? [];
    list.push(r);
    byLender.set(r.lender_id, list);
  }

  const lenderIds = [...byLender.keys()];
  const { data: lenders, error: lErr } = await db.from("lenders")
    .select("id, company_name, category").in("id", lenderIds);
  if (lErr) return { funders: 0, entries: 0, contradictions: 0, errors: [lErr.message] };

  const errors: string[] = [];
  let funders = 0, entries = 0, contradictionCount = 0;
  const now = new Date().toISOString();

  for (const l of lenders ?? []) {
    const list = (byLender.get(l.id as string) ?? []).slice()
      .sort((a, b) => b.cnt - a.cnt || a.reason_category.localeCompare(b.reason_category));

    const history = list.map((r) => ({
      reason_category: r.reason_category,
      count: Number(r.cnt),
      last_seen_quote: (r.last_quote ?? "").slice(0, 300),
      last_seen: r.last_seen,
      confidence: confidenceFor(Number(r.cnt)),
    }));
    const total = history.reduce((n, h) => n + h.count, 0);

    // Read-modify-write, preserving EVERY existing key. criteria.decline_signal is
    // human-curated and is copied through untouched — only decline_history and
    // decline_history_meta are written.
    const category = (l.category ?? {}) as Record<string, unknown>;
    const criteria = ((category.criteria ?? {}) as Record<string, unknown>);
    const counts = new Map<string, number>(history.map((h) => [h.reason_category, h.count]));
    const flags = contradictions(criteria, counts);
    contradictionCount += flags.length;

    const nextCategory = {
      ...category,
      criteria: {
        ...criteria,
        decline_history: history,
        decline_history_meta: {
          total_declines: total,
          distinct_reasons: history.length,
          updated_at: now,
          source: "auto — funder-decline-intel (parsed funder decline emails)",
          note: total < 3
            ? "Thin evidence: a single decline is a data point, not a rule. Do not treat as a published gate."
            : "Observed behaviour, not the funder's published box. Weigh against criteria.decline_signal (human-curated).",
          contradicts_published_box: flags,
        },
      },
    };

    const { error: upErr } = await db.from("lenders")
      .update({ category: nextCategory }).eq("id", l.id as string);
    if (upErr) { errors.push(`${l.company_name}: ${upErr.message}`); continue; }
    funders++;
    entries += history.length;
  }
  return { funders, entries, contradictions: contradictionCount, errors };
}

// ── Phase 4: self-heal (state) ───────────────────────────────────────────────
// A "we don't fund <state>" decline is the funder telling us its own box is wrong on
// file. Every other phase only OBSERVES; this one REPAIRS: the merchant's state goes
// onto criteria.restricted_states and states_coverage flips to "restricted", so the
// underwriter's state gate hard-excludes that funder for the next merchant in that
// state instead of learning the same lesson again.
//
// Rules, in the order they matter:
//   · ADD ONLY. A human-set entry is never removed, never rewritten, never
//     down-graded — if the code already appears in any entry (including a caveated
//     one like "CA (selective)"), this leaves the row alone.
//   · The merchant's state comes from the DEAL (customers.address_state), never from
//     the decline prose — a funder's email mentions its own HQ as often as the
//     merchant's state.
//   · Idempotent: dedup on the 2-letter code, and criteria.states_learned is keyed by
//     state so re-runs append nothing.
const STATE_HEAL_BATCH = 200;

/** Leading UPPERCASE 2-letter token — the same head-code read the underwriter uses. */
function headCode(entry: string): string | null {
  const m = String(entry ?? "").trim().match(/^([A-Za-z]{2})\b/);
  return m ? m[1].toUpperCase() : null;
}

async function selfHealStates(db: SupabaseClient): Promise<{
  declines: number; funders_updated: number; states_added: string[];
  skipped_no_state: number; already_known: number; errors: string[];
}> {
  const empty = {
    declines: 0, funders_updated: 0, states_added: [] as string[],
    skipped_no_state: 0, already_known: 0, errors: [] as string[],
  };
  const { data: rows, error } = await db.from("funder_replies")
    .select("id, lender_id, deal_id, verbatim_quote, received_at")
    .eq("is_decline", true)
    .not("deal_id", "is", null)
    .contains("reason_categories", ["state_restricted"])
    .order("received_at", { ascending: true })
    .limit(STATE_HEAL_BATCH);
  if (error) return { ...empty, errors: [error.message] };
  if (!rows?.length) return empty;
  empty.declines = rows.length;

  // deal → customer → state, in two batched reads.
  const dealIds = [...new Set(rows.map((r) => r.deal_id as string))];
  const { data: deals } = await db.from("deals").select("id, deal_number, customer_id").in("id", dealIds);
  const custOf = new Map((deals ?? []).map((d) => [d.id as string, d.customer_id as string | null]));
  const dealNoOf = new Map((deals ?? []).map((d) => [d.id as string, (d.deal_number as string) ?? d.id as string]));
  const custIds = [...new Set([...custOf.values()].filter(Boolean) as string[])];
  const { data: custs } = custIds.length
    ? await db.from("customers").select("id, address_state").in("id", custIds)
    : { data: [] as Array<{ id: string; address_state: string | null }> };
  const stateOf = new Map((custs ?? []).map((c) => [c.id as string, String(c.address_state ?? "").trim().toUpperCase()]));

  // Everything this run wants to teach, grouped per funder.
  interface Lesson { state: string; reply_id: string; deal: string; quote: string; seen_at: string | null }
  const byLender = new Map<string, Lesson[]>();
  let skippedNoState = 0;
  for (const r of rows) {
    const cid = custOf.get(r.deal_id as string) ?? null;
    const st = cid ? (stateOf.get(cid) ?? "") : "";
    if (!/^[A-Z]{2}$/.test(st)) { skippedNoState++; continue; }
    const list = byLender.get(r.lender_id as string) ?? [];
    list.push({
      state: st,
      reply_id: r.id as string,
      deal: dealNoOf.get(r.deal_id as string) ?? (r.deal_id as string),
      quote: String(r.verbatim_quote ?? "").slice(0, 200),
      seen_at: (r.received_at as string | null) ?? null,
    });
    byLender.set(r.lender_id as string, list);
  }
  if (byLender.size === 0) {
    return { ...empty, declines: rows.length, skipped_no_state: skippedNoState };
  }

  const { data: lenders, error: lErr } = await db.from("lenders")
    .select("id, company_name, category").in("id", [...byLender.keys()]);
  if (lErr) return { ...empty, declines: rows.length, skipped_no_state: skippedNoState, errors: [lErr.message] };

  const errors: string[] = [];
  const added: string[] = [];
  let funders = 0, alreadyKnown = 0;
  const now = new Date().toISOString();

  for (const l of lenders ?? []) {
    const lessons = byLender.get(l.id as string) ?? [];
    const category = (l.category ?? {}) as Record<string, unknown>;
    const criteria = ((category.criteria ?? {}) as Record<string, unknown>);

    // Coerce defensively: some rows carry JSON null here rather than [].
    const existing = Array.isArray(criteria.restricted_states)
      ? (criteria.restricted_states as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const known = new Set(existing.map(headCode).filter(Boolean) as string[]);

    const learnedPrior = Array.isArray(criteria.states_learned)
      ? (criteria.states_learned as Array<Record<string, unknown>>)
      : [];
    const learnedBy = new Map(learnedPrior.map((e) => [String(e.state ?? "").toUpperCase(), e]));

    const nextStates = [...existing];
    const newHere: string[] = [];
    for (const lesson of lessons) {
      if (known.has(lesson.state)) { alreadyKnown++; continue; }
      known.add(lesson.state);
      nextStates.push(lesson.state);
      newHere.push(lesson.state);
      learnedBy.set(lesson.state, {
        state: lesson.state,
        source: "decline",
        learned_at: now,
        funder_reply_id: lesson.reply_id,
        deal: lesson.deal,
        quote: lesson.quote,
        seen_at: lesson.seen_at,
        note: "Added automatically from a real funder decline citing the merchant's state.",
      });
    }
    if (newHere.length === 0) continue;

    const nextCategory = {
      ...category,
      criteria: {
        ...criteria,
        restricted_states: nextStates,
        states_coverage: "restricted",
        states_learned: [...learnedBy.values()],
      },
    };
    const { error: upErr } = await db.from("lenders")
      .update({ category: nextCategory }).eq("id", l.id as string);
    if (upErr) { errors.push(`${l.company_name}: ${upErr.message}`); continue; }
    funders++;
    for (const st of newHere) {
      added.push(`${l.company_name}: +${st}`);
      console.log(`[funder-decline-intel] self-heal — ${l.company_name} restricted_states += ${st} (learned from decline)`);
    }
  }

  return {
    declines: rows.length, funders_updated: funders, states_added: added,
    skipped_no_state: skippedNoState, already_known: alreadyKnown, errors,
  };
}

// ── Entry ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const db = serviceClient();
    const url = new URL(req.url);

    // Cron path: ?secret=<GHL webhook_secret> + anon bearer at the gateway.
    // Staff path: a signed-in closer/admin/super_admin bearer.
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    if (provided) {
      const { data: gc } = await db.rpc("get_ghl_config");
      const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
      if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);
    } else {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Missing authorization" }, 401);
      const { data: userData, error: userErr } = await db.auth.getUser(token);
      const caller = userData?.user;
      if (userErr || !caller) return json({ error: "Invalid session" }, 401);
      const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
      const role = prof?.role as string | undefined;
      if (!role || !["closer", "admin", "super_admin"].includes(role)) {
        return json({ error: "Staff only" }, 403);
      }
    }

    // ?phases=backfill,recover,parse,rollup,selfheal — default is all five, in order.
    // selfheal runs LAST so it reads a lenders row rollup has already written: both
    // phases read-modify-write the whole category object, and the later reader wins.
    const want = (url.searchParams.get("phases") ?? "backfill,recover,parse,rollup,selfheal")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const out: Record<string, unknown> = { ok: true, phases: want };
    if (want.includes("backfill")) out.backfill = await backfill(db);
    if (want.includes("recover")) out.recover = await recover(db);
    if (want.includes("parse")) out.parse = await parsePending(db);
    if (want.includes("rollup")) out.rollup = await rollup(db);
    if (want.includes("selfheal")) out.selfheal = await selfHealStates(db);
    return json(out);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
