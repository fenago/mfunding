// ph-ucc-push-ghl — the LOAD stage of the PH UCC List Machine: the missing link
// between skip-trace and the dialer.
//
// Takes the owner's FILTERED, SKIP-TRACED UCC leads (an explicit lead_ids[] set
// the UI passes from the lead book, batched) and upserts each as a GHL contact —
// tagged, de-duped, with UCC context on custom fields. Because HotProspector
// mirrors GHL natively, a contact created here appears in HP automatically, and
// the per-run batch tag lets an HP dialer campaign target this exact load.
//
// PUSHING IS FREE. No BatchData / no spend — no wallet gate. The only cost is a
// handful of GHL API calls per lead.
//
// SAFETY / CONTRACT:
//   • PUSH ONLY dialable leads — a lead must have a usable phone OR email (on
//     ph_ucc_leads.phone / .email / .apollo_business_email). needs_skiptrace and
//     no-contact leads are SKIPPED (a contact with neither is useless in a dialer)
//     and reported as skipped_no_contact.
//   • DE-DUPE by email/phone via GHL /contacts/upsert (a merchant already in GHL
//     is UPDATED, never duplicated). The upsert's `new` flag distinguishes a
//     freshly-created contact (pushed) from a matched existing one (updated).
//   • IDEMPOTENT — re-pushing a lead updates its contact + re-stamps
//     pushed_to_ghl_at; it never creates a second contact.
//   • Trigger/dialer tags must PRE-EXIST in GHL to attach reliably, so every tag
//     the batch will apply is created up-front via the tags API (existing ones are
//     left alone).
//   • NO outbound comms. This function never sends an SMS/email and never dials —
//     it only creates/updates contacts and stamps the DB.
//
// AUTH (mirrors ph-ucc-skiptrace): trusted cron via ?secret=<GHL webhook secret> +
// anon-key Bearer, OR a signed-in staff user (closer/admin/super_admin). A
// service-role bearer deliberately fails the role check — use the secret path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch,
  upsertContact, addContactTags, updateContactCustomFields, listCustomFields,
  type GhlConfig, type ContactInput,
} from "../_shared/ghl.ts";

const HARD_MAX = 100;      // never process more than this many ids per call (UI chunks to match)
const BUDGET_MS = 50_000;  // stop starting new leads past this (platform kills ~60s)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const clean = (s: unknown): string | null => {
  const v = (s ?? "").toString().trim();
  return v.length ? v : null;
};

const VALID_EMAIL = (e: unknown): e is string =>
  typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** The sentinel matched_funders value the ingest writes for agent-filed leads. It
 * is NOT a real funder name — never turn it into a funder-<slug> tag. */
const AGENT_FILED_SENTINEL = "— agent-filed (funder unknown) —";

/** funder-<slug> tag from a funder display name. */
function funderSlug(name: string): string | null {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base ? `funder-${base}` : null;
}

type ConfTier = "confirmed" | "high" | "medium" | "low";

/** Resolve a lead's confidence tier — same contract as the UI's leadConfidence():
 * prefer the backend `confidence` column; else derive from lead_class + stack_depth
 * (named_funder = confirmed; agent_masked: 3+ = high, 2 = medium, else low). */
function confidenceTier(l: Lead): ConfTier {
  const c = l.confidence;
  if (c === "confirmed" || c === "high" || c === "medium" || c === "low") return c;
  if (l.lead_class === "agent_masked") {
    const d = l.stack_depth ?? 0;
    if (d >= 3) return "high";
    if (d === 2) return "medium";
    return "low";
  }
  return "confirmed";
}

interface Lead {
  id: string;
  state: string | null;
  debtor_name: string | null;
  debtor_state: string | null;
  matched_funders: string[] | null;
  stack_depth: number | null;
  latest_filing_date: string | null;
  freshness_days: number | null;
  mca_score: number | string | null;
  score: number | string | null;
  status: string;
  person_name: string | null;
  phone: string | null;
  email: string | null;
  apollo_business_email: string | null;
  lead_class: string | null;
  agent_name: string | null;
  confidence: string | null;
  ghl_contact_id: string | null;
}

const LEAD_COLS =
  "id,state,debtor_name,debtor_state,matched_funders,stack_depth,latest_filing_date," +
  "freshness_days,mca_score,score,status,person_name,phone,email,apollo_business_email," +
  "lead_class,agent_name,confidence,ghl_contact_id";

/** Compute the full tag set for one lead (base + geo + confidence + funders + batch + extras). */
function tagsFor(l: Lead, batchTag: string, extra: string[]): string[] {
  const tags = new Set<string>(["ucc-lead", ...extra]);
  const st = clean(l.state) ?? clean(l.debtor_state);
  if (st) tags.add(`ucc-${st.toLowerCase()}`);
  tags.add(`conf-${confidenceTier(l)}`);
  // funder-<slug> ONLY for real, named funders (not agent-masked / sentinel).
  if (l.lead_class !== "agent_masked") {
    for (const f of l.matched_funders ?? []) {
      if (!f || f === AGENT_FILED_SENTINEL) continue;
      const slug = funderSlug(f);
      if (slug) tags.add(slug);
    }
  }
  tags.add(batchTag);
  return Array.from(tags);
}

/** Build the UCC-context custom fields for one lead, using field ids resolved by
 * fieldKey from the location (reuse existing MCA fields — no duplicates created). */
function customFieldsFor(
  l: Lead,
  keyToId: Map<string, string>,
): Array<{ id: string; value: string | number }> {
  const out: Array<{ id: string; value: string | number }> = [];
  const put = (key: string, value: string | number | null) => {
    if (value === null || value === "") return;
    const id = keyToId.get(key);
    if (id) out.push({ id, value });
  };

  // # positions / stack → Active MCA Positions (numerical)
  if (l.stack_depth != null) put("contact.active_mca_positions", l.stack_depth);

  // Matched funders → Current Funder Names (honest for masked leads)
  const funders = (l.matched_funders ?? []).filter((f) => f && f !== AGENT_FILED_SENTINEL);
  if (l.lead_class === "agent_masked") {
    put("contact.current_funder_names", l.agent_name
      ? `Agent-filed via ${l.agent_name} (funder unknown)`
      : "Agent-filed (funder unknown)");
  } else if (funders.length) {
    put("contact.current_funder_names", funders.join(", "));
  }

  // Lead agent / source → the filing agent for masked, else the machine
  put("contact.lead_agent__source_company", clean(l.agent_name) ?? "UCC Machine");

  // Rich context → Funding Positions Notes (large text). One human-readable line.
  const mca = l.mca_score == null ? null : Number(l.mca_score);
  const parts = [
    `UCC lead (${confidenceTier(l)})`,
    (clean(l.state) ?? clean(l.debtor_state)) ? `state ${(clean(l.state) ?? clean(l.debtor_state))!.toUpperCase()}` : null,
    l.stack_depth != null ? `${l.stack_depth} position(s)` : null,
    mca != null && Number.isFinite(mca) ? `MCA score ${mca.toFixed(2)}` : null,
    l.latest_filing_date ? `latest filing ${l.latest_filing_date}` : null,
    l.freshness_days != null ? `${l.freshness_days}d old` : null,
    funders.length ? `funders: ${funders.join(", ")}` : null,
  ].filter(Boolean);
  put("contact.funding_positions_notes", parts.join(" · "));

  return out;
}

/** Pre-create every tag the batch will use so it attaches reliably. Reads the
 * location's tags once, creates only the missing ones (dup create → 400, ignored). */
async function ensureTags(cfg: GhlConfig, wanted: Set<string>): Promise<void> {
  if (wanted.size === 0) return;
  const existing = new Set<string>();
  const res = await ghlFetch<{ tags?: Array<{ name?: string }> }>(
    cfg, "GET", `/locations/${cfg.locationId}/tags`,
  );
  for (const t of res.data?.tags ?? []) {
    const n = clean(t?.name);
    if (n) existing.add(n.toLowerCase());
  }
  for (const tag of wanted) {
    if (existing.has(tag.toLowerCase())) continue;
    const cr = await ghlFetch(cfg, "POST", `/locations/${cfg.locationId}/tags`, { name: tag });
    // 400 "already exist" is a benign race — anything else we just log and move on
    // (addContactTags will still auto-create as a fallback).
    if (!cr.ok && cr.status !== 400) {
      console.warn("[ph-ucc-push-ghl] tag create failed", JSON.stringify({ tag, status: cr.status, error: cr.error }));
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted secret OR signed-in staff (mirrors ph-ucc-skiptrace) ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* empty */ }

  // Explicit id set from the UI's filtered lead book. Hard-capped so no caller can
  // push more than the ceiling per call (the UI chunks to match).
  const idsRaw = (payload as { lead_ids?: unknown }).lead_ids;
  const leadIds = Array.isArray(idsRaw)
    ? Array.from(new Set(idsRaw.filter((x): x is string => typeof x === "string" && x.length > 0))).slice(0, HARD_MAX)
    : [];
  if (leadIds.length === 0) return json({ error: "lead_ids[] is required" }, 400);

  // Batch tag: the client supplies either a full batch_tag ("ucc-batch-2026-08-10")
  // or a batch_date ("2026-08-10"); fall back to server date if neither is given.
  const batchTagRaw = clean((payload as { batch_tag?: unknown }).batch_tag);
  const batchDate = clean((payload as { batch_date?: unknown }).batch_date);
  const stamp = (batchDate ?? new Date().toISOString().slice(0, 10)).replace(/[^0-9-]/g, "");
  const batchTag = batchTagRaw ?? `ucc-batch-${stamp}`;

  // Optional extra tags (e.g. ["ucc-test"] for a safe test run). Not used by the UI.
  const extraRaw = (payload as { extra_tags?: unknown }).extra_tags;
  const extraTags = Array.isArray(extraRaw)
    ? extraRaw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 5)
    : [];

  // GHL config from the vault.
  let cfg: GhlConfig | null = null;
  let ghlErr: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlErr = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlErr ?? "missing credentials"}` }, 502);

  const started = Date.now();

  // Load the requested leads.
  const { data: leadRows, error: leadErr } = await db
    .from("ph_ucc_leads").select(LEAD_COLS).in("id", leadIds);
  if (leadErr) return json({ error: `lead load failed: ${leadErr.message}` }, 500);
  const leads = (leadRows as Lead[]) ?? [];

  // Resolve custom-field ids by fieldKey once (reuse existing MCA fields).
  const cfRes = await listCustomFields(cfg);
  const keyToId = new Map<string, string>();
  for (const f of cfRes.data?.customFields ?? []) {
    if (f.fieldKey && f.id) keyToId.set(f.fieldKey, f.id);
  }

  // Pre-create every tag the batch will apply (dialable leads only).
  const dialable = leads.filter((l) =>
    VALID_EMAIL(l.email) || VALID_EMAIL(l.apollo_business_email) || clean(l.phone));
  const allTags = new Set<string>();
  for (const l of dialable) for (const t of tagsFor(l, batchTag, extraTags)) allTags.add(t);
  await ensureTags(cfg, allTags);

  let pushed = 0, updated = 0, skipped_no_contact = 0, errored = 0;
  const nowIso = new Date().toISOString();
  const perLead: Record<string, unknown>[] = [];

  for (const l of leads) {
    if (Date.now() - started > BUDGET_MS) {
      perLead.push({ lead_id: l.id, skipped: "time-budget — re-run to finish" });
      break;
    }

    const email = VALID_EMAIL(l.email) ? l.email!.trim()
      : VALID_EMAIL(l.apollo_business_email) ? l.apollo_business_email!.trim()
      : null;
    const phone = clean(l.phone);

    // SKIP no-contact leads — useless in a dialer, and upsert needs email or phone.
    if (!email && !phone) {
      skipped_no_contact++;
      perLead.push({ lead_id: l.id, debtor: l.debtor_name, result: "skipped_no_contact" });
      continue;
    }

    try {
      const nameParts = (clean(l.person_name) ?? "").split(/\s+/).filter(Boolean);
      const input: ContactInput = {
        email: email ?? undefined,
        phone: phone ?? undefined,
        firstName: nameParts[0],
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined,
        companyName: clean(l.debtor_name) ?? undefined,
        state: clean(l.state) ?? clean(l.debtor_state) ?? undefined,
        source: "UCC Machine",
        tags: tagsFor(l, batchTag, extraTags),
      };

      const up = await upsertContact(cfg, input);
      const contactId = up.data?.contact?.id ?? null;
      if (!contactId) {
        errored++;
        perLead.push({ lead_id: l.id, debtor: l.debtor_name, error: `upsert: ${up.error ?? "no contact id"}` });
        continue;
      }
      // `new` on the upsert response distinguishes create (pushed) vs match (updated).
      const isNew = (up.data as { new?: boolean } | null)?.new === true;

      // Context custom fields (best-effort — a field miss must not fail the load).
      const fields = customFieldsFor(l, keyToId);
      if (fields.length) {
        const cf = await updateContactCustomFields(cfg, contactId, fields);
        if (!cf.ok) console.warn("[ph-ucc-push-ghl] custom fields failed", JSON.stringify({ lead: l.id, status: cf.status, error: cf.error }));
      }

      // Explicit tag attach (belt-and-suspenders on top of upsert tags; tags pre-created).
      await addContactTags(cfg, contactId, input.tags ?? []);

      // Stamp the DB: link the contact, mark loaded + pushed (idempotent).
      const { error: uErr } = await db.from("ph_ucc_leads").update({
        ghl_contact_id: contactId,
        pushed_to_ghl_at: nowIso,
        loaded_at: nowIso,
        status: "loaded",
      }).eq("id", l.id);
      if (uErr) {
        errored++;
        perLead.push({ lead_id: l.id, debtor: l.debtor_name, contact_id: contactId, error: `db stamp: ${uErr.message}` });
        continue;
      }

      if (isNew) pushed++; else updated++;
      perLead.push({
        lead_id: l.id, debtor: l.debtor_name, contact_id: contactId,
        result: isNew ? "pushed" : "updated", channel: phone ? "phone" : "email_only",
      });
    } catch (e) {
      errored++;
      perLead.push({ lead_id: l.id, debtor: l.debtor_name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({
    ok: true,
    batch_tag: batchTag,
    requested: leadIds.length,
    eligible: dialable.length,
    pushed,
    updated,
    skipped_no_contact,
    errors: errored,
    elapsed_ms: Date.now() - started,
    per_lead: perLead,
  });
});
