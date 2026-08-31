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
  bank_statements_at: string | null;
  bank_statement_count: number | null;
  working_by: string | null;
  working_by_name: string | null;
  working_is_mine: boolean | null;
  application: AppObj | null;
}

export type Pipe = "mca" | "vcf";
export type Sort = "age" | "callback" | "stage" | "amount" | "closer";
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
