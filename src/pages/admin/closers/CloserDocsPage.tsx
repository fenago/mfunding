// Closer Onboarding & Documents — the index.
//
// Two audiences, one route:
//   • admin / super_admin → the full list of documents with links, a per-closer
//     signing checklist, and the "send onboarding package" button.
//   • closer              → ONLY their own documents and their own status. RLS
//     makes this true regardless of what the UI does; the UI just doesn't render
//     other people's rows.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  Cog6ToothIcon,
  ChevronRightIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  CLOSER_DOCS,
  REFERENCE_DOCS,
  ESIGNABLE_SLUGS,
  ACTION_LABEL,
  ACTION_BADGE,
  DELIVERY_LABEL,
} from "@/data/closerDocs";
import {
  getCloserDocuments,
  getMyCloser,
  getMergeSettings,
  saveMergeSettings,
  sendOnboardingPackage,
  setDocStatus,
  STATUS_LABEL,
  STATUS_BADGE,
  STATUS_DOT,
  type CloserDocumentRow,
  type DocStatus,
  type SendPackageResult,
} from "@/services/closerDocsService";
import type { MergeSettings } from "@/lib/closerDocMerge";

interface CloserLite {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// ---------------------------------------------------------------------------

/** The "just the links" list — every document, what it is, and how to open it. */
function DocumentIndex() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-bold text-gray-900 dark:text-white">The documents</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Phase 0 of the onboarding SOP. Every closer signs or returns all nine.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-8">#</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Document</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">How it's done</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {CLOSER_DOCS.map((doc) => (
              <tr key={doc.slug} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 text-sm tabular-nums text-gray-400">{doc.order}</td>
                <td className="px-4 py-3">
                  <Link
                    to={`/admin/closer-docs/${doc.slug}`}
                    className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue"
                  >
                    {doc.title}
                  </Link>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{doc.summary}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${ACTION_BADGE[doc.action]}`}>
                    {ACTION_LABEL[doc.action]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${
                      doc.delivery === "esign"
                        ? "bg-mint-green/20 text-emerald-700 dark:bg-mint-green/20 dark:text-emerald-300"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {DELIVERY_LABEL[doc.delivery]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/admin/closer-docs/${doc.slug}`} className="text-sm text-ocean-blue hover:underline">
                    Open
                  </Link>
                  {doc.externalUrl && (
                    <a
                      href={doc.externalUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-3 inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
                    >
                      IRS <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
          Reference only — received, never signed
        </p>
        <div className="flex flex-wrap gap-3">
          {REFERENCE_DOCS.map((doc) => (
            <Link
              key={doc.slug}
              to={`/admin/closer-docs/${doc.slug}`}
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-ocean-blue"
            >
              <DocumentTextIcon className="w-4 h-4" />
              {doc.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Company-wide values the merge needs. Without these, nothing can be sent. */
function MergeSettingsPanel({
  settings,
  onSave,
}: {
  settings: MergeSettings;
  onSave: (s: MergeSettings) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MergeSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(settings), [settings]);

  // The draw treatment is NOT here — it's an admin policy flag on
  // /admin/platform-config and it has a safe default, so it never blocks a send.
  const incomplete =
    !form.company_legal_name ||
    !form.company_signatory ||
    !form.governing_state ||
    form.clawback_window_days == null ||
    form.renewal_override_pct == null;

  const save = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof MergeSettings,
    placeholder: string,
    type: "text" | "number" = "text",
  ) => (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={(form[key] as string | number | null) ?? ""}
        placeholder={placeholder}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value,
          })
        }
        className="input-field"
      />
    </div>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30"
      >
        <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
        <Cog6ToothIcon className="w-5 h-5 text-gray-400" />
        <div className="flex-1">
          <h2 className="font-bold text-gray-900 dark:text-white">Company terms used in every document</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            These fill <code className="text-xs">[COMPANY]</code>, the signatory, governing state, and the Schedule A draw choice.
          </p>
        </div>
        {incomplete && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            ⚠ incomplete — blocks sending
          </span>
        )}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              <strong className="font-semibold">This is what prints on every executed contract.</strong> The entity is
              set to <strong>Agentic Voice Inc. d/b/a MFunding.net | Momentum Funding</strong> — verify it matches the
              formation paperwork exactly before any closer signs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {field("Company legal name — [COMPANY]", "company_legal_name", "Agentic Voice Inc. d/b/a MFunding.net | Momentum Funding")}
            {field("Company signatory — [SIGNATORY NAME, TITLE]", "company_signatory", "Ernesto Lee, President")}
            {field("Governing-law state — [STATE]", "governing_state", "Florida")}
            {field("Clawback window (days) — [#]", "clawback_window_days", "90", "number")}
            {field("Renewal override %", "renewal_override_pct", "10", "number")}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Schedule A&apos;s draw treatment (forgiven vs repayable) is an admin flag on{" "}
            <Link to="/admin/platform-config" className="text-ocean-blue hover:underline">
              Platform Config
            </Link>{" "}
            — it defaults to <strong className="font-semibold">repayable</strong>, so it never blocks a send.
          </p>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? "Saving…" : "Save company terms"}
            </button>
            {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Per-closer checklist + the send button. */
function CloserChecklist({
  closer,
  rows,
  onRefresh,
}: {
  closer: CloserLite;
  rows: CloserDocumentRow[];
  onRefresh: () => Promise<void>;
}) {
  const byslug = useMemo(() => {
    const m: Record<string, CloserDocumentRow> = {};
    rows.forEach((r) => { m[r.doc_slug] = r; });
    return m;
  }, [rows]);

  // Pre-select the e-signable docs that haven't been signed yet — the ones the
  // "send" button can actually act on.
  const sendable = ESIGNABLE_SLUGS.filter((s) => byslug[s]?.status !== "signed");
  const [selected, setSelected] = useState<Set<string>>(new Set(sendable));
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendPackageResult | null>(null);

  const signedCount = CLOSER_DOCS.filter((d) => byslug[d.slug]?.status === "signed").length;
  const doneCount = CLOSER_DOCS.filter(
    (d) => byslug[d.slug]?.status === "signed" || byslug[d.slug]?.status === "na",
  ).length;

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const allSelected = sendable.length > 0 && sendable.every((s) => selected.has(s));
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(sendable));

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const res = await sendOnboardingPackage(closer.id, [...selected]);
      setResult(res);
      if (res.ok) await onRefresh();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Send failed" });
    } finally {
      setSending(false);
    }
  };

  const markStatus = async (slug: string, status: DocStatus) => {
    await setDocStatus(closer.id, slug, status);
    await onRefresh();
  };

  return (
    <div className="p-5 bg-gray-50/80 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 space-y-4">
      {/* Send bar */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={selectAll}
            disabled={sendable.length === 0}
            className="rounded border-gray-300 dark:border-gray-600 text-ocean-blue focus:ring-ocean-blue"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Select all e-signable ({sendable.length})
          </span>
        </label>
        <button
          onClick={send}
          disabled={sending || selected.size === 0}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          <PaperAirplaneIcon className="w-4 h-4" />
          {sending
            ? "Sending…"
            : `Email ${selected.size} doc${selected.size === 1 ? "" : "s"} to ${closer.first_name} to e-sign`}
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Sends one email to <strong className="font-semibold">{closer.email}</strong> with a signing link per document.
        </span>
      </div>

      {/* Blocked: unfilled fields. Nothing was sent. */}
      {result?.blocked?.length ? (
        <div className="rounded-lg border-2 border-rose-400 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/25 p-4">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="flex-1">
              <p className="text-sm font-bold text-rose-900 dark:text-rose-100">
                Nothing was sent — these documents still have unfilled fields.
              </p>
              <p className="text-xs text-rose-800 dark:text-rose-200 mt-0.5">
                A closer must never receive a contract with a raw <code>[BRACKET]</code> in it. Fill these in and send again.
              </p>
              <div className="mt-3 space-y-2">
                {result.blocked.map((b) => (
                  <div key={b.slug}>
                    <p className="text-xs font-semibold text-rose-900 dark:text-rose-100">{b.title}</p>
                    <ul className="mt-1 space-y-0.5">
                      {b.missing.map((m) => (
                        <li key={m.token} className="text-xs text-rose-800 dark:text-rose-200 flex gap-2">
                          <span className="opacity-60">▸</span>
                          <span>
                            <strong className="font-semibold">{m.label}</strong>{" "}
                            <span className="opacity-70">
                              — fix in {m.fix === "settings" ? "Company terms above" : `${closer.first_name}'s closer record`}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {result?.ok && (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2">
          <p className="text-sm text-emerald-800 dark:text-emerald-200">
            <strong className="font-semibold">Sent to {result.to}</strong> — {result.sent?.length} document
            {result.sent?.length === 1 ? "" : "s"}. Each is now frozen and awaiting signature.
          </p>
        </div>
      )}

      {result && !result.ok && !result.blocked?.length && (
        <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-3 py-2">
          <p className="text-sm text-rose-800 dark:text-rose-200">{result.error}</p>
        </div>
      )}

      {/* Checklist */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <table className="w-full">
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {CLOSER_DOCS.map((doc) => {
              const row = byslug[doc.slug];
              const status = (row?.status ?? "not_sent") as DocStatus;
              const canSend = doc.delivery === "esign";
              return (
                <tr key={doc.slug}>
                  <td className="pl-4 pr-2 py-2.5 w-8">
                    {canSend ? (
                      <input
                        type="checkbox"
                        checked={selected.has(doc.slug)}
                        onChange={() => toggle(doc.slug)}
                        disabled={status === "signed"}
                        className="rounded border-gray-300 dark:border-gray-600 text-ocean-blue focus:ring-ocean-blue disabled:opacity-40"
                      />
                    ) : (
                      <span className="block w-4 h-4" />
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
                      <Link
                        to={`/admin/closer-docs/${doc.slug}`}
                        className="text-sm font-medium text-gray-900 dark:text-white hover:text-ocean-blue"
                      >
                        {doc.title}
                      </Link>
                      {!canSend && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                          {DELIVERY_LABEL[doc.delivery]}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${STATUS_BADGE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {status === "signed" ? fmtDate(row?.signed_at ?? null) : status === "sent" ? fmtDate(row?.sent_at ?? null) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {/* Manual status only for the docs that aren't e-signed. An
                        e-signable doc can only reach 'signed' through the RPC. */}
                    {!canSend && (
                      <select
                        value={status}
                        onChange={(e) => markStatus(doc.slug, e.target.value as DocStatus)}
                        className="text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-1.5 py-1"
                      >
                        <option value="not_sent">Not sent</option>
                        <option value="sent">Sent</option>
                        <option value="signed">Collected / signed</option>
                        <option value="na">N/A</option>
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        <strong className="font-semibold text-gray-700 dark:text-gray-200">
          {signedCount}/{CLOSER_DOCS.length} signed
        </strong>{" "}
        · {doneCount}/{CLOSER_DOCS.length} resolved (signed or N/A)
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function CloserDocsPage() {
  const { isAdmin, isSuperAdmin } = useUserProfile();
  const isManager = isAdmin || isSuperAdmin;

  const [closers, setClosers] = useState<CloserLite[]>([]);
  const [rows, setRows] = useState<CloserDocumentRow[]>([]);
  const [settings, setSettings] = useState<MergeSettings>({});
  const [myCloserId, setMyCloserId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const docs = await getCloserDocuments();
      setRows(docs);

      if (isManager) {
        const { data } = await supabase
          .from("closers")
          .select("id, first_name, last_name, email, status")
          .order("first_name");
        setClosers((data ?? []) as CloserLite[]);
        setSettings(await getMergeSettings());
      } else {
        const me = await getMyCloser();
        setMyCloserId(me?.id ?? null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  // --- Closer view: only their own documents. -------------------------------
  if (!isManager) {
    const mine = rows.filter((r) => r.closer_id === myCloserId);
    const bySlug: Record<string, CloserDocumentRow> = {};
    mine.forEach((r) => { bySlug[r.doc_slug] = r; });
    const toSign = mine.filter((r) => r.status === "sent").length;

    return (
      <div className="p-6 max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your onboarding documents</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {toSign > 0 ? (
            <>
              <strong className="font-semibold text-gray-700 dark:text-gray-200">{toSign} waiting for your signature.</strong>{" "}
              Open each one, read it, and sign at the bottom.
            </>
          ) : (
            "Nothing is waiting on you right now."
          )}
        </p>

        {error && <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {CLOSER_DOCS.map((doc) => {
                const status = (bySlug[doc.slug]?.status ?? "not_sent") as DocStatus;
                return (
                  <tr key={doc.slug} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
                        <Link
                          to={`/admin/closer-docs/${doc.slug}`}
                          className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue"
                        >
                          {doc.title}
                        </Link>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 ml-3.5">{doc.summary}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${STATUS_BADGE[status]}`}>
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/admin/closer-docs/${doc.slug}`} className="text-sm text-ocean-blue hover:underline">
                        {status === "sent" ? "Read & sign" : "Open"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // --- Manager view ---------------------------------------------------------
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Closer Onboarding &amp; Documents</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Every document a closer signs, the link to each one, and who still owes what.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-3 py-2">
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      <DocumentIndex />

      {isSuperAdmin && (
        <MergeSettingsPanel
          settings={settings}
          onSave={async (s) => {
            await saveMergeSettings(s);
            setSettings(s);
          }}
        />
      )}

      {/* Per-closer signing tracker */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold text-gray-900 dark:text-white">Who has signed what</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Open a closer to see their checklist and send their package.
          </p>
        </div>
        <table className="w-full">
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {closers.map((c) => {
              const mine = rows.filter((r) => r.closer_id === c.id);
              const signed = mine.filter((r) => r.status === "signed").length;
              const awaiting = mine.filter((r) => r.status === "sent").length;
              const isOpen = expanded.has(c.id);
              const complete = signed + mine.filter((r) => r.status === "na").length;

              return (
                <tr key={c.id} className="align-top">
                  <td colSpan={5} className="p-0">
                    <button
                      onClick={() => toggle(c.id)}
                      className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                        isOpen ? "bg-gray-50 dark:bg-gray-700/30" : ""
                      }`}
                    >
                      <ChevronRightIcon
                        className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 dark:text-white">
                          {c.first_name} {c.last_name}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{c.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {awaiting > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            {awaiting} awaiting signature
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            complete === CLOSER_DOCS.length
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                          }`}
                        >
                          {signed}/{CLOSER_DOCS.length} signed
                        </span>
                      </div>
                    </button>
                    {isOpen && <CloserChecklist closer={c} rows={mine} onRefresh={load} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
