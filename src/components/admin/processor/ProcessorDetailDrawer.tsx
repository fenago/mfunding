import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  MoonIcon,
  PaperAirplaneIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/24/solid";
import supabase from "@/supabase";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import { dateTimeET } from "@/utils/time";
import {
  applicationCompleteness,
  SECTION_LABEL,
  type AppSection,
} from "@/lib/applicationCompleteness";
import SchedulePicker from "./SchedulePicker";
import GateTracker from "./GateTracker";
import { appComplete, hasStatements, qaPassed, toDealArg, type Pipe, type PipelineRow } from "./types";

// ── The QA checklist — UI-owned, stable keys (persisted as jsonb via
// processor_save_qa). Every item must be ticked before QA can be marked passed.
// NOTE: a voided check NEVER blocks (house rule) — it is deliberately not here.
const QA_ITEMS: { key: string; label: string }[] = [
  { key: "app_accurate", label: "Application fields are accurate & complete" },
  {
    key: "statements_recent",
    label: "3 most-recent full months of statements — all pages, legible",
  },
  {
    key: "statements_match",
    label: "Statements match the business & bank account on the application",
  },
  {
    key: "amount_sensible",
    label: "Requested amount + use of funds set and sensible vs. revenue",
  },
  {
    key: "no_blocking_flags",
    label: "No blocking flags (DND handled · not a TCPA litigator)",
  },
];

/**
 * ProcessorDetailDrawer — the "processor sees everything" surface. An in-app
 * right-side slide-over (NOT a browser popup) that loads processor_deal_detail()
 * and shows the FULL merchant application (real values, sensitive ones behind a
 * Show toggle), the bank-statement documents with signed View / Download links,
 * and inline set-callback / set-appointment / log-contact / move-to-nurture.
 *
 * HONESTY: a failed read is a RED error with retry — never a blank drawer.
 */

interface DetailDoc {
  id: string;
  file_name: string | null;
  category: string | null;
  created_at: string | null;
  storage_path: string | null;
  is_bank_statement: boolean | null;
}

interface QaShape {
  checklist?: Record<string, boolean> | null;
  qa_passed?: boolean | null;
  qa_passed_at?: string | null;
  qa_passed_by_name?: string | null;
  submission_ready_at?: string | null;
  submission_ready_by_name?: string | null;
  decision?: "go" | "no_go" | null;
  decision_reason?: string | null;
  decision_at?: string | null;
  decision_by_name?: string | null;
  notes?: string | null;
}

interface DetailShape {
  deal?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  application?: Record<string, unknown> | null;
  documents?: DetailDoc[] | null;
  qa?: QaShape | null;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: DetailShape };

const SENSITIVE_KEYS = new Set([
  "ein",
  "owner_ssn",
  "ssn",
  "owner_dob",
  "date_of_birth",
  "bank_account_number",
  "bank_routing_number",
  "account_number",
  "routing_number",
]);

// Keys that are plumbing, not application data — hidden from the field dump.
const HIDDEN_KEYS = new Set(["id", "deal_id", "customer_id", "created_at", "updated_at"]);

function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bEin\b/, "EIN")
    .replace(/\bSsn\b/, "SSN")
    .replace(/\bDob\b/, "DOB")
    .replace(/\bId\b/, "ID");
}

function renderVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function stageChip(status: string | null | undefined) {
  const cfg = status ? DEAL_STATUS_CONFIG[status as DealStatus] : undefined;
  const cls = cfg
    ? `${cfg.bgColor} ${cfg.color}`
    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
  return { label: cfg?.label ?? status ?? "—", cls };
}

const CONTACT_OUTCOMES: { key: string; label: string }[] = [
  { key: "reached", label: "Reached" },
  { key: "no_answer", label: "No answer" },
  { key: "left_voicemail", label: "Left VM" },
  { key: "bad_number", label: "Bad number" },
  { key: "not_interested", label: "Not interested" },
];

export default function ProcessorDetailDrawer({
  dealId,
  row,
  pipe,
  onClose,
  onChanged,
}: {
  dealId: string | null;
  /** The list row for this deal — the single source of truth for the gates so the
   *  drawer and the list can never disagree. */
  row: PipelineRow | null;
  pipe: Pipe;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showSensitive, setShowSensitive] = useState(false);
  const [note, setNote] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  // Move-to-nurture is destructive-ish (soft-closes the deal) → armed two-step.
  const [nurtureArmed, setNurtureArmed] = useState(false);
  // QA checklist working state (seeded from the loaded detail's qa.checklist).
  const [qaChecks, setQaChecks] = useState<Record<string, boolean>>({});
  const [qaNotes, setQaNotes] = useState("");
  // Go/No-Go verdict working state.
  const [noGoOpen, setNoGoOpen] = useState(false);
  const [noGoReason, setNoGoReason] = useState("");

  const load = useCallback(async () => {
    if (!dealId) return;
    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.rpc("processor_deal_detail", { p_deal_id: dealId });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("The detail read returned nothing.");
      const detail = data as DetailShape;
      // Seed the QA checklist / notes from what's already persisted.
      const savedChecks = (detail.qa?.checklist ?? {}) as Record<string, boolean>;
      const seeded: Record<string, boolean> = {};
      for (const item of QA_ITEMS) seeded[item.key] = !!savedChecks[item.key];
      setQaChecks(seeded);
      setQaNotes(detail.qa?.notes ?? "");
      setState({ kind: "ready", detail });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load this deal.",
      });
    }
  }, [dealId]);

  useEffect(() => {
    setShowSensitive(false);
    setNote("");
    setActionErr(null);
    setNurtureArmed(false);
    setNoGoOpen(false);
    setNoGoReason("");
    if (dealId) void load();
  }, [dealId, load]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!dealId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dealId, onClose]);

  const runRpc = useCallback(
    async (name: string, args: Record<string, unknown>, busyKey: string) => {
      setActionBusy(busyKey);
      setActionErr(null);
      try {
        const { error } = await supabase.rpc(name, args);
        if (error) throw new Error(error.message);
        onChanged();
        await load();
      } catch (e) {
        setActionErr(e instanceof Error ? e.message : "That action failed.");
      } finally {
        setActionBusy(null);
      }
    },
    [load, onChanged],
  );

  const openDoc = useCallback(async (documentId: string, download: boolean) => {
    setActionErr(null);
    try {
      // Signing needs the service role (customer-documents storage RLS walls a
      // processor-closer to their own book), so this is an edge fn, not an RPC.
      const { data, error } = await supabase.functions.invoke("processor-document-url", {
        body: { document_id: documentId },
      });
      if (error) throw new Error(error.message);
      const err = (data as { error?: string } | null)?.error;
      if (err) throw new Error(err);
      const url = (data as { url?: string } | null)?.url;
      const fileName = (data as { file_name?: string } | null)?.file_name;
      if (!url) throw new Error("No signed URL returned.");
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName || "document";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Couldn't open that document.");
    }
  }, []);

  // Persist the QA checklist + notes. p_passed carries whether QA is marked passed
  // (keep the current value on a plain "Save", flip it on the pass / reopen buttons).
  const saveQa = useCallback(
    (passed: boolean, busyKey: string) =>
      runRpc(
        "processor_save_qa",
        {
          p_deal_id: dealId,
          p_checklist: qaChecks,
          p_passed: passed,
          ...(qaNotes.trim() ? { p_notes: qaNotes.trim() } : {}),
        },
        busyKey,
      ),
    [runRpc, dealId, qaChecks, qaNotes],
  );

  // GO verdict — persist the ticks/notes, then record the go decision (server
  // requires bank statements + flips qa_passed + submission_ready).
  const submitGo = useCallback(async () => {
    setActionBusy("go");
    setActionErr(null);
    try {
      const save = await supabase.rpc("processor_save_qa", {
        p_deal_id: dealId,
        p_checklist: qaChecks,
        p_passed: true,
        ...(qaNotes.trim() ? { p_notes: qaNotes.trim() } : {}),
      });
      if (save.error) throw new Error(save.error.message);
      const { error } = await supabase.rpc("processor_qa_decision", {
        p_deal_id: dealId,
        p_decision: "go",
      });
      if (error) throw new Error(error.message);
      onChanged();
      await load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Couldn't record GO.");
    } finally {
      setActionBusy(null);
    }
  }, [dealId, qaChecks, qaNotes, onChanged, load]);

  // NO-GO verdict — persist any ticks/notes, then record the no-go + reason.
  const submitNoGo = useCallback(async () => {
    const reason = noGoReason.trim();
    if (!reason) return;
    setActionBusy("nogo");
    setActionErr(null);
    try {
      const save = await supabase.rpc("processor_save_qa", {
        p_deal_id: dealId,
        p_checklist: qaChecks,
        p_passed: false,
        ...(qaNotes.trim() ? { p_notes: qaNotes.trim() } : {}),
      });
      if (save.error) throw new Error(save.error.message);
      const { error } = await supabase.rpc("processor_qa_decision", {
        p_deal_id: dealId,
        p_decision: "no_go",
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      setNoGoOpen(false);
      setNoGoReason("");
      onChanged();
      await load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Couldn't record NO-GO.");
    } finally {
      setActionBusy(null);
    }
  }, [dealId, qaChecks, qaNotes, noGoReason, onChanged, load]);

  // Completeness for the missing-field list — computed off the ROW so the drawer's
  // gate ② matches the list exactly (single source of truth).
  const completeness = useMemo(
    () => (row ? applicationCompleteness(toDealArg(row), row.application ?? null) : null),
    [row],
  );

  if (!dealId) return null;

  const detail = state.kind === "ready" ? state.detail : null;
  const deal = detail?.deal ?? {};
  const customer = detail?.customer ?? {};
  const application = detail?.application ?? null;
  const documents = detail?.documents ?? [];
  const qa = detail?.qa ?? null;
  const chip = stageChip(deal?.status as string | undefined);
  const title =
    (customer?.business_name as string) ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    (deal?.deal_number as string) ||
    "Merchant";

  const appEntries = application
    ? Object.entries(application).filter(([k]) => !HIDDEN_KEYS.has(k))
    : [];

  // ── Gate readouts (all off the row — the same source the list uses) ──
  const gateApp = row ? appComplete(row) : false;
  const gateStmts = row ? hasStatements(row) : false;
  const gateQa = !!qa?.qa_passed || (row ? qaPassed(row) : false);
  const allQaTicked = QA_ITEMS.every((i) => qaChecks[i.key]);
  // Go / No-Go verdict state.
  const decision: "go" | "no_go" | null =
    (qa?.decision as "go" | "no_go" | null) ?? (row?.qa_decision ?? null);
  const canGo = gateApp && gateStmts && allQaTicked;
  const missingBySection = completeness
    ? (Object.entries(completeness.missingBySection) as [AppSection, number][]).filter(
        ([, n]) => n > 0,
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-900 h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{title}</h2>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${chip.cls}`}>
                {chip.label}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
              {typeof deal?.deal_number === "string" && <span>#{deal.deal_number}</span>}
              <Link
                to={`/admin/setter-performance?deal=${dealId}`}
                className="inline-flex items-center gap-1 font-semibold text-ocean-blue hover:underline"
              >
                <ArrowTopRightOnSquareIcon className="w-3 h-3" /> Open in Operations console
              </Link>
              <Link
                to={`/admin/deals/${dealId}`}
                className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:underline"
              >
                Full deal record
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Close (Esc)"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {state.kind === "loading" && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-10">
              <span className="loading loading-spinner loading-sm" /> Loading the deal…
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Couldn't load this deal.</div>
                <div className="mt-0.5">This is not an empty deal — it's an unreadable one.</div>
                <div className="mt-0.5 font-mono opacity-80">{state.message}</div>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-1.5 font-semibold text-ocean-blue hover:underline"
                >
                  Try again →
                </button>
              </div>
            </div>
          )}

          {state.kind === "ready" && (
            <>
              {/* Readiness — the spine. Where this lead sits on the 4 gates, and
                  exactly what's missing. */}
              <section className="rounded-lg border border-ocean-blue/30 dark:border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  Readiness — drive to submission-ready
                </h3>
                {row ? (
                  <GateTracker row={row} pipe={pipe} />
                ) : (
                  <p className="text-xs text-gray-400">Gate readout unavailable for this lead.</p>
                )}
                {/* Gate ② — the exact fields still missing on the application. */}
                {!gateApp && completeness && (
                  <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                      Application {completeness.pct}%
                    </span>{" "}
                    — {completeness.missing.length} field
                    {completeness.missing.length === 1 ? "" : "s"} left
                    {missingBySection.length > 0 && (
                      <span className="text-gray-400">
                        {" ("}
                        {missingBySection
                          .map(([s, n]) => `${SECTION_LABEL[s]}: ${n}`)
                          .join(" · ")}
                        {")"}
                      </span>
                    )}
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {completeness.missing.map((f) => (
                        <li
                          key={f.key}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                        >
                          {f.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {gateApp && !gateStmts && (
                  <p className="mt-2 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                    Application done — now get the bank statements in (chase below).
                  </p>
                )}
              </section>

              {/* Schedule actions */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  Schedule
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <SchedulePicker
                    kind="callback"
                    value={(deal?.callback_at as string) ?? null}
                    onSave={(iso) =>
                      runRpc("processor_set_callback", { p_deal_id: dealId, p_callback_at: iso }, "cb")
                    }
                  />
                  <SchedulePicker
                    kind="appointment"
                    value={(deal?.appointment_at as string) ?? null}
                    onSave={(iso) =>
                      runRpc(
                        "processor_set_appointment",
                        { p_deal_id: dealId, p_appointment_at: iso },
                        "appt",
                      )
                    }
                  />
                </div>
              </section>

              {/* Log contact */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  Log a contact attempt
                </h3>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note (what happened on the call)…"
                  rows={2}
                  className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-2 text-gray-900 dark:text-white"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CONTACT_OUTCOMES.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      disabled={actionBusy === `log-${o.key}`}
                      onClick={() =>
                        void runRpc(
                          "processor_log_contact",
                          {
                            p_deal_id: dealId,
                            p_outcome: o.key,
                            ...(note.trim() ? { p_note: note.trim() } : {}),
                          },
                          `log-${o.key}`,
                        )
                      }
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue disabled:opacity-50"
                    >
                      {actionBusy === `log-${o.key}` ? "…" : o.label}
                    </button>
                  ))}
                </div>
                {typeof deal?.last_contact_at === "string" && (
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    Last contact {dateTimeET(deal.last_contact_at)} ET
                  </p>
                )}
              </section>

              {/* Bank statements + documents */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  Documents ({documents.length})
                </h3>
                {documents.length === 0 ? (
                  <p className="text-xs text-red-600 dark:text-red-400 font-semibold">
                    No documents on file yet — chase the bank statements.
                  </p>
                ) : (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
                    {documents.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 px-3 py-2">
                        <DocumentTextIcon className="w-4 h-4 shrink-0 text-gray-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                            {d.file_name || "Document"}
                            {d.is_bank_statement && (
                              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                bank statement
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {d.category || "uncategorized"}
                            {d.created_at ? ` · ${dateTimeET(d.created_at)}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openDoc(d.id, false)}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
                          title="View"
                        >
                          <EyeIcon className="w-3 h-3" /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => void openDoc(d.id, true)}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
                          title="Download"
                        >
                          <ArrowDownTrayIcon className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* QA step — gate ④. Tick every item, then mark QA passed. */}
              <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    QA — quality check before submission
                  </h3>
                  {gateQa && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <CheckIcon className="w-3 h-3" /> QA passed
                    </span>
                  )}
                </div>
                {gateQa && qa?.qa_passed_by_name && (
                  <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
                    Passed by {qa.qa_passed_by_name}
                    {qa.qa_passed_at ? ` · ${dateTimeET(qa.qa_passed_at)} ET` : ""}
                  </p>
                )}
                <ul className="space-y-1.5">
                  {QA_ITEMS.map((item) => (
                    <li key={item.key}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!qaChecks[item.key]}
                          onChange={(e) =>
                            setQaChecks((prev) => ({ ...prev, [item.key]: e.target.checked }))
                          }
                          className="mt-0.5 checkbox checkbox-xs checkbox-primary"
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-200">
                          {item.label}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] text-gray-400">
                  A voided check never blocks — a bank-portal screenshot satisfies it.
                </p>
                <textarea
                  value={qaNotes}
                  onChange={(e) => setQaNotes(e.target.value)}
                  placeholder="QA notes (optional)…"
                  rows={2}
                  className="mt-2 w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-2 text-gray-900 dark:text-white"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={actionBusy === "qa-save"}
                    onClick={() => void saveQa(gateQa, "qa-save")}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue disabled:opacity-50"
                  >
                    {actionBusy === "qa-save" ? "Saving…" : "Save QA progress"}
                  </button>
                  {!gateQa ? (
                    <button
                      type="button"
                      disabled={!allQaTicked || actionBusy === "qa-pass"}
                      onClick={() => void saveQa(true, "qa-pass")}
                      title={allQaTicked ? "Mark QA passed" : "Tick every item first"}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                      {actionBusy === "qa-pass" ? "Passing…" : "Mark QA passed"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionBusy === "qa-reopen"}
                      onClick={() => void saveQa(false, "qa-reopen")}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-amber-500 hover:text-amber-600 disabled:opacity-50"
                    >
                      <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                      {actionBusy === "qa-reopen" ? "Reopening…" : "Reopen QA"}
                    </button>
                  )}
                </div>
              </section>

              {/* The verdict — GO / NO-GO (submit / don't submit). Server enforces
                  bank statements on a GO; the UI also requires app + statements +
                  all QA items ticked. A GO is the owner's "run the AI Underwriter"
                  signal; a NO-GO records a reason and sends it back for rework. */}
              <section
                className={`rounded-lg border p-3 ${
                  decision === "go"
                    ? "border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20"
                    : decision === "no_go"
                      ? "border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-900/20"
                      : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  Verdict — submit or don&apos;t
                </h3>

                {decision === "go" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <CheckCircleIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                          GO — ready for the AI Underwriter
                        </div>
                        {(qa?.submission_ready_by_name || qa?.decision_by_name) && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            by {qa?.submission_ready_by_name || qa?.decision_by_name}
                            {qa?.submission_ready_at
                              ? ` · ${dateTimeET(qa.submission_ready_at)} ET`
                              : ""}
                          </div>
                        )}
                      </div>
                    </div>
                    <Link
                      to={`/admin/deals/${dealId}#underwriting`}
                      className="mt-2 w-full inline-flex items-center justify-center gap-1.5 text-sm font-bold px-3 py-2.5 rounded-lg bg-ocean-blue text-white hover:bg-deep-sea"
                    >
                      <PaperAirplaneIcon className="w-4 h-4" /> Run the AI Underwriter →
                    </Link>
                    <button
                      type="button"
                      disabled={actionBusy === "unready"}
                      onClick={() =>
                        void runRpc("processor_unmark_ready", { p_deal_id: dealId }, "unready")
                      }
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                      {actionBusy === "unready" ? "Clearing…" : "Pull back / change verdict"}
                    </button>
                  </>
                ) : decision === "no_go" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <XCircleIcon className="w-5 h-5 text-red-500 shrink-0" />
                      <div className="text-sm font-bold text-red-700 dark:text-red-300">
                        NO-GO — do not submit
                      </div>
                    </div>
                    {qa?.decision_reason && (
                      <p className="mt-1 text-xs text-gray-700 dark:text-gray-200">
                        <span className="font-semibold">Reason:</span> {qa.decision_reason}
                      </p>
                    )}
                    {qa?.decision_by_name && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        by {qa.decision_by_name}
                        {qa.decision_at ? ` · ${dateTimeET(qa.decision_at)} ET` : ""}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={actionBusy === "unready"}
                      onClick={() =>
                        void runRpc("processor_unmark_ready", { p_deal_id: dealId }, "unready")
                      }
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue disabled:opacity-50"
                    >
                      <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                      {actionBusy === "unready" ? "Clearing…" : "Clear / re-open verdict"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canGo || actionBusy === "go"}
                        onClick={() => void submitGo()}
                        title={
                          canGo
                            ? "GO — ready for the AI Underwriter"
                            : "Finish the application, get statements in, and tick every QA item first"
                        }
                        className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <PaperAirplaneIcon className="w-4 h-4" />
                        {actionBusy === "go" ? "Recording…" : "GO — Submit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoGoOpen((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-2.5 rounded-lg border border-red-400 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <XCircleIcon className="w-4 h-4" /> NO-GO — Don&apos;t submit
                      </button>
                    </div>
                    {!canGo && (
                      <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                        GO unlocks once{" "}
                        <span className={gateApp ? "text-emerald-600 dark:text-emerald-400" : ""}>
                          application
                        </span>
                        ,{" "}
                        <span className={gateStmts ? "text-emerald-600 dark:text-emerald-400" : ""}>
                          statements
                        </span>{" "}
                        and{" "}
                        <span className={allQaTicked ? "text-emerald-600 dark:text-emerald-400" : ""}>
                          every QA item
                        </span>{" "}
                        are green.
                      </p>
                    )}
                    {noGoOpen && (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={noGoReason}
                          onChange={(e) => setNoGoReason(e.target.value)}
                          placeholder="Why not? What has to be fixed before this can be submitted? (required)"
                          rows={2}
                          className="w-full text-sm rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 px-2.5 py-2 text-gray-900 dark:text-white"
                        />
                        <button
                          type="button"
                          disabled={!noGoReason.trim() || actionBusy === "nogo"}
                          onClick={() => void submitNoGo()}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {actionBusy === "nogo" ? "Recording…" : "Record NO-GO"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Full application */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Full application
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowSensitive((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
                  >
                    {showSensitive ? (
                      <>
                        <EyeSlashIcon className="w-3.5 h-3.5" /> Hide sensitive
                      </>
                    ) : (
                      <>
                        <EyeIcon className="w-3.5 h-3.5" /> Show sensitive
                      </>
                    )}
                  </button>
                </div>
                {appEntries.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    No saved application yet for this deal.
                  </p>
                ) : (
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {appEntries.map(([k, v]) => {
                      const sensitive = SENSITIVE_KEYS.has(k);
                      const shown = !sensitive || showSensitive;
                      return (
                        <div key={k} className="min-w-0">
                          <dt className="text-[10px] uppercase tracking-wide text-gray-400">
                            {humanize(k)}
                          </dt>
                          <dd className="text-xs text-gray-900 dark:text-gray-100 break-words">
                            {shown ? renderVal(v) : "••••••"}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </section>

              {actionErr && (
                <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {actionErr}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — move to nurture (armed two-step, no popup) */}
        {state.kind === "ready" && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3">
            <button
              type="button"
              disabled={actionBusy === "nurture"}
              onClick={() => {
                if (nurtureArmed) {
                  void runRpc(
                    "processor_move_to_nurture",
                    {
                      p_deal_id: dealId,
                      ...(note.trim() ? { p_reason: note.trim() } : {}),
                    },
                    "nurture",
                  );
                  setNurtureArmed(false);
                } else {
                  setNurtureArmed(true);
                  window.setTimeout(() => setNurtureArmed(false), 4000);
                }
              }}
              className={`w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
                nurtureArmed
                  ? "border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200"
                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-300"
              }`}
            >
              <MoonIcon className="w-4 h-4" />
              {actionBusy === "nurture"
                ? "Moving…"
                : nurtureArmed
                  ? "Click again to confirm — move to long-term nurture"
                  : "Move to long-term nurture"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
