// recommend-customer — AI sales recommendations for ONE customer/lead.
//
// POST body: { "customer": CustomerProfile }
//
// Moves the former client-side Gemini call (src/lib/gemini.ts,
// generateCustomerRecommendation) server-side. The provider key was previously
// shipped in the browser bundle via VITE_GEMINI_API_KEY (audit #4); it now loads
// from the Supabase vault through the shared callLLM layer and is never returned
// to the caller.
//
// Auth: verify_jwt = true PLUS an in-code staff role check (mirrors
// analyze-campaign / get-funder-email).
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. The prompt
// distinguishes MCA from actual loan products (term/SBA/equipment) accordingly.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface CustomerProfile {
  first_name?: string;
  last_name?: string;
  business_name?: string | null;
  industry?: string | null;
  business_type?: string | null;
  time_in_business?: number | null;
  monthly_revenue?: number | null;
  amount_requested?: number | null;
  lead_source?: string | null;
  status?: string | null;
  notes?: string | null;
}

const RECOMMENDATION_PROMPT = `You are an expert business funding sales consultant for an ISO/brokerage. Analyze this customer profile and provide strategic recommendations for the sales team.

Customer Profile:
{CUSTOMER_DATA}

Based on this information, provide comprehensive recommendations including:

1. A brief summary of this customer's funding profile (2-3 sentences)
2. Recommended funding products ranked by fit (choose from: MCA/Merchant Cash Advance, Term Loan, Line of Credit, Equipment Financing, Invoice Factoring, SBA Loan, Revenue-Based Financing)
3. An opening script tailored to this customer's situation
4. Discovery questions to understand their needs better
5. Common objections for this customer type and how to handle them
6. Best closing approach
7. Any red flags or concerns to watch for
8. Recommended next steps

IMPORTANT COMPLIANCE: An MCA (Merchant Cash Advance) is a purchase of future receivables, NEVER a loan. Do not describe an MCA as a "loan" or use lending terms for it. Actual loan products (term loan, SBA, equipment financing, line of credit) may use standard lending terminology.

Return your response as valid JSON with this exact structure:
{
  "summary": "string - brief assessment of the customer",
  "recommended_products": [
    {
      "product_type": "mca|term_loan|line_of_credit|equipment_financing|invoice_factoring|sba_loan|revenue_based",
      "product_name": "string - friendly product name",
      "fit_score": number 1-10,
      "reasoning": "string - why this product fits",
      "typical_terms": "string - typical terms for this product"
    }
  ],
  "opening_script": "string - personalized opening script",
  "discovery_questions": ["array of 3-5 questions"],
  "objection_handlers": [
    {
      "objection": "string - common objection",
      "response": "string - how to handle it"
    }
  ],
  "closing_approach": "string - best way to close this deal",
  "red_flags": ["array of concerns if any"],
  "next_steps": ["array of recommended next actions"]
}

Focus on practical, actionable advice that a sales rep can use immediately. Be specific to this customer's industry, business size, and funding needs. Return ONLY the JSON, no prose or markdown fences.`;

function buildCustomerData(c: CustomerProfile): string {
  const money = (n?: number | null) => (n ? `$${Number(n).toLocaleString()}` : null);
  return [
    `Name: ${[c.first_name, c.last_name].filter(Boolean).join(" ") || "Not provided"}`,
    `Business Name: ${c.business_name || "Not provided"}`,
    `Industry: ${c.industry || "Not specified"}`,
    `Business Type: ${c.business_type || "Not specified"}`,
    `Time in Business: ${c.time_in_business ? `${c.time_in_business} months` : "Not provided"}`,
    `Monthly Revenue: ${money(c.monthly_revenue) || "Not provided"}`,
    `Amount Requested: ${money(c.amount_requested) || "Not specified"}`,
    `Lead Source: ${c.lead_source?.replace(/_/g, " ") || "Not specified"}`,
    `Current Status: ${c.status?.replace(/_/g, " ") || "Unknown"}`,
    `Notes: ${c.notes || "None"}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // --- Authn/Authz: signed-in staff only. ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: callerProfile } = await db
      .from("profiles").select("role").eq("id", caller.id).single();
    const callerRole = callerProfile?.role as string | undefined;
    if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const customer = body?.customer as CustomerProfile | undefined;
    if (!customer || typeof customer !== "object") {
      return json({ error: "customer is required" }, 400);
    }

    const prompt = RECOMMENDATION_PROMPT.replace("{CUSTOMER_DATA}", buildCustomerData(customer));

    let text: string;
    try {
      text = await callLLM(db, {
        prompt,
        maxTokens: 4096,
        temperature: 0.7,
        jsonMode: true,
        task: "customer_recommendation",
      });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }

    // Parse defensively — pull the JSON object even if wrapped in prose.
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
      }
    }
    if (!parsed || typeof parsed.summary !== "string") {
      return json({ error: "Could not parse AI response.", raw: text.slice(0, 500) }, 502);
    }

    return json({ ok: true, recommendation: parsed });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
