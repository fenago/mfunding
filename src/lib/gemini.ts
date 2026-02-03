const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export type GeminiModel = "gemini-2.0-flash" | "gemini-2.0-pro-exp";

// Customer data for AI recommendations
export interface CustomerProfile {
  first_name: string;
  last_name: string;
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

export interface ProductRecommendation {
  product_type: string;
  product_name: string;
  fit_score: number; // 1-10
  reasoning: string;
  typical_terms?: string;
}

export interface CustomerRecommendation {
  summary: string;
  recommended_products: ProductRecommendation[];
  opening_script: string;
  discovery_questions: string[];
  objection_handlers: {
    objection: string;
    response: string;
  }[];
  closing_approach: string;
  red_flags?: string[];
  next_steps: string[];
}

export interface LenderExtraction {
  company_name?: string;
  description?: string;
  lender_types?: string[];
  paper_types?: string[];
  min_funding_amount?: number;
  max_funding_amount?: number;
  min_time_in_business?: number;
  min_monthly_revenue?: number;
  min_credit_score?: number;
  min_daily_balance?: number;
  commission_type?: string;
  commission_rate?: number;
  commission_notes?: string;
  funding_speed?: string;
  factor_rate_range?: string;
  term_lengths?: string;
  advance_rate?: string;
  stacking_policy?: string;
  requires_collateral?: boolean;
  industries_restricted?: string[];
  industries_preferred?: string[];
  states_restricted?: string[];
  submission_email?: string;
  submission_portal_url?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  notes?: string;
}

const EXTRACTION_PROMPT = `You are analyzing a business lending/MCA company's website for a broker CRM. Extract ALL of the following information if available:

BASIC INFO:
1. Company name
2. Brief description of what they do (1-2 sentences)
3. Types of lending products offered (choose from: mca, term_loan, line_of_credit, equipment_financing, invoice_factoring, sba_loan, revenue_based, real_estate)
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

Only include fields where you found relevant information. If a field is not found, use null.
Website content to analyze:
`;

export async function extractLenderInfo(
  websiteContent: string,
  model: GeminiModel = "gemini-2.0-flash"
): Promise<LenderExtraction> {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: EXTRACTION_PROMPT + websiteContent,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Gemini API error:", error);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("No response from Gemini");
  }

  // Extract JSON from the response (it might be wrapped in markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    console.error("Failed to parse Gemini response:", text);
    throw new Error("Failed to parse AI response");
  }
}

const CUSTOMER_RECOMMENDATION_PROMPT = `You are an expert business lending sales consultant. Analyze this customer profile and provide strategic recommendations for the sales team.

Customer Profile:
{CUSTOMER_DATA}

Based on this information, provide comprehensive recommendations including:

1. A brief summary of this customer's funding profile (2-3 sentences)
2. Recommended lending products ranked by fit (choose from: MCA/Merchant Cash Advance, Term Loan, Line of Credit, Equipment Financing, Invoice Factoring, SBA Loan, Revenue-Based Financing)
3. An opening script tailored to this customer's situation
4. Discovery questions to understand their needs better
5. Common objections for this customer type and how to handle them
6. Best closing approach
7. Any red flags or concerns to watch for
8. Recommended next steps

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

Focus on practical, actionable advice that a sales rep can use immediately. Be specific to this customer's industry, business size, and funding needs.`;

export async function generateCustomerRecommendation(
  customer: CustomerProfile,
  model: GeminiModel = "gemini-2.0-flash"
): Promise<CustomerRecommendation> {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  // Build customer data string
  const customerData = `
Name: ${customer.first_name} ${customer.last_name}
Business Name: ${customer.business_name || "Not provided"}
Industry: ${customer.industry || "Not specified"}
Business Type: ${customer.business_type || "Not specified"}
Time in Business: ${customer.time_in_business ? `${customer.time_in_business} months` : "Not provided"}
Monthly Revenue: ${customer.monthly_revenue ? `$${customer.monthly_revenue.toLocaleString()}` : "Not provided"}
Amount Requested: ${customer.amount_requested ? `$${customer.amount_requested.toLocaleString()}` : "Not specified"}
Lead Source: ${customer.lead_source?.replace(/_/g, " ") || "Not specified"}
Current Status: ${customer.status?.replace(/_/g, " ") || "Unknown"}
Notes: ${customer.notes || "None"}
`.trim();

  const prompt = CUSTOMER_RECOMMENDATION_PROMPT.replace("{CUSTOMER_DATA}", customerData);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7, // Slightly creative for sales scripts
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Gemini API error:", error);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("No response from Gemini");
  }

  // Extract JSON from the response (it might be wrapped in markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    console.error("Failed to parse Gemini response:", text);
    throw new Error("Failed to parse AI response");
  }
}

const FIRECRAWL_API_KEY = import.meta.env.VITE_FIRECRAWL_API_KEY;

export async function fetchWebsiteContent(url: string): Promise<string> {
  // Try Firecrawl first (best option - crawls multiple pages)
  if (FIRECRAWL_API_KEY) {
    try {
      const firecrawlResult = await fetchWithFirecrawl(url);
      if (firecrawlResult) return firecrawlResult;
    } catch (error) {
      console.warn("Firecrawl failed, trying fallback:", error);
    }
  }

  // Fallback to CORS proxy
  const corsProxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  ];

  for (const proxyUrl of corsProxies) {
    try {
      const response = await fetch(proxyUrl);
      if (!response.ok) continue;

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script, style, noscript, iframe").forEach((el) => el.remove());
      const textContent = doc.body?.textContent || "";

      const cleanedContent = textContent.replace(/\s+/g, " ").trim();
      if (cleanedContent.length > 100) {
        return cleanedContent.substring(0, 15000);
      }
    } catch (error) {
      console.warn(`Proxy ${proxyUrl} failed:`, error);
    }
  }

  throw new Error("Could not fetch website content. Try adding a Firecrawl API key for better results.");
}

async function fetchWithFirecrawl(url: string): Promise<string> {
  // First, crawl the site to get relevant pages
  const crawlResponse = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      limit: 5, // Get up to 5 pages
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    }),
  });

  if (!crawlResponse.ok) {
    // Fallback to simple scrape
    return fetchWithFirecrawlScrape(url);
  }

  const crawlData = await crawlResponse.json();

  // If async crawl, poll for results
  if (crawlData.id) {
    return pollFirecrawlCrawl(crawlData.id);
  }

  // If sync response with data
  if (crawlData.data && Array.isArray(crawlData.data)) {
    return crawlData.data
      .map((page: { markdown?: string }) => page.markdown || "")
      .join("\n\n---\n\n")
      .substring(0, 20000);
  }

  throw new Error("Invalid Firecrawl response");
}

async function fetchWithFirecrawlScrape(url: string): Promise<string> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl scrape failed: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.markdown || data.data?.content || "";
}

async function pollFirecrawlCrawl(crawlId: string): Promise<string> {
  const maxAttempts = 30;
  const pollInterval = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const response = await fetch(`https://api.firecrawl.dev/v1/crawl/${crawlId}`, {
      headers: {
        "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
      },
    });

    if (!response.ok) continue;

    const data = await response.json();

    if (data.status === "completed" && data.data) {
      return data.data
        .map((page: { markdown?: string }) => page.markdown || "")
        .join("\n\n---\n\n")
        .substring(0, 20000);
    }

    if (data.status === "failed") {
      throw new Error("Firecrawl crawl failed");
    }
  }

  throw new Error("Firecrawl crawl timed out");
}
