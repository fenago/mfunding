// deal-assistant — a deal-desk AI the CLOSER can chat with while a deal is loaded
// in the Revenue Playbook. The use case is literal: the closer is ON THE PHONE
// with a funder who is asking for things, and needs the answer NOW.
//
// POST body: { deal_id, question, history?: [{ role: "user"|"assistant", content }] }
//        →   { answer, model, context_summary }
//
// The whole value is CONTEXT ASSEMBLY: we load everything about that ONE deal
// (merchant, financials, pipeline position, doc checklist, every funder it went
// to and what each said, funder requirements, underwriting, activity history) and
// hand it to the model. The model reasons INSIDE that context and nothing else.
//
// House doctrine honored here:
//   • Code computes ground truth; the AI explains it. Per-funder missing-doc math
//     is done in TypeScript (mirrors src/services/funderAvailability.ts), not by
//     the model — so "what is the funder waiting on" is deterministic.
//   • Missing docs are STIPULATIONS, never disqualifiers. A voided check NEVER
//     blocks (a bank-portal screenshot satisfies it) and rides as an advisory.
//   • deals.doc_checklist is the SOURCE OF TRUTH for what's collected.
//
// Auth: verify_jwt = true PLUS an in-code staff role check (mirrors
// analyze-campaign). A CLOSER may only ask about a deal they own — enforced via
// the closer_owns_deal(uid, d_id) RPC (same call as submit-to-funders /
// underwrite-deal). Admin/super_admin may ask about any deal.
//
// Compliance: an MCA is a purchase of future receivables, NEVER a loan.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM, resolveConfig } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// The docs-on-file vocabulary (customer_document_type slugs), same labels the
// closer sees in DocumentChecklist / FunderPicker.
const DOC_LABELS: Record<string, string> = {
  application: "Signed application",
  bank_statement: "Bank statements",
  id: "Photo ID",
  business_license: "Business license",
  tax_return: "Tax return",
  voided_check: "Voided check",
};

/** Docs on file = the closer-ticked deals.doc_checklist. Source of truth. */
function docsOnFile(deal: Row): Set<string> {
  const present = new Set<string>();
  for (const [slug, on] of Object.entries((deal.doc_checklist ?? {}) as Record<string, unknown>)) {
    if (on === true) present.add(slug);
  }
  return present;
}

/**
 * Deterministic per-funder doc math (mirrors funderAvailability.evaluate).
 * missing   = HARD-required docs not on file → real stipulations to collect.
 * advisories = never blocking (voided check, conditional docs).
 */
function funderDocGap(p: Row | null, docs: Set<string>) {
  const missing: string[] = [];
  const advisories: string[] = [];
  if (!p) return { missing, advisories, bank_statement_months: null as number | null, conditions: null as string | null };

  const hard: [boolean, string][] = [
    [p.doc_application === true, "application"],
    [p.doc_photo_id === true, "id"],
    [(p.doc_bank_statement_months ?? 0) > 0, "bank_statement"],
    [p.doc_proof_of_ownership === true, "business_license"],
    [p.doc_tax_financials === "required", "tax_return"],
  ];
  for (const [required, slug] of hard) {
    if (!required || docs.has(slug)) continue;
    if (slug === "bank_statement" && (p.doc_bank_statement_months ?? 0) > 0) {
      missing.push(`${DOC_LABELS.bank_statement} (${p.doc_bank_statement_months} months)`);
    } else {
      missing.push(DOC_LABELS[slug]);
    }
  }

  // A voided check NEVER blocks — a bank-portal screenshot satisfies it.
  if (p.doc_voided_check === true && !docs.has("voided_check")) {
    advisories.push("Voided check (a bank-portal screenshot satisfies it — never a blocker)");
  }
  if (p.doc_tax_financials === "conditional") advisories.push("Tax return / financials may be needed for larger deals");
  if (p.doc_cc_processing === "required" || p.doc_cc_processing === "if_applicable") {
    advisories.push("CC-processing statements may also be needed");
  }
  if (p.doc_ar_aging === "required" || p.doc_ar_aging === "if_applicable") advisories.push("A/R aging report may also be needed");
  if (p.doc_mtd_statement === true) advisories.push("Month-to-date bank statement may also be needed");

  return {
    missing,
    advisories,
    bank_statement_months: p.doc_bank_statement_months ?? null,
    conditions: p.doc_conditions?.trim?.() || null,
  };
}

const STAGE_TIMESTAMPS = [
  "created_at", "contacted_at", "qualified_at", "application_sent_at", "docs_collected_at",
  "bank_statements_at", "submitted_at", "offer_received_at", "offer_presented_at",
  "offer_accepted_at", "funded_at", "declined_at", "nurture_at",
];

const clip = (v: unknown, n = 600) =>
  typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v ?? null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // ---- Authn: signed-in staff only. -------------------------------------
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);

    const { data: callerProfile } = await db
      .from("profiles").select("role").eq("id", caller.id).single();
    const role = callerProfile?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const dealId = (body?.deal_id ?? body?.dealId) as string | undefined;
    const question = String(body?.question ?? "").trim();
    if (!dealId) return json({ error: "deal_id is required" }, 400);
    if (!question) return json({ error: "question is required" }, 400);

    // ---- Authz: a closer may only ask about a deal they own. ---------------
    if (role === "closer") {
      const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
      if (owns !== true) {
        return json({ error: "Forbidden — this deal is not assigned to you." }, 403);
      }
    }

    // ---- CONTEXT ASSEMBLY --------------------------------------------------
    // 1) The deal.
    const { data: deal, error: dErr } = await db
      .from("deals")
      .select(
        "id, customer_id, deal_number, deal_type, status, previous_status, amount_requested, amount_funded, " +
          "use_of_funds, urgency, is_renewal, renewal_count, paydown_percentage, lead_source, lead_source_detail, " +
          "market, campaign_id, temperature, lead_qual, doc_checklist, playbook_checklist, notes, tags, " +
          "closed_reason, closed_note, lost_reason, merchant_reply_at, merchant_reply_summary, ai_business_summary, " +
          "ai_recommended_at, ai_lender_recommendations, first_call_due_at, " +
          "vcf_active_positions, vcf_total_balance, vcf_daily_debit, vcf_current_funders, vcf_hardship_reason, " +
          STAGE_TIMESTAMPS.join(", "),
      )
      .eq("id", dealId)
      .maybeSingle();
    if (dErr) return json({ error: `could not load deal: ${dErr.message}` }, 502);
    if (!deal) return json({ error: "Deal not found." }, 404);

    // 2) The merchant.
    const { data: customer } = await db
      .from("customers")
      .select(
        "id, business_name, first_name, last_name, email, phone, industry, business_type, ein, " +
          "time_in_business, monthly_revenue, credit_score_range, has_bankruptcies, has_tax_liens, " +
          "address_city, address_state, address_zip, source, notes, do_not_contact, do_not_contact_reason",
      )
      .eq("id", deal.customer_id)
      .maybeSingle();

    // 3) Submissions → which funders, when, what they said.
    const { data: subs } = await db
      .from("deal_submissions")
      .select(
        "id, lender_id, status, submitted_at, response_at, response_type, response_summary, decline_reason, " +
          "offer_amount, factor_rate, term_months, daily_payment, weekly_payment, total_payback, " +
          "commission_points, commission_amount, notes, submission_method, opened_at, open_count, withdrawn_at, error",
      )
      .eq("deal_id", dealId)
      .order("submitted_at", { ascending: true });
    const submissions = (subs ?? []) as Row[];

    // 4) The funder records + MCA program + submission recipe for those funders,
    //    so the assistant can answer "what does THIS funder need from us?".
    const lenderIds = [...new Set(submissions.map((s) => s.lender_id).filter(Boolean))];
    let lenders: Row[] = [], programs: Row[] = [], recipes: Row[] = [];
    if (lenderIds.length) {
      const [lRes, pRes, rRes] = await Promise.all([
        db.from("lenders")
          .select(
            "id, company_name, status, submission_email, submission_portal_url, submission_notes, " +
              "min_funding_amount, max_funding_amount, min_time_in_business, min_monthly_revenue, min_credit_score, " +
              "factor_rate_range, term_lengths, commission_rate, commission_notes, funding_speed, stacking_policy, " +
              "paper_types, industries_restricted, states_restricted, primary_contact_name, primary_contact_email, " +
              "primary_contact_phone, notes",
          )
          .in("id", lenderIds),
        db.from("lender_programs")
          .select(
            "lender_id, product_type, is_active, approval_min, approval_max, term_text, min_credit_score, " +
              "monthly_revenue_required, time_in_business_months, cost_of_capital, payment_frequency, " +
              "required_documents, important_details, doc_bank_statement_months, doc_application, doc_photo_id, " +
              "doc_voided_check, doc_cc_processing, doc_mtd_statement, doc_proof_of_ownership, doc_ar_aging, " +
              "doc_tax_financials, doc_conditions, doc_other",
          )
          .in("lender_id", lenderIds).eq("product_type", "mca"),
        db.from("funder_submission_profiles")
          .select("lender_id, method, to_email, required_stips, special_instructions, max_statement_months, portal_url, active")
          .in("lender_id", lenderIds),
      ]);
      lenders = (lRes.data ?? []) as Row[];
      programs = (pRes.data ?? []) as Row[];
      recipes = (rRes.data ?? []) as Row[];
    }

    // 5) Documents actually uploaded (hints) + the authoritative checklist.
    const { data: docsRaw } = await db
      .from("customer_documents")
      .select("document_type, filename, status, description, created_at")
      .eq("customer_id", deal.customer_id)
      .order("created_at", { ascending: false })
      .limit(40);

    // 6) Latest underwriting run (bank analysis), if any.
    const { data: uw } = await db
      .from("deal_underwriting")
      .select("version, run_mode, metrics, flags, risk_rating, affordability_rating, ai_narrative, assumptions, created_at")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 7) The MCA application (is it filled? sent to the merchant?).
    const { data: app } = await db
      .from("mca_applications")
      .select("status, sent_to_merchant_at, business_legal_name, existing_positions, existing_balance, average_daily_balance, monthly_revenue, updated_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    // 8) The story so far — activity on the DEAL and the CUSTOMER.
    const { data: acts } = await db
      .from("activity_log")
      .select("interaction_type, subject, content, old_status, new_status, call_outcome, created_at")
      .in("entity_id", [dealId, deal.customer_id])
      .order("created_at", { ascending: false })
      .limit(30);

    // ---- Deterministic doc math (code, not the model). ---------------------
    const onFile = docsOnFile(deal as Row);
    const docsCollected = [...onFile].map((s) => DOC_LABELS[s] ?? s);
    const docsNotTicked = Object.keys(DOC_LABELS).filter((s) => !onFile.has(s)).map((s) => DOC_LABELS[s]);

    const programByLender = new Map(programs.map((p) => [p.lender_id, p]));
    const recipeByLender = new Map(recipes.map((r) => [r.lender_id, r]));
    const lenderById = new Map(lenders.map((l) => [l.id, l]));

    const funderView = submissions.map((s) => {
      const l = lenderById.get(s.lender_id) ?? null;
      const p = programByLender.get(s.lender_id) ?? null;
      const r = recipeByLender.get(s.lender_id) ?? null;
      const gap = funderDocGap(p, onFile);
      return {
        funder: l?.company_name ?? "Unknown funder",
        submission_status: s.status,
        submitted_at: s.submitted_at,
        response_at: s.response_at,
        response_type: s.response_type,
        what_they_said: clip(s.response_summary),
        decline_reason: clip(s.decline_reason),
        offer: s.offer_amount
          ? {
              amount: s.offer_amount, factor_rate: s.factor_rate, term_months: s.term_months,
              daily_payment: s.daily_payment, weekly_payment: s.weekly_payment,
              total_payback: s.total_payback, commission_points: s.commission_points,
              commission_amount: s.commission_amount,
            }
          : null,
        email_opened_at: s.opened_at,
        withdrawn_at: s.withdrawn_at,
        send_error: s.error ?? null,
        // What this specific funder requires vs. what we actually have:
        their_requirements: l
          ? {
              min_monthly_revenue: l.min_monthly_revenue, min_time_in_business_months: l.min_time_in_business,
              min_funding_amount: l.min_funding_amount, max_funding_amount: l.max_funding_amount,
              min_credit_score: l.min_credit_score, factor_rate_range: l.factor_rate_range,
              stacking_policy: l.stacking_policy, funding_speed: l.funding_speed,
              submission_email: l.submission_email, submission_notes: clip(l.submission_notes, 400),
              contact: l.primary_contact_name, contact_email: l.primary_contact_email,
              contact_phone: l.primary_contact_phone,
            }
          : null,
        their_required_stips: r?.required_stips ?? p?.required_documents ?? null,
        their_special_instructions: clip(r?.special_instructions, 400),
        max_statement_months: r?.max_statement_months ?? p?.doc_bank_statement_months ?? null,
        // COMPUTED IN CODE — deterministic, not an AI guess:
        stips_still_missing_for_this_funder: gap.missing,
        non_blocking_advisories: gap.advisories,
        their_doc_conditions: gap.conditions,
      };
    });

    const stageTimeline = Object.fromEntries(
      STAGE_TIMESTAMPS.map((k) => [k, (deal as Row)[k] ?? null]).filter(([, v]) => v != null),
    );

    const context = {
      deal: {
        deal_number: deal.deal_number,
        product: deal.deal_type === "vcf" ? "VCF (debt relief)" : "MCA (purchase of future receivables)",
        deal_type: deal.deal_type,
        pipeline_stage: deal.status,
        amount_requested: deal.amount_requested,
        amount_funded: deal.amount_funded,
        is_renewal: deal.is_renewal,
        renewal_count: deal.renewal_count,
        paydown_percentage: deal.paydown_percentage,
        use_of_funds: deal.use_of_funds,
        urgency: deal.urgency,
        lead_source: deal.lead_source,
        lead_source_detail: deal.lead_source_detail,
        market: deal.market,
        temperature: deal.temperature,
        lead_qual: deal.lead_qual,
        closed_reason: deal.closed_reason,
        closed_note: deal.closed_note,
        lost_reason: deal.lost_reason,
        merchant_replied_at: deal.merchant_reply_at,
        merchant_reply_summary: deal.merchant_reply_summary,
        notes: clip(deal.notes, 800),
        tags: deal.tags,
        stage_timeline: stageTimeline,
        ai_business_summary: clip(deal.ai_business_summary, 1200),
      },
      // VCF-only fields, included only for VCF deals.
      ...(deal.deal_type === "vcf"
        ? {
            vcf: {
              active_positions: (deal as Row).vcf_active_positions ?? null,
              total_balance: (deal as Row).vcf_total_balance ?? null,
              daily_debit: (deal as Row).vcf_daily_debit ?? null,
              current_funders: (deal as Row).vcf_current_funders ?? null,
              hardship_reason: (deal as Row).vcf_hardship_reason ?? null,
            },
          }
        : {}),
      merchant: customer
        ? {
            business_name: customer.business_name,
            owner: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || null,
            email: customer.email,
            phone: customer.phone,
            industry: customer.industry,
            business_type: customer.business_type,
            state: customer.address_state,
            city: customer.address_city,
            time_in_business_months: customer.time_in_business,
            stated_monthly_revenue: customer.monthly_revenue,
            credit_score_range: customer.credit_score_range,
            has_bankruptcies: customer.has_bankruptcies,
            has_tax_liens: customer.has_tax_liens,
            do_not_contact: customer.do_not_contact,
            notes: clip(customer.notes, 600),
          }
        : null,
      documents: {
        note:
          "deals.doc_checklist is the SOURCE OF TRUTH for what is collected. Uploaded files are hints only. " +
          "Missing docs are STIPULATIONS to collect — they never disqualify a funder.",
        collected: docsCollected,
        not_yet_ticked: docsNotTicked,
        uploaded_files: (docsRaw ?? []).map((d: Row) => ({
          type: d.document_type, filename: d.filename, status: d.status, uploaded_at: d.created_at,
        })),
      },
      application: app
        ? {
            status: app.status,
            sent_to_merchant_at: app.sent_to_merchant_at,
            existing_mca_positions: app.existing_positions,
            existing_balance: app.existing_balance,
            average_daily_balance: app.average_daily_balance,
            stated_monthly_revenue_on_app: app.monthly_revenue,
          }
        : null,
      underwriting: uw
        ? {
            version: uw.version, run_at: uw.created_at, risk_rating: uw.risk_rating,
            affordability_rating: uw.affordability_rating, metrics: uw.metrics, flags: uw.flags,
            assumptions: uw.assumptions, narrative: clip(uw.ai_narrative, 1500),
          }
        : null,
      funder_submissions: funderView.length ? funderView : "This deal has NOT been submitted to any funder yet.",
      recent_activity: (acts ?? []).map((a: Row) => ({
        at: a.created_at, type: a.interaction_type, subject: a.subject,
        note: clip(a.content, 300), outcome: a.call_outcome,
        status_change: a.new_status ? `${a.old_status ?? "?"} → ${a.new_status}` : null,
      })),
    };

    // ---- The prompt --------------------------------------------------------
    const system = [
      "You are the deal desk for Momentum Funding (MFunding), an ISO/brokerage. You are talking to a CLOSER on our",
      "own team — this is INTERNAL. The closer is very likely ON THE PHONE right now with a funder or the merchant,",
      "so speed and precision beat completeness.",
      "",
      "ANSWER STYLE (this matters as much as accuracy):",
      "- Lead with the direct answer in the first sentence. No preamble, no restating the question.",
      "- Short. Usually under 80 words. Use tight bullets for lists (missing stips, funder responses).",
      "- Concrete and specific: cite the deal's ACTUAL numbers, funder names, dates, and stage from the context.",
      "- Give the closer the next action when there is an obvious one.",
      "- No markdown headers, no wall of text, no sign-off.",
      "",
      "ANTI-HALLUCINATION — ABSOLUTE:",
      "- Answer ONLY from the DEAL CONTEXT JSON provided. It is the complete record of this deal.",
      "- If something is not in the context, SAY SO PLAINLY — e.g. 'No bank statements on file' or",
      "  'No underwriting has been run on this deal' or 'This deal hasn't gone to any funder yet'.",
      "- NEVER invent or estimate financials, funder terms, factor rates, offers, stip lists, dates, or funder",
      "  responses. A missing value is a finding to report, not a gap to fill. Do not guess what a funder",
      "  'probably' wants — if their requirements are not in the context, say we don't have them on file.",
      "- The stips_still_missing_for_this_funder and non_blocking_advisories fields were computed",
      "  DETERMINISTICALLY IN CODE from the funder's real requirements. Trust them over your own inference,",
      "  and never contradict them.",
      "",
      "DOCTRINE:",
      "- Missing documents are STIPULATIONS to collect, never disqualifiers. Never tell the closer a deal is dead",
      "  because a doc is missing — tell them which doc to go get.",
      "- A voided check NEVER blocks anything; a bank-portal screenshot satisfies it.",
      "- Unknown or weak credit does not disqualify an MCA — MCA is cash-flow underwriting.",
      "",
      "COMPLIANCE — NON-NEGOTIABLE:",
      "- An MCA is a PURCHASE OF FUTURE RECEIVABLES. It is NOT a loan. Never write 'loan', 'borrow', 'lend',",
      "  'interest rate', or 'APR' about an MCA. Correct terms: advance, funding, capital, factor rate, payback,",
      "  retrieval/holdback, purchase of future receivables.",
      "- Actual loan products (term loan, SBA, LOC, equipment financing) may use normal lending terminology.",
      "- Funders are 'funders', not 'lenders', on MCA deals.",
    ].join("\n");

    // Multi-turn: prior turns are replayed as a transcript ahead of the question,
    // so follow-ups like "and what about the second one?" resolve.
    const hist = Array.isArray(body?.history) ? (body.history as Row[]).slice(-8) : [];
    const transcript = hist
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m) => `${m.role === "user" ? "CLOSER" : "YOU"}: ${m.content}`)
      .join("\n\n");

    const prompt = [
      "DEAL CONTEXT (the complete record for this one deal — the only facts you may use):",
      "```json",
      JSON.stringify(context, null, 2),
      "```",
      transcript ? `\nCONVERSATION SO FAR:\n${transcript}` : "",
      `\nCLOSER'S QUESTION: ${question}`,
      "\nAnswer now — short, direct, grounded in the context above.",
    ].join("\n");

    const { model } = await resolveConfig(db, "deal_assistant");

    let answer: string;
    try {
      answer = await callLLM(db, {
        system,
        prompt,
        maxTokens: 900,
        temperature: 0.2,
        task: "deal_assistant",
      });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }
    if (!answer?.trim()) return json({ error: "The AI returned an empty answer. Try rephrasing." }, 502);

    return json({
      ok: true,
      answer: answer.trim(),
      model,
      // Lets the UI show what the assistant could actually see.
      context_summary: {
        deal_number: deal.deal_number,
        stage: deal.status,
        funders_submitted: funderView.length,
        docs_collected: docsCollected.length,
        has_underwriting: !!uw,
        activity_events: (acts ?? []).length,
      },
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
