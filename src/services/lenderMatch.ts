// Qualification matcher — the "which programs does this merchant qualify for?"
// engine. Given a deal's numbers, evaluate each lender program's hard gates and
// return pass/fail per criterion. A null requirement = no gate (auto-pass).
// This is the source of truth the Revenue Playbook submission step references so
// we stop submitting deals that miss a lender's stated minimums.

import { type LenderProgram, money } from "../data/lenderPrograms";

export interface DealCriteria {
  amount?: number | null; // requested / target funding amount
  credit_score?: number | null;
  annual_revenue?: number | null;
  monthly_revenue?: number | null; // avg monthly deposits from bank statements
  time_in_business_months?: number | null;
}

export interface CriterionResult {
  label: string;
  pass: boolean;
  detail: string;
}

export interface MatchResult {
  program: LenderProgram;
  qualified: boolean; // no failing gates
  checks: CriterionResult[]; // only the criteria we could actually evaluate
  failCount: number;
  evaluated: number;
}

export function evaluateProgram(p: LenderProgram, deal: DealCriteria): MatchResult {
  const checks: CriterionResult[] = [];
  const add = (label: string, pass: boolean, detail: string) => checks.push({ label, pass, detail });

  if (deal.amount != null && (p.approval_min != null || p.approval_max != null)) {
    const okMin = p.approval_min == null || deal.amount >= p.approval_min;
    const okMax = p.approval_max == null || deal.amount <= p.approval_max;
    add("Approval amount", okMin && okMax, `range ${money(p.approval_min)}–${money(p.approval_max)} · deal ${money(deal.amount)}`);
  }
  if (p.min_credit_score != null && deal.credit_score != null) {
    add("Credit score", deal.credit_score >= p.min_credit_score, `needs ${p.min_credit_score}+ · deal ${deal.credit_score}`);
  }
  if (p.annual_revenue_required != null && deal.annual_revenue != null) {
    add("Annual revenue", deal.annual_revenue >= p.annual_revenue_required, `needs ${money(p.annual_revenue_required)}+ · deal ${money(deal.annual_revenue)}`);
  }
  if (p.monthly_revenue_required != null && deal.monthly_revenue != null) {
    add("Monthly revenue", deal.monthly_revenue >= p.monthly_revenue_required, `needs ${money(p.monthly_revenue_required)}+ · deal ${money(deal.monthly_revenue)}`);
  }
  if (p.time_in_business_months != null && deal.time_in_business_months != null) {
    add("Time in business", deal.time_in_business_months >= p.time_in_business_months, `needs ${p.time_in_business_months} mo · deal ${deal.time_in_business_months} mo`);
  }

  const failCount = checks.filter((c) => !c.pass).length;
  return { program: p, qualified: failCount === 0, checks, failCount, evaluated: checks.length };
}

// Sort best-fit first: qualified (0 fails) first, then fewest fails, then most criteria actually checked.
export function matchDeal(programs: LenderProgram[], deal: DealCriteria): MatchResult[] {
  return programs
    .map((p) => evaluateProgram(p, deal))
    .sort((a, b) => a.failCount - b.failCount || b.evaluated - a.evaluated);
}
