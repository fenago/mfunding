import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedLenderData {
  company_name?: string;
  phone?: string;
  email?: string;
  contact_name?: string;
  description?: string;
  funding_products?: string[];
  min_funding_amount?: number;
  max_funding_amount?: number;
  min_time_in_business?: number;
  min_monthly_revenue?: number;
  min_credit_score?: number;
  commission_structure?: string;
  factor_rate_range?: string;
  term_lengths?: string;
  advance_rate?: string;
  funding_speed?: string;
  stacking_policy?: string;
  industries_restricted?: string[];
  industries_preferred?: string[];
  states_restricted?: string[];
  submission_email?: string;
  submission_portal_url?: string;
  detailed_notes?: string;
}

// Helper to delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to clean string fields - remove JSON artifacts
const cleanString = (val: any): string => {
  if (!val) return "";
  if (typeof val !== "string") return String(val);
  // If it looks like JSON, return empty
  if (val.includes('":') || val.includes('{"') || val.includes('["')) return "";
  return val.trim();
};

// Helper to clean array fields
const cleanArray = (val: any): string[] => {
  if (!val) return [];
  if (!Array.isArray(val)) return [];
  return val
    .filter((item: any) => typeof item === "string" && !item.includes("{") && !item.includes(":"))
    .map((item: string) => item.trim());
};

// Parse numeric value from string (handles $, commas)
const parseAmount = (val: any): number | null => {
  if (!val) return null;
  if (typeof val === "number") return val;
  if (typeof val !== "string") return null;
  // Extract numbers from string like "$10,000" or "10000"
  const cleaned = val.replace(/[^0-9]/g, "");
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
};

// Parse agent output (fallback for non-structured responses)
function parseAgentOutput(output: unknown): ExtractedLenderData {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const result: ExtractedLenderData = {};

  // Extract company name
  const companyMatch = text.match(/(?:company name|business name|lender)[:\s]*([^\n,]+)/i);
  if (companyMatch) result.company_name = companyMatch[1].trim();

  // Extract phone
  const phoneMatch = text.match(/(?:phone|tel|call)[:\s]*([0-9\-\(\)\s\.]+)/i);
  if (phoneMatch) result.phone = phoneMatch[1].trim();

  // Extract email
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) result.email = emailMatch[1].trim();

  // Extract contact name
  const contactMatch = text.match(/(?:contact|rep|representative|account manager)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/i);
  if (contactMatch) result.contact_name = contactMatch[1].trim();

  // Extract description
  const descMatch = text.match(/(?:about|overview|description)[:\s]*([^\n]+(?:\n[^\n]+)?)/i);
  if (descMatch) result.description = descMatch[1].trim().substring(0, 500);

  // Extract funding products
  const products: string[] = [];
  const productKeywords = {
    "mca": ["mca", "merchant cash advance", "cash advance"],
    "term_loan": ["term loan", "term loans", "business term"],
    "line_of_credit": ["line of credit", "loc", "credit line"],
    "equipment_financing": ["equipment", "equipment financing", "equipment loan"],
    "sba_loan": ["sba", "sba loan", "small business administration"],
    "invoice_factoring": ["factoring", "invoice factoring", "receivables"],
    "revenue_based": ["revenue based", "revenue-based", "rbf"],
  };
  Object.entries(productKeywords).forEach(([key, keywords]) => {
    if (keywords.some(kw => text.toLowerCase().includes(kw))) {
      products.push(key);
    }
  });
  if (products.length > 0) result.funding_products = products;

  // Extract funding amounts
  const minFundingMatch = text.match(/(?:minimum|min).*?(?:funding|loan|amount)[:\s]*\$?([0-9,]+)/i);
  if (minFundingMatch) result.min_funding_amount = parseInt(minFundingMatch[1].replace(/,/g, ""));

  const maxFundingMatch = text.match(/(?:maximum|max|up to).*?(?:funding|loan|amount)?[:\s]*\$?([0-9,]+)/i);
  if (maxFundingMatch) result.max_funding_amount = parseInt(maxFundingMatch[1].replace(/,/g, ""));

  // Extract requirements
  const tibMatch = text.match(/(?:time in business|months? in business|TIB)[:\s]*(\d+)/i);
  if (tibMatch) result.min_time_in_business = parseInt(tibMatch[1]);

  const revenueMatch = text.match(/(?:monthly revenue|min.*revenue)[:\s]*\$?([0-9,]+)/i);
  if (revenueMatch) result.min_monthly_revenue = parseInt(revenueMatch[1].replace(/,/g, ""));

  const creditMatch = text.match(/(?:credit score|fico|min.*score)[:\s]*(\d{3})/i);
  if (creditMatch) result.min_credit_score = parseInt(creditMatch[1]);

  // Extract pricing/terms
  const commissionMatch = text.match(/(?:commission|broker.*comp|points)[:\s]*([^\n]+)/i);
  if (commissionMatch) result.commission_structure = commissionMatch[1].trim().substring(0, 200);

  const factorMatch = text.match(/(?:factor rate|interest rate)[:\s]*([^\n]+)/i);
  if (factorMatch) result.factor_rate_range = factorMatch[1].trim().substring(0, 100);

  const termMatch = text.match(/(?:term length|terms?)[:\s]*([^\n]+)/i);
  if (termMatch) result.term_lengths = termMatch[1].trim().substring(0, 100);

  const advanceMatch = text.match(/(?:advance rate|% of revenue)[:\s]*([^\n]+)/i);
  if (advanceMatch) result.advance_rate = advanceMatch[1].trim().substring(0, 100);

  // Extract operations
  const speedMatch = text.match(/(?:funding speed|fund.*(?:in|within)|same day|24.*hour|48.*hour)[^\n]*/i);
  if (speedMatch) result.funding_speed = speedMatch[0].trim().substring(0, 100);

  const stackMatch = text.match(/(?:stack|stacking|2nd position|second position)[^\n]*/i);
  if (stackMatch) result.stacking_policy = stackMatch[0].trim().substring(0, 200);

  // Extract restricted industries
  const restrictedMatch = text.match(/(?:restricted|don't fund|won't fund|prohibited)[^\n]*(?:industries?|business)[:\s]*([^\n]+)/i);
  if (restrictedMatch) {
    result.industries_restricted = restrictedMatch[1].split(/[,;]/).map(s => s.trim()).filter(s => s.length > 0);
  }

  // Extract preferred industries
  const preferredMatch = text.match(/(?:specialize|preferred|focus)[^\n]*(?:industries?|business)[:\s]*([^\n]+)/i);
  if (preferredMatch) {
    result.industries_preferred = preferredMatch[1].split(/[,;]/).map(s => s.trim()).filter(s => s.length > 0);
  }

  // Extract submission info
  const subEmailMatch = text.match(/(?:submit|submission)[^\n]*(?:email)[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (subEmailMatch) result.submission_email = subEmailMatch[1].trim();

  const portalMatch = text.match(/(?:portal|submit)[^\n]*(https?:\/\/[^\s]+)/i);
  if (portalMatch) result.submission_portal_url = portalMatch[1].trim();

  // Store full output as notes
  result.detailed_notes = text.substring(0, 2000);

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== SCAN LENDER WEBSITE v14 (Agent+Schema) ===");

  try {
    const { url } = await req.json();
    console.log("Request URL:", url);

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY") || Deno.env.get("VITE_FIRECRAWL_API_KEY");
    console.log("API Key found:", firecrawlApiKey ? `Yes (${firecrawlApiKey.length} chars)` : "No");

    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ error: "Firecrawl API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentPrompt = `You are researching a business funding lender for a loan brokerage CRM.
Navigate the website thoroughly to find broker/partner information.
Look at broker pages, partner pages, product pages, and requirements.
Extract EXACT numbers for funding amounts, requirements, and terms.`;

    const extractionSchema = {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Exact lender/company name" },
        phone: { type: "string", description: "Phone number" },
        email: { type: "string", description: "General email address" },
        contact_name: { type: "string", description: "Contact person or account manager name" },
        description: { type: "string", description: "Brief company description" },
        funding_products: {
          type: "array",
          items: { type: "string" },
          description: "Types of funding: MCA, term loan, line of credit, equipment financing, SBA, invoice factoring, revenue based"
        },
        min_funding_amount: { type: "number", description: "Minimum funding amount in dollars" },
        max_funding_amount: { type: "number", description: "Maximum funding amount in dollars" },
        min_time_in_business: { type: "number", description: "Minimum time in business in months" },
        min_monthly_revenue: { type: "number", description: "Minimum monthly revenue in dollars" },
        min_credit_score: { type: "number", description: "Minimum credit score required" },
        commission_structure: { type: "string", description: "Broker commission/compensation (e.g., 2-4 points, 10% of funded)" },
        factor_rate_range: { type: "string", description: "Factor rate or interest rate range" },
        term_lengths: { type: "string", description: "Available term lengths" },
        advance_rate: { type: "string", description: "Advance rate or % of revenue" },
        funding_speed: { type: "string", description: "Funding speed (same day, 24-48 hours, etc.)" },
        stacking_policy: { type: "string", description: "Stacking policy (no stacking, 2nd position OK, etc.)" },
        industries_restricted: { type: "array", items: { type: "string" }, description: "Industries they do NOT fund" },
        industries_preferred: { type: "array", items: { type: "string" }, description: "Industries they specialize in" },
        states_restricted: { type: "array", items: { type: "string" }, description: "States they do NOT operate in" },
        submission_email: { type: "string", description: "Email for deal submissions" },
        submission_portal_url: { type: "string", description: "URL for broker portal or deal submission" }
      }
    };

    // Start the agent job using /v2/agent with schema
    console.log("Starting Firecrawl agent job...");
    const agentResponse = await fetch("https://api.firecrawl.dev/v2/agent", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: [url],
        prompt: agentPrompt,
        schema: extractionSchema,
      }),
    });

    console.log("Agent start response status:", agentResponse.status);

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text();
      console.error("Agent start error:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to start agent", status: agentResponse.status, details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentData = await agentResponse.json();
    const jobId = agentData.id;
    console.log("Agent job started, ID:", jobId);

    if (!jobId) {
      console.error("No job ID returned:", JSON.stringify(agentData));
      return new Response(
        JSON.stringify({ error: "No job ID returned", response: agentData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Poll for completion - max 70 attempts * 1.5s = 105 seconds
    const maxAttempts = 70;
    const pollInterval = 1500;
    let attempt = 0;
    let agentResult = null;

    while (attempt < maxAttempts) {
      attempt++;
      await delay(pollInterval);

      const elapsed = Date.now() - startTime;
      console.log(`Poll attempt ${attempt}/${maxAttempts} (${elapsed}ms elapsed)`);

      const statusResponse = await fetch(`https://api.firecrawl.dev/v2/agent/${jobId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${firecrawlApiKey}`,
        },
      });

      if (!statusResponse.ok) {
        console.error("Poll error:", statusResponse.status);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`Job status: ${statusData.status}`);

      if (statusData.status === "completed") {
        agentResult = statusData;
        console.log("Agent completed successfully!");
        break;
      } else if (statusData.status === "failed" || statusData.status === "error") {
        console.error("Agent failed:", JSON.stringify(statusData));
        return new Response(
          JSON.stringify({ error: "Agent job failed", details: statusData }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Continue polling if still running
    }

    if (!agentResult) {
      const elapsed = Date.now() - startTime;
      console.error(`Agent timed out after ${elapsed}ms`);
      return new Response(
        JSON.stringify({ error: "Agent timed out", elapsed: elapsed }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract data from agent result - try to get structured JSON first
    const agentOutput = agentResult.result || agentResult.output || agentResult.data || "";
    console.log("Agent output type:", typeof agentOutput);
    console.log("Agent raw output (first 1000 chars):", typeof agentOutput === "string" ? agentOutput.substring(0, 1000) : JSON.stringify(agentOutput).substring(0, 1000));

    // Try to parse as structured JSON first, fall back to regex parsing
    let extracted: ExtractedLenderData;
    if (typeof agentOutput === "object" && agentOutput !== null) {
      // Agent returned structured data
      console.log("Using structured agent output");
      extracted = agentOutput as ExtractedLenderData;
    } else if (typeof agentOutput === "string") {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(agentOutput);
        console.log("Parsed JSON from string output");
        extracted = parsed as ExtractedLenderData;
      } catch {
        // Fall back to regex parsing
        console.log("Falling back to regex parsing");
        extracted = parseAgentOutput(agentOutput);
      }
    } else {
      extracted = {};
    }
    console.log("Extracted data keys:", Object.keys(extracted));

    const elapsed = Date.now() - startTime;
    console.log(`Total execution time: ${elapsed}ms`);

    // Build notes
    const notesSections: string[] = [];
    notesSections.push(`═══════════════════════════════════════`);
    notesSections.push(`AUTO-EXTRACTED FROM WEBSITE`);
    notesSections.push(`Scanned: ${new Date().toLocaleString()}`);
    notesSections.push(`URL: ${url}`);
    notesSections.push(`═══════════════════════════════════════`);
    notesSections.push("");

    if (extracted.description) {
      notesSections.push(`📋 OVERVIEW`);
      notesSections.push(`───────────────────────────────────────`);
      notesSections.push(cleanString(extracted.description));
      notesSections.push("");
    }

    if (extracted.detailed_notes) {
      notesSections.push(`📝 ADDITIONAL DETAILS`);
      notesSections.push(`───────────────────────────────────────`);
      notesSections.push(extracted.detailed_notes);
      notesSections.push("");
    }

    // Map funding products to our standard values
    const productMapping: Record<string, string> = {
      "mca": "mca",
      "merchant cash advance": "mca",
      "cash advance": "mca",
      "term loan": "term_loan",
      "term loans": "term_loan",
      "business term": "term_loan",
      "line of credit": "line_of_credit",
      "loc": "line_of_credit",
      "credit line": "line_of_credit",
      "equipment": "equipment_financing",
      "equipment financing": "equipment_financing",
      "equipment loan": "equipment_financing",
      "sba": "sba_loan",
      "sba loan": "sba_loan",
      "invoice factoring": "invoice_factoring",
      "factoring": "invoice_factoring",
      "receivables": "invoice_factoring",
      "revenue based": "revenue_based",
      "revenue-based": "revenue_based",
      "rbf": "revenue_based",
    };

    const mappedProducts: string[] = [];
    if (extracted.funding_products) {
      extracted.funding_products.forEach((product) => {
        if (typeof product !== "string") return;
        const normalized = product.toLowerCase().trim();
        const mapped = productMapping[normalized] || normalized.replace(/\s+/g, "_");
        if (!mappedProducts.includes(mapped)) {
          mappedProducts.push(mapped);
        }
      });
    }

    const result = {
      company_name: cleanString(extracted.company_name),
      description: cleanString(extracted.description),
      primary_contact_name: cleanString(extracted.contact_name),
      primary_contact_email: cleanString(extracted.email),
      primary_contact_phone: cleanString(extracted.phone),

      // Funding products
      funding_products: mappedProducts,

      // Funding range
      min_funding_amount: parseAmount(extracted.min_funding_amount),
      max_funding_amount: parseAmount(extracted.max_funding_amount),

      // Requirements
      min_time_in_business: typeof extracted.min_time_in_business === "number" ? extracted.min_time_in_business : parseAmount(extracted.min_time_in_business),
      min_monthly_revenue: parseAmount(extracted.min_monthly_revenue),
      min_credit_score: typeof extracted.min_credit_score === "number" ? extracted.min_credit_score : parseAmount(extracted.min_credit_score),

      // Pricing/Terms
      commission_structure: cleanString(extracted.commission_structure),
      factor_rate_range: cleanString(extracted.factor_rate_range),
      term_lengths: cleanString(extracted.term_lengths),
      advance_rate: cleanString(extracted.advance_rate),

      // Operations
      funding_speed: cleanString(extracted.funding_speed),
      stacking_policy: cleanString(extracted.stacking_policy),
      industries_restricted: cleanArray(extracted.industries_restricted),
      industries_preferred: cleanArray(extracted.industries_preferred),
      states_restricted: cleanArray(extracted.states_restricted),

      // Submission
      submission_email: cleanString(extracted.submission_email),
      submission_portal_url: cleanString(extracted.submission_portal_url),

      notes: notesSections.join("\n"),
    };

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to scan website" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
