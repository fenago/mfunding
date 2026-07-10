// lender-extract — scrape a lender's website + AI-extract structured funder data.
//
// POST body: { "url": "https://funder.example.com" }
//
// Moves the former client-side pipeline (src/lib/gemini.ts fetchWebsiteContent +
// extractLenderInfo) server-side. Both paid keys were previously shipped in the
// browser bundle via VITE_FIRECRAWL_API_KEY / VITE_GEMINI_API_KEY (audit #4). The
// Firecrawl key now loads from the Supabase vault (Deno.env FIRECRAWL_API_KEY) and
// the AI extraction runs through the shared callLLM layer (provider key never
// leaves the server).
//
// Returns the same LenderExtraction shape the client's "Extract from Website" /
// "Apply extracted data" flow already consumes, so the UI is unchanged.
//
// Auth: verify_jwt = true PLUS an in-code staff role check.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EXTRACTION_PROMPT = `You are analyzing a business funding/MCA company's website for a broker CRM. Extract ALL of the following information if available:

BASIC INFO:
1. Company name
2. Brief description of what they do (1-2 sentences)
3. Types of funding products offered (choose from: mca, term_loan, line_of_credit, equipment_financing, invoice_factoring, sba_loan, revenue_based, real_estate)
4. Credit quality / paper types they accept (choose from: a_paper, b_paper, c_paper, d_paper). Determine based on credit score requirements: A=700+, B=600-699, C=500-599, D=below 500 or stacked/defaulted

FUNDING REQUIREMENTS:
5. Minimum funding amount (number in dollars)
6. Maximum funding amount (number in dollars)
7. Minimum time in business required (number in months)
8. Minimum monthly revenue required (number in dollars)
9. Minimum credit score required (number)
10. Minimum daily bank balance required (number in dollars)

COMMISSION & TERMS:
11. Commission/compensation type for brokers (choose one: points, split, flat)
12. Commission rate (number - percentage or points value)
13. Commission notes (any details about commission tiers, bonuses, structure)
14. Funding speed (e.g. "Same day", "24-48 hours", "3-5 days")
15. Factor rate range (e.g. "1.15 - 1.45")
16. Available term lengths (e.g. "3-18 months")
17. Advance rate (e.g. "Up to 150% of monthly revenue")
18. Stacking policy (e.g. "No stacking", "2nd position OK", "Up to 3 positions")
19. Whether collateral is required (true/false)

INDUSTRY & GEOGRAPHY:
20. Industries they will NOT fund (array of strings)
21. Industries they specialize in or prefer (array of strings)
22. States they do NOT serve (array of state abbreviations)

CONTACT & SUBMISSION:
23. Contact person name (account manager, partner contact)
24. Contact email
25. Contact phone number
26. Deal submission email (where brokers send deals)
27. Broker portal or submission URL

28. Any other important notes about their offerings

An MCA is a purchase of future receivables, NOT a loan — never describe it as a loan.

Return your response as valid JSON with this exact structure:
{
  "company_name": "string or null",
  "description": "string or null",
  "lender_types": ["array of product types"],
  "paper_types": ["array: a_paper, b_paper, c_paper, d_paper"],
  "min_funding_amount": number or null,
  "max_funding_amount": number or null,
  "min_time_in_business": number or null,
  "min_monthly_revenue": number or null,
  "min_credit_score": number or null,
  "min_daily_balance": number or null,
  "commission_type": "points or split or flat or null",
  "commission_rate": number or null,
  "commission_notes": "string or null",
  "funding_speed": "string or null",
  "factor_rate_range": "string or null",
  "term_lengths": "string or null",
  "advance_rate": "string or null",
  "stacking_policy": "string or null",
  "requires_collateral": boolean or null,
  "industries_restricted": ["array of strings"] or null,
  "industries_preferred": ["array of strings"] or null,
  "states_restricted": ["array of state abbreviations"] or null,
  "primary_contact_name": "string or null",
  "primary_contact_email": "string or null",
  "primary_contact_phone": "string or null",
  "submission_email": "string or null",
  "submission_portal_url": "string or null",
  "notes": "string or null"
}

Only include fields where you found relevant information. If a field is not found, use null. Return ONLY the JSON, no prose or markdown fences.
Website content to analyze:
`;

// Scrape the page via Firecrawl (best quality); fall back to a direct fetch with
// tag-stripping so extraction still works if Firecrawl is down/unset.
async function fetchWebsiteContent(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || Deno.env.get("VITE_FIRECRAWL_API_KEY");

  if (firecrawlKey) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${firecrawlKey}`,
        },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      });
      if (res.ok) {
        const data = await res.json();
        const md: string = data?.data?.markdown || data?.data?.content || "";
        if (md && md.trim().length > 100) return md.substring(0, 20000);
      } else {
        console.warn("Firecrawl scrape non-OK:", res.status);
      }
    } catch (e) {
      console.warn("Firecrawl scrape failed, falling back:", e);
    }
  }

  // Direct fetch fallback — no browser CORS constraints server-side.
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MFundingBot/1.0)" },
    });
    if (res.ok) {
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 100) return text.substring(0, 15000);
    }
  } catch (e) {
    console.warn("Direct fetch fallback failed:", e);
  }

  throw new Error("Could not fetch website content.");
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
    let url = (body?.url as string | undefined)?.trim();
    if (!url) return json({ error: "url is required" }, 400);
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    let content: string;
    try {
      content = await fetchWebsiteContent(url);
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }

    let text: string;
    try {
      text = await callLLM(db, {
        prompt: EXTRACTION_PROMPT + content,
        maxTokens: 4096,
        temperature: 0.1,
        jsonMode: true,
        task: "lender_extract",
      });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }

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
    if (!parsed) {
      return json({ error: "Could not parse AI response.", raw: text.slice(0, 500) }, 502);
    }

    return json({ ok: true, data: parsed });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
