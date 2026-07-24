// underwrite-deal — AI Internal Underwriter (Phase 1).
//
// Analyzes a deal's bank statements with Claude and produces an affordability-
// focused risk read. Three passes:
//   A) EXTRACTION (Claude, extraction_model) — each bank-statement PDF is sent as
//      a native PDF document block; the model returns structured per-statement
//      figures (deposits, withdrawals, balances, NSF, negative days, and classified
//      padding + MCA debits).
//   B) AGGREGATION (deterministic TS, NO AI) — computes the metrics object incl.
//      true revenue (deposits − padding), safe daily debit capacity, max affordable
//      advance, debt-service %, and builds flags from the admin-tunable thresholds.
//   C) JUDGE (Claude, judge_model) — given the metrics + flags + the funders'
//      minimums, returns a short narrative + risk_rating + a paper/fit note.
//
// It NEVER moves money. An MCA is a purchase of future receivables, NOT a loan —
// the prompts enforce receivables language.
//
// POST body: { dealId: string, mode?: 'manual' | 'auto' }
//   manual — signed-in admin/super_admin, or a closer running THEIR OWN deal.
//   auto   — invoked server-side with the service-role key (e.g. from ghl-webhook
//            when new bank statements arrive). Deduped by docs_hash so an identical
//            doc set never re-runs. Manual runs ALWAYS run.
//
// verify_jwt = true — but a service-role bearer (SUPABASE_SERVICE_ROLE_KEY) is
// accepted for auto calls (detected below), mirroring how other functions let the
// platform invoke them server-side.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { ingestGhlDocuments } from "../_shared/ghlDocs.ts";
import { reconcileDocumentType } from "../_shared/docClassify.ts";
import { callAnthropicBlocks, callLLM } from "../_shared/llm.ts";
import { fireAndForgetScore } from "../_shared/scoreLeadInvoke.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DOC_BUCKET = "customer-documents";
const SIGNED_URL_TTL = 10 * 60; // 10 min — just long enough to fetch the bytes.

// Business-day assumptions used across the affordability math (documented once):
//   ~21 business days per month → daily revenue = monthly / 21.
//   ~4.33 weeks per month (52/12) → weekly figures convert monthly ÷ 4.33.
//   ~110 business days ≈ a 5–6 month MCA term → the LEGACY max affordable advance is
//   roughly the safe daily debit capacity sustained over that term. (The first-class
//   affordability block below uses the admin-tunable term_daily_biz_days /
//   term_weekly_weeks + factor instead — this constant stays for backward compat.)
const BIZ_DAYS_PER_MONTH = 21;
const WEEKS_PER_MONTH = 52 / 12; // 4.333…
const BIZ_DAYS_PER_WEEK = 5;
const TERM_BIZ_DAYS = 110;

// Coded fallback settings — used when no underwriting_settings row exists (the
// migration seeds one, so this is just belt-and-suspenders).
const DEFAULT_SETTINGS = {
  padding_categories: {
    zelle: true, venmo: true, cashapp: true, paypal_personal: true,
    internal_transfer: true, owner_deposit: true, reversal: true,
    round_number: true, same_day_in_out: true,
  } as Record<string, boolean>,
  revenue_quality_flag_pct: 85,
  holdback_ceiling_pct: 15,
  nsf_monthly_cap: 5,
  negative_days_flag: 3,
  debt_service_flag_pct: 20,
  min_avg_daily_balance: null as number | null,
  // ── First-class affordability knobs (see 20260710 migration). ──
  // Total debt-service ceiling (existing positions + new advance) as a % of TRUE
  // monthly revenue. Industry MCA sizing is 8–15%; 10% = middle of the band.
  max_payment_pct_of_revenue: 10,
  // Second, independent guard: the NEW payment may not exceed this % of the worst
  // month's average daily balance (a thin-balance merchant can't be sized on
  // revenue math alone).
  balance_buffer_pct: 50,
  // Assumed MCA structure used to convert a sustainable payment → an advance size
  // (advance = payment × term ÷ factor). Shown for BOTH daily and weekly remits.
  affordability_factor_rate: 1.35,
  term_daily_biz_days: 120,
  term_weekly_weeks: 26,
  // How to treat recurring third-party PAYROLL paid to the OWNER's own name — a
  // judgment call between business commission income and personal W-2 pay.
  // 'count' | 'flag_and_discount' (default: count but flag + compute downside) | 'exclude'.
  owner_payroll_treatment: "flag_and_discount" as "count" | "flag_and_discount" | "exclude",
  extraction_model: "claude-sonnet-4-6",
  judge_model: "claude-opus-4-8",
};

type Settings = typeof DEFAULT_SETTINGS;

// deno-lint-ignore no-explicit-any
type Any = Record<string, any>;

const num = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const numOr0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// FNV-1a hash of a string → stable short hex. Used for docs_hash so an identical
// analyzed doc set (same ids + timestamps) produces the same hash across runs.
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---- Per-statement extraction shape (what Claude returns per PDF) -----------
interface PerStatement {
  month: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  avg_daily_balance: number | null;
  min_balance: number | null;
  negative_days: number | null;
  nsf_count: number | null;
  // TOTAL count of deposit/credit transactions posted in the month (every credit
  // line). The "true" (non-padding) deposit count shown per-month is derived
  // deterministically in aggregation as deposit_count − padding items.
  deposit_count: number | null;
  account_last4: string | null;
  deposits: Array<{ date?: string; desc?: string; amount?: number; classified_type?: string }>;
  padding_deposits: Array<{ date?: string; desc?: string; amount?: number; category?: string }>;
  // Recurring third-party PAYROLL paid to the OWNER's own name (and similar
  // owner-personal-income patterns) — a distinct bucket from padding. Whether it
  // counts as true revenue is a judgment call resolved by owner_payroll_treatment.
  questionable_deposits: Array<{ date?: string; desc?: string; amount?: number; source?: string; reason?: string }>;
  mca_debits: Array<{ date?: string; desc?: string; amount?: number; cadence?: string }>;
  _filename?: string;
  _error?: string;
  // Provenance for post-extraction period dedup (not sent to Claude / persisted for
  // debugging only): how many source files collapsed into this unique period.
  _dupe_count?: number;
}

function extractionSystem(enabledCategories: string[]): string {
  return (
    "You are a bank-statement analyst for an MCA underwriter at an ISO (broker). " +
    "An MCA is a purchase of future receivables, NOT a loan — never call it a loan. " +
    "You are given ONE business bank statement as a PDF. Read it and return STRICT JSON " +
    "describing that statement. Be precise and conservative; if a figure is not present, use null. " +
    "Classify each notable deposit's classified_type as one of: 'sales_revenue', 'transfer', " +
    "'owner_deposit', 'loan_or_advance', 'refund_reversal', 'other'. " +
    "Separately, list PADDING deposits — deposits that are NOT true operating sales revenue and should " +
    "be REMOVED when computing real revenue. ONLY classify a deposit as padding if its category is one " +
    "of these ENABLED categories: [" + enabledCategories.join(", ") + "]. " +
    "Padding categories mean: zelle/venmo/cashapp = peer-to-peer app transfers in; paypal_personal = " +
    "personal (non-merchant) PayPal transfers; internal_transfer = transfer between the owner's own " +
    "accounts; owner_deposit = owner capital injection / personal money in; reversal = a returned/reversed " +
    "debit credited back; round_number = suspiciously round large deposits inconsistent with sales; " +
    "same_day_in_out = money deposited and withdrawn same day (wash). If a category is NOT in the enabled " +
    "list, do NOT treat that type as padding. " +
    "SEPARATELY from padding, list QUESTIONABLE deposits: recurring third-party PAYROLL deposits paid to the " +
    "OWNER's own name (e.g. an ACH labeled 'DES:PAYROLL' / 'PAYROLL' with 'INDN:<owner name>', or similar " +
    "owner-personal-income patterns like recurring W-2-style direct deposits to the owner). These are AMBIGUOUS: " +
    "they may be legitimate business commission income OR personal employment pay — do NOT put them in " +
    "padding_deposits and do NOT silently drop them; capture each with the paying source and why it's ambiguous. " +
    "Also list MCA/advance DEBITS — recurring daily or weekly fixed withdrawals that look like an existing " +
    "merchant cash advance / receivables purchase remittance (cadence: 'daily' | 'weekly' | 'unknown'). " +
    "Return the statement's account_last4 (last 4 digits of the account number) if visible, else null. " +
    "You MUST fill every field of the report_statement tool for THIS statement — do not omit any. " +
    "Every real bank statement shows an ENDING balance and a statement period, so closing_balance and month are " +
    "ALWAYS present, never null. Provide avg_daily_balance from the statement's average-daily-balance line if " +
    "printed, otherwise estimate it from the running daily ledger balances (do not leave it null). " +
    "negative_days = the number of days the ledger balance was below zero (0 if none). " +
    "deposit_count = the TOTAL number of deposit/credit transactions posted in the month — count EVERY credit " +
    "line item (sales, transfers, owner deposits, everything). It must be >= the number of deposits you list and " +
    "must NEVER be 0 when the statement has any deposits. Padding is handled separately via padding_deposits — do " +
    "NOT subtract padding from deposit_count. " +
    "Call the report_statement tool with your findings (do not also write prose)."
  );
}

// The extraction tool — a structured schema whose required fields the model cannot
// omit. Forcing a single tool call is what guarantees the four owner-mandated
// per-statement fields (deposit_count, ending/closing balance, avg daily balance,
// negative_days) are always present, unlike a free-form JSON prompt where the model
// silently dropped deposit_count on some statements.
const EXTRACTION_TOOL = {
  name: "report_statement",
  description: "Report the extracted figures for exactly one business bank statement.",
  input_schema: {
    type: "object",
    properties: {
      month: { type: ["string", "null"], description: "Statement period, e.g. 'March 2026'. Always present on a real statement." },
      account_last4: { type: ["string", "null"] },
      opening_balance: { type: ["number", "null"] },
      closing_balance: { type: "number", description: "Ending balance shown on the statement. Always present." },
      total_deposits: { type: ["number", "null"], description: "Sum of all deposits/credits for the month." },
      total_withdrawals: { type: ["number", "null"] },
      avg_daily_balance: { type: "number", description: "Average daily balance — from the statement if printed, else estimated from daily ledger balances." },
      min_balance: { type: ["number", "null"] },
      negative_days: { type: "integer", description: "Count of days the balance was negative (0 if none)." },
      nsf_count: { type: ["integer", "null"] },
      deposit_count: { type: "integer", description: "TOTAL count of deposit/credit transactions this month; never 0 when deposits exist." },
      deposits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" },
            classified_type: { type: "string" },
          },
        },
      },
      padding_deposits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" }, category: { type: "string" },
          },
        },
      },
      questionable_deposits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" },
            source: { type: "string" }, reason: { type: "string" },
          },
        },
      },
      mca_debits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" }, cadence: { type: "string" },
          },
        },
      },
    },
    required: [
      "month", "closing_balance", "avg_daily_balance", "negative_days", "deposit_count",
      "total_deposits", "deposits", "padding_deposits", "questionable_deposits", "mca_debits",
    ],
  },
};

// Decode a JWT's payload and return its "role" claim (no signature check — used
// ONLY to recognize a service_role token for trusted server-side auto calls; the
// token still had to be a valid bearer to reach an authenticated request path).
function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64)) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function safeParseJson(text: string): Any | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { dealId?: string; mode?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = body.dealId;
  const mode = body.mode === "auto" ? "auto" : "manual";
  if (!dealId) return json({ error: "dealId is required" }, 400);

  const db = serviceClient();

  // --- Auth. A service-role bearer marks a trusted server-side auto call (e.g.
  // from ghl-webhook). Otherwise the caller must be signed-in staff; a closer may
  // run only their OWN deal (mirrors submit-to-funders). We detect the service key
  // two ways for robustness: equality with the injected SUPABASE_SERVICE_ROLE_KEY,
  // OR a JWT whose "role" claim is "service_role" (the key format env can vary).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceCall = !!token && (token === serviceKey || jwtRole(token) === "service_role");

  let callerId: string | null = null;
  if (!isServiceCall) {
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    callerId = caller.id;
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
    if (role === "closer") {
      const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
      if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
    }
  }

  try {
    // --- Settings (fall back to coded defaults if the singleton is missing). ---
    const { data: sRow } = await db
      .from("underwriting_settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...(sRow ?? {}),
      padding_categories: {
        ...DEFAULT_SETTINGS.padding_categories,
        ...((sRow?.padding_categories as Record<string, boolean> | undefined) ?? {}),
      },
    };
    const enabledCategories = Object.entries(settings.padding_categories)
      .filter(([, on]) => on === true)
      .map(([k]) => k);

    // --- Deal + customer. ---
    const { data: deal, error: dErr } = await db
      .from("deals")
      .select("id, deal_number, deal_type, amount_requested, use_of_funds, customer_id, vcf_active_positions, vcf_daily_debit, customer:customers!customer_id(business_name, monthly_revenue, time_in_business, industry, business_type, address_state, ghl_contact_id)")
      .eq("id", dealId).maybeSingle();
    if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);
    const cust = (deal.customer ?? {}) as Any;

    // --- Documents: bank statements (analyzed) + applications (context only). ---
    const loadDocs = async (): Promise<Any[]> => {
      const { data: rows, error } = await db
        .from("customer_documents")
        .select("id, document_type, filename, storage_path, mime_type, created_at, updated_at")
        .eq("customer_id", deal.customer_id)
        .in("document_type", ["bank_statement", "application"]);
      if (error) throw new Error(`could not read documents: ${error.message}`);
      return (rows ?? []) as Any[];
    };

    // ── PREFLIGHT: content-classify any "other"-typed docs BEFORE selecting bank
    // statements. This is the direct fix for the SIS-Financial failure: three bank
    // statements were typed "other" (filename had no "statement") and the underwriter
    // never saw them. Reading the first page corrects the type so they're analyzed.
    // Best-effort, never throws (docClassify guarantees it).
    let reclassifiedNote: string | null = null;
    try {
      const { data: otherDocs } = await db
        .from("customer_documents")
        .select("id")
        .eq("customer_id", deal.customer_id)
        .eq("document_type", "other");
      if (otherDocs && otherDocs.length) {
        const outcomes = await Promise.all(
          otherDocs.map((d) => reconcileDocumentType(db, { documentId: d.id as string, authority: "machine" })),
        );
        const promoted = outcomes.filter((o) => o.changed);
        if (promoted.length) {
          const toBank = promoted.filter((o) => o.to === "bank_statement").length;
          reclassifiedNote = `Content-corrected ${promoted.length} previously-"other" document(s) before underwriting` +
            (toBank ? ` (${toBank} now bank statement${toBank === 1 ? "" : "s"})` : "") + ".";
          console.log(`[underwrite-deal] preflight reclassify for deal ${deal.deal_number}: ${reclassifiedNote}`);
        }
      }
    } catch (e) {
      console.warn("[underwrite-deal] preflight reclassify failed:", e instanceof Error ? e.message : e);
    }

    let docs = await loadDocs();
    let bankDocs = docs.filter((d) => d.document_type === "bank_statement");

    // ── SELF-HEAL: the merchant's statements usually live in GHL, not here. ──
    // Merchants upload through the GHL secure-upload link, so their files sit on the
    // GHL contact's FILE_UPLOAD fields. The playbook's doc checklist reads GHL and
    // shows them ticked, but this function reads `customer_documents` — which was
    // EMPTY for every real merchant, so underwriting 422'd on every genuine deal.
    // When we find nothing locally, pull the files across (read-only against GHL,
    // idempotent on external_ref) and re-read, so "Run underwriting" simply works.
    let ingestNote: string | null = null;
    const ghlContactId = (cust.ghl_contact_id as string | null | undefined) ?? null;
    if (bankDocs.length === 0 && ghlContactId) {
      try {
        const res = await ingestGhlDocuments(db, deal.customer_id as string, ghlContactId);
        console.log(
          `[underwrite-deal] GHL ingest for deal ${deal.deal_number}: found=${res.found} synced=${res.synced} skipped=${res.skipped} failed=${res.failed} bank=${res.bankStatementsAdded}`,
        );
        if (res.synced > 0) {
          ingestNote = `Imported ${res.synced} document(s) the merchant uploaded in GoHighLevel.`;
          docs = await loadDocs();
          bankDocs = docs.filter((d) => d.document_type === "bank_statement");
        }
      } catch (e) {
        console.warn("[underwrite-deal] GHL ingest failed:", e instanceof Error ? e.message : e);
      }
    }

    if (bankDocs.length === 0) {
      return json({
        error: ghlContactId
          ? "No bank statements on file for this deal yet — nothing found in our storage or on the merchant's GoHighLevel contact."
          : "No bank statements on file for this deal yet.",
        dealId,
      }, 422);
    }

    // --- docs_hash: stable hash of the analyzed doc set (bank + application),
    // sorted by id, each id + its last-touched timestamp. If auto mode and the
    // latest run already analyzed this exact set, skip (dedup the trickle-in case).
    const hashSource = docs
      .map((d) => `${d.id}:${d.updated_at ?? d.created_at ?? ""}`)
      .sort()
      .join("|");
    const docsHash = stableHash(hashSource);

    if (mode === "auto") {
      const { data: last } = await db
        .from("deal_underwriting")
        .select("id, docs_hash, version")
        .eq("deal_id", dealId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.docs_hash === docsHash) {
        return json({ ok: true, skipped: true, reason: "docs_hash unchanged", dealId, version: last.version });
      }
    }

    // ---- PASS A: EXTRACTION (Claude reads each bank-statement PDF) ----
    // Statements are independent, so extract them CONCURRENTLY — 6 statements in
    // series would blow the edge-function wall-clock; in parallel it's one round
    // trip's latency. Each task never throws (errors become an _error statement).
    const exSystem = extractionSystem(enabledCategories);

    // Step 1: fetch each bank doc, compute a content hash, and base64-encode it —
    // then DROP the raw bytes (keeping only the b64 string) to stay within the edge
    // worker's memory wall on a many-statement deal. The hash lets us DEDUP
    // byte-identical uploads BEFORE spending a Claude call: if a merchant uploads the
    // exact same file twice (even renamed), we send it to Claude once and reuse the
    // extraction for every copy.
    const loadOne = async (d: Any): Promise<{ filename: string; hash: string | null; b64: string | null; err?: string }> => {
      const filename = (d.filename as string) || "statement.pdf";
      const isPdf = /pdf/i.test((d.mime_type as string) || "") || /\.pdf$/i.test(filename);
      if (!isPdf) return { filename, hash: null, b64: null, err: "not a PDF — skipped from extraction" };
      const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, SIGNED_URL_TTL);
      const url = signed?.signedUrl;
      if (!url) return { filename, hash: null, b64: null, err: "could not sign URL" };
      try {
        const bin = await fetch(url);
        if (!bin.ok) return { filename, hash: null, b64: null, err: `fetch ${bin.status}` };
        const bytes = new Uint8Array(await bin.arrayBuffer());
        if (!bytes.length) return { filename, hash: null, b64: null, err: "empty file" };
        const hash = `${bytes.length}:${hashBytes(bytes)}`;
        const b64 = base64FromBytes(bytes);
        return { filename, hash, b64 }; // raw bytes go out of scope here.
      } catch (e) {
        return { filename, hash: null, b64: null, err: `fetch error: ${e instanceof Error ? e.message : e}` };
      }
    };
    const loaded = await Promise.all(bankDocs.map(loadOne));

    // Group by the byte fingerprint. Byte-identical files share one Claude extraction;
    // the result is fanned back to every copy.
    const groups = new Map<string, { b64: string; filenames: string[] }>();
    for (const l of loaded) {
      if (!l.b64 || !l.hash) continue; // non-PDF / fetch errors: handled individually below.
      const g = groups.get(l.hash);
      if (g) g.filenames.push(l.filename);
      else groups.set(l.hash, { b64: l.b64, filenames: [l.filename] });
    }

    const extractGroup = async (g: { b64: string; filenames: string[] }): Promise<PerStatement> => {
      const filename = g.filenames[0];
      // Transient failures are common on real runs — the API overloads (HTTP 529/429)
      // or the model returns a JSON near-miss. One short retry recovers most of them
      // without pushing the whole (concurrent) run past the worker wall-clock/CPU wall.
      const MAX_ATTEMPTS = 2;
      let lastErr = "extraction failed";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const text = await callAnthropicBlocks(
            db,
            settings.extraction_model,
            [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: g.b64 } },
              { type: "text", text: "Extract this bank statement per your instructions and call the report_statement tool." },
            ],
            // A busy month has a long deposits/mca_debits array — 4096 tokens can
            // truncate the tool JSON mid-array and fail parsing, so give it room.
            // Forcing report_statement guarantees the required per-statement fields.
            {
              system: exSystem, maxTokens: 8192, temperature: 0, jsonMode: true,
              tools: [EXTRACTION_TOOL],
              toolChoice: { type: "tool", name: "report_statement" },
            },
          );
          const parsed = safeParseJson(text);
          if (!parsed) { lastErr = "could not parse extraction JSON"; }
          else {
            const st = normalizeStatement(parsed, filename);
            // A byte-identical duplicate uploaded twice yields the SAME result as once.
            st._dupe_count = g.filenames.length;
            return st;
          }
        } catch (e) {
          lastErr = `extraction error: ${e instanceof Error ? e.message : e}`;
        }
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 600));
      }
      return emptyStatement(filename, lastErr);
    };

    // Extract one statement per unique byte-set, plus carry through the non-PDF /
    // fetch-error docs as _error statements (so extraction_gaps still counts them).
    const errorStatements = loaded
      .filter((l) => !l.b64)
      .map((l) => emptyStatement(l.filename, l.err ?? "could not load file"));
    const extracted = await Promise.all(Array.from(groups.values()).map(extractGroup));
    let perStatement: PerStatement[] = [...extracted, ...errorStatements];

    // Post-extraction PERIOD dedup: even non-byte-identical files can be the same
    // statement (re-scanned, re-exported, renamed). Dedup successful extractions by
    // (account, period); keep the richer extraction (more line items), first on tie.
    // Net effect: the same statement uploaded twice produces the same result as once.
    perStatement = dedupByPeriod(perStatement);

    // ---- PASS B: AGGREGATION (deterministic — no AI) ----
    // Aggregation runs over the UNIQUE set only, so months_covered /
    // statements_analyzed / all revenue math never double-count a duplicate.
    const analyzed = perStatement.filter((s) => !s._error);
    // DISTINCT calendar months — a two-account merchant's pair of April statements
    // is ONE month of coverage, not two. (statements_analyzed carries the file
    // count.) Fall back to the statement count only when no month labels came back.
    const monthsCovered =
      new Set(analyzed.map((s) => String(s.month ?? "").trim().toLowerCase()).filter(Boolean)).size ||
      analyzed.length;

    // Explicit per-month table rows (chronologically sortable in the UI):
    // month | true deposit count | true-deposit $ | ending balance | avg daily balance | negative days.
    const perMonth: Array<{
      month: string | null;
      deposit_count: number | null;
      true_deposits: number;
      ending_balance: number | null;
      average_daily_balance: number | null;
      negative_days: number;
    }> = [];
    const perMonthReported: number[] = [];
    const perMonthPadding: number[] = [];
    // Owner-payroll ("questionable") revenue per month — deposits that ARE credited
    // as true revenue by default but are a judgment call (see owner_payroll_treatment).
    const perMonthQuestionable: number[] = [];
    const perMonthNet: number[] = [];
    const paddingByCategory: Record<string, number> = {};
    const questionableBySource: Record<string, number> = {};
    let nsfTotal = 0;
    let negativeDays = 0;
    const balances: number[] = [];
    const minBalances: number[] = [];
    // Statements whose owner-mandated per-month fields had to be repaired/inferred
    // (e.g. the model returned deposit_count 0 despite deposits, or omitted a
    // balance). Surfaced as a data_quality flag — never silently stored.
    const dataQualityIssues: string[] = [];
    let mcaDebitTotal = 0;
    let mcaDebitDaily = 0; // best estimate of existing daily debit
    const openPositionKeys = new Set<string>();

    for (const s of analyzed) {
      const reported = numOr0(s.total_deposits);
      const padding = (s.padding_deposits ?? []).reduce((sum, p) => {
        const amt = Math.abs(numOr0(p.amount));
        if (p.category) paddingByCategory[p.category] = (paddingByCategory[p.category] ?? 0) + amt;
        return sum + amt;
      }, 0);
      const questionable = (s.questionable_deposits ?? []).reduce((sum, q) => {
        const amt = Math.abs(numOr0(q.amount));
        // Collapse case/whitespace variants of the same payer (e.g. "Your Health
        // Quot" vs "YOUR HEALTH QUOT") so the by-source breakdown doesn't split one
        // source into two lines.
        const src = (q.source || q.desc || "owner payroll").toString().trim().toUpperCase().replace(/\s+/g, " ").slice(0, 80);
        questionableBySource[src] = (questionableBySource[src] ?? 0) + amt;
        return sum + amt;
      }, 0);
      // "net" (true revenue) = deposits − padding. Questionable owner-payroll is NOT
      // padding, so by default it stays IN net (the 'count' / 'flag_and_discount'
      // behavior). It is subtracted below only when treatment == 'exclude'.
      const net = Math.max(0, reported - padding);
      perMonthReported.push(reported);
      perMonthPadding.push(padding);
      perMonthQuestionable.push(questionable);
      perMonthNet.push(net);
      nsfTotal += numOr0(s.nsf_count);
      const monthNegDays = numOr0(s.negative_days);
      negativeDays += monthNegDays;
      if (s.avg_daily_balance != null) balances.push(numOr0(s.avg_daily_balance));
      if (s.min_balance != null) minBalances.push(numOr0(s.min_balance));

      // Per-month row.
      const label = s.month ?? s._filename ?? "a statement";
      const listedDeposits = s.deposits?.length ?? 0;
      const paddingItems = s.padding_deposits?.length ?? 0;
      // TOTAL credit count from the model. Repair when it's missing or implausibly
      // zero while deposits clearly exist — fall back to the listed-deposit count
      // and record a data-quality note (never silently store a 0).
      let totalDepositCount: number | null =
        s.deposit_count != null ? Math.max(0, Math.round(numOr0(s.deposit_count))) : null;
      if ((totalDepositCount == null || totalDepositCount === 0) && (listedDeposits > 0 || reported > 0)) {
        totalDepositCount = listedDeposits > 0 ? listedDeposits : null;
        dataQualityIssues.push(`${label}: deposit count came back 0 despite $${Math.round(reported).toLocaleString("en-US")} in deposits — inferred ${totalDepositCount ?? "n/a"} from line items`);
      }
      // TRUE (revenue) deposit count = total credits − padding transactions.
      const trueDepositCount = totalDepositCount != null ? Math.max(0, totalDepositCount - paddingItems) : null;
      if (s.closing_balance == null) dataQualityIssues.push(`${label}: no ending balance extracted`);
      if (s.avg_daily_balance == null) dataQualityIssues.push(`${label}: no average daily balance extracted`);
      perMonth.push({
        month: s.month,
        deposit_count: trueDepositCount,
        true_deposits: round2(net),
        ending_balance: s.closing_balance != null ? round2(numOr0(s.closing_balance)) : null,
        average_daily_balance: s.avg_daily_balance != null ? round2(numOr0(s.avg_daily_balance)) : null,
        negative_days: monthNegDays,
      });

      for (const dbt of (s.mca_debits ?? [])) {
        const amt = Math.abs(numOr0(dbt.amount));
        mcaDebitTotal += amt;
        // Cadence → normalized daily amount. A distinct funder/amount is one position.
        const cadence = (dbt.cadence || "unknown").toLowerCase();
        const daily = cadence === "weekly" ? amt / 5 : cadence === "daily" ? amt : amt; // unknown ≈ per-hit
        mcaDebitDaily += daily;
        openPositionKeys.add(`${Math.round(amt)}:${cadence}`);
      }
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const reportedAvgMonthlyRevenue = round2(avg(perMonthReported));
    const paddingTotal = round2(perMonthPadding.reduce((a, b) => a + b, 0));

    // Owner-payroll ("questionable") treatment. 'count'/'flag_and_discount' leave it
    // IN true revenue; 'exclude' removes it. The conservative figure (revenue if the
    // questionable income were personal/W-2 rather than business) is always computed
    // so the judge + assumptions can state the downside without a merchant round-trip.
    const ownerPayrollTreatment = ((settings.owner_payroll_treatment as string) || "flag_and_discount");
    const questionableTotal = round2(perMonthQuestionable.reduce((a, b) => a + b, 0));
    const avgQuestionableMonthly = round2(avg(perMonthQuestionable));
    // per-month net EXCLUDING questionable income = the conservative revenue series.
    const perMonthNetConservative = perMonthNet.map((n, i) => Math.max(0, n - (perMonthQuestionable[i] ?? 0)));
    const conservativeAvgMonthlyRevenue = round2(avg(perMonthNetConservative));

    // Effective net series feeding the affordability math depends on the treatment:
    //   count / flag_and_discount → keep questionable in (base case)
    //   exclude                   → drop it (use the conservative series)
    const effPerMonthNet = ownerPayrollTreatment === "exclude" ? perMonthNetConservative : perMonthNet;
    const trueAvgMonthlyRevenue = round2(avg(effPerMonthNet));
    const avgNetRetained = trueAvgMonthlyRevenue; // deposits − padding (− questionable if excluded)
    const revenueQualityPct = reportedAvgMonthlyRevenue > 0
      ? round2((trueAvgMonthlyRevenue / reportedAvgMonthlyRevenue) * 100)
      : 100;

    // Existing daily MCA debit — prefer the deal's known VCF daily debit if set,
    // else the statement-derived estimate (averaged per analyzed month).
    const dealDailyDebit = num(deal.vcf_daily_debit);
    const existingDailyDebit = dealDailyDebit != null && dealDailyDebit > 0
      ? round2(dealDailyDebit)
      : round2(monthsCovered ? mcaDebitDaily / monthsCovered : mcaDebitDaily);

    // Affordability math (see BIZ_DAYS constants above).
    const trueDailyRevenue = trueAvgMonthlyRevenue / BIZ_DAYS_PER_MONTH;
    const holdbackFraction = numOr0(settings.holdback_ceiling_pct) / 100;
    const safeDailyDebitCapacity = round2(Math.max(0, trueDailyRevenue * holdbackFraction - existingDailyDebit));
    const maxAffordableAdvance = round2(safeDailyDebitCapacity * TERM_BIZ_DAYS);
    const debtServicePct = trueAvgMonthlyRevenue > 0
      ? round2(((existingDailyDebit * BIZ_DAYS_PER_MONTH) / trueAvgMonthlyRevenue) * 100)
      : 0;

    const estOpenPositions = openPositionKeys.size ||
      (num(deal.vcf_active_positions) ?? 0) || (existingDailyDebit > 0 ? 1 : 0);

    // Revenue trend across the analyzed months (first vs last third).
    const revenueTrend = trendOf(effPerMonthNet);

    // Deposit concentration — largest single sales deposit vs total deposits
    // (a proxy for one-customer dependency). Computed across all analyzed months.
    let biggestDeposit = 0;
    let allDepositsTotal = 0;
    for (const s of analyzed) {
      for (const dep of (s.deposits ?? [])) {
        const amt = Math.abs(numOr0(dep.amount));
        allDepositsTotal += amt;
        if (amt > biggestDeposit) biggestDeposit = amt;
      }
    }
    const depositConcentrationPct = allDepositsTotal > 0
      ? round2((biggestDeposit / allDepositsTotal) * 100)
      : 0;

    const amountRequested = num(deal.amount_requested);
    const avgDailyBalance = balances.length ? round2(avg(balances)) : null;
    const minBalance = minBalances.length ? round2(Math.min(...minBalances)) : null;

    // Conservative sensitivity: what the affordability looks like if the questionable
    // owner-payroll income turned out to be personal (excluded). Always computed so
    // the judge can state base-vs-conservative even under 'count'/'flag_and_discount'.
    const consDailyRevenue = conservativeAvgMonthlyRevenue / BIZ_DAYS_PER_MONTH;
    const consSafeDailyCapacity = round2(Math.max(0, consDailyRevenue * holdbackFraction - existingDailyDebit));
    const conservativeMaxAffordableAdvance = round2(consSafeDailyCapacity * TERM_BIZ_DAYS);
    const hasQuestionable = questionableTotal > 0;

    // Chronological per-month table (upload order is arbitrary — sort by month).
    perMonth.sort((a, b) => {
      const ta = Date.parse(`1 ${a.month ?? ""}`);
      const tb = Date.parse(`1 ${b.month ?? ""}`);
      return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb;
    });

    // ── FIRST-CLASS AFFORDABILITY (deterministic — daily vs weekly) ──
    // Two independent ceilings, we take the tighter:
    //   1) REVENUE ceiling — total debt service (existing positions + new advance)
    //      must stay within max_payment_pct_of_revenue of TRUE monthly revenue.
    //      New capacity = pct×revenue − existing debits, spread over the month.
    //   2) BALANCE ceiling — the new payment may not exceed balance_buffer_pct of
    //      the WORST month's average daily balance, so a thin-balance merchant
    //      can't be sized on revenue math alone.
    // Then advance = sustainable payment × term ÷ factor, for BOTH a daily remit
    // (term_daily_biz_days) and a weekly remit (term_weekly_weeks).
    const maxPayPct = numOr0(settings.max_payment_pct_of_revenue) / 100;
    const bufferPct = numOr0(settings.balance_buffer_pct) / 100;
    const factorRate = numOr0(settings.affordability_factor_rate) || 1.35;
    const termDailyDays = numOr0(settings.term_daily_biz_days) || 120;
    const termWeeklyWeeks = numOr0(settings.term_weekly_weeks) || 26;
    const existingMonthlyDebt = round2(existingDailyDebit * BIZ_DAYS_PER_MONTH);
    // Worst-month avg daily balance drives the balance guard (fallback: overall avg).
    const perMonthAvgBalances = perMonth
      .map((r) => r.average_daily_balance)
      .filter((x): x is number => x != null);
    const worstMonthAvgBalance = perMonthAvgBalances.length
      ? Math.min(...perMonthAvgBalances)
      : avgDailyBalance;

    // Builds an affordability read for a given true-monthly-revenue figure.
    const affordabilityFor = (monthlyRevenue: number) => {
      const allowedTotalMonthly = maxPayPct * Math.max(0, monthlyRevenue);
      const allowedNewMonthly = Math.max(0, allowedTotalMonthly - existingMonthlyDebt);
      const revDaily = allowedNewMonthly / BIZ_DAYS_PER_MONTH;
      const revWeekly = allowedNewMonthly / WEEKS_PER_MONTH;
      // Balance guard: cap the daily pull at a fraction of the worst avg balance.
      const balDaily = worstMonthAvgBalance != null && worstMonthAvgBalance > 0
        ? bufferPct * worstMonthAvgBalance
        : (worstMonthAvgBalance != null ? 0 : Infinity); // <=0 balance ⇒ no room; unknown ⇒ no cap
      const balWeekly = balDaily === Infinity ? Infinity : balDaily * BIZ_DAYS_PER_WEEK;
      const maxDaily = round2(Math.max(0, Math.min(revDaily, balDaily)));
      const maxWeekly = round2(Math.max(0, Math.min(revWeekly, balWeekly)));
      const bindingDaily = balDaily < revDaily ? "balance" : "revenue";
      const bindingWeekly = balWeekly < revWeekly ? "balance" : "revenue";
      return {
        max_daily_payment: maxDaily,
        max_weekly_payment: maxWeekly,
        max_advance_daily: round2((maxDaily * termDailyDays) / factorRate),
        max_advance_weekly: round2((maxWeekly * termWeeklyWeeks) / factorRate),
        binding_daily: bindingDaily,
        binding_weekly: bindingWeekly,
      };
    };

    const affBase = affordabilityFor(trueAvgMonthlyRevenue);
    const affCons = affordabilityFor(conservativeAvgMonthlyRevenue);
    // What the requested amount WOULD demand as a daily / weekly pull.
    const reqDailyPayment = amountRequested != null && amountRequested > 0
      ? round2((amountRequested * factorRate) / termDailyDays) : null;
    const reqWeeklyPayment = amountRequested != null && amountRequested > 0
      ? round2((amountRequested * factorRate) / termWeeklyWeeks) : null;
    const affordableDaily = reqDailyPayment == null ? null : affBase.max_daily_payment >= reqDailyPayment;
    const affordableWeekly = reqWeeklyPayment == null ? null : affBase.max_weekly_payment >= reqWeeklyPayment;

    const affordability = {
      // knobs used (surfaced as assumptions text in the UI)
      max_payment_pct_of_revenue: numOr0(settings.max_payment_pct_of_revenue),
      balance_buffer_pct: numOr0(settings.balance_buffer_pct),
      factor_rate: factorRate,
      term_daily_biz_days: termDailyDays,
      term_weekly_weeks: termWeeklyWeeks,
      // inputs
      monthly_revenue_basis: trueAvgMonthlyRevenue,
      existing_daily_debit: existingDailyDebit,
      existing_monthly_debt_service: existingMonthlyDebt,
      balance_basis: worstMonthAvgBalance != null ? round2(worstMonthAvgBalance) : null,
      // base-case results
      max_daily_payment: affBase.max_daily_payment,
      max_weekly_payment: affBase.max_weekly_payment,
      max_advance_daily: affBase.max_advance_daily,
      max_advance_weekly: affBase.max_advance_weekly,
      binding_constraint_daily: affBase.binding_daily,
      binding_constraint_weekly: affBase.binding_weekly,
      // requested-amount comparison
      amount_requested: amountRequested,
      required_daily_payment: reqDailyPayment,
      required_weekly_payment: reqWeeklyPayment,
      affordable_daily: affordableDaily,
      affordable_weekly: affordableWeekly,
      // conservative sensitivity (owner-payroll excluded) — only meaningful when present
      conservative: hasQuestionable
        ? {
            monthly_revenue_basis: conservativeAvgMonthlyRevenue,
            max_daily_payment: affCons.max_daily_payment,
            max_weekly_payment: affCons.max_weekly_payment,
            max_advance_daily: affCons.max_advance_daily,
            max_advance_weekly: affCons.max_advance_weekly,
            affordable_daily: reqDailyPayment == null ? null : affCons.max_daily_payment >= reqDailyPayment,
            affordable_weekly: reqWeeklyPayment == null ? null : affCons.max_weekly_payment >= reqWeeklyPayment,
          }
        : null,
    };

    // money formatter — hoisted here (was in the flags block) so the scenario
    // notes/verdict below can use it too.
    const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

    // ── FUNDER BOXES (for path box-matching AND the judge minimums) ──
    // Load every active MCA program once, with the lender's onboarding STATUS +
    // name, so the paths below can name which funders' recorded boxes fit a given
    // size/revenue/TIB. Box-matching is deterministic (never an AI call).
    const { data: mcaPrograms } = await db
      .from("lender_programs")
      .select("monthly_revenue_required, min_credit_score, approval_min, approval_max, time_in_business_months, lenders!inner(company_name, status)")
      .eq("product_type", "mca").eq("is_active", true);
    const funderBoxes = ((mcaPrograms ?? []) as Any[]).map((p) => {
      const l = (Array.isArray(p.lenders) ? p.lenders[0] : p.lenders) as Any | undefined;
      return {
        name: (l?.company_name as string) ?? "Funder",
        status: (l?.status as string) ?? "",
        rev_req: num(p.monthly_revenue_required),
        approval_min: num(p.approval_min),
        approval_max: num(p.approval_max),
        tib: num(p.time_in_business_months),
        min_credit_score: num(p.min_credit_score),
      };
    });

    // ── WHAT-IF SCENARIOS (deterministic — NO extra LLM call) ──
    // The single verdict can't answer the two questions a closer actually asks on a
    // stacked, padded deal: "if he RESTRUCTURES his existing MCAs, does the math
    // change?" and "what if ALL his revenue were real?". We answer both with the
    // SAME first-class affordability math (payment cap, balance buffer, factor, term
    // — see affordabilityFor above); only two inputs move: the revenue basis (true
    // vs reported) and the existing monthly debt (as-is vs zeroed by a clean
    // restructure). Each scenario reports the daily-remit capacity + max advance and
    // how it stacks against the ask.
    const askAmt = amountRequested != null && amountRequested > 0 ? amountRequested : null;
    const vsAsk = (adv: number): { status: "green" | "amber" | "red" | "na"; delta: number | null } => {
      if (askAmt == null) return { status: "na", delta: null };
      const delta = round2(adv - askAmt);
      const status = adv >= askAmt ? "green" : adv >= askAmt * 0.7 ? "amber" : "red";
      return { status, delta };
    };
    // Daily-remit affordability for an arbitrary (revenue, existing-monthly-debt)
    // pair — identical revenue-cap + balance-buffer logic to affordabilityFor, but
    // the existing debt is a parameter so a restructure can zero it out.
    const scenarioDaily = (monthlyRevenue: number, existingMonthly: number) => {
      const allowedTotalMonthly = maxPayPct * Math.max(0, monthlyRevenue);
      const allowedNewMonthly = Math.max(0, allowedTotalMonthly - Math.max(0, existingMonthly));
      const revDaily = allowedNewMonthly / BIZ_DAYS_PER_MONTH;
      const balDaily = worstMonthAvgBalance != null && worstMonthAvgBalance > 0
        ? bufferPct * worstMonthAvgBalance
        : (worstMonthAvgBalance != null ? 0 : Infinity); // <=0 balance ⇒ no room; unknown ⇒ no cap
      const capacity = round2(Math.max(0, Math.min(revDaily, balDaily)));
      const binding = balDaily < revDaily ? "balance" : "revenue";
      const advance = round2((capacity * termDailyDays) / factorRate);
      return { capacity, advance, binding };
    };
    const buildScenario = (
      key: string, label: string, monthlyRevenue: number, existingMonthly: number, note: string,
    ) => {
      const r = scenarioDaily(monthlyRevenue, existingMonthly);
      return {
        key, label,
        capacity_per_day: r.capacity,
        max_affordable_advance: r.advance,
        binding_constraint: r.binding,
        affordable_vs_ask: vsAsk(r.advance),
        note,
      };
    };
    const scAsIs = buildScenario(
      "as_is", "As-is (current verdict)", trueAvgMonthlyRevenue, existingMonthlyDebt,
      `True revenue ${money(trueAvgMonthlyRevenue)}/mo with ${money(existingDailyDebit)}/day existing debits netted out; ${affBase.binding_daily}-bound.`,
    );
    const scRevReal = buildScenario(
      "revenue_all_real", "If all stated revenue were real", reportedAvgMonthlyRevenue, existingMonthlyDebt,
      `Credits the full ${money(reportedAvgMonthlyRevenue)}/mo of reported deposits (no padding stripped); existing debits unchanged.`,
    );
    const scRestruct = buildScenario(
      "debt_restructured", "If existing positions were restructured (upper bound)", trueAvgMonthlyRevenue, 0,
      "UPPER BOUND — assumes existing positions FULLY cleared; post-restructure reality lands between as-is and this.",
    );
    const scBoth = buildScenario(
      "both", "Both (absolute ceiling)", reportedAvgMonthlyRevenue, 0,
      "Absolute ceiling — full stated revenue AND zero existing debits; every real position lands below this.",
    );
    const scenarios = [scAsIs, scRevReal, scRestruct, scBoth];

    // One-line derived verdict summarizing the two levers vs. the ask.
    const restructUnlock = round2(scRestruct.max_affordable_advance - scAsIs.max_affordable_advance);
    const revenueUnlock = round2(scRevReal.max_affordable_advance - scAsIs.max_affordable_advance);
    const scParts: string[] = [];
    if (restructUnlock > 0) scParts.push(`restructuring existing positions unlocks ~${money(restructUnlock)}`);
    if (revenueUnlock > 0) scParts.push(`full-revenue credit unlocks ~${money(revenueUnlock)}`);
    let askClause = "";
    if (askAmt != null) {
      if (scAsIs.max_affordable_advance >= askAmt) {
        askClause = `the ${money(askAmt)} ask is already covered as-is`;
      } else {
        const firstCover = scenarios.find((s) => s.max_affordable_advance >= askAmt);
        askClause = firstCover
          ? `the ${money(askAmt)} ask is reachable only under "${firstCover.label}"`
          : `the ${money(askAmt)} ask is unreachable in every scenario`;
      }
    }
    const lead = scParts.join("; ");
    let scenariosVerdict: string;
    if (lead && askClause) scenariosVerdict = `${lead.charAt(0).toUpperCase() + lead.slice(1)} — ${askClause}.`;
    else if (lead) scenariosVerdict = `${lead.charAt(0).toUpperCase() + lead.slice(1)}.`;
    else if (askClause) scenariosVerdict = `${askClause.charAt(0).toUpperCase() + askClause.slice(1)}.`;
    else scenariosVerdict = "Neither a restructure nor crediting full revenue changes capacity materially here.";

    // ── PATHS TO REVENUE (deterministic) — the product. The IRON RULE: every run
    // emits at least one ACTIONABLE path; a bare "decline" is forbidden output.
    // Each path is derived from the scenarios above + our real funder rails (box-
    // matching, NEVER an AI call), ranked by expected revenue.
    const tibMonths = num(cust.time_in_business);
    const POINTS = 0.08;          // MFunding's new-deal commission (8 points).
    const COUNTER_FLOOR = 5000;   // smallest advance worth countering / a funder box wants.
    const cleanTo = (n: number) => Math.max(0, Math.floor(n / 1000) * 1000); // clean counter figure
    const listNames = (a: string[], max = 4) =>
      a.length <= max ? a.join(", ") : `${a.slice(0, max).join(", ")} +${a.length - max} more`;

    // Which onboarded funders' recorded boxes fit a given (advance, revenue)?
    // Partitioned by how we'd submit TODAY. Credit score UNKNOWN never disqualifies
    // (MCA = cash-flow underwriting); missing box fields don't exclude a funder.
    const fitFunders = (advance: number, revenue: number) => {
      const live: string[] = []; const referral: string[] = []; const pending: string[] = [];
      for (const b of funderBoxes) {
        if (b.rev_req != null && revenue < b.rev_req) continue;
        if (b.approval_min != null && advance < b.approval_min) continue;
        if (b.approval_max != null && advance > b.approval_max) continue;
        if (b.tib != null && tibMonths != null && tibMonths < b.tib) continue;
        if (b.status === "live_vendor") live.push(b.name);
        else if (b.status === "affiliate_referral") referral.push(b.name);
        else if (b.status === "application_submitted") pending.push(b.name);
      }
      return { live, referral, pending };
    };

    type Path = {
      rank: number; key: string; label: string; action: string; expected_note: string;
      expected_revenue: number; // internal — drives ranking only
    };
    const paths: Path[] = [];

    // 1) RIGHT-SIZED COUNTER — when a "now" scenario (no restructure) supports ≥ $5K.
    //    Emit the as-is counter AND the full-revenue counter when they differ.
    const counterSeen = new Set<number>();
    for (const c of [
      { adv: scAsIs.max_affordable_advance, cap: scAsIs.capacity_per_day, rev: trueAvgMonthlyRevenue, basis: "as_is" as const },
      { adv: scRevReal.max_affordable_advance, cap: scRevReal.capacity_per_day, rev: reportedAvgMonthlyRevenue, basis: "full_revenue" as const },
    ]) {
      const amt = cleanTo(c.adv);
      if (amt < COUNTER_FLOOR || counterSeen.has(amt)) continue;
      counterSeen.add(amt);
      const fit = fitFunders(amt, c.rev);
      const submitNow = [...fit.live, ...fit.referral];
      const action = submitNow.length
        ? `Counter at ${money(amt)} → submit to ${listNames(submitNow)}`
        : fit.pending.length
          ? `Counter at ${money(amt)} → ${listNames(fit.pending)} (ISO app pending — call to expedite)`
          : `Counter at ${money(amt)} — no onboarded funder box fits this size yet; widen the network`;
      paths.push({
        rank: 0,
        key: c.basis === "as_is" ? "counter_as_is" : "counter_full_revenue",
        label: c.basis === "as_is" ? `Right-sized counter — ${money(amt)}` : `Full-revenue counter — ${money(amt)}`,
        action,
        expected_note: `Capacity ${money(c.cap)}/day supports ${money(amt)}` +
          (c.basis === "full_revenue" ? ` if the full ${money(reportedAvgMonthlyRevenue)}/mo verifies` : "") +
          `. ${fit.live.length} live + ${fit.referral.length} referral fit, ${fit.pending.length} pending.`,
        expected_revenue: amt * POINTS,
      });
    }

    // 2) RESTRUCTURE FIRST (VCF) — heavily stacked: OUR relief product is the play.
    //    Frame the post-restructure capacity as revenue, not consolation.
    if (debtServicePct > 50 && scRestruct.max_affordable_advance >= COUNTER_FLOOR) {
      const z = cleanTo(scRestruct.max_affordable_advance);
      paths.push({
        rank: 0, key: "restructure_vcf",
        label: `Restructure first (Relief) → unlocks ~${money(z)} new money`,
        action: "Toggle this deal to Relief and run the VCF flow; after a clean restructure this merchant supports new financing",
        expected_note: `Existing debits eat ${Math.round(debtServicePct)}% of true revenue. Clear them and capacity opens to ~${money(scRestruct.capacity_per_day)}/day → ~${money(z)} new money (upper bound — real post-restructure lands between as-is and this).`,
        expected_revenue: z * POINTS,
      });
    }

    // 3) MICRO-MCA TIER — real revenue but below mainstream live floors.
    if (trueAvgMonthlyRevenue >= COUNTER_FLOOR && trueAvgMonthlyRevenue < 15000) {
      const microNames = ["Bitty Advance", "Greenbox Capital", "Giggle Finance"];
      const statusOf = new Map(funderBoxes.map((b) => [b.name, b.status]));
      const statusLabel = (s?: string) =>
        s === "live_vendor" ? "live" : s === "affiliate_referral" ? "live via referral"
        : s === "application_submitted" ? "ISO app pending" : "not onboarded";
      const parts = microNames.filter((n) => statusOf.has(n)).map((n) => `${n} (${statusLabel(statusOf.get(n))})`);
      if (parts.length) {
        paths.push({
          rank: 0, key: "micro_mca",
          label: "Micro-MCA tier",
          action: `Route to the micro rail: ${parts.join(", ")}`,
          expected_note: `True revenue ${money(trueAvgMonthlyRevenue)}/mo clears the $5K micro floors but sits below most mainstream live funders — the micro rail is where this funds.`,
          expected_revenue: Math.max(cleanTo(scRevReal.max_affordable_advance), COUNTER_FLOOR) * POINTS * 0.5,
        });
      }
    }

    // 4) PRODUCT SWITCH — MCA unaffordable but revenue steady. Statements can't see
    //    collateral / receivables, so emit as closer QUESTIONS, not a verdict.
    if (scAsIs.max_affordable_advance < COUNTER_FLOOR && trueAvgMonthlyRevenue >= COUNTER_FLOOR && revenueTrend !== "down") {
      paths.push({
        rank: 0, key: "product_switch",
        label: "Product switch — ask two questions",
        action: "Ask the merchant: (1) equipment owned free-and-clear? (2) unpaid B2B invoices / receivables? A yes on either opens Equipment financing or invoice factoring where an MCA can't fit",
        expected_note: `Steady ${money(trueAvgMonthlyRevenue)}/mo revenue but the MCA math is tight — a collateral- or receivables-backed product may work. Catalog: /admin/lender-catalog`,
        expected_revenue: 1, // unknown size — ranks below sized paths, above nurture.
      });
    }

    // 5) NURTURE WITH A CONCRETE RE-ENTRY TRIGGER — never "dead". Compute the exact
    //    condition that would flip the verdict (paydown target OR revenue target).
    {
      const requiredCapacity = (COUNTER_FLOOR * factorRate) / termDailyDays; // $/day to support a $5K advance
      const requiredNewMonthly = requiredCapacity * BIZ_DAYS_PER_MONTH;
      const roomFromRevenue = maxPayPct * trueAvgMonthlyRevenue - requiredNewMonthly;
      let action: string; let note: string;
      if (existingMonthlyDebt > 0 && roomFromRevenue > 0) {
        const targetDaily = roomFromRevenue / BIZ_DAYS_PER_MONTH; // existing daily debit at/below which a $5K counter clears
        const paydownPct = existingDailyDebit > 0
          ? Math.max(0, Math.min(99, Math.round((1 - targetDaily / existingDailyDebit) * 100)))
          : 0;
        action = `Nurture until existing daily debits drop below ${money(targetDaily)}/day, then re-run`;
        note = `At today's ${money(existingDailyDebit)}/day that's ≈${paydownPct}% paydown of the current position(s). Set the re-entry trigger and move on — not dead, just early.`;
      } else {
        const targetRev = (requiredNewMonthly + existingMonthlyDebt) / maxPayPct;
        action = `Nurture until true revenue reaches ~${money(targetRev)}/mo (2+ clean months), then re-run`;
        note = `Revenue is the binding constraint, not stacking — re-enter on growth, not a paydown.`;
      }
      paths.push({
        rank: 0, key: "nurture_trigger",
        label: "Nurture with a concrete re-entry trigger",
        action, expected_note: note,
        expected_revenue: 0.5, // fallback sentinel — always lowest, guarantees a path exists.
      });
    }

    // Rank by expected revenue (desc); renumber 1..n.
    paths.sort((a, b) => b.expected_revenue - a.expected_revenue);
    paths.forEach((p, i) => { p.rank = i + 1; });

    // Reframe the headline as the PLAY — never a bare decline.
    const topPath = paths[0];
    const pathsVerdict = topPath
      ? `${topPath.label} is the play` +
        (askAmt != null && scAsIs.max_affordable_advance < askAmt ? ` — the ${money(askAmt)} ask is unreachable as-is.` : ".")
      : scenariosVerdict;

    const metrics = {
      statements_analyzed: monthsCovered,
      months_covered: monthsCovered,
      reported_avg_monthly_revenue: reportedAvgMonthlyRevenue,
      true_avg_monthly_revenue: trueAvgMonthlyRevenue,
      revenue_quality_pct: revenueQualityPct,
      padding_total: paddingTotal,
      padding_by_category: Object.fromEntries(
        Object.entries(paddingByCategory).map(([k, v]) => [k, round2(v)]),
      ),
      // Owner-payroll ("questionable") income — the base-vs-conservative sensitivity.
      owner_payroll_treatment: ownerPayrollTreatment,
      questionable_revenue_total: questionableTotal,
      questionable_revenue_monthly: avgQuestionableMonthly,
      questionable_revenue_by_source: Object.fromEntries(
        Object.entries(questionableBySource).map(([k, v]) => [k, round2(v)]),
      ),
      conservative_avg_monthly_revenue: conservativeAvgMonthlyRevenue,
      conservative_max_affordable_advance: conservativeMaxAffordableAdvance,
      net_retained_by_month: effPerMonthNet.map(round2),
      avg_net_retained: round2(avgNetRetained),
      avg_daily_balance: avgDailyBalance,
      min_balance: minBalance,
      negative_days: negativeDays,
      nsf_total: nsfTotal,
      est_open_positions: estOpenPositions,
      existing_daily_debit: existingDailyDebit,
      debt_service_pct: debtServicePct,
      safe_daily_debit_capacity: safeDailyDebitCapacity,
      max_affordable_advance: maxAffordableAdvance,
      amount_requested: amountRequested,
      revenue_trend: revenueTrend,
      deposit_concentration_pct: depositConcentrationPct,
      // Explicit per-month table + first-class affordability block (both additive;
      // old rows lack them and the UI hides those sections).
      per_month: perMonth,
      affordability,
      // What-if scenarios (additive; older stored runs lack them and the UI hides
      // the section). Four deterministic reads on the two levers a closer asks about.
      scenarios,
      scenarios_verdict: scenariosVerdict,
      // Paths to revenue — the product. Always ≥1 actionable path. `expected_revenue`
      // is internal ranking only, dropped from what we persist/return.
      paths: paths.map(({ expected_revenue: _er, ...p }) => p),
      paths_verdict: pathsVerdict,
    };

    // ---- Flags from the admin-tunable thresholds ----
    const flags: Array<{ code: string; severity: "info" | "warn" | "critical"; message: string }> = [];

    // ── Statement coverage vs the CALENDAR: are we current, and are we continuous? ──
    // Funders want the newest complete month and an unbroken run. A closer staring
    // at "6 statements" has no way to notice that June is missing (real case:
    // K.L. Breen). Deterministic — parsed month labels vs today's date in ET.
    // Unparseable labels drop out silently: never false-alarm on a naming quirk.
    {
      const monthIdx = new Map<number, string>(); // year*12+month → pretty label
      for (const s of analyzed) {
        const t = Date.parse(`1 ${String(s.month ?? "").trim()}`);
        if (Number.isNaN(t)) continue;
        const d = new Date(t);
        monthIdx.set(d.getUTCFullYear() * 12 + d.getUTCMonth(), String(s.month).trim());
      }
      if (monthIdx.size > 0) {
        const keys = [...monthIdx.keys()].sort((a, b) => a - b);
        const fmt = (k: number) =>
          new Date(Date.UTC(Math.floor(k / 12), k % 12, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

        // Last COMPLETE calendar month, reckoned in Eastern (the business clock).
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const lastComplete = nowET.getFullYear() * 12 + nowET.getMonth() - 1;
        const newest = keys[keys.length - 1];
        if (newest < lastComplete) {
          const behind = lastComplete - newest;
          flags.push({
            code: "statements_stale",
            severity: behind >= 2 ? "critical" : "warn",
            message: `Newest statement is ${fmt(newest)} — ${fmt(lastComplete)} is the last complete month. Missing ${behind === 1 ? fmt(lastComplete) : `the ${behind} most recent month(s)`}; funders will ask for it before an offer.`,
          });
        }

        // Continuity: holes inside the covered range.
        const missing: string[] = [];
        for (let k = keys[0]; k <= newest; k++) if (!monthIdx.has(k)) missing.push(fmt(k));
        if (missing.length > 0) {
          flags.push({
            code: "month_gap",
            severity: "warn",
            message: `Statement months are not continuous — missing ${missing.join(", ")} between ${fmt(keys[0])} and ${fmt(newest)}.`,
          });
        }
      }
    }

    if (revenueQualityPct < numOr0(settings.revenue_quality_flag_pct)) {
      const sev = revenueQualityPct < numOr0(settings.revenue_quality_flag_pct) - 20 ? "critical" : "warn";
      flags.push({
        code: "revenue_quality",
        severity: sev,
        message: `Only ${revenueQualityPct}% of reported deposits look like true sales revenue (${money(paddingTotal)} padding removed).`,
      });
    }
    const nsfCap = numOr0(settings.nsf_monthly_cap) * Math.max(1, monthsCovered);
    if (nsfTotal > nsfCap) {
      flags.push({
        code: "nsf",
        severity: "warn",
        message: `${nsfTotal} NSF/overdraft events across ${monthsCovered} month(s) — above the ${settings.nsf_monthly_cap}/mo cap.`,
      });
    }
    if (negativeDays >= numOr0(settings.negative_days_flag)) {
      flags.push({
        code: "negative_days",
        severity: "warn",
        message: `${negativeDays} negative-balance day(s) observed.`,
      });
    }
    if (debtServicePct > numOr0(settings.debt_service_flag_pct)) {
      flags.push({
        code: "debt_service",
        severity: "critical",
        message: `Existing daily debits consume ${debtServicePct}% of true revenue (over the ${settings.debt_service_flag_pct}% ceiling) — heavily stacked.`,
      });
    }
    if (avgNetRetained <= 0) {
      flags.push({ code: "no_retained_revenue", severity: "critical", message: "Net retained revenue is at or below zero after padding removal." });
    } else if (safeDailyDebitCapacity <= 0) {
      flags.push({ code: "no_capacity", severity: "critical", message: "No safe daily-debit capacity remains after existing debits — a new advance is unaffordable." });
    }
    if (revenueTrend === "down") {
      flags.push({ code: "revenue_trend", severity: "warn", message: "Real revenue is trending down across the analyzed period." });
    }
    if (depositConcentrationPct >= 40) {
      flags.push({ code: "deposit_concentration", severity: "info", message: `Largest single deposit is ${depositConcentrationPct}% of all deposits — possible customer concentration.` });
    }
    if (settings.min_avg_daily_balance != null && avgDailyBalance != null && avgDailyBalance < numOr0(settings.min_avg_daily_balance)) {
      flags.push({ code: "low_balance", severity: "warn", message: `Average daily balance ${money(avgDailyBalance)} is below the ${money(numOr0(settings.min_avg_daily_balance))} floor.` });
    }
    // Extraction gaps count only genuine FAILURES (couldn't load/parse a file) — NOT
    // duplicates removed by dedup, which are expected and harmless.
    const failedStatements = perStatement.filter((s) => s._error).length;
    if (failedStatements > 0) {
      flags.push({ code: "extraction_gaps", severity: "info", message: `${failedStatements} of ${bankDocs.length} statement file(s) could not be analyzed.` });
    }
    if (dataQualityIssues.length > 0) {
      flags.push({
        code: "data_quality",
        severity: "warn",
        message: `Per-month data repaired on ${dataQualityIssues.length} field(s): ${dataQualityIssues.join("; ")}.`,
      });
    }
    // docs_not_analyzed SAFETY NET: shout ONLY about docs still typed "other" —
    // after the content-classifier preflight, "other" means genuinely unidentifiable,
    // and an unidentified file could be a statement (the SIS failure). A photo ID or
    // voided check sitting unanalyzed is CORRECT, not a warning — flagging those on
    // every deal would teach closers to ignore this flag.
    try {
      const { data: allDocTypes } = await db
        .from("customer_documents")
        .select("document_type, filename")
        .eq("customer_id", deal.customer_id);
      const unidentified = (allDocTypes ?? []).filter((d) => d.document_type === "other");
      if (unidentified.length) {
        const names = unidentified.map((d) => String(d.filename ?? "unnamed")).slice(0, 5);
        flags.push({
          code: "docs_not_analyzed",
          severity: "warn",
          message: `${unidentified.length} document(s) on file could not be identified and were NOT analyzed (${names.join(", ")}) — check whether any is a bank statement.`,
        });
      }
    } catch (e) {
      console.warn("[underwrite-deal] docs_not_analyzed check failed:", e instanceof Error ? e.message : e);
    }

    // ---- Affordability rating (capacity vs. amount requested) ----
    let affordabilityRating: "strong" | "adequate" | "tight" | "unaffordable";
    if (avgNetRetained <= 0 || safeDailyDebitCapacity <= 0) {
      affordabilityRating = "unaffordable";
    } else if (amountRequested == null || amountRequested <= 0) {
      // No requested amount — rate purely on capacity headroom vs. revenue.
      affordabilityRating = debtServicePct > numOr0(settings.debt_service_flag_pct) ? "tight" : "adequate";
    } else if (maxAffordableAdvance >= amountRequested * 1.25) {
      affordabilityRating = "strong";
    } else if (maxAffordableAdvance >= amountRequested) {
      affordabilityRating = "adequate";
    } else if (maxAffordableAdvance >= amountRequested * 0.7) {
      affordabilityRating = "tight";
    } else {
      affordabilityRating = "unaffordable";
    }

    // ---- ASSUMPTIONS: the judgment calls the underwriter made from the docs alone ----
    // So underwriting is COMPLETE before funder submission — no merchant round-trip.
    // Each: { item, assumed, basis, impact_if_wrong }. Also surfaced as flags so the
    // existing UI renders them with no frontend change.
    const assumptions: Array<{ item: string; assumed: string; basis: string; impact_if_wrong: string }> = [];

    if (hasQuestionable) {
      const topSource = Object.entries(questionableBySource).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "owner payroll";
      const counted = ownerPayrollTreatment !== "exclude";
      const item = `${money(avgQuestionableMonthly)}/mo '${topSource}' owner-payroll deposits`;
      const assumed = counted
        ? "business commission/1099 income (counted as true revenue)"
        : "personal W-2 pay (excluded from true revenue)";
      const basis = "recurring third-party ACH labeled PAYROLL paid to the owner's own name";
      const affordableBase = amountRequested != null && amountRequested > 0
        ? (maxAffordableAdvance >= amountRequested ? "affordable" : "already tight")
        : "supported";
      const affordableCons = amountRequested != null && amountRequested > 0
        ? (conservativeMaxAffordableAdvance >= amountRequested ? "still affordable" : "UNAFFORDABLE")
        : `capacity drops to ${money(conservativeMaxAffordableAdvance)}`;
      const impact = counted
        ? `if personal W-2, true revenue falls from ${money(trueAvgMonthlyRevenue)} to ~${money(conservativeAvgMonthlyRevenue)}/mo` +
          (amountRequested != null && amountRequested > 0
            ? ` — the ${money(amountRequested)} ask goes from ${affordableBase} to ${affordableCons}${affordableCons === "UNAFFORDABLE" ? " → decline" : ""}`
            : ` and max affordable advance falls to ${money(conservativeMaxAffordableAdvance)}`)
        : `if it IS business income, true revenue would be ~${money(trueAvgMonthlyRevenue + avgQuestionableMonthly)}/mo and capacity higher`;
      assumptions.push({ item, assumed, basis, impact_if_wrong: impact });

      const sev: "warn" | "info" = ownerPayrollTreatment === "flag_and_discount" ? "warn" : "info";
      flags.push({
        code: "owner_payroll_assumption",
        severity: sev,
        message: `Assumption: ${item} treated as ${assumed}. Basis: ${basis}. If wrong: ${impact}.`,
      });
    }

    if (failedStatements > 0) {
      const item = `${failedStatements} of ${bankDocs.length} statement file(s) unreadable`;
      assumptions.push({
        item,
        assumed: `underwrote on the ${monthsCovered} readable statement(s) only`,
        basis: "PDF could not be fetched or parsed",
        impact_if_wrong: "the unread month(s) could shift average revenue, NSF/negative-day counts, or reveal additional stacking",
      });
      flags.push({
        code: "partial_docs_assumption",
        severity: "info",
        message: `Assumption: underwrote on ${monthsCovered} readable statement(s); ${failedStatements} unreadable file(s) not counted.`,
      });
    }

    // ---- PASS C: JUDGE (Claude — narrative + risk_rating + funder-fit note) ----
    // Load active MCA funder minimums so the judge can say which paper grade / which
    // funders this true-revenue profile fits.
    // Reuse the funder boxes already loaded above (no second query).
    const funderMinimums = funderBoxes.map((b) => ({
      monthly_revenue_required: b.rev_req,
      min_credit_score: b.min_credit_score,
      approval_min: b.approval_min,
      approval_max: b.approval_max,
    }));
    // Distinct revenue floors present in the network (compact signal for the judge).
    const revenueFloors = Array.from(
      new Set(funderMinimums.map((f) => f.monthly_revenue_required).filter((x): x is number => x != null && x > 0)),
    ).sort((a, b) => a - b);

    const judgeSystem =
      "You are the senior underwriter at an ISO (Independent Sales Organization / MCA broker) writing a " +
      "SHORT internal affordability + risk read for a closer. An MCA is a purchase of future receivables, " +
      "NOT a loan — never use the word loan or lending terms. Base your read on the AFFORDABILITY metrics " +
      "(true revenue = deposits minus padding, safe daily-debit capacity, existing debt-service %, " +
      "max affordable advance) and the flags provided. Be direct and honest; do not invent numbers beyond " +
      "what is given. Consider whether this merchant's TRUE revenue clears the funder revenue floors in the " +
      "network and, roughly, what paper grade (A/B/C/D) the profile suggests (A = clean/high revenue/low " +
      "stacking; D = heavily stacked/low quality). " +
      "This is INTERNAL underwriting done BEFORE funder submission from the submitted docs ALONE — you must " +
      "NOT ask the merchant anything. Where a judgment call was made (see ASSUMPTIONS), STATE the key " +
      "assumption(s) in the narrative and give the SENSITIVITY: the base case (assumption holds) vs. the " +
      "conservative case (assumption is wrong), using the base and conservative numbers provided. Then still " +
      "land on ONE clear recommendation so the read is complete without a merchant round-trip. " +
      "IRON RULE — a bare 'decline' is NOT an acceptable read: the deterministic PATHS TO REVENUE provided are " +
      "the options, and your Recommendation MUST be the top path (or another listed path), phrased as the concrete " +
      "next step (counter at $X to named funders, flip to Relief and restructure, route to the micro rail, ask the " +
      "product-switch questions, or nurture until a specific trigger). Even when the ask is unreachable, there is a play. " +
      "Return ONLY strict JSON: " +
      '{"risk_rating":"low"|"medium"|"high","narrative":string,"funder_fit_note":string}. ' +
      "FORMAT the narrative as lightweight markdown the closer can scan in 5 seconds — NOT a wall of prose:\n" +
      "- Open with ONE short headline sentence (the bottom line), no bullet.\n" +
      "- Then labeled bullet lines, each starting with '- **Label:** ', e.g.:\n" +
      "  - **True revenue:** stated vs verified numbers + what was stripped\n" +
      "  - **Key assumption:** the judgment call made (only when one exists)\n" +
      "  - **Base case (assumption holds):** revenue, capacity, max advance → verdict\n" +
      "  - **Conservative case (assumption wrong):** same numbers → verdict\n" +
      "  - **Cash position:** balances, negative days, NSFs, positions\n" +
      "  - **Recommendation:** the ONE clear action\n" +
      "Use **bold** for every dollar figure, multiple, and verdict word (decline, approve, counter-offer); " +
      "use <u>underline</u> ONLY for the single most critical warning in the read (at most one). " +
      "Keep 4-7 bullets total, each one line where possible. " +
      "funder_fit_note = one line (plain text, bold key numbers) on which revenue floors this clears and the likely paper grade.";

    const judgeUser =
      "MERCHANT: " + JSON.stringify({
        business: cust.business_name ?? null,
        industry: cust.industry ?? cust.business_type ?? null,
        state: cust.address_state ?? null,
        time_in_business_months: num(cust.time_in_business),
        stated_monthly_revenue: num(cust.monthly_revenue),
        product: deal.deal_type,
      }) +
      "\n\nAFFORDABILITY METRICS (computed deterministically from the bank statements):\n" +
      JSON.stringify(metrics, null, 2) +
      "\n\nFLAGS:\n" + JSON.stringify(flags, null, 2) +
      "\n\nASSUMPTIONS THE UNDERWRITER MADE (state these + the sensitivity in the narrative):\n" +
      JSON.stringify(assumptions, null, 2) +
      (hasQuestionable
        ? `\n\nSENSITIVITY on owner-payroll income (treatment='${ownerPayrollTreatment}'): ` +
          `BASE CASE true revenue ${money(trueAvgMonthlyRevenue)}/mo, max affordable ${money(maxAffordableAdvance)}. ` +
          `CONSERVATIVE CASE (owner-payroll is personal, excluded): true revenue ${money(conservativeAvgMonthlyRevenue)}/mo, ` +
          `max affordable ${money(conservativeMaxAffordableAdvance)}.`
        : "") +
      "\n\nAFFORDABILITY (deterministic, DAILY vs WEEKLY structure — factor " + factorRate +
        `, ${termDailyDays} biz-days daily / ${termWeeklyWeeks} weeks weekly, payment cap ` +
        `${affordability.max_payment_pct_of_revenue}% of revenue, balance buffer ${affordability.balance_buffer_pct}%): ` +
        `max sustainable DAILY payment ${money(affBase.max_daily_payment)} → max advance ${money(affBase.max_advance_daily)}; ` +
        `max sustainable WEEKLY payment ${money(affBase.max_weekly_payment)} → max advance ${money(affBase.max_advance_weekly)}. ` +
        `Existing debits netted out: ${money(existingDailyDebit)}/day (${money(existingMonthlyDebt)}/mo). ` +
        (reqDailyPayment != null
          ? `Requested ${money(amountRequested ?? 0)} needs ${money(reqDailyPayment)}/day or ${money(reqWeeklyPayment ?? 0)}/week → ` +
            `daily ${affordableDaily ? "AFFORDABLE" : "UNAFFORDABLE"}, weekly ${affordableWeekly ? "AFFORDABLE" : "UNAFFORDABLE"}.`
          : "No requested amount on file.") +
      "\n\nPATHS TO REVENUE (deterministic, ranked — your Recommendation MUST be the top one or another listed here; " +
        "NEVER a bare decline):\n" +
        paths.map((p) => `${p.rank}. ${p.label} — ${p.action}`).join("\n") +
      "\n\nAFFORDABILITY RATING (code-derived, base case): " + affordabilityRating +
      "\n\nFUNDER NETWORK MONTHLY-REVENUE FLOORS (distinct, USD): " +
      (revenueFloors.length ? revenueFloors.map((f) => `$${f.toLocaleString("en-US")}`).join(", ") : "none on file") +
      ` (${funderMinimums.length} active MCA programs).` +
      "\n\nReturn the JSON now.";

    let riskRating: "low" | "medium" | "high" = "medium";
    let aiNarrative = "";
    let funderFitNote = "";
    try {
      const judgeText = await callLLM(db, {
        system: judgeSystem,
        prompt: judgeUser,
        // 1024 truncated the JSON mid-narrative on a real 3-statement deal — the
        // parse then failed and the run persisted an EMPTY narrative with a default
        // "medium" rating. Give the judge room to close its JSON.
        maxTokens: 2048,
        temperature: 0.2,
        jsonMode: true,
        task: "underwrite_judge",
      });
      const parsed = safeParseJson(judgeText);
      if (parsed) {
        if (["low", "medium", "high"].includes(parsed.risk_rating)) riskRating = parsed.risk_rating;
        if (typeof parsed.narrative === "string") aiNarrative = parsed.narrative.trim();
        if (typeof parsed.funder_fit_note === "string") funderFitNote = parsed.funder_fit_note.trim();
      }
      // A parse miss (or an empty narrative) must NOT silently ship a blank read —
      // fall back to the flag-derived rating + summary, exactly like a throw does.
      if (!aiNarrative) throw new Error("judge returned no narrative");
    } catch (e) {
      // Judge failure never sinks the run — we still persist metrics + flags. Derive
      // a fallback risk_rating from the critical/warn flag counts.
      const crit = flags.filter((f) => f.severity === "critical").length;
      const warn = flags.filter((f) => f.severity === "warn").length;
      riskRating = crit > 0 ? "high" : warn >= 2 ? "medium" : "low";
      aiNarrative = `AI narrative unavailable (${e instanceof Error ? e.message : e}). Risk derived from flags: ${crit} critical, ${warn} warnings.`;
    }
    const narrativeOut = funderFitNote ? `${aiNarrative}\n- **Funder fit:** ${funderFitNote}` : aiNarrative;

    // ---- Persist a new version ----
    const { data: prev } = await db
      .from("deal_underwriting")
      .select("version")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (num(prev?.version) ?? 0) + 1;

    const { data: inserted, error: insErr } = await db
      .from("deal_underwriting")
      .insert({
        deal_id: dealId,
        version,
        run_mode: mode,
        docs_hash: docsHash,
        per_statement: perStatement,
        metrics,
        flags,
        assumptions,
        risk_rating: riskRating,
        affordability_rating: affordabilityRating,
        ai_narrative: narrativeOut,
        settings_snapshot: settings,
        extraction_model: settings.extraction_model,
        judge_model: settings.judge_model,
        created_by: callerId,
      })
      .select("id, version, created_at")
      .maybeSingle();
    if (insErr) return json({ error: `could not save underwriting run: ${insErr.message}` }, 502);

    // ── Lead-score re-rank (fire-and-forget — never blocks the underwriting
    // response). Bank-statement truth just landed: the score must move NOW —
    // this is what demotes a stated-$19k/true-$10.9k merchant automatically.
    fireAndForgetScore(dealId, "underwriting");

    return json({
      ok: true,
      dealId,
      id: inserted?.id,
      version: inserted?.version ?? version,
      run_mode: mode,
      // Set when this run had to pull the merchant's documents out of GHL first.
      ingest_note: ingestNote,
      // Set when preflight content-corrected any "other"-typed docs before analysis.
      reclassified_note: reclassifiedNote,
      docs_hash: docsHash,
      risk_rating: riskRating,
      affordability_rating: affordabilityRating,
      ai_narrative: narrativeOut,
      metrics,
      flags,
      assumptions,
      per_statement: perStatement,
      extraction_model: settings.extraction_model,
      judge_model: settings.judge_model,
      created_at: inserted?.created_at,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

// ---- helpers ----------------------------------------------------------------

function emptyStatement(filename: string, err: string): PerStatement {
  return {
    month: null, account_last4: null, opening_balance: null, closing_balance: null,
    total_deposits: null, total_withdrawals: null, avg_daily_balance: null,
    min_balance: null, negative_days: null, nsf_count: null, deposit_count: null,
    deposits: [], padding_deposits: [], questionable_deposits: [], mca_debits: [],
    _filename: filename, _error: err,
  };
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const capMonth = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Parse a consistent "Month YYYY" out of any string (a filename, or the AI's
// month field in whatever format it returned — "2026-03", "June 2026", "Jun 26").
function monthFromText(s: string): string | null {
  const t = (s || "").toLowerCase();
  if (!t) return null;
  const ym = t.match(/\b(20\d{2})\b/);
  const year = ym ? ym[1] : null;
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTH_NAMES[i]}\\b`).test(t) || new RegExp(`\\b${MONTH_ABBR[i]}\\b`).test(t)) {
      return year ? `${capMonth(MONTH_NAMES[i])} ${year}` : null;
    }
  }
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})\b/); // 2026-03
  if (m) { const mi = parseInt(m[2], 10) - 1; if (mi >= 0 && mi < 12) return `${capMonth(MONTH_NAMES[mi])} ${m[1]}`; }
  m = t.match(/\b(\d{1,2})[-/.](20\d{2})\b/); // 03/2026
  if (m) { const mi = parseInt(m[1], 10) - 1; if (mi >= 0 && mi < 12) return `${capMonth(MONTH_NAMES[mi])} ${m[2]}`; }
  return null;
}

// The statement's month, consistent + accurate. The FILENAME wins when it names
// a month (merchants/closers name them "February 2026 Statement.pdf" — that's
// authoritative and beats a mis-parsed statement period). Otherwise normalize
// the AI's month. Fixes both the format drift ("2026-03") and mis-reads (a Feb
// statement the AI called "January").
function deriveMonth(aiMonth: unknown, filename: string): string | null {
  return monthFromText(filename) ?? monthFromText(String(aiMonth ?? "")) ?? (aiMonth ? String(aiMonth) : null);
}

function normalizeStatement(p: Any, filename: string): PerStatement {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    month: deriveMonth(p.month, filename),
    account_last4: p.account_last4 != null ? String(p.account_last4) : null,
    opening_balance: num(p.opening_balance),
    closing_balance: num(p.closing_balance),
    total_deposits: num(p.total_deposits),
    total_withdrawals: num(p.total_withdrawals),
    avg_daily_balance: num(p.avg_daily_balance),
    min_balance: num(p.min_balance),
    negative_days: num(p.negative_days),
    nsf_count: num(p.nsf_count),
    deposit_count: num(p.deposit_count),
    deposits: arr(p.deposits),
    padding_deposits: arr(p.padding_deposits),
    questionable_deposits: arr(p.questionable_deposits),
    mca_debits: arr(p.mca_debits),
    _filename: filename,
  };
}

// FNV-1a hash over raw bytes → stable short hex. Used to detect BYTE-IDENTICAL
// bank-statement uploads so the same file (even renamed) is sent to Claude once.
function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Post-extraction dedup by the statement PERIOD Claude read from INSIDE each PDF
// (month + account_last4) — NOT the filename. Two files covering the same period
// for the same account collapse to one; keep the richer extraction (more line
// items), first on a tie. Error statements and periodless statements pass through
// untouched. Net effect: the same statement uploaded twice == uploaded once.
function dedupByPeriod(statements: PerStatement[]): PerStatement[] {
  const richness = (s: PerStatement) =>
    (s.deposits?.length ?? 0) + (s.padding_deposits?.length ?? 0) +
    (s.questionable_deposits?.length ?? 0) + (s.mca_debits?.length ?? 0);
  const byPeriod = new Map<string, number>(); // period key → index in `out`
  const out: PerStatement[] = [];
  for (const s of statements) {
    const period = (s.month ?? "").toString().trim().toLowerCase();
    if (s._error || !period) { out.push(s); continue; }
    const key = `${s.account_last4 ?? "?"}|${period}`;
    const existingIdx = byPeriod.get(key);
    if (existingIdx == null) {
      byPeriod.set(key, out.length);
      out.push(s);
    } else if (richness(s) > richness(out[existingIdx])) {
      // Prefer the richer extraction; carry a merged dupe_count for provenance.
      s._dupe_count = (out[existingIdx]._dupe_count ?? 1) + (s._dupe_count ?? 1);
      out[existingIdx] = s;
    } else {
      out[existingIdx]._dupe_count = (out[existingIdx]._dupe_count ?? 1) + (s._dupe_count ?? 1);
    }
  }
  return out;
}

// First-third vs last-third average of the monthly net-revenue series.
function trendOf(series: number[]): "up" | "flat" | "down" {
  if (series.length < 2) return "flat";
  const third = Math.max(1, Math.floor(series.length / 3));
  const first = series.slice(0, third);
  const last = series.slice(-third);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const f = avg(first);
  const l = avg(last);
  if (f <= 0) return l > 0 ? "up" : "flat";
  const change = (l - f) / f;
  if (change > 0.1) return "up";
  if (change < -0.1) return "down";
  return "flat";
}

// Base64-encode bytes without blowing the call stack on large PDFs (chunked).
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
