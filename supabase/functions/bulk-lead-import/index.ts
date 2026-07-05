// bulk-lead-import — bulk CSV lead intake (Paths 1–3 of the Lead Intake spec).
//
// Enforces the single most important intake rule (V2_Lead_Intake_Mechanics_and_SLA.md §A):
//   • source.creates_deal = false (aged / ucc / trigger — identity_only)
//        → NURTURE POOL: insert a `customers` row ONLY (status 'lead', tag 'nurture').
//          NO deal. These never touch the pipeline board until a dialer promotes them.
//   • source.creates_deal = true (web_purchased / aged_transfer)
//        → ACTIVE PIPELINE: insert customer + a `deals` row (deal_type 'mca', status
//          from source.default_status, first_call_due_at = now + first_call_sla_seconds).
//
// Dedup (law, §A.3): every row is matched by normalized phone OR email against existing
// customers. A hit MERGES into the existing customer (adds attribution) and is counted as
// `merged`, never duplicated. If the source creates deals and the customer has no open
// deal, one is created; if they already have an open deal, it's just a touch.
//
// deal_type is ALWAYS 'mca' at intake — VCF is a human re-route decision on the call.
//
// Runs service-role (bypasses RLS) but verify_jwt=true so only an authenticated ops user
// can call it. The caller's uid is stamped as lead_import_batches.imported_by.
//
// Request:  { source_key, column_map, rows, batch_id?, total_rows?, file_name? }
//   column_map: { <targetField>: <csvHeader> }  — target → source header
//   rows:       Record<csvHeader, string>[]      — one chunk of parsed CSV rows
// Response: { imported, merged, rejected, batch_id, sample_errors }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// config source.key → customers.source enum (lead_source). source_details keeps the exact key.
const SOURCE_ENUM: Record<string, string> = {
  aged: "aged_lead",
  ucc: "ucc_lead",
  trigger: "other",
  web_purchased: "website",
  aged_transfer: "live_transfer",
};

// Terminal deal stages — a customer with a deal in one of these is "closed", so a
// re-approach (merge) may open a fresh deal. Anything else counts as an open deal.
const TERMINAL_STATUSES = ["funded", "declined", "dead", "nurture", "lost"];

// ---- normalization ---------------------------------------------------------
function normEmail(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

// Strip to digits; prepend +1 for 10-digit US numbers (or 11-digit starting with 1).
function normPhone(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function s(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
}

interface Parsed {
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  monthly_revenue: number | null;
  time_in_business: number | null;
  credit_score: string | null;
  amount_requested: number | null;
  use_of_funds: string | null;
  existing_positions: string | null;
  lead_date: string | null;
  industry: string | null;
  address_city: string | null;
  address_state: string | null;
}

function mapRow(raw: Record<string, string>, columnMap: Record<string, string>): Parsed {
  const g = (field: string): string | undefined => {
    const header = columnMap[field];
    return header ? raw[header] : undefined;
  };
  // contact_name (single column) → split into first/last when explicit first/last absent.
  let first = s(g("first_name"));
  let last = s(g("last_name"));
  const contact = s(g("contact_name"));
  if (!first && !last && contact) {
    const parts = contact.split(/\s+/);
    first = parts[0] ?? null;
    last = parts.slice(1).join(" ") || null;
  }
  return {
    business_name: s(g("company_name")),
    first_name: first,
    last_name: last,
    phone: normPhone(g("phone")),
    email: normEmail(g("email")),
    monthly_revenue: toNum(g("monthly_revenue")),
    time_in_business: toNum(g("time_in_business")),
    credit_score: s(g("credit_score")),
    amount_requested: toNum(g("amount_requested")),
    use_of_funds: s(g("use_of_funds")),
    existing_positions: s(g("existing_positions")),
    lead_date: s(g("lead_date")),
    industry: s(g("industry")),
    address_city: s(g("address_city")),
    address_state: s(g("address_state")),
  };
}

// The qual payload stored on customers.lead_qual (and deals.lead_qual for warm sources).
function buildQual(p: Parsed): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  if (p.monthly_revenue != null) q.monthly_revenue = p.monthly_revenue;
  if (p.time_in_business != null) q.time_in_business = p.time_in_business;
  if (p.credit_score) q.credit_score = p.credit_score;
  if (p.amount_requested != null) q.amount_requested = p.amount_requested;
  if (p.use_of_funds) q.use_of_funds = p.use_of_funds;
  if (p.existing_positions) q.existing_positions = p.existing_positions;
  if (p.lead_date) {
    q.lead_date = p.lead_date;
    const t = Date.parse(p.lead_date);
    if (!Number.isNaN(t)) {
      q.lead_age_days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
    }
  }
  return q;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    source_key?: string;
    column_map?: Record<string, string>;
    rows?: Record<string, string>[];
    batch_id?: string;
    total_rows?: number;
    file_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const sourceKey = String(body.source_key ?? "").trim();
  const columnMap = body.column_map ?? {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!sourceKey) return json({ error: "source_key is required" }, 400);
  if (!rows.length) return json({ error: "rows is empty" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: ops staff only (admin / super_admin). verify_jwt only proves the
  // token is validly signed — the public anon key passes it — so we MUST role-check the
  // caller in code before touching the DB with the service role. Mirrors submit-to-funders.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Unauthorized" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — admin only" }, 403);
  }
  const importedBy = caller.id;

  // Load + validate the source config. Bulk importer only handles bulk_csv feeds.
  const { data: source, error: srcErr } = await db
    .from("inbound_lead_sources")
    .select("key, feed_type, qual_richness, creates_deal, temperature, default_status, first_call_sla_seconds")
    .eq("key", sourceKey)
    .maybeSingle();
  if (srcErr) return json({ error: `could not load source: ${srcErr.message}` }, 500);
  if (!source) return json({ error: `unknown source_key '${sourceKey}'` }, 400);
  if (source.feed_type !== "bulk_csv") {
    return json({ error: `source '${sourceKey}' is not a bulk_csv feed` }, 400);
  }

  const createsDeal: boolean = !!source.creates_deal;
  const temperature: string = source.temperature ?? "cold";
  const defaultStatus: string = source.default_status ?? "new";
  const sla: number | null = source.first_call_sla_seconds ?? null;
  const sourceEnum = SOURCE_ENUM[sourceKey] ?? "other";

  // Batch: reuse across chunks so one CSV = one batch row.
  let batchId = body.batch_id ?? null;
  if (!batchId) {
    const { data: batch, error: bErr } = await db
      .from("lead_import_batches")
      .insert({
        source_key: sourceKey,
        file_name: body.file_name ?? null,
        row_count: body.total_rows ?? rows.length,
        imported_count: 0,
        merged_count: 0,
        rejected_count: 0,
        column_map: columnMap,
        imported_by: importedBy,
      })
      .select("id")
      .single();
    if (bErr || !batch) return json({ error: `could not create batch: ${bErr?.message}` }, 500);
    batchId = batch.id;
  }

  // ---- pass 1: parse + validate ------------------------------------------
  interface Valid {
    raw: Record<string, string>;
    p: Parsed;
    qual: Record<string, unknown>;
  }
  const valid: Valid[] = [];
  const logs: Record<string, unknown>[] = [];
  const sampleErrors: string[] = [];
  let rejected = 0;

  for (const raw of rows) {
    const p = mapRow(raw, columnMap);
    // Need a way to reach them (phone OR email) AND a name to file under (business OR contact).
    if (!p.phone && !p.email) {
      rejected++;
      const err = "no valid phone or email";
      if (sampleErrors.length < 5) sampleErrors.push(err);
      logs.push({ batch_id: batchId, source_key: sourceKey, feed_type: "bulk_csv", status: "rejected", raw, parsed: p, error: err });
      continue;
    }
    if (!p.business_name && !p.first_name) {
      rejected++;
      const err = "no business name or contact name";
      if (sampleErrors.length < 5) sampleErrors.push(err);
      logs.push({ batch_id: batchId, source_key: sourceKey, feed_type: "bulk_csv", status: "rejected", raw, parsed: p, error: err });
      continue;
    }
    valid.push({ raw, p, qual: buildQual(p) });
  }

  // ---- dedup lookup: batch-fetch existing customers by email + phone ------
  const emails = [...new Set(valid.map((v) => v.p.email).filter(Boolean) as string[])];
  const phones = [...new Set(valid.map((v) => v.p.phone).filter(Boolean) as string[])];
  const byEmail = new Map<string, { id: string; tags: string[] | null; lead_qual: Record<string, unknown> | null; import_batch_id: string | null; business_name: string | null; first_name: string | null }>();
  const byPhone = new Map<string, { id: string; tags: string[] | null; lead_qual: Record<string, unknown> | null; import_batch_id: string | null; business_name: string | null; first_name: string | null }>();

  const CUST_COLS = "id, email, phone, tags, lead_qual, import_batch_id, business_name, first_name";
  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  for (const part of chunk(emails, 300)) {
    const { data } = await db.from("customers").select(CUST_COLS).in("email", part);
    for (const c of data ?? []) if (c.email) byEmail.set(c.email.toLowerCase(), c);
  }
  for (const part of chunk(phones, 300)) {
    const { data } = await db.from("customers").select(CUST_COLS).in("phone", part);
    for (const c of data ?? []) if (c.phone) byPhone.set(c.phone, c);
  }

  // ---- pass 2: create / merge -------------------------------------------
  let imported = 0;
  let merged = 0;

  const firstCallDueAt = () =>
    createsDeal && sla != null ? new Date(Date.now() + sla * 1000).toISOString() : null;

  // Create the mca deal for a customer if they have no open one. Returns the deal id (or null).
  async function ensureDeal(customerId: string, p: Parsed, qual: Record<string, unknown>): Promise<string | null> {
    const { data: openDeal } = await db
      .from("deals")
      .select("id")
      .eq("customer_id", customerId)
      .eq("deal_type", "mca")
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openDeal) return null; // already on the board — a touch, not a new deal
    const { data: deal, error } = await db
      .from("deals")
      .insert({
        customer_id: customerId,
        deal_type: "mca",
        status: defaultStatus,
        temperature,
        lead_source: sourceKey,
        lead_qual: qual,
        first_call_due_at: firstCallDueAt(),
        amount_requested: p.amount_requested,
        use_of_funds: p.use_of_funds,
      })
      .select("id")
      .single();
    if (error) throw new Error(`deal insert failed: ${error.message}`);
    return deal.id;
  }

  for (const v of valid) {
    const { p, qual, raw } = v;
    const existing =
      (p.email ? byEmail.get(p.email) : undefined) ??
      (p.phone ? byPhone.get(p.phone) : undefined);

    try {
      if (existing) {
        // MERGE: add attribution, backfill blanks, union tags, merge qual.
        // A warm source (creates_deal) pulls the contact ONTO the board, so it leaves
        // the pool (drop 'nurture'); a cold source keeps/adds the 'nurture' tag.
        let mergedTags = [...new Set([...(existing.tags ?? []), sourceKey])];
        if (createsDeal) mergedTags = mergedTags.filter((t) => t !== "nurture");
        else mergedTags = [...new Set([...mergedTags, "nurture"])];
        const patch: Record<string, unknown> = {
          tags: mergedTags,
          lead_qual: { ...(existing.lead_qual ?? {}), ...qual },
        };
        if (!existing.business_name && p.business_name) patch.business_name = p.business_name;
        if (existing.import_batch_id == null) patch.import_batch_id = batchId;
        const { error: uErr } = await db.from("customers").update(patch).eq("id", existing.id).select("id");
        if (uErr) throw new Error(`customer merge failed: ${uErr.message}`);

        let dealId: string | null = null;
        if (createsDeal) dealId = await ensureDeal(existing.id, p, qual);

        merged++;
        logs.push({ batch_id: batchId, source_key: sourceKey, feed_type: "bulk_csv", status: "merged", customer_id: existing.id, deal_id: dealId, dedupe_of: existing.id, raw, parsed: p });
      } else {
        // CREATE new customer.
        const tags = createsDeal ? [sourceKey] : ["nurture", sourceKey];
        const { data: cust, error: cErr } = await db
          .from("customers")
          .insert({
            first_name: p.first_name ?? p.business_name ?? "Unknown",
            last_name: p.last_name ?? "",
            email: p.email,
            phone: p.phone,
            business_name: p.business_name,
            status: "lead",
            source: sourceEnum,
            source_details: sourceKey,
            temperature,
            import_batch_id: batchId,
            tags,
            lead_qual: qual,
            monthly_revenue: p.monthly_revenue,
            time_in_business: p.time_in_business,
            amount_requested: p.amount_requested,
            use_of_funds: p.use_of_funds,
            credit_score_range: p.credit_score,
            industry: p.industry,
            address_city: p.address_city,
            address_state: p.address_state,
          })
          .select("id")
          .single();
        if (cErr || !cust) throw new Error(`customer insert failed: ${cErr?.message}`);

        let dealId: string | null = null;
        if (createsDeal) {
          const { data: deal, error: dErr } = await db
            .from("deals")
            .insert({
              customer_id: cust.id,
              deal_type: "mca",
              status: defaultStatus,
              temperature,
              lead_source: sourceKey,
              lead_qual: qual,
              first_call_due_at: firstCallDueAt(),
              amount_requested: p.amount_requested,
              use_of_funds: p.use_of_funds,
            })
            .select("id")
            .single();
          if (dErr) throw new Error(`deal insert failed: ${dErr.message}`);
          dealId = deal.id;
        }

        // Register in the in-memory dedup maps so later rows in THIS chunk fold in.
        const rec = { id: cust.id, tags, lead_qual: qual, import_batch_id: batchId, business_name: p.business_name, first_name: p.first_name };
        if (p.email) byEmail.set(p.email, rec);
        if (p.phone) byPhone.set(p.phone, rec);

        imported++;
        logs.push({ batch_id: batchId, source_key: sourceKey, feed_type: "bulk_csv", status: "created", customer_id: cust.id, deal_id: dealId, raw, parsed: p });
      }
    } catch (e) {
      rejected++;
      const err = e instanceof Error ? e.message : String(e);
      if (sampleErrors.length < 5) sampleErrors.push(err);
      logs.push({ batch_id: batchId, source_key: sourceKey, feed_type: "bulk_csv", status: "rejected", raw, parsed: p, error: err });
    }
  }

  // ---- persist per-row logs (chunked) ------------------------------------
  for (const part of chunk(logs, 500)) {
    const { error } = await db.from("lead_intake_log").insert(part);
    if (error) console.error("bulk-lead-import: intake log insert failed", error.message);
  }

  // ---- roll chunk deltas into the batch counters -------------------------
  const { data: cur } = await db
    .from("lead_import_batches")
    .select("imported_count, merged_count, rejected_count")
    .eq("id", batchId)
    .single();
  await db
    .from("lead_import_batches")
    .update({
      imported_count: (cur?.imported_count ?? 0) + imported,
      merged_count: (cur?.merged_count ?? 0) + merged,
      rejected_count: (cur?.rejected_count ?? 0) + rejected,
    })
    .eq("id", batchId);

  return json({ imported, merged, rejected, batch_id: batchId, sample_errors: sampleErrors });
});
