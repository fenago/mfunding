// recommend-lenders — AI funder-matching for the submit-to-funders flow.
//
// POST body: { "deal_id": "<deal uuid>" }
//
// Loads the deal + customer and the funder network (lenders with any criteria or
// submission data), builds a merchant profile, and asks Claude to rank the best
// funder fits for THIS deal. Returns STRICT JSON:
//   { recommendations: [{ lender_id, lender_name, fit, reasons[], watch_outs[] }],
//     summary, missing_fields[], model }
//
// This does NOT submit anything or send any email — it only produces a ranked
// short-list the closer reviews in the FunderPicker before hitting Submit.
//
// Auth: verify_jwt stays default (authenticated staff call it via
// supabase.functions.invoke). The Anthropic key is a function secret, never the
// client's, and is never returned to the caller.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. The system prompt
// enforces receivables language; the model reasons about fit, not loan terms.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM, resolveConfig } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const tib = (months: unknown) => {
  const m = Number(months);
  if (!m || Number.isNaN(m)) return null;
  if (m < 12) return `${m} months`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r ? `${y} yr ${r} mo` : `${y} yr`;
};

const money = (n: unknown) =>
  n == null || n === "" ? null : `$${Number(n).toLocaleString("en-US")}`;

// Array/string field is "present" when it holds something meaningful.
function has(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

// deno-lint-ignore no-explicit-any
type Lender = Record<string, any>;

// The criteria/submission fields we hand the model. A lender is "usable" for
// recommendation if it has a name plus at least one of these populated.
const LENDER_FIELDS = [
  "lender_types", "funding_products", "paper_types",
  "min_funding_amount", "max_funding_amount", "min_time_in_business",
  "min_monthly_revenue", "min_credit_score", "requires_collateral",
  "industries_restricted", "industries_preferred",
  "states_available", "states_restricted",
  "factor_rate_range", "funding_speed", "stacking_policy",
  "submission_email", "submission_portal_url", "submission_notes", "notes",
] as const;

// Human labels for the docs-on-file vocabulary (customer_documents.document_type
// slugs). Mirrors FunderPicker / funderAvailability DOC_LABELS so the AI, the
// server, and the client all speak the same doc names.
const DOC_LABELS: Record<string, string> = {
  application: "Signed application",
  bank_statement: "Bank statements",
  id: "Photo ID",
  business_license: "Business license",
  tax_return: "Tax return",
  voided_check: "Voided check",
};

// Per-funder doc readiness computed deterministically server-side (NOT by the
// AI). Mirrors src/services/funderAvailability.ts evaluate() exactly.
interface DocReadiness {
  docsReady: boolean;
  docsMissing: string[]; // hard-required docs not on file, human-labeled
  docsAdvisory: string[]; // voided check + conditional/if-applicable (never blocking)
}

// A lender_programs row (MCA) reduced to the doc-requirement columns.
// deno-lint-ignore no-explicit-any
type ProgramRow = Record<string, any>;

// For one funder's MCA program + the docs on the merchant's file, decide
// ready / missing / advisories. HARD-required docs flip a funder to NOT ready;
// voided check and conditional/if-applicable docs are advisories that NEVER
// lower readiness (STANDING RULE: a bank-portal screenshot satisfies a voided
// check, so it never blocks).
function docReadiness(p: ProgramRow | null | undefined, docs: Set<string>): DocReadiness {
  const missing: string[] = [];
  const advisory: string[] = [];
  if (!p) return { docsReady: true, docsMissing: missing, docsAdvisory: advisory };

  const bankMonths = Number(p.doc_bank_statement_months ?? 0) || 0;
  const hard: [boolean, string][] = [
    [p.doc_application === true, "application"],
    [p.doc_photo_id === true, "id"],
    [bankMonths > 0, "bank_statement"],
    [p.doc_proof_of_ownership === true, "business_license"],
    [p.doc_tax_financials === "required", "tax_return"],
  ];
  for (const [required, slug] of hard) {
    if (!required || docs.has(slug)) continue;
    if (slug === "bank_statement" && bankMonths > 0) {
      missing.push(`${DOC_LABELS.bank_statement} (${bankMonths}mo)`);
    } else {
      missing.push(DOC_LABELS[slug]);
    }
  }

  // ADVISORY docs — shown for context, never blocking.
  if (p.doc_voided_check === true && !docs.has("voided_check")) {
    advisory.push("Voided check (a bank-portal screenshot satisfies it)");
  }
  if (p.doc_tax_financials === "conditional") {
    advisory.push("Tax return / financials may be needed for larger deals");
  }
  if (p.doc_cc_processing === "required" || p.doc_cc_processing === "if_applicable") {
    advisory.push("CC-processing statements may also be needed");
  }
  if (p.doc_ar_aging === "required" || p.doc_ar_aging === "if_applicable") {
    advisory.push("A/R aging report may also be needed");
  }
  if (p.doc_mtd_statement === true) {
    advisory.push("Month-to-date bank statement may also be needed");
  }

  return { docsReady: missing.length === 0, docsMissing: missing, docsAdvisory: advisory };
}

// Compact one-funder view — drop empty fields so the prompt stays lean and the
// model isn't misled by nulls.
interface Qualification { qualifies: boolean; disqualifiers: string[]; }

// GROUND-TRUTH qualification: does the merchant meet this funder's HARD minimums
// (revenue, time in business, funding amount range) from the Funder Approval
// Matrix? Computed in code — the AI must NOT call a disqualified funder a fit.
// Credit is intentionally NOT gated here (often a range/unknown; unknown credit
// must never disqualify). Voided check / docs are handled separately.
function qualification(
  program: ProgramRow | null | undefined,
  m: { monthlyRev: number | null; tibMonths: number | null; amount: number | null },
): Qualification {
  const dq: string[] = [];
  if (!program) return { qualifies: true, disqualifiers: dq }; // no matrix criteria → can't disqualify
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const fmt = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
  const minRev = n(program.monthly_revenue_required);
  const minTib = n(program.time_in_business_months);
  const aMin = n(program.approval_min);
  const aMax = n(program.approval_max);
  if (minRev && m.monthlyRev != null && m.monthlyRev < minRev)
    dq.push(`Monthly revenue ${fmt(m.monthlyRev)} is below the ${fmt(minRev)}/mo minimum`);
  if (minTib && m.tibMonths != null && m.tibMonths < minTib)
    dq.push(`Time in business ${m.tibMonths} mo is below the ${minTib} mo minimum`);
  if (aMin && m.amount != null && m.amount < aMin)
    dq.push(`Amount ${fmt(m.amount)} is below the ${fmt(aMin)} minimum`);
  if (aMax && m.amount != null && m.amount > aMax)
    dq.push(`Amount ${fmt(m.amount)} exceeds the ${fmt(aMax)} maximum`);
  return { qualifies: dq.length === 0, disqualifiers: dq };
}

function lenderForPrompt(l: Lender, program?: Record<string, unknown> | null, readiness?: DocReadiness, qual?: Qualification) {
  const out: Record<string, unknown> = {
    lender_id: l.id,
    lender_name: l.company_name,
    status: l.status,
  };
  for (const f of LENDER_FIELDS) {
    if (has(l[f])) out[f] = l[f];
  }
  // Authoritative per-funder MCA approval criteria (Funder Approval Matrix).
  if (program) {
    const pm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(program)) {
      if (k !== "lender_id" && has(v)) pm[k] = v;
    }
    if (Object.keys(pm).length) out.mca_approval_matrix = pm;
  }
  // Ground-truth doc readiness for THIS merchant vs THIS funder's structured
  // requirements. The AI reasons about it; it does not compute it.
  if (readiness) {
    out.doc_status = readiness.docsReady
      ? (readiness.docsAdvisory.length
        ? { status: "READY", advisory: readiness.docsAdvisory }
        : "READY")
      : {
        status: "MISSING_REQUIRED_DOCS",
        missing_hard: readiness.docsMissing,
        ...(readiness.docsAdvisory.length ? { advisory: readiness.docsAdvisory } : {}),
      };
  }
  // Ground-truth qualification (hard minimums). A DISQUALIFIED funder cannot be
  // a fit — the AI is told so, and code enforces fit='poor' regardless.
  if (qual) {
    out.qualification_status = qual.qualifies
      ? "QUALIFIES"
      : { status: "DISQUALIFIED", reasons: qual.disqualifiers };
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // Provider/model come from the pluggable LLM layer (task "recommend_lenders"),
    // super-admin-switchable in Admin → Integrations → AI Provider. The model
    // label is surfaced in the response and persisted with the recommendations.
    const { model } = await resolveConfig(db, "recommend_lenders");

    const body = await req.json().catch(() => ({}));
    const dealId = (body?.deal_id ?? body?.dealId) as string | undefined;
    if (!dealId) return json({ error: "deal_id is required" }, 400);

    // 1) Deal + merchant.
    const { data: deal, error: dErr } = await db
      .from("deals")
      .select("id, deal_type, status, customer_id, amount_requested, use_of_funds, vcf_active_positions, doc_checklist, customer:customers!customer_id(business_name, monthly_revenue, time_in_business, industry, business_type, address_state, credit_score_range, ein)")
      .eq("id", dealId).single();
    if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message}` }, 404);
    const cust = (deal.customer ?? {}) as Lender;

    // 2) Funder network — pull everything, then keep the ones with a name and
    //    at least one criteria/submission field to reason about.
    const selectCols = ["id", "company_name", "status", ...LENDER_FIELDS].join(", ");
    const { data: lendersRaw, error: lErr } = await db
      .from("lenders").select(selectCols)
      // Only funders we actually have a relationship with — matches the Step 6
      // picker's filter (getMatchingLenders), so the AI never recommends a
      // funder the closer can't submit to.
      .in("status", ["live_vendor", "approved"]);
    if (lErr) return json({ error: `could not load lenders: ${lErr.message}` }, 502);
    const allLenders = (lendersRaw ?? []) as Lender[];

    // 2b) Funder Approval Matrix (lender_programs, MCA) — the authoritative
    //     approval criteria the owner maintains per funder. Merged into each
    //     funder view so the model ranks against the real matrix, and a funder
    //     with only matrix criteria (empty flat fields) still counts as usable.
    //     Also pulls the STRUCTURED doc requirements (doc_* columns) used for the
    //     per-funder doc-readiness math below.
    const programMap = new Map<string, Record<string, unknown>>();
    const docReqMap = new Map<string, ProgramRow>();
    if (allLenders.length) {
      const { data: programsRaw } = await db
        .from("lender_programs")
        .select("lender_id, approval_min, approval_max, term_text, min_credit_score, annual_revenue_required, monthly_revenue_required, time_in_business_months, cost_of_capital, time_to_approve, approval_pct_min, approval_pct_max, payment_frequency, industries_note, important_details, required_documents, doc_bank_statement_months, doc_application, doc_photo_id, doc_voided_check, doc_cc_processing, doc_mtd_statement, doc_proof_of_ownership, doc_ar_aging, doc_tax_financials, doc_conditions, doc_other")
        .eq("product_type", "mca").eq("is_active", true)
        .in("lender_id", allLenders.map((l) => l.id));
      for (const p of (programsRaw ?? []) as Record<string, unknown>[]) {
        docReqMap.set(p.lender_id as string, p as ProgramRow);
        const populated = Object.entries(p).some(([k, v]) => k !== "lender_id" && has(v));
        if (populated) programMap.set(p.lender_id as string, p);
      }
    }

    // 2c) Docs on the merchant's file — the CLOSER-CONTROLLED manual checklist
    //     (deals.doc_checklist) is the SOURCE OF TRUTH, keyed by
    //     customer_document_type slug → true. We no longer infer "on file" from
    //     customer_documents, which misses docs (a Photo ID uploaded to GHL as
    //     "image.jpg" is never typed 'id'). Feeds the per-funder doc-readiness math.
    const docsOnFile = new Set<string>();
    const checklist = (deal.doc_checklist ?? {}) as Record<string, boolean>;
    for (const [slug, on] of Object.entries(checklist)) {
      if (on === true) docsOnFile.add(slug);
    }

    const lenders = allLenders.filter(
      (l) => l.company_name && (LENDER_FIELDS.some((f) => has(l[f])) || programMap.has(l.id)),
    );
    if (lenders.length === 0) {
      return json({ error: "No funders with usable criteria in the network yet." }, 422);
    }

    // Per-funder doc readiness (ground truth, computed here — not by the AI).
    const readinessMap = new Map<string, DocReadiness>();
    // Per-funder qualification against hard minimums (revenue / TIB / amount).
    const merchantNums = {
      monthlyRev: Number.isFinite(Number(cust.monthly_revenue)) ? Number(cust.monthly_revenue) : null,
      tibMonths: Number.isFinite(Number(cust.time_in_business)) ? Number(cust.time_in_business) : null,
      amount: Number.isFinite(Number(deal.amount_requested)) ? Number(deal.amount_requested) : null,
    };
    const qualMap = new Map<string, Qualification>();
    for (const l of lenders) {
      readinessMap.set(l.id, docReadiness(docReqMap.get(l.id), docsOnFile));
      qualMap.set(l.id, qualification(docReqMap.get(l.id), merchantNums));
    }

    // 3) Merchant profile + which fields are missing (be honest about gaps).
    const profile = {
      business_name: cust.business_name ?? null,
      product_requested: deal.deal_type,
      amount_requested: money(deal.amount_requested),
      monthly_revenue: money(cust.monthly_revenue),
      time_in_business: tib(cust.time_in_business),
      industry: cust.industry ?? cust.business_type ?? null,
      state: cust.address_state ?? null,
      credit: cust.credit_score_range ?? null,
      use_of_funds: deal.use_of_funds ?? null,
      existing_positions: deal.vcf_active_positions ?? null,
    };
    const missingLabels: Record<string, string> = {
      monthly_revenue: "monthly revenue",
      time_in_business: "time in business",
      industry: "industry",
      state: "business state",
      credit: "credit score / range",
      amount_requested: "amount requested",
    };
    const missing_fields = Object.entries(missingLabels)
      .filter(([k]) => !profile[k as keyof typeof profile])
      .map(([, label]) => label);

    const productLabel = deal.deal_type === "mca" ? "MCA (purchase of future receivables)" : deal.deal_type;

    const system =
      "You are an MCA underwriting analyst for an ISO (Independent Sales Organization / broker) " +
      "matching a merchant to the right funders in the ISO's network. " +
      "An MCA is a purchase of future receivables, NOT a loan — never call it a loan or use lending terms for MCA deals. " +
      "Rank funders by how well the merchant profile fits each funder's stated criteria " +
      "(funding range, minimum time in business, minimum monthly revenue, " +
      "industry preferences/restrictions, state availability/restrictions, stacking policy, product type). " +
      "IMPORTANT — credit score weighting: MCA underwriting is revenue/cash-flow based; most MCA funders " +
      "have NO credit minimum, and an unknown credit score is NORMAL at this stage. Never treat unknown credit " +
      "as a global blocker, never make obtaining a credit score a general priority action, and never downgrade " +
      "a funder's fit for unknown credit UNLESS that specific funder has a stated min_credit_score — mention " +
      "credit only in that funder's own watch_outs. " +
      "Be honest and explicit about other missing data — never invent facts. " +
      "QUALIFICATION vs STIPULATIONS — two different things, do not conflate: " +
      'A funder carries "qualification_status". "QUALIFIES" means the merchant meets its HARD criteria ' +
      "(revenue, time in business, funding amount). {\"status\":\"DISQUALIFIED\",\"reasons\":[...]} means the merchant " +
      "FAILS a hard minimum (e.g. revenue below the funder's floor) — this funder is OUT: mark fit \"poor\" and state " +
      "the reason; do NOT recommend submitting. A MISSING DOCUMENT is NOT a disqualifier — it is a STIPULATION we " +
      "collect. A funder can QUALIFY and still be missing a doc: keep it as a strong/possible fit and simply LIST the " +
      "doc to collect. Only failing the hard CRITERIA disqualifies; a missing driver's license, ID, etc. never does. " +
      "DOC READINESS — reason holistically about criteria FIT and DOC READINESS together. " +
      'Each funder carries a "doc_status": "READY" means every hard-required doc for that funder is already ' +
      'on the merchant\'s file; {"status":"MISSING_REQUIRED_DOCS","missing_hard":[...]} means a required doc is ' +
      "not yet collected. Fit and doc-readiness are INDEPENDENT: judge fit from the criteria/matrix ONLY. " +
      "A funder can be a strong fit AND missing docs. When a funder is a strong or possible fit but its doc_status " +
      "is MISSING_REQUIRED_DOCS, keep the fit as-is and add a watch_out like \"Collect <doc> before submitting\". " +
      "When a funder is a strong fit AND doc_status is READY, note in reasons that it is ready to submit now, and " +
      "order docs-ready strong fits first among equals. NEVER lower a funder's fit because of a doc gap. " +
      'The "advisory" items (voided check, conditional/if-applicable docs) must NEVER lower fit and NEVER be ' +
      "treated as blocking — a voided check is satisfied by a bank-portal screenshot; mention advisories only lightly if at all. " +
      "Recommend 3 to 7 funders, best first. " +
      'A "strong" fit clearly meets the stated criteria; "possible" is plausible but has gaps or unknowns; ' +
      '"poor" is a likely mismatch (include only if few good options exist). ' +
      "ALSO write \"business_summary\": a polished 2-4 sentence overview of the MERCHANT suitable to paste at the BOTTOM OF A FUNDER SUBMISSION — who they are, industry, time in business, monthly revenue, amount requested + use of funds, and any genuine strengths (seasoning, stability). It is FUNDER-FACING: do NOT mention other funders, qualification counts, disqualifications, doc gaps, or any internal analysis. Professional, factual, no hype. " +
      "Return ONLY a single strict JSON object, no prose or markdown, of the exact shape: " +
      '{"recommendations":[{"lender_id":string,"lender_name":string,"fit":"strong"|"possible"|"poor","reasons":string[],"watch_outs":string[]}],"summary":string,"business_summary":string}. ' +
      "Use the exact lender_id and lender_name from the provided funder list.";

    const docsOnFileLabels = [...docsOnFile].map((s) => DOC_LABELS[s] ?? s.replace(/_/g, " "));
    const user =
      `MERCHANT PROFILE (product requested: ${productLabel}):\n` +
      JSON.stringify(profile, null, 2) +
      (missing_fields.length ? `\n\nMissing/unknown merchant fields: ${missing_fields.join(", ")}.` : "") +
      `\n\nDOCS ON FILE for this merchant: ${docsOnFileLabels.length ? docsOnFileLabels.join(", ") : "none yet"}.` +
      `\n\nFUNDER NETWORK (${lenders.length} funders; only populated criteria are shown per funder. ` +
      `Each funder's "mca_approval_matrix" is the authoritative approval criteria — rank primarily against it. ` +
      `Each funder's "doc_status" is the ground-truth doc readiness for THIS merchant — factor it in per the rules above):\n` +
      JSON.stringify(lenders.map((l) => lenderForPrompt(l, programMap.get(l.id), readinessMap.get(l.id), qualMap.get(l.id))), null, 2) +
      `\n\nReturn the ranked JSON now.`;

    // 4) Call the active LLM provider (task "recommend_lenders"). callLLM
    //    resolves provider/model from llm_settings, loads the key server-side,
    //    dispatches to the right protocol, and returns assistant text with
    //    ```json fences stripped. A provider/HTTP error throws a clear message.
    let text: string;
    try {
      text = await callLLM(db, {
        system,
        prompt: user,
        maxTokens: 4096,
        temperature: 0.2,
        jsonMode: true,
        task: "recommend_lenders",
      });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }

    // 5) Parse defensively — extract the JSON object even if wrapped in prose.

    let parsed: { recommendations?: unknown; summary?: unknown } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
      }
    }
    if (!parsed || !Array.isArray(parsed.recommendations)) {
      return json({ error: "Could not parse AI response.", raw: text.slice(0, 500) }, 502);
    }

    // Keep only recommendations that point at a real funder in the list, and
    // ATTACH the ground-truth doc-readiness the code computed (docsReady /
    // docsMissing / docsAdvisory) — never trust the AI to compute these.
    const validIds = new Map(lenders.map((l) => [l.id, l.company_name]));
    const fits = new Set(["strong", "possible", "poor"]);
    // deno-lint-ignore no-explicit-any
    const recommendations = (parsed.recommendations as any[])
      .filter((r) => r && validIds.has(r.lender_id))
      .map((r) => {
        const readiness = readinessMap.get(r.lender_id) ??
          { docsReady: true, docsMissing: [], docsAdvisory: [] };
        const qual = qualMap.get(r.lender_id) ?? { qualifies: true, disqualifiers: [] };
        return {
          lender_id: r.lender_id as string,
          lender_name: validIds.get(r.lender_id) as string,
          // HARD GATE: a merchant failing a funder minimum is NOT a fit,
          // regardless of what the model said.
          fit: qual.qualifies ? (fits.has(r.fit) ? r.fit : "possible") : "poor",
          qualifies: qual.qualifies,
          disqualifiers: qual.disqualifiers,
          reasons: Array.isArray(r.reasons) ? r.reasons.filter((x: unknown) => typeof x === "string") : [],
          watch_outs: Array.isArray(r.watch_outs) ? r.watch_outs.filter((x: unknown) => typeof x === "string") : [],
          docsReady: readiness.docsReady,
          docsMissing: readiness.docsMissing,
          docsAdvisory: readiness.docsAdvisory,
        };
      });

    // Show DISQUALIFIED funders too (grayed, with the reason) — the AI ranks the
    // best fits and drops the rest, but the closer wants to SEE who's out and why.
    const shown = new Set(recommendations.map((r) => r.lender_id));
    for (const l of lenders) {
      const q = qualMap.get(l.id);
      if (!q || q.qualifies || shown.has(l.id)) continue;
      const readiness = readinessMap.get(l.id) ?? { docsReady: true, docsMissing: [], docsAdvisory: [] };
      recommendations.push({
        lender_id: l.id,
        lender_name: l.company_name as string,
        fit: "poor",
        qualifies: false,
        disqualifiers: q.disqualifiers,
        reasons: ["Merchant does not meet this funder's minimum criteria."],
        watch_outs: [],
        docsReady: readiness.docsReady,
        docsMissing: readiness.docsMissing,
        docsAdvisory: readiness.docsAdvisory,
      });
    }

    // Top-line: how many strong fits are also docs-ready ("submit now").
    const submitNow = recommendations.filter((r) => r.fit === "strong" && r.docsReady && r.qualifies).length;
    const aiSummary = typeof parsed.summary === "string" ? parsed.summary : "";
    const businessSummary = typeof (parsed as { business_summary?: unknown }).business_summary === "string"
      ? (parsed as { business_summary?: string }).business_summary!.trim() : "";
    const summary = submitNow > 0
      ? `${submitNow} funder${submitNow === 1 ? " is a" : "s are"} strong fit${submitNow === 1 ? "" : "s"} AND docs-ready — submit now.` +
        (aiSummary ? ` ${aiSummary}` : "")
      : aiSummary;

    // Persist the ENRICHED recs (with doc-readiness fields) — additive, so the
    // UI reading ai_lender_recommendations keeps working. These cost tokens; the
    // picker rehydrates from the deal so a reload never throws them away.
    await db.from("deals").update({
      ai_lender_recommendations: { summary, recommendations },
      ...(businessSummary ? { ai_business_summary: businessSummary } : {}),
      ai_recommended_at: new Date().toISOString(),
    }).eq("id", dealId);


    return json({
      ok: true,
      deal_id: dealId,
      model,
      summary,
      recommendations,
      missing_fields,
      considered: lenders.length,
      submit_now: submitNow,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
