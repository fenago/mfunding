import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedData {
  company_name?: string;
  phone?: string;
  email?: string;
  contact_name?: string;
  lead_products?: Array<{
    product_name: string;
    price: string;
    description: string;
    minimum?: string;
  }>;
  industries?: string[];
  lead_generation_method?: string;
  exclusivity?: string;
  return_policy?: string;
  minimum_order?: string;
  volume_available?: string;
  additional_services?: string[];
  detailed_notes?: string;
}

// Helper to delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse agent output (which is natural language) into structured data
function parseAgentOutput(output: unknown): ExtractedData {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const result: ExtractedData = {};

  // Extract company name
  const companyMatch = text.match(/(?:company name|business name)[:\s]*([^\n,]+)/i);
  if (companyMatch) result.company_name = companyMatch[1].trim();

  // Extract phone
  const phoneMatch = text.match(/(?:phone|tel|call)[:\s]*([0-9\-\(\)\s\.]+)/i);
  if (phoneMatch) result.phone = phoneMatch[1].trim();

  // Extract email
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) result.email = emailMatch[1].trim();

  // Extract contact name
  const contactMatch = text.match(/(?:contact|rep|representative)[:\s]*([A-Z][a-z]+ [A-Z][a-z]+)/i);
  if (contactMatch) result.contact_name = contactMatch[1].trim();

  // Extract lead products with pricing - look for price patterns
  const leadProducts: Array<{ product_name: string; price: string; description: string; minimum?: string }> = [];
  const pricePatterns = [
    /(?:live transfer|live transfers)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
    /(?:aged lead|aged leads)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
    /(?:exclusive lead|exclusive leads)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
    /(?:ucc lead|ucc leads|ucc data)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
    /(?:web lead|web leads)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
    /(?:appointment|appointments)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
    /(?:data lead|data leads)[^\$]*\$([0-9,]+(?:\.[0-9]{2})?)/gi,
  ];

  const productNames = ["Live Transfer", "Aged Lead", "Exclusive Lead", "UCC Lead", "Web Lead", "Appointment", "Data Lead"];
  pricePatterns.forEach((pattern, idx) => {
    const match = pattern.exec(text);
    if (match) {
      leadProducts.push({
        product_name: productNames[idx],
        price: `$${match[1]}`,
        description: "",
      });
    }
  });

  // Also look for any pricing patterns like "$XX per lead" or "$XX/lead"
  const genericPriceMatches = text.matchAll(/([a-zA-Z\s]+)[:\-]?\s*\$([0-9,]+(?:\.[0-9]{2})?)\s*(?:per|\/|each)?\s*(?:lead|call|transfer)?/gi);
  for (const match of genericPriceMatches) {
    const productName = match[1].trim();
    const price = match[2];
    if (productName.length < 50 && !leadProducts.some(p => p.product_name.toLowerCase() === productName.toLowerCase())) {
      leadProducts.push({
        product_name: productName,
        price: `$${price}`,
        description: "",
      });
    }
  }

  if (leadProducts.length > 0) result.lead_products = leadProducts;

  // Extract industries
  const industries: string[] = [];
  const industryKeywords = ["MCA", "merchant cash advance", "business loan", "equipment financing", "SBA", "merchant services", "factoring"];
  industryKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      industries.push(keyword);
    }
  });
  if (industries.length > 0) result.industries = industries;

  // Extract lead generation method
  const leadGenMatch = text.match(/(?:lead generation|leads are generated|how.*leads)[:\s]*([^\n]+)/i);
  if (leadGenMatch) result.lead_generation_method = leadGenMatch[1].trim().substring(0, 500);

  // Extract exclusivity info
  const exclusivityMatch = text.match(/(?:exclusiv|shared)[^\n]*[:\s]*([^\n]+)/i);
  if (exclusivityMatch) result.exclusivity = exclusivityMatch[0].trim().substring(0, 200);

  // Extract return policy
  const returnMatch = text.match(/(?:return|refund|guarantee)[^\n]*[:\s]*([^\n]+)/i);
  if (returnMatch) result.return_policy = returnMatch[0].trim().substring(0, 300);

  // Extract minimum order
  const minimumMatch = text.match(/(?:minimum|min order)[^\n]*[:\s]*([^\n]+)/i);
  if (minimumMatch) result.minimum_order = minimumMatch[0].trim().substring(0, 100);

  // Extract volume available
  const volumeMatch = text.match(/(?:volume|available|daily|weekly|monthly)[^\n]*leads[^\n]*[:\s]*([^\n]+)/i);
  if (volumeMatch) result.volume_available = volumeMatch[0].trim().substring(0, 200);

  // Extract additional services
  const services: string[] = [];
  const serviceKeywords = ["CRM", "dialer", "call center", "marketing", "training", "support"];
  serviceKeywords.forEach(keyword => {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      services.push(keyword);
    }
  });
  if (services.length > 0) result.additional_services = services;

  // Store the full output as detailed notes
  result.detailed_notes = text.substring(0, 2000);

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("=== SCAN VENDOR WEBSITE v19 (Agent+Schema) ===");

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

    const agentPrompt = `You are researching a lead generation vendor for a business loan brokerage CRM.
Navigate the website thoroughly to find pricing and product information.
Look at pricing pages, product pages, and contact pages.
Extract EXACT prices per lead (like $35/lead, not funding amounts).`;

    const extractionSchema = {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Exact business/company name" },
        phone: { type: "string", description: "Phone number" },
        email: { type: "string", description: "Email address" },
        contact_name: { type: "string", description: "Contact person name" },
        lead_products: {
          type: "array",
          description: "Lead products with pricing - price per lead NOT funding amounts",
          items: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "Product name (Live Transfer, Aged Lead, UCC Lead, etc.)" },
              price_per_lead: { type: "string", description: "Price PER LEAD like $35, $45, $2.50 - NOT funding amounts" },
              minimum_order: { type: "string", description: "Minimum order quantity" },
              description: { type: "string", description: "Brief description" }
            }
          }
        },
        industries: { type: "array", items: { type: "string" }, description: "Industries served (MCA, business loans, etc.)" },
        lead_generation_method: { type: "string", description: "How leads are generated" },
        exclusivity: { type: "string", description: "Exclusivity policy" },
        return_policy: { type: "string", description: "Return/refund policy" },
        minimum_order: { type: "string", description: "General minimum order requirement" },
        volume_available: { type: "string", description: "Lead volume available" },
        additional_services: { type: "array", items: { type: "string" }, description: "Additional services offered" }
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
    let extracted: ExtractedData;
    if (typeof agentOutput === "object" && agentOutput !== null) {
      // Agent returned structured data
      console.log("Using structured agent output");
      extracted = agentOutput as ExtractedData;
    } else if (typeof agentOutput === "string") {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(agentOutput);
        console.log("Parsed JSON from string output");
        extracted = parsed as ExtractedData;
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

    // Build comprehensive notes
    const notesSections: string[] = [];
    notesSections.push(`═══════════════════════════════════════`);
    notesSections.push(`AUTO-EXTRACTED FROM WEBSITE`);
    notesSections.push(`Scanned: ${new Date().toLocaleString()}`);
    notesSections.push(`URL: ${url}`);
    notesSections.push(`═══════════════════════════════════════`);
    notesSections.push("");

    if (extracted.detailed_notes) {
      notesSections.push(`📝 SUMMARY`);
      notesSections.push(`───────────────────────────────────────`);
      notesSections.push(extracted.detailed_notes);
      notesSections.push("");
    }

    // Map lead products to our lead types
    const leadTypeMapping: Record<string, string> = {
      "live transfer": "live_transfer",
      "live transfers": "live_transfer",
      "aged lead": "aged_lead",
      "aged leads": "aged_lead",
      "aged": "aged_lead",
      "exclusive": "exclusive_lead",
      "exclusive lead": "exclusive_lead",
      "ucc": "ucc_lead",
      "ucc lead": "ucc_lead",
      "ucc leads": "ucc_lead",
      "ucc data": "ucc_lead",
      "appointment": "appointment",
      "appointments": "appointment",
      "web lead": "web_lead",
      "web leads": "web_lead",
      "inbound": "inbound_call",
      "inbound call": "inbound_call",
      "data lead": "data_lead",
      "data leads": "data_lead",
      "data list": "data_lead",
      "email": "email",
      "sms": "sms",
    };

    const detectedLeadTypes: string[] = [];
    if (extracted.lead_products) {
      extracted.lead_products.forEach((product) => {
        const name = product.product_name?.toLowerCase() || "";
        Object.entries(leadTypeMapping).forEach(([key, value]) => {
          if (name.includes(key) && !detectedLeadTypes.includes(value)) {
            detectedLeadTypes.push(value);
          }
        });
      });
    }

    // Build pricing_products array for the new JSONB field
    // Handle both schema format (price_per_lead) and legacy format (price)
    const pricingProducts = (extracted.lead_products || []).map((p: any) => ({
      product: p.product_name || "",
      price: p.price_per_lead || p.price || "",
      minimum: p.minimum_order || p.minimum || "",
      notes: p.description || ""
    }));

    // Build description - only use clean text, not JSON
    let description = "";
    if (extracted.industries && Array.isArray(extracted.industries) && extracted.industries.length > 0) {
      const cleanIndustries = extracted.industries
        .filter((i: any) => typeof i === "string" && !i.includes("{") && !i.includes(":"))
        .slice(0, 3);
      if (cleanIndustries.length > 0) {
        description = `Lead generation vendor specializing in ${cleanIndustries.join(", ")}.`;
      }
    }

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

    const result = {
      // Basic fields
      vendor_name: cleanString(extracted.company_name),
      description: description.trim(),
      contact_name: cleanString(extracted.contact_name),
      contact_email: cleanString(extracted.email),
      contact_phone: cleanString(extracted.phone),
      lead_types: detectedLeadTypes,

      // NEW structured fields
      pricing_products: pricingProducts,
      minimum_order: cleanString(extracted.minimum_order),
      return_policy: cleanString(extracted.return_policy),
      exclusivity: cleanString(extracted.exclusivity),
      lead_generation_method: cleanString(extracted.lead_generation_method),
      volume_available: cleanString(extracted.volume_available),
      industries_served: cleanArray(extracted.industries),
      additional_services: cleanArray(extracted.additional_services),

      // Notes for anything else
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
