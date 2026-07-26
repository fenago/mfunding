import supabase from "../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Call / Transfer Quality audit — the phone-call sibling of the email census on the
// Campaign Audit page. Reads runs + per-call results (admin/super_admin RLS) and
// drives the call-audit-sweep edge function.
//
// The sweep is RESUMABLE: one invocation processes a budgeted batch and returns
// {done, pending, enum_remaining}. The UI loops the invoke with the returned runId
// until done — the same pattern as the email-verify "Verify all now" button.
// Transcripts are stored server-side in call_audit_calls and read straight from
// the table (no GHL round-trip on view).
// ─────────────────────────────────────────────────────────────────────────────

export type CallClass =
  | "missed_transfer_voicemail"
  | "answered_then_kicked"
  | "mid_call_drop"
  | "end_teardown_cosmetic"
  | "clean"
  | "no_recording"
  | "transcription_failed"
  | "suspected_instant_drop"
  | "short_call_unverified"
  | "pending";

export interface CallAuditRun {
  id: string;
  campaign_id: string | null;
  date_from: string;
  date_to: string;
  all_inbound: boolean;
  source: "manual" | "cron";
  status: "queued" | "enumerating" | "running" | "done" | "error";
  totals: CallAuditTotals;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallAuditTotals {
  calls?: number;
  with_recording?: number;
  with_recording_pct?: number | null;
  inbound?: number;
  outbound?: number;
  by_class?: Partial<Record<CallClass, number>>;
  answered_then_kicked?: number;
  missed_transfer_voicemail?: number;
  mid_call_drop?: number;
  end_teardown_cosmetic?: number;
  clean?: number;
  no_recording?: number;
  transcription_failed?: number;
  transcription_available?: boolean; // false = no valid Gemini key; classified from metadata only
  gaps?: string[];
  reconciliation?: ReconResult;
  reconciliation_error?: string;
}

// Transfer reconciliation — Synergy intake emails ↔ inbound calls (see call_audit_reconcile).
export interface ReconSummary {
  transfers: number;
  live_transfer: number;
  realtime: number;
  matched_to_call: number;
  matched_by_phone: number;
  matched_by_time: number;
  no_call: number;
  voicemail: number;
  answered_then_kicked: number;
  suspect_drop: number;
  connected: number;
}
export interface ReconRow {
  received_at: string;
  merchant: string;
  phone: string | null;
  kind: string;
  bucket: "no_call" | "voicemail" | "answered_then_kicked" | "suspect_drop" | "connected";
  call_class: CallClass | null;
  call_date: string | null;
  duration_s: number | null;
  phone_match: boolean | null;
  gap_s: number | null;
}
export interface ReconResult {
  window: { from: string; to: string };
  summary: ReconSummary;
  rows: ReconRow[];
}

export interface CallAuditCall {
  id: string;
  run_id: string;
  campaign_id: string | null;
  customer_id: string | null;
  deal_id: string | null;
  ghl_contact_id: string | null;
  ghl_message_id: string;
  conversation_id: string | null;
  direction: string | null;
  call_date: string | null;
  duration_s: number | null;
  call_status: string | null;
  from_number: string | null;
  to_number: string | null;
  has_recording: boolean;
  transcript: string | null;
  classification: CallClass;
  matched_quote: string | null;
  kick_offset_hint: string | null;
  meta: { business?: string; transcription?: string; model?: string; rec_bytes?: number } | null;
}

export interface SweepProgress {
  ok?: boolean;
  runId?: string;
  done?: boolean;
  processed?: number;
  phase?: string;
  enum_remaining?: number;
  pending?: number;
  gemini?: boolean;
  error?: string;
}

// Human labels for the taxonomy — one home, shared by the KPIs and the table chips.
export const CALL_CLASS_LABELS: Record<CallClass, string> = {
  answered_then_kicked: "Answered then kicked",
  missed_transfer_voicemail: "Missed → our voicemail",
  mid_call_drop: "Mid-call drop",
  end_teardown_cosmetic: "Teardown (cosmetic)",
  clean: "Clean",
  no_recording: "No recording",
  transcription_failed: "Transcription failed",
  suspected_instant_drop: "Suspected instant drop",
  short_call_unverified: "Unverified (no transcript)",
  pending: "Pending…",
};

// List recent runs (newest first) for the run-history picker.
export async function listCallAuditRuns(limit = 25): Promise<CallAuditRun[]> {
  const { data, error } = await supabase
    .from("call_audit_runs")
    .select("id, campaign_id, date_from, date_to, all_inbound, source, status, totals, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CallAuditRun[];
}

export async function getCallAuditRun(runId: string): Promise<CallAuditRun | null> {
  const { data, error } = await supabase
    .from("call_audit_runs")
    .select("id, campaign_id, date_from, date_to, all_inbound, source, status, totals, error, created_at, updated_at")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CallAuditRun) ?? null;
}

// The calls for a run, worst-first (headline failures float up), then most recent.
const CLASS_ORDER: CallClass[] = [
  "answered_then_kicked", "missed_transfer_voicemail", "mid_call_drop",
  "suspected_instant_drop", "short_call_unverified", "transcription_failed",
  "no_recording", "end_teardown_cosmetic", "clean", "pending",
];
export async function getCallAuditCalls(runId: string): Promise<CallAuditCall[]> {
  const { data, error } = await supabase
    .from("call_audit_calls")
    .select("id, run_id, campaign_id, customer_id, deal_id, ghl_contact_id, ghl_message_id, conversation_id, direction, call_date, duration_s, call_status, from_number, to_number, has_recording, transcript, classification, matched_quote, kick_offset_hint, meta")
    .eq("run_id", runId)
    .order("call_date", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as CallAuditCall[];
  const rank = (c: CallClass) => { const i = CLASS_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  return rows.sort((a, b) => {
    const r = rank(a.classification) - rank(b.classification);
    if (r !== 0) return r;
    return (b.call_date ?? "").localeCompare(a.call_date ?? "");
  });
}

// Kick off a NEW run. Returns the sweep's first-batch response (carries runId).
export async function startCallAudit(params: {
  campaignId: string | null;
  dateFrom: string;
  dateTo: string;
  allInbound: boolean;
}): Promise<SweepProgress> {
  const { data, error } = await supabase.functions.invoke("call-audit-sweep", {
    body: {
      campaignId: params.campaignId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      allInbound: params.allInbound,
      source: "manual",
    },
  });
  if (error) throw error;
  return (data ?? {}) as SweepProgress;
}

// Continue an in-progress run one batch. The UI calls this in a loop until done.
export async function continueCallAudit(runId: string): Promise<SweepProgress> {
  const { data, error } = await supabase.functions.invoke("call-audit-sweep", { body: { runId } });
  if (error) throw error;
  return (data ?? {}) as SweepProgress;
}
