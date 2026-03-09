import supabase from "../supabase";

interface DealProfile {
  deal_type: string;
  amount_requested: number | null;
  monthly_revenue: number | null;
  time_in_business: number | null;
  industry: string | null;
  credit_score?: number | null;
}

interface LenderMatch {
  id: string;
  company_name: string;
  status: string;
  lender_types: string[];
  paper_types: string[];
  min_credit_score: number | null;
  min_funding_amount: number | null;
  max_funding_amount: number | null;
  min_monthly_revenue: number | null;
  min_time_in_business: number | null;
  commission_type: string | null;
  commission_rate: number | null;
  score: number;
  reasons: string[];
}

// Map deal types to lender_types values
const DEAL_TYPE_TO_LENDER_TYPE: Record<string, string[]> = {
  mca: ["mca", "merchant_cash_advance"],
  term_loan: ["term_loan", "short_term_loan", "medium_term_loan", "long_term_loan"],
  line_of_credit: ["line_of_credit", "business_line_of_credit"],
  sba: ["sba", "sba_loan"],
  equipment_financing: ["equipment_financing", "equipment_loan"],
};

// Map credit scores to paper types
function getCreditTier(score: number | null | undefined): string | null {
  if (!score) return null;
  if (score >= 700) return "a_paper";
  if (score >= 600) return "b_paper";
  if (score >= 500) return "c_paper";
  return "d_paper";
}

export async function getMatchingLenders(dealProfile: DealProfile): Promise<LenderMatch[]> {
  // Fetch all active/approved lenders
  const { data: lenders, error } = await supabase
    .from("lenders")
    .select("id, company_name, status, lender_types, paper_types, min_credit_score, min_funding_amount, max_funding_amount, min_monthly_revenue, min_time_in_business, commission_type, commission_rate")
    .in("status", ["live_vendor", "approved"]);

  if (error || !lenders) {
    console.error("Error fetching lenders for matching:", error);
    return [];
  }

  const matches: LenderMatch[] = [];
  const relevantLenderTypes = DEAL_TYPE_TO_LENDER_TYPE[dealProfile.deal_type] || [];
  const creditTier = getCreditTier(dealProfile.credit_score);

  for (const lender of lenders) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Check deal type compatibility (30 pts)
    if (lender.lender_types && lender.lender_types.length > 0) {
      const hasMatchingType = lender.lender_types.some((lt: string) =>
        relevantLenderTypes.includes(lt.toLowerCase())
      );
      if (hasMatchingType) {
        score += 30;
        reasons.push("Offers this product type");
      } else {
        // Skip lenders that don't offer this product type
        continue;
      }
    } else {
      // No type restriction, assume they handle it
      score += 15;
      reasons.push("Product type not specified");
    }

    // 2. Check credit tier / paper type match (20 pts)
    if (creditTier && lender.paper_types && lender.paper_types.length > 0) {
      if (lender.paper_types.includes(creditTier)) {
        score += 20;
        reasons.push("Handles this credit tier");
      } else {
        score -= 10;
        reasons.push("Credit tier may not match");
      }
    } else if (!creditTier) {
      score += 10; // No score available, neutral
    }

    // 3. Check minimum credit score (10 pts)
    if (lender.min_credit_score && dealProfile.credit_score) {
      if (dealProfile.credit_score >= lender.min_credit_score) {
        score += 10;
        reasons.push("Meets minimum credit score");
      } else {
        score -= 15;
        reasons.push("Below minimum credit score");
      }
    }

    // 4. Check funding amount range (15 pts)
    if (dealProfile.amount_requested) {
      const amt = dealProfile.amount_requested;
      const minOk = !lender.min_funding_amount || amt >= lender.min_funding_amount;
      const maxOk = !lender.max_funding_amount || amt <= lender.max_funding_amount;
      if (minOk && maxOk) {
        score += 15;
        reasons.push("Amount within range");
      } else {
        score -= 10;
        reasons.push("Amount outside typical range");
      }
    }

    // 5. Check minimum monthly revenue (10 pts)
    if (lender.min_monthly_revenue && dealProfile.monthly_revenue) {
      if (dealProfile.monthly_revenue >= lender.min_monthly_revenue) {
        score += 10;
        reasons.push("Meets revenue requirement");
      } else {
        score -= 10;
        reasons.push("Below minimum revenue");
      }
    }

    // 6. Check time in business (10 pts)
    if (lender.min_time_in_business && dealProfile.time_in_business) {
      if (dealProfile.time_in_business >= lender.min_time_in_business) {
        score += 10;
        reasons.push("Meets time-in-business requirement");
      } else {
        score -= 10;
        reasons.push("Below minimum time in business");
      }
    }

    // 7. Commission bonus (5 pts for higher commission)
    if (lender.commission_rate) {
      if (lender.commission_rate >= 8) {
        score += 5;
        reasons.push("High commission rate");
      } else if (lender.commission_rate >= 6) {
        score += 3;
      }
    }

    // Only include lenders with a positive score
    if (score > 0) {
      matches.push({
        ...(lender as LenderMatch),
        score,
        reasons,
      });
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}
