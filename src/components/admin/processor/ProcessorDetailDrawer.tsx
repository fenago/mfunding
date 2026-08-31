import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  MoonIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import { dateTimeET } from "@/utils/time";
import SchedulePicker from "./SchedulePicker";

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

interface DetailShape {
  deal?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  application?: Record<string, unknown> | null;
  documents?: DetailDoc[] | null;
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
  onClose,
  onChanged,
}: {
  dealId: string | null;
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

  const load = useCallback(async () => {
    if (!dealId) return;
    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.rpc("processor_deal_detail", { p_deal_id: dealId });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("The detail read returned nothing.");
      setState({ kind: "ready", detail: data as DetailShape });
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
      const { data, error } = await supabase.rpc("processor_document_url", {
        p_document_id: documentId,
      });
      if (error) throw new Error(error.message);
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

  if (!dealId) return null;

  const detail = state.kind === "ready" ? state.detail : null;
  const deal = detail?.deal ?? {};
  const customer = detail?.customer ?? {};
  const application = detail?.application ?? null;
  const documents = detail?.documents ?? [];
  const chip = stageChip(deal?.status as string | undefined);
  const title =
    (customer?.business_name as string) ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    (deal?.deal_number as string) ||
    "Merchant";

  const appEntries = application
    ? Object.entries(application).filter(([k]) => !HIDDEN_KEYS.has(k))
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
                to={`/admin/deals/${dealId}`}
                className="inline-flex items-center gap-1 font-semibold text-ocean-blue hover:underline"
              >
                <ArrowTopRightOnSquareIcon className="w-3 h-3" /> Full deal record
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
