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
import { callAnthropicBlocks, callLLM } from "../_shared/llm.ts";

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
//   ~110 business days ≈ a 5–6 month MCA term → max affordable advance is roughly
//   the safe daily debit capacity sustained over that term.
const BIZ_DAYS_PER_MONTH = 21;
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
  deposits: Array<{ date?: string; desc?: string; amount?: number; classified_type?: string }>;
  padding_deposits: Array<{ date?: string; desc?: string; amount?: number; category?: string }>;
  mca_debits: Array<{ date?: string; desc?: string; amount?: number; cadence?: string }>;
  _filename?: string;
  _error?: string;
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
    "Also list MCA/advance DEBITS — recurring daily or weekly fixed withdrawals that look like an existing " +
    "merchant cash advance / receivables purchase remittance (cadence: 'daily' | 'weekly' | 'unknown'). " +
    "Return ONLY this JSON object, no prose: " +
    '{"month":string|null,"opening_balance":number|null,"closing_balance":number|null,' +
    '"total_deposits":number|null,"total_withdrawals":number|null,"avg_daily_balance":number|null,' +
    '"min_balance":number|null,"negative_days":number|null,"nsf_count":number|null,' +
    '"deposits":[{"date":string,"desc":string,"amount":number,"classified_type":string}],' +
    '"padding_deposits":[{"date":string,"desc":string,"amount":number,"category":string}],' +
    '"mca_debits":[{"date":string,"desc":string,"amount":number,"cadence":string}]}'
  );
}

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
      .select("id, deal_number, deal_type, amount_requested, use_of_funds, customer_id, vcf_active_positions, vcf_daily_debit, customer:customers!customer_id(business_name, monthly_revenue, time_in_business, industry, business_type, address_state)")
      .eq("id", dealId).maybeSingle();
    if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);
    const cust = (deal.customer ?? {}) as Any;

    // --- Documents: bank statements (analyzed) + applications (context only). ---
    const { data: docRows } = await db
      .from("customer_documents")
      .select("id, document_type, filename, storage_path, mime_type, created_at, updated_at")
      .eq("customer_id", deal.customer_id)
      .in("document_type", ["bank_statement", "application"]);
    const docs = (docRows ?? []) as Any[];
    const bankDocs = docs.filter((d) => d.document_type === "bank_statement");

    if (bankDocs.length === 0) {
      return json({ error: "No bank statements on file for this deal yet.", dealId }, 422);
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
    const extractOne = async (d: Any): Promise<PerStatement> => {
      const filename = (d.filename as string) || "statement.pdf";
      const isPdf = /pdf/i.test((d.mime_type as string) || "") || /\.pdf$/i.test(filename);
      // Only PDFs are sent as native document blocks. (Image statements could be
      // added later; for now non-PDF bank docs are noted and skipped from extraction.)
      if (!isPdf) return emptyStatement(filename, "not a PDF — skipped from extraction");
      const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, SIGNED_URL_TTL);
      const url = signed?.signedUrl;
      if (!url) return emptyStatement(filename, "could not sign URL");
      let b64: string;
      try {
        const bin = await fetch(url);
        if (!bin.ok) return emptyStatement(filename, `fetch ${bin.status}`);
        const bytes = new Uint8Array(await bin.arrayBuffer());
        if (!bytes.length) return emptyStatement(filename, "empty file");
        b64 = base64FromBytes(bytes);
      } catch (e) {
        return emptyStatement(filename, `fetch error: ${e instanceof Error ? e.message : e}`);
      }
      try {
        const text = await callAnthropicBlocks(
          db,
          settings.extraction_model,
          [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: "Extract this bank statement per your instructions. Return ONLY the JSON object." },
          ],
          { system: exSystem, maxTokens: 4096, temperature: 0, jsonMode: true },
        );
        const parsed = safeParseJson(text);
        if (!parsed) return emptyStatement(filename, "could not parse extraction JSON");
        return normalizeStatement(parsed, filename);
      } catch (e) {
        return emptyStatement(filename, `extraction error: ${e instanceof Error ? e.message : e}`);
      }
    };
    const perStatement: PerStatement[] = await Promise.all(bankDocs.map(extractOne));

    // ---- PASS B: AGGREGATION (deterministic — no AI) ----
    const analyzed = perStatement.filter((s) => !s._error);
    const monthsCovered = analyzed.length;

    const perMonthReported: number[] = [];
    const perMonthPadding: number[] = [];
    const perMonthNet: number[] = [];
    const paddingByCategory: Record<string, number> = {};
    let nsfTotal = 0;
    let negativeDays = 0;
    const balances: number[] = [];
    const minBalances: number[] = [];
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
      const net = Math.max(0, reported - padding);
      perMonthReported.push(reported);
      perMonthPadding.push(padding);
      perMonthNet.push(net);
      nsfTotal += numOr0(s.nsf_count);
      negativeDays += numOr0(s.negative_days);
      if (s.avg_daily_balance != null) balances.push(numOr0(s.avg_daily_balance));
      if (s.min_balance != null) minBalances.push(numOr0(s.min_balance));

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
    const trueAvgMonthlyRevenue = round2(avg(perMonthNet));
    const paddingTotal = round2(perMonthPadding.reduce((a, b) => a + b, 0));
    const avgNetRetained = trueAvgMonthlyRevenue; // deposits − padding (retained real revenue)
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
    const revenueTrend = trendOf(perMonthNet);

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
      net_retained_by_month: perMonthNet.map(round2),
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
    };

    // ---- Flags from the admin-tunable thresholds ----
    const flags: Array<{ code: string; severity: "info" | "warn" | "critical"; message: string }> = [];
    const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

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
    if (analyzed.length < bankDocs.length) {
      flags.push({ code: "extraction_gaps", severity: "info", message: `${bankDocs.length - analyzed.length} of ${bankDocs.length} statement file(s) could not be analyzed.` });
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

    // ---- PASS C: JUDGE (Claude — narrative + risk_rating + funder-fit note) ----
    // Load active MCA funder minimums so the judge can say which paper grade / which
    // funders this true-revenue profile fits.
    const { data: programs } = await db
      .from("lender_programs")
      .select("lender_id, monthly_revenue_required, min_credit_score, approval_min, approval_max")
      .eq("product_type", "mca").eq("is_active", true);
    const funderMinimums = (programs ?? []).map((p) => ({
      monthly_revenue_required: num(p.monthly_revenue_required),
      min_credit_score: num(p.min_credit_score),
      approval_min: num(p.approval_min),
      approval_max: num(p.approval_max),
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
      "Return ONLY strict JSON: " +
      '{"risk_rating":"low"|"medium"|"high","narrative":string,"funder_fit_note":string}. ' +
      "narrative = 2-5 sentences a closer can act on. funder_fit_note = one line on which revenue floors this " +
      "clears and the likely paper grade.";

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
      "\n\nAFFORDABILITY RATING (code-derived): " + affordabilityRating +
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
        maxTokens: 1024,
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
    } catch (e) {
      // Judge failure never sinks the run — we still persist metrics + flags. Derive
      // a fallback risk_rating from the critical/warn flag counts.
      const crit = flags.filter((f) => f.severity === "critical").length;
      const warn = flags.filter((f) => f.severity === "warn").length;
      riskRating = crit > 0 ? "high" : warn >= 2 ? "medium" : "low";
      aiNarrative = `AI narrative unavailable (${e instanceof Error ? e.message : e}). Risk derived from flags: ${crit} critical, ${warn} warnings.`;
    }
    const narrativeOut = funderFitNote ? `${aiNarrative}\n\nFunder fit: ${funderFitNote}` : aiNarrative;

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

    return json({
      ok: true,
      dealId,
      id: inserted?.id,
      version: inserted?.version ?? version,
      run_mode: mode,
      docs_hash: docsHash,
      risk_rating: riskRating,
      affordability_rating: affordabilityRating,
      ai_narrative: narrativeOut,
      metrics,
      flags,
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
    month: null, opening_balance: null, closing_balance: null,
    total_deposits: null, total_withdrawals: null, avg_daily_balance: null,
    min_balance: null, negative_days: null, nsf_count: null,
    deposits: [], padding_deposits: [], mca_debits: [],
    _filename: filename, _error: err,
  };
}

function normalizeStatement(p: Any, filename: string): PerStatement {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    month: p.month ?? null,
    opening_balance: num(p.opening_balance),
    closing_balance: num(p.closing_balance),
    total_deposits: num(p.total_deposits),
    total_withdrawals: num(p.total_withdrawals),
    avg_daily_balance: num(p.avg_daily_balance),
    min_balance: num(p.min_balance),
    negative_days: num(p.negative_days),
    nsf_count: num(p.nsf_count),
    deposits: arr(p.deposits),
    padding_deposits: arr(p.padding_deposits),
    mca_debits: arr(p.mca_debits),
    _filename: filename,
  };
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
