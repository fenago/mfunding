// Shared shapes + helpers for the Processor workspace (/admin/processor).
// The row shape mirrors the processor_pipeline_rows() RPC contract EXACTLY.

import type { DealWithCustomer } from "@/types/deals";
import { applicationCompleteness } from "@/lib/applicationCompleteness";
import { dateKeyET } from "@/utils/time";

export interface AppObj {
  [key: string]: unknown;
}

/** One row from processor_pipeline_rows(). Every field is defensively optional
 *  so the UI degrades gracefully if the RPC lands with a slightly leaner shape. */
export interface PipelineRow {
  id: string;
  deal_number: string | null;
  status: string | null;
  deal_type: string | null;
  business_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  do_not_contact: boolean | null;
  amount_requested: number | null;
  created_at: string | null;
  days_in_pipeline: number | null;
  is_stale: boolean | null;
  assigned_closer_id: string | null;
  closer_name: string | null;
  callback_at: string | null;
  appointment_at: string | null;
  last_contact_at: string | null;
  has_bank_statements: boolean | null;
  touches_total?: number | null;
  touched_today?: boolean | null;
  application_signed_at?: string | null;
  bank_statements_at: string | null;
  bank_statement_count: number | null;
  working_by: string | null;
  working_by_name: string | null;
  working_is_mine: boolean | null;
  application: AppObj | null;
  // ── Readiness / QA (added by the supabase-backend agent's contract) ──
  qa_passed: boolean | null;
  qa_passed_at: string | null;
  submission_ready_at: string | null;
  qa_decision: "go" | "no_go" | null;
  qa_decision_reason: string | null;
}

export type Pipe = "mca" | "vcf";
export type Sort = "recent" | "age" | "callback" | "stage" | "amount" | "closer";
export type CallbackSegment = "all" | "overdue" | "today" | "next7" | "fortnight";

export function merchantName(r: PipelineRow): string {
  return (
    r.business_name?.trim() ||
    r.contact_name?.trim() ||
    r.deal_number ||
    "Unnamed merchant"
  );
}

export function closerLabel(r: PipelineRow): string {
  if (!r.assigned_closer_id) return "Unassigned";
  return r.closer_name?.trim() || "Assigned";
}

export function prettyPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

export function pctTone(pct: number): string {
  if (pct >= 90) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** Build the narrow DealWithCustomer shape applicationCompleteness reads. When a
 *  saved application row exists (REAL values per the RPC), completeness hydrates
 *  from it; otherwise it seeds from these customer-shaped fields — a safe
 *  under-estimate, never a leak. KEEP IN SYNC with ProcessorBoard.toDealArg. */
export function toDealArg(r: PipelineRow): DealWithCustomer {
  const name = (r.contact_name ?? "").trim();
  const i = name.lastIndexOf(" ");
  const first = i < 0 ? name : name.slice(0, i);
  const last = i < 0 ? "" : name.slice(i + 1);
  return {
    customer: {
      business_name: r.business_name,
      first_name: first || null,
      last_name: last || null,
      email: r.email,
      phone: r.phone,
    },
    lead_qual: null,
    amount_requested: r.amount_requested,
    use_of_funds: null,
  } as unknown as DealWithCustomer;
}

/** Application completeness %, matching the modal + ProcessorBoard exactly. */
export function appPct(r: PipelineRow): number {
  return applicationCompleteness(toDealArg(r), r.application ?? null).pct;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE READINESS MODEL — the spine of the processor's job.
// Every in-scope lead moves through 4 explicit gates:
//   ① Interested  ② Application complete  ③ Bank statements in  ④ QA passed
//   → READY TO SUBMIT (all gates green AND submission_ready_at set).
// These helpers are the single source of truth for gate + bucket + next-action.
// ─────────────────────────────────────────────────────────────────────────────

/** "Interested" = the customer engaged and we're driving to submission-ready.
 *  Excludes cold `new` and everything from submission onward (that's not the
 *  processor's job anymore). MCA + VCF each have their own engaged stages. */
export const INTERESTED_STAGES: Record<Pipe, Set<string>> = {
  mca: new Set(["contacted", "qualifying", "application_sent", "docs_collected", "bank_statements"]),
  vcf: new Set(["hardship_consult", "positions_analysis", "strategy_proposal", "agreement_sent"]),
};

export function isInterested(pipe: Pipe, status: string | null | undefined): boolean {
  return !!status && INTERESTED_STAGES[pipe].has(status);
}

/** Gate ③ — bank statements are in (count when the RPC provides it). */
export function hasStatements(r: PipelineRow): boolean {
  return !!r.has_bank_statements || (r.bank_statement_count ?? 0) > 0;
}

/** Gate ② — the merchant application is 100% complete. */
export function appComplete(r: PipelineRow): boolean {
  return appPct(r) === 100;
}

/** Gate ④ — QA has been passed. */
export function qaPassed(r: PipelineRow): boolean {
  return !!r.qa_passed;
}

/** READY = marked ready for submission (server only lets this happen once
 *  gates ②③④ are all green, so submission_ready_at implies the rest). */
export function isReady(r: PipelineRow): boolean {
  return !!r.submission_ready_at;
}

/** The four gates for a lead, in order, as a compact tracker model. */
export interface GateState {
  interested: boolean;
  appComplete: boolean;
  statements: boolean;
  qa: boolean;
  ready: boolean;
  appPct: number;
  statementCount: number;
}

export function gateState(r: PipelineRow, pipe: Pipe): GateState {
  return {
    interested: isInterested(pipe, r.status),
    appComplete: appComplete(r),
    statements: hasStatements(r),
    qa: qaPassed(r),
    ready: isReady(r),
    appPct: appPct(r),
    statementCount: r.bank_statement_count ?? 0,
  };
}

/** The workflow buckets — the natural order of the processor's job. They
 *  PARTITION the in-scope funnel: every in-scope lead is in exactly one. */
export type WorkBucket = "needs_app" | "needs_stmts" | "ready_qa" | "ready_submit";

export function workBucket(r: PipelineRow): WorkBucket {
  if (isReady(r)) return "ready_submit";
  if (!appComplete(r)) return "needs_app";
  if (!hasStatements(r)) return "needs_stmts";
  return "ready_qa"; // app + statements in, still needs QA passed / marked ready
}

export type NextTone = "app" | "stmts" | "qa" | "ready";

/** The single clearest NEXT ACTION for a lead, given where it sits. */
export function nextAction(r: PipelineRow): { label: string; tone: NextTone } {
  switch (workBucket(r)) {
    case "needs_app": {
      const missing = applicationCompleteness(toDealArg(r), r.application ?? null).missing.length;
      return {
        label:
          missing === 0
            ? "Finish the application"
            : `Finish the application — ${missing} field${missing === 1 ? "" : "s"} left`,
        tone: "app",
      };
    }
    case "needs_stmts":
      return { label: "Get bank statements — call/text the merchant", tone: "stmts" };
    case "ready_qa":
      return qaPassed(r)
        ? { label: "Mark ready to submit", tone: "ready" }
        : { label: "Run QA", tone: "qa" };
    case "ready_submit":
    default:
      return { label: "Ready — hand to submissions", tone: "ready" };
  }
}

/** Does a row's callback_at fall in the requested two-week segment? */
export function matchesSegment(r: PipelineRow, seg: CallbackSegment): boolean {
  if (seg === "all") return true;
  if (!r.callback_at) return false;
  const cb = new Date(r.callback_at).getTime();
  if (!Number.isFinite(cb)) return false;
  const now = Date.now();
  const todayKey = dateKeyET(new Date(now));
  const cbKey = dateKeyET(new Date(cb));
  const day = 24 * 60 * 60 * 1000;
  switch (seg) {
    case "overdue":
      // Past its time AND not still "today" (today gets its own chip).
      return cb < now && cbKey !== todayKey;
    case "today":
      return cbKey === todayKey;
    case "next7":
      return cb > now && cbKey !== todayKey && cb <= now + 7 * day;
    case "fortnight":
      return cb > now && cbKey !== todayKey && cb <= now + 14 * day;
    default:
      return true;
  }
}
