// /admin/closer-docs/:slug — read the document, and (if it's yours and it's been
// sent to you) sign it.
//
// WHAT GETS RENDERED, in priority order:
//   1. The closer's OWN frozen merged_content, if the document has been sent to
//      them. This is the authoritative text — the exact bytes the signature
//      ledger hashes. Never re-merge on the client for a signer.
//   2. For a manager: a live PREVIEW merged from the template + that closer's
//      row, clearly labelled as a preview, with any unfilled fields called out.
//   3. Reference docs: the SOP from bundled repo markdown; the Comp Offer Sheet
//      fetched from closer_doc_templates, because it states rates and must not
//      be in the bundle at all.
//
// WHO MAY SEE COMMISSION TERMS: only a viewer who HAS commission terms — i.e. a
// real `closers` row (their own splits, draw, clawback example) — or a manager.
// A setter is role `closer` with NO closers row; they are not commissioned, and
// the compensation documents must not render for them.
//
// This gate is DEFENCE IN DEPTH, not the enforcement. The enforcement is RLS on
// closer_doc_templates (migration 20260827_closer_comp_docs_to_db.sql): a setter
// asking the API directly for the comp bodies gets zero rows. The old bundled
// `?raw` comp sheet could not be protected this way — the bytes were already in
// every browser, and hiding the component only hid the component.
//
// The signing act: type your full legal name + tick the consent box. The RPC
// records name, consent sentence, content snapshot, SHA-256, timestamp, IP, and
// user-agent. The browser is not trusted for any of it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import MarkdownDoc from "@/components/shared/MarkdownDoc";
import { getCloserDoc, ACTION_LABEL, ACTION_BADGE, DELIVERY_LABEL } from "@/data/closerDocs";
import {
  getCloserDocuments,
  getDocTemplates,
  getMergeSettings,
  getMyCloser,
  getReferenceDocBody,
  getSignatures,
  signDocument,
  CONSENT_TEXT,
  STATUS_BADGE,
  STATUS_LABEL,
  type CloserDocumentRow,
  type CloserDocTemplate,
  type DocStatus,
  type SignatureRow,
} from "@/services/closerDocsService";
import { mergeCloserDoc, type MergeCloser, type MergeSettings, type MissingField } from "@/lib/closerDocMerge";

export default function CloserDocViewerPage() {
  const { slug } = useParams<{ slug: string }>();
  const { isAdmin, isSuperAdmin } = useUserProfile();
  const isManager = isAdmin || isSuperAdmin;
  const doc = getCloserDoc(slug);

  const [myRow, setMyRow] = useState<CloserDocumentRow | null>(null);
  const [myCloserId, setMyCloserId] = useState<string | null>(null);
  const [template, setTemplate] = useState<CloserDocTemplate | null>(null);
  const [previewCloser, setPreviewCloser] = useState<MergeCloser | null>(null);
  const [settings, setSettings] = useState<MergeSettings>({});
  const [signature, setSignature] = useState<SignatureRow | null>(null);
  const [loading, setLoading] = useState(true);
  /** Reference body held in the DB (the Comp Offer Sheet). */
  const [dbBody, setDbBody] = useState<string | null>(null);
  /** The DB read FAILED. Never let that render as "nothing to show". */
  const [dbBodyError, setDbBodyError] = useState<string | null>(null);

  const [typedName, setTypedName] = useState("");
  const [consented, setConsented] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const me = await getMyCloser();
      setMyCloserId(me?.id ?? null);
      if (me) setTypedName(`${me.first_name} ${me.last_name}`.trim());

      // Reference body that lives in the DB. Don't even ask for it when the
      // viewer is barred from it — RLS would return nothing anyway, and asking
      // would blur "refused" into "empty". If we DO ask and the read fails, the
      // error is kept so the page can say so instead of rendering a blank doc.
      if (doc?.bodyFromDb) {
        const barred = !isManager && !me && !!doc.compensation;
        if (barred) {
          setDbBody(null);
          setDbBodyError(null);
        } else {
          const res = await getReferenceDocBody(slug);
          setDbBody(res.body);
          setDbBodyError(res.error);
        }
      }

      const [rows, sigs] = await Promise.all([getCloserDocuments(), getSignatures()]);
      const mine = me ? rows.find((r) => r.closer_id === me.id && r.doc_slug === slug) ?? null : null;
      setMyRow(mine);
      setSignature(me ? sigs.find((s) => s.closer_id === me.id && s.doc_slug === slug) ?? null : null);

      // Managers get a merge preview against a real closer's data.
      if (isManager) {
        const [tpls, st] = await Promise.all([getDocTemplates(), getMergeSettings()]);
        setTemplate(tpls.find((t) => t.slug === slug) ?? null);
        setSettings(st);
        const { data: c } = await supabase
          .from("closers")
          .select("first_name, last_name, company_lead_split, self_gen_split, renewal_split, draw_amount, draw_start_date, draw_end_date, start_date")
          .order("first_name")
          .limit(1)
          .maybeSingle();
        setPreviewCloser((c ?? null) as MergeCloser | null);
      }
    } finally {
      setLoading(false);
    }
  }, [slug, isManager, doc]);

  useEffect(() => { void load(); }, [load]);

  // Does this viewer have commission terms of their own? `myCloserId` is the
  // closers row keyed to the signed-in user (getMyCloser → closers.user_id),
  // the same signal useCloserSplits() calls `hasCloser`. No row = a setter, who
  // has no split to be shown. Managers keep full visibility.
  //
  // Fail closed: while the row is still loading `myCloserId` is null, so the
  // restriction is ON until we have actually confirmed otherwise.
  const compRestricted = !isManager && !myCloserId && !!doc?.compensation;

  // What text do we show?
  const { body, mode, missing } = useMemo((): {
    body: string | null;
    mode: "frozen" | "preview" | "reference" | "restricted" | "none";
    missing: MissingField[];
  } => {
    if (!doc) return { body: null, mode: "none", missing: [] };

    // A compensation document, and this viewer has no commission terms. Nothing
    // is rendered — not the frozen copy, not the repo markdown, not a preview.
    // There is no redacted variant on purpose: the numbers ARE the document.
    if (compRestricted) return { body: null, mode: "restricted", missing: [] };

    // Reference docs. The SOP ships from the repo; the Comp Offer Sheet comes
    // from the DB. Both resolve BEFORE the merge preview so a reference doc is
    // never mistaken for a mergeable template.
    if (doc.body) return { body: doc.body, mode: "reference", missing: [] };
    if (doc.bodyFromDb && dbBody) return { body: dbBody, mode: "reference", missing: [] };

    // The signer's own frozen copy always wins.
    if (myRow?.merged_content) return { body: myRow.merged_content, mode: "frozen", missing: [] };

    // Manager preview. Reference docs are never merged — nobody signs them.
    if (isManager && !doc.bodyFromDb && template && previewCloser) {
      const res = mergeCloserDoc(template.slug, template.body_md, previewCloser, settings);
      return { body: res.content, mode: "preview", missing: res.missing };
    }
    return { body: null, mode: "none", missing: [] };
  }, [doc, myRow, isManager, template, previewCloser, settings, compRestricted, dbBody]);

  const status = (myRow?.status ?? "not_sent") as DocStatus;
  const canSign = !!myCloserId && doc?.delivery === "esign" && status === "sent" && !signature;
  const alreadySigned = !!signature;

  const doSign = async () => {
    if (!slug) return;
    setSigning(true);
    setSignError(null);
    try {
      const sig = await signDocument(slug, typedName);
      setSignature(sig);
      await load();
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Could not sign");
    } finally {
      setSigning(false);
    }
  };

  if (!doc) {
    return (
      <div className="p-6">
        <Link to="/admin/closer-docs" className="text-sm text-ocean-blue hover:underline">
          ← All closer documents
        </Link>
        <p className="mt-6 text-gray-500 dark:text-gray-400">Document not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <Link to="/admin/closer-docs" className="inline-flex items-center gap-1 text-sm text-ocean-blue hover:underline">
        <ArrowLeftIcon className="w-4 h-4" /> All closer documents
      </Link>

      {/* Header */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{doc.title}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{doc.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${ACTION_BADGE[doc.action]}`}>
            {ACTION_LABEL[doc.action]}
          </span>
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {DELIVERY_LABEL[doc.delivery]}
          </span>
          {myCloserId && (
            <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full ${STATUS_BADGE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500 font-mono">{doc.path}</p>

      {/* Non-e-sign handling note. Suppressed for a restricted viewer — it is
          instructions for handling a document they are not being shown. */}
      {doc.handling && mode !== "restricted" && (
        <div className="mt-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">{doc.handling}</p>
          {doc.externalUrl && (
            <a
              href={doc.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ocean-blue hover:underline"
            >
              Open the official form <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            </a>
          )}
        </div>
      )}

      {/* Preview banner (managers only) */}
      {mode === "preview" && (
        <div className="mt-5 rounded-xl border border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-4">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Preview — merged against {previewCloser?.first_name} {previewCloser?.last_name}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            This is what the document looks like once the closer&apos;s real numbers are filled in. Each closer gets their
            own merged copy when you send the package.
          </p>
          {missing.length > 0 && (
            <div className="mt-3 rounded-lg border-2 border-rose-400 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/25 p-3">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
                <div>
                  <p className="text-sm font-bold text-rose-900 dark:text-rose-100">
                    {missing.length} field{missing.length === 1 ? "" : "s"} still unfilled — this cannot be sent yet.
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {missing.map((m) => (
                      <li key={m.token} className="text-xs text-rose-800 dark:text-rose-200 flex gap-2">
                        <span className="opacity-60">▸</span>
                        <span>
                          <strong className="font-semibold">{m.label}</strong>
                          <span className="opacity-70">
                            {" "}— fix in {m.fix === "settings" ? "Company terms" : "the closer's record"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Frozen-copy note */}
      {mode === "frozen" && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
          <LockClosedIcon className="w-4 h-4 shrink-0 text-gray-400 mt-0.5" />
          <p className="text-xs text-gray-600 dark:text-gray-300">
            This is your copy, locked at the moment it was sent to you. It cannot change after you sign it.
            {myRow?.merged_sha256 && (
              <>
                {" "}
                <span className="font-mono opacity-70">sha256:{myRow.merged_sha256.slice(0, 16)}…</span>
              </>
            )}
          </p>
        </div>
      )}

      {/* The document */}
      {loading ? (
        <p className="mt-8 text-gray-400">Loading…</p>
      ) : body ? (
        <article className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <MarkdownDoc source={body} />
        </article>
      ) : mode === "restricted" ? (
        <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div className="flex items-start gap-3">
            <NoSymbolIcon className="w-5 h-5 shrink-0 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">
                This document isn&apos;t part of your role.
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                It sets out commission terms, which apply to commissioned closers only. If you think it should
                apply to you, ask your manager.
              </p>
            </div>
          </div>
        </div>
      ) : dbBodyError ? (
        // The read failed. Say that. An unreadable document must never look
        // like an empty one.
        <div className="mt-6 rounded-xl border-2 border-rose-400 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/25 p-6">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-rose-900 dark:text-rose-100">
                Couldn&apos;t load this document.
              </p>
              <p className="mt-1 text-sm text-rose-800 dark:text-rose-200">
                The text is stored in the database and the read failed — this is not an empty document.
                Try again; if it keeps failing, tell the owner.
              </p>
              <p className="mt-2 text-xs font-mono text-rose-700 dark:text-rose-300">{dbBodyError}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {doc.delivery === "esign"
              ? "This document hasn't been sent to you yet. When it is, your copy will appear here to read and sign."
              : "This document isn't rendered in the app — see the handling note above."}
          </p>
        </div>
      )}

      {/* Already signed */}
      {alreadySigned && signature && (
        <div className="mt-6 rounded-xl border-2 border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="w-6 h-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
                Signed by {signature.signer_name} on{" "}
                {new Date(signature.signed_at).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                Recorded against <span className="font-mono">sha256:{signature.content_sha256.slice(0, 16)}…</span>
                {signature.ip_address && <> · IP {signature.ip_address}</>}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sign */}
      {canSign && body && (
        <div className="mt-6 rounded-xl border-2 border-ocean-blue/50 bg-white dark:bg-gray-800 p-5">
          <h2 className="font-bold text-gray-900 dark:text-white">Sign this document</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Read the document above in full before you sign.
          </p>

          <label className="block mt-4">
            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Type your full legal name
            </span>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="input-field max-w-sm"
              placeholder="Your full legal name"
            />
          </label>

          <label className="flex items-start gap-2 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-ocean-blue focus:ring-ocean-blue"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">{CONSENT_TEXT}</span>
          </label>

          {signError && (
            <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{signError}</p>
          )}

          <button
            onClick={doSign}
            disabled={signing || !consented || typedName.trim().length < 2}
            className="btn-primary mt-4 disabled:opacity-50"
          >
            {signing ? "Signing…" : "Sign and submit"}
          </button>
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            We record your name, the time, your IP address, and a fingerprint of the exact document you agreed to.
          </p>
        </div>
      )}
    </div>
  );
}
