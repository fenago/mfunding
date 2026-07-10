// Client-side AI helpers.
//
// SECURITY (audit #4): this module used to read VITE_GEMINI_API_KEY and
// VITE_FIRECRAWL_API_KEY and call Google Gemini / Firecrawl directly from the
// browser. Any VITE_-prefixed var is inlined into the production bundle, so those
// paid keys were extractable by anyone. Both features now run server-side behind
// JWT+role-gated edge functions (recommend-customer, lender-extract) that load the
// keys from the Supabase vault via the shared callLLM layer. No API keys here.

import supabase from "../supabase";

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

// supabase.functions.invoke stashes a non-2xx response's JSON body in the thrown
// FunctionsHttpError's context; surface the real server message instead of a bare
// "Edge Function returned a non-2xx status code".
async function readInvokeError(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* not JSON — fall through */
    }
  }
  return err instanceof Error ? err.message : fallback;
}

/**
 * Generate strategic sales recommendations for a customer. Runs server-side in
 * the recommend-customer edge function (JWT + staff-role gated); the model is
 * resolved from llm_settings, not chosen client-side.
 */
export async function generateCustomerRecommendation(
  customer: CustomerProfile,
): Promise<CustomerRecommendation> {
  const { data, error } = await supabase.functions.invoke("recommend-customer", {
    body: { customer },
  });
  if (error) throw new Error(await readInvokeError(error, "Failed to generate recommendations"));
  if (!data?.recommendation) throw new Error(data?.error || "No recommendation returned");
  return data.recommendation as CustomerRecommendation;
}

/**
 * Scrape a lender's website and extract structured funder data. Runs server-side
 * in the lender-extract edge function (JWT + staff-role gated): Firecrawl scrape
 * + AI extraction, keys loaded from the Supabase vault.
 */
export async function extractLenderFromWebsite(url: string): Promise<LenderExtraction> {
  const { data, error } = await supabase.functions.invoke("lender-extract", {
    body: { url },
  });
  if (error) throw new Error(await readInvokeError(error, "Failed to extract information"));
  if (!data?.data) throw new Error(data?.error || "No data extracted");
  return data.data as LenderExtraction;
}
