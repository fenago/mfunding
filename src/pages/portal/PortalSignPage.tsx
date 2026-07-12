import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircleIcon,
  DocumentTextIcon,
  ArrowLeftIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/solid";
import {
  getMerchantDocument,
  signMerchantDocument,
  type MerchantDocument,
} from "../../services/portalService";

// This MUST match the consent sentence the sign-merchant-document edge function
// records server-side — what the merchant sees checking the box has to be what's
// legally captured. (Confirmed authoritative wording from w3-backend.)
const CONSENT_TEXT =
  "I have read this document in full and I agree to be bound by it. I intend my typed name below to be my legal electronic signature.";

function fmtDateTime(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Renders the frozen, server-merged document body. It's plain TEXT, so it
 *  renders as preformatted text — inherently safe, never raw HTML. */
function DocumentBody({ content }: { content: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-800 dark:text-gray-100">
      {content}
    </pre>
  );
}

export default function PortalSignPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  const [doc, setDoc] = useState<MerchantDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [typedName, setTypedName] = useState("");
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [justSigned, setJustSigned] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    let alive = true;
    setIsLoading(true);
    getMerchantDocument(documentId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        if (!d) setLoadError("We couldn't find this document.");
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : "Failed to load this document.");
      })
      .finally(() => alive && setIsLoading(false));
    return () => {
      alive = false;
    };
  }, [documentId]);

  const handleSign = async () => {
    if (!documentId || !typedName.trim() || !consent) return;
    setSigning(true);
    setSignError(null);
    try {
      await signMerchantDocument(documentId, typedName.trim(), consent);
      setJustSigned(true);
      // Refresh to pick up signed status/timestamp from the source of truth.
      const refreshed = await getMerchantDocument(documentId).catch(() => null);
      if (refreshed) setDoc(refreshed);
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "We couldn't record your signature. Please try again.");
    } finally {
      setSigning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  if (loadError || !doc) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-gray-600 dark:text-gray-300 font-medium">
            {loadError ?? "We couldn't find this document."}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            It may have been updated. Your specialist can send you a fresh link anytime.
          </p>
          <Link to="/portal" className="btn-primary mt-4 inline-flex">
            Back to your dashboard
          </Link>
        </div>
      </div>
    );
  }

  const isSigned = doc.status === "signed" || justSigned;
  const isVoid = doc.status === "void";
  const signedAt = fmtDateTime(doc.signed_at);
  const canSign = doc.status === "sent" && !justSigned;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back
      </button>

      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 bg-ocean-blue/10 rounded-lg flex-shrink-0">
          <DocumentTextIcon className="w-6 h-6 text-ocean-blue" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{doc.name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Please read this through, then add your signature below.
          </p>
        </div>
      </div>

      {/* Already signed */}
      {isSigned && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 p-4 flex items-start gap-3"
        >
          <CheckCircleIcon className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">
              Signed — you're all set.
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
              {signedAt ? `Signed ${signedAt}.` : "Your signature has been recorded."} A copy stays
              in your portal.
            </p>
          </div>
        </motion.div>
      )}

      {/* Void / expired */}
      {isVoid && !isSigned && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
          <p className="font-semibold text-gray-700 dark:text-gray-200">
            This document is no longer active.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Your specialist can send you an updated version if it's still needed.
          </p>
        </div>
      )}

      {/* Frozen document body */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="max-h-[55vh] overflow-y-auto p-5">
          <DocumentBody content={doc.merged_content} />
        </div>
      </div>

      {/* Signing footer */}
      {canSign && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <ShieldCheckIcon className="w-5 h-5 text-mint-green" />
            Your electronic signature is secure and legally recognized.
          </div>

          <div>
            <label
              htmlFor="legal-name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Type your full legal name
            </label>
            <input
              id="legal-name"
              type="text"
              autoComplete="name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="e.g. Jordan A. Rivera"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-mint-green"
            />
            {typedName.trim() && (
              <p className="mt-2 text-2xl text-gray-900 dark:text-white" style={{ fontFamily: "cursive" }}>
                {typedName.trim()}
              </p>
            )}
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-gray-300 text-mint-green focus:ring-mint-green flex-shrink-0"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">{CONSENT_TEXT}</span>
          </label>

          {signError && <p className="text-sm text-red-500">{signError}</p>}

          <button
            type="button"
            disabled={!typedName.trim() || !consent || signing}
            onClick={handleSign}
            className="w-full py-3 rounded-xl bg-mint-green text-white font-semibold hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {signing ? "Signing…" : "Sign this document"}
          </button>
        </div>
      )}
    </div>
  );
}
