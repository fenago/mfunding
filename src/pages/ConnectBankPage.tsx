import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  BuildingLibraryIcon,
  ShieldCheckIcon,
  ArrowPathIcon,
  LockClosedIcon,
  ArrowUpTrayIcon,
  EnvelopeIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import { usePlaidConnect } from "../hooks/usePlaidConnect";
import {
  fetchDocLinkStatus,
  uploadMerchantDoc,
  type DocsOnFile,
  type DocLinkStatus,
} from "../lib/merchantDocLink";
import { MAX_UPLOAD_BYTES, friendlyUploadError } from "../data/docRequests";

/**
 * ConnectBankPage — the public, logged-OUT document page at /connect-bank/:token.
 * A merchant lands here from a texted link or from the redirect after they sign
 * their application, and this is the ONLY place they are ever told how to get
 * statements to us. So it carries all THREE ways on one screen:
 *
 *   1. Connect the bank through Plaid (primary, fastest)
 *   2. Upload the files right here
 *   3. Email them to sales@send.mfunding.net
 *
 * Lane 2 is not small print. submit-to-funders' stips gate is satisfied by a
 * `customer_documents` row or a GHL form upload and NOTHING else — it never
 * consults bank_analyses or plaid_items — so a bank connection on its own does
 * not unblock a submission. Uploads therefore go through merchant-upload-doc,
 * which writes both the storage object and the row (a logged-out browser can
 * write neither: there is no `anon` policy on either).
 *
 * THE ASK IS ONE PHRASE: the last 3–4 months. Soft on purpose — most funders
 * only require 3 and a hard ask for 4 adds friction for no gain, but we take 4
 * happily. Nothing on this page says "3 most recent" or "3-month", because four
 * different live emails each said something different.
 *
 * NOTHING here tells a merchant they are finished unless we can read back that
 * we hold their statements. Plaid's Statements product covers only part of the
 * US depository market, `plaid_items` has never held a row (read 2026-11-01),
 * and an unreadable check is reported as unreadable — never as "nothing".
 *
 * Standalone: no portal/admin chrome, no auth. An MCA is a purchase of future
 * receivables, not a loan, and no copy here says otherwise.
 */

const DOCS_EMAIL = "sales@send.mfunding.net";

/** What a merchant may file from here. Ops classification stays with ops. */
const UPLOAD_TYPES: Array<{ value: string; label: string }> = [
  { value: "bank_statement", label: "Bank statements (last 3–4 months)" },
  { value: "id", label: "Driver's licence / photo ID" },
  { value: "voided_check", label: "Voided check or bank letter" },
  { value: "other", label: "Something else they asked for" },
];

type QueueState = "uploading" | "done" | "error";
interface QueueItem {
  key: string;
  name: string;
  state: QueueState;
  error?: string;
}

export default function ConnectBankPage() {
  const { token } = useParams<{ token: string }>();
  const [institution, setInstitution] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Send your bank statements · Momentum Funding";
  }, []);

  // ── What we actually hold, read back from the server. `null` onFile means the
  //    read FAILED; `statusError` means we could not even reach it. Neither is
  //    ever rendered as "nothing on file". ──
  const [status, setStatus] = useState<DocLinkStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!token) return;
    try {
      const s = await fetchDocLinkStatus(token);
      setStatus(s);
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "We couldn't check your file.");
    }
  }, [token]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const { start, phase, busy, error, reset } = usePlaidConnect({
    createBody: { link_ref: token },
    exchangeBody: { link_ref: token },
    onConnected: (inst) => setInstitution(inst ?? null),
  });
  const connected = phase === "done";

  // Statement PDFs arrive asynchronously (plaid-exchange → plaid-pull), so after
  // a connect we re-read a few times before saying anything about what we hold.
  const pollTimers = useRef<number[]>([]);
  useEffect(() => {
    if (!connected) return;
    pollTimers.current.forEach(clearTimeout);
    pollTimers.current = [4000, 10000, 20000, 35000].map((ms) =>
      window.setTimeout(() => void refreshStatus(), ms),
    );
    void refreshStatus();
    return () => pollTimers.current.forEach(clearTimeout);
  }, [connected, refreshStatus]);

  // ── Upload lane ──
  const [docType, setDocType] = useState("bank_statement");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const sendFiles = useCallback(
    async (files: File[]) => {
      if (!token || files.length === 0) return;
      // One at a time: the request body stays small and a failure names one file.
      for (const file of files) {
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setQueue((q) => [...q, { key, name: file.name, state: "uploading" }]);
        if (file.size > MAX_UPLOAD_BYTES) {
          setQueue((q) =>
            q.map((i) =>
              i.key === key
                ? { ...i, state: "error", error: "Over 10MB — please send a smaller photo or PDF." }
                : i,
            ),
          );
          continue;
        }
        try {
          const res = await uploadMerchantDoc(token, file, docType);
          setQueue((q) => q.map((i) => (i.key === key ? { ...i, state: "done" } : i)));
          if (res.onFile) setStatus((s) => (s ? { ...s, onFile: res.onFile } : s));
        } catch (e) {
          setQueue((q) =>
            q.map((i) =>
              i.key === key ? { ...i, state: "error", error: friendlyUploadError(e) } : i,
            ),
          );
        }
      }
      void refreshStatus();
    },
    [token, docType, refreshStatus],
  );

  // ── Copy affordances (no native dialogs anywhere on this page) ──
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2500);
    } catch {
      setCopied(null);
    }
  };

  const bizName = status?.businessName ?? null;
  const emailSubject = `Bank statements${bizName ? ` — ${bizName}` : ""}${
    status?.dealNumber ? ` (${status.dealNumber})` : ""
  }`;
  const mailto = `mailto:${DOCS_EMAIL}?subject=${encodeURIComponent(emailSubject)}`;

  const uploadedNow = queue.filter((i) => i.state === "done").length;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Brand bar */}
      <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
          Momentum <span className="text-mint-green">Funding</span>
        </span>
      </header>

      <main className="flex-1 px-4 py-8 sm:py-10">
        <div className="w-full max-w-2xl mx-auto space-y-5">
          {/* ── The ask. One headline, one number. ── */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
              Send us <u>the last 3–4 months</u> of business bank statements
            </h1>
            {bizName && (
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                For <strong className="text-gray-700 dark:text-gray-200">{bizName}</strong>
                {status?.dealNumber ? (
                  <>
                    {" · "}
                    <span className="font-mono text-xs">{status.dealNumber}</span>
                  </>
                ) : null}
              </p>
            )}
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Pick <strong>any one</strong> of the three ways below. The funders review your
              statements — that is what decides your offer.
            </p>
          </div>

          {/* ── Ground truth: what we HOLD. Chips, not a paragraph. ── */}
          <OnFileChips onFile={status?.onFile ?? null} statusError={statusError} hasToken={!!token} />

          {!token ? (
            /* Missing/garbled link — lanes 1 and 2 need the token, lane 3 does not. */
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
              <div className="flex items-start gap-3">
                <LockClosedIcon className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <div>
                  <h2 className="font-bold text-amber-900 dark:text-amber-200">
                    This link looks incomplete
                  </h2>
                  <p className="mt-1.5 text-sm text-amber-800 dark:text-amber-200">
                    Please open the full, most recent link your funding specialist sent you — or
                    reply to them for a fresh one. <strong>You can still email your statements</strong>{" "}
                    using the instructions at the bottom of this page.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* ══ LANE 1 — Connect the bank. Primary, biggest, first. ══ */}
          {token && (
            <section className="rounded-2xl border-2 border-ocean-blue/40 dark:border-ocean-blue/50 bg-white dark:bg-gray-900 p-6 sm:p-7 shadow-xl">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-ocean-blue text-white">
                  Fastest
                </span>
                <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                  about 60 seconds
                </span>
              </div>

              <div className="w-12 h-12 rounded-xl bg-ocean-blue/10 dark:bg-ocean-blue/20 flex items-center justify-center mb-4">
                <BuildingLibraryIcon className="w-7 h-7 text-ocean-blue" />
              </div>

              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Option 1 — Connect your bank
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Sign in to your bank through Plaid. Nothing to dig up, nothing to scan.
              </p>

              <ul className="mt-4 space-y-2">
                <li className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                  <ShieldCheckIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  Bank-level security via Plaid — trusted by thousands of apps.
                </li>
                <li className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                  <LockClosedIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <span>
                    <strong>We never see or store your bank login.</strong> Read-only — no money
                    can move.
                  </span>
                </li>
              </ul>

              {connected ? (
                <ConnectedNotice institution={institution} onFile={status?.onFile ?? null} statusError={statusError} />
              ) : (
                <>
                  {error && (
                    <div className="mt-5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
                      <p className="text-sm text-amber-800 dark:text-amber-200">{error}</p>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        If your bank won't connect, <strong>Option 2 below works just as well</strong>.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => (error ? reset() : start())}
                    disabled={busy}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 text-base font-semibold text-white bg-ocean-blue rounded-xl hover:bg-ocean-blue/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {busy ? (
                      <>
                        <ArrowPathIcon className="w-5 h-5 animate-spin" />
                        Connecting…
                      </>
                    ) : error ? (
                      "Try again"
                    ) : (
                      "Connect your bank securely"
                    )}
                  </button>
                </>
              )}

              <p className="mt-3 text-center text-[11px] text-gray-400">
                Connecting your bank only verifies your business revenue.
              </p>
            </section>
          )}

          {/* ══ LANE 2 — Upload. A real option, same weight as lane 1. ══ */}
          {token && (
            <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-7 shadow-lg">
              <div className="w-12 h-12 rounded-xl bg-mint-green/10 dark:bg-mint-green/20 flex items-center justify-center mb-4">
                <ArrowUpTrayIcon className="w-7 h-7 text-mint-green" />
              </div>

              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Option 2 — Upload them here
              </h2>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                PDFs from your online banking, or <strong>photos taken with your phone</strong> —
                both are fine. Send <strong>the last 3–4 months</strong>; one file per month is
                normal.
              </p>

              <label className="block mt-5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  What are you sending?
                </span>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100"
                >
                  {UPLOAD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void sendFiles(Array.from(e.dataTransfer.files));
                }}
                className={`mt-4 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                  dragging
                    ? "border-mint-green bg-mint-green/5"
                    : "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
                }`}
              >
                <DocumentTextIcon className="w-8 h-8 mx-auto text-gray-400" />
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  Drag your files here, or
                </p>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="mt-3 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-mint-green rounded-xl hover:bg-mint-green/90 transition-colors"
                >
                  <ArrowUpTrayIcon className="w-4 h-4" />
                  Choose files or take a photo
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    void sendFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <p className="mt-3 text-[11px] text-gray-400">
                  PDF, JPG, PNG or HEIC · up to 10MB each
                </p>
              </div>

              {queue.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {queue.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-start gap-2 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm"
                    >
                      {item.state === "uploading" && (
                        <ArrowPathIcon className="w-4 h-4 mt-0.5 text-gray-400 animate-spin flex-shrink-0" />
                      )}
                      {item.state === "done" && (
                        <CheckCircleIcon className="w-4 h-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                      )}
                      {item.state === "error" && (
                        <ExclamationTriangleIcon className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-700 dark:text-gray-200">
                          {item.name}
                        </span>
                        {item.state === "uploading" && (
                          <span className="text-[11px] text-gray-400">Sending…</span>
                        )}
                        {item.state === "done" && (
                          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            On your file
                          </span>
                        )}
                        {item.state === "error" && (
                          <span className="text-[11px] text-amber-700 dark:text-amber-400">
                            <strong>Not sent</strong> — {item.error}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {uploadedNow > 0 && (
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  <strong>
                    {uploadedNow} file{uploadedNow === 1 ? "" : "s"}
                  </strong>{" "}
                  landed on your file. Keep going until <strong>the last 3–4 months</strong> are in.
                </p>
              )}
            </section>
          )}

          {/* ══ LANE 3 — Email. A plain instruction, no form. ══ */}
          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-7 shadow-lg">
            <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <EnvelopeIcon className="w-7 h-7 text-gray-500 dark:text-gray-400" />
            </div>

            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Option 3 — Email them to us
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Attach <strong>the last 3–4 months</strong> and send them to:
            </p>

            <dl className="mt-4 space-y-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Send to
                </dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="select-all rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {DOCS_EMAIL}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy("email", DOCS_EMAIL)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-ocean-blue hover:underline"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                    {copied === "email" ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>

              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Put this in the subject
                </dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="select-all rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100">
                    {emailSubject}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy("subject", emailSubject)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-ocean-blue hover:underline"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                    {copied === "subject" ? "Copied" : "Copy"}
                  </button>
                </dd>
                {!bizName && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    Add your business name to the subject so we can match it to your file.
                  </p>
                )}
              </div>
            </dl>

            <a
              href={mailto}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <EnvelopeIcon className="w-4 h-4" />
              Open my email app
            </a>
            <p className="mt-3 text-[11px] text-gray-400 text-center">
              Emailed files are matched by hand, so they take a little longer than Options 1 and 2.
            </p>
          </section>

          <p className="pb-6 text-center text-[11px] text-gray-400">
            Questions? Reply to your funding specialist's last text or email — they'll pick it up.
          </p>
        </div>
      </main>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

/**
 * The read-back strip. Three states, and they are NOT interchangeable:
 *   · a count we read      → print the count
 *   · a read that returned → print "nothing yet"
 *   · a read that FAILED   → print "couldn't check", never "nothing yet"
 */
function OnFileChips({
  onFile,
  statusError,
  hasToken,
}: {
  onFile: DocsOnFile | null;
  statusError: string | null;
  hasToken: boolean;
}) {
  if (!hasToken) return null;

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border";

  if (statusError || !onFile) {
    return (
      <div className="flex flex-wrap gap-2">
        <span
          className={`${base} border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300`}
        >
          statements on file: couldn't check
        </span>
        <span className="text-[11px] text-gray-400 self-center">
          That is not the same as none — send them below to be sure.
        </span>
      </div>
    );
  }

  const n = onFile.bank_statements;
  return (
    <div className="flex flex-wrap gap-2">
      <span
        className={`${base} ${
          n > 0
            ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300"
            : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300"
        }`}
      >
        {n > 0 ? `statements on file: ${n} ✓` : "statements on file: none yet ✗"}
      </span>
      {onFile.other_docs > 0 && (
        <span
          className={`${base} border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300`}
        >
          other documents: {onFile.other_docs}
        </span>
      )}
    </div>
  );
}

/**
 * What we say after a bank connects. It MUST NOT say "there's nothing else you
 * need to send" unless we can read back that we hold statements — the page this
 * replaced said exactly that to every merchant, including the ones whose bank
 * delivered no statement PDFs at all.
 */
function ConnectedNotice({
  institution,
  onFile,
  statusError,
}: {
  institution: string | null;
  onFile: DocsOnFile | null;
  statusError: string | null;
}) {
  const held = !statusError && onFile ? onFile.bank_statements : null;

  return (
    <div className="mt-5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
      <div className="flex items-start gap-2.5">
        <CheckCircleIcon className="w-6 h-6 text-emerald-500 flex-shrink-0" />
        <div>
          <p className="font-bold text-emerald-900 dark:text-emerald-200">
            Bank connected{institution ? ` — ${institution}` : ""}
          </p>

          {held === null ? (
            <p className="mt-1.5 text-sm text-emerald-900 dark:text-emerald-200">
              We <strong>couldn't check</strong> which statements are on your file just now. Please
              send <strong>the last 3–4 months</strong> with Option 2 or Option 3 so nothing waits on
              us.
            </p>
          ) : held > 0 ? (
            <p className="mt-1.5 text-sm text-emerald-900 dark:text-emerald-200">
              We now hold <strong>{held} statement{held === 1 ? "" : "s"}</strong> for you. If any
              of <strong>the last 3–4 months</strong> are missing, add them with Option 2 below.
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-emerald-900 dark:text-emerald-200">
              Your revenue is now verifiable — but{" "}
              <strong>we don't have your statements yet</strong>. Not every bank releases statement
              PDFs through Plaid. Please send <strong>the last 3–4 months</strong> with Option 2 or
              Option 3.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
