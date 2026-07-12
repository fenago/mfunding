import { useState, useEffect } from "react";
import { PaperAirplaneIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import type { MerchantDocStatus } from "../../services/portalService";

interface SendForSignatureProps {
  dealId: string;
}

interface DocTemplate {
  id: string;
  name: string;
}

interface DealMerchantDoc {
  id: string;
  name: string;
  status: MerchantDocStatus;
  sent_at: string | null;
  signed_at: string | null;
}

const STATUS_CHIP: Record<MerchantDocStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  sent: { label: "Awaiting signature", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  signed: { label: "Signed", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  void: { label: "Void", className: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400" },
};

function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|relation .* does not exist/i.test(error.message || "")
  );
}

function fmtDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

/** Closer control to send a contract/agreement to the merchant for e-signature.
 *  Loads templates, fires the send-merchant-document edge fn, and lists the
 *  deal's existing merchant documents. Renders nothing if the feature's tables
 *  aren't deployed. */
export default function SendForSignature({ dealId }: SendForSignatureProps) {
  const [available, setAvailable] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [docs, setDocs] = useState<DealMerchantDoc[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [sent, setSent] = useState(false);

  const load = async () => {
    setIsLoading(true);
    const [tplRes, docRes] = await Promise.all([
      supabase.from("merchant_doc_templates").select("id, name").order("name"),
      supabase
        .from("merchant_documents")
        .select("id, name, status, sent_at, signed_at")
        .eq("deal_id", dealId)
        .order("sent_at", { ascending: false, nullsFirst: false }),
    ]);

    if (isTableMissing(tplRes.error) || isTableMissing(docRes.error)) {
      setAvailable(false);
      setIsLoading(false);
      return;
    }
    setTemplates((tplRes.data as DocTemplate[]) ?? []);
    setDocs((docRes.data as DealMerchantDoc[]) ?? []);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const send = async () => {
    if (!templateId) return;
    setBusy(true);
    setError(null);
    setMissing(null);
    setSent(false);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("send-merchant-document", {
        body: { deal_id: dealId, template_id: templateId },
      });
      if (fnError) {
        setError(fnError.message || "Couldn't send the document. Please try again.");
        return;
      }
      const result = data as { ok?: boolean; missing?: string[]; message?: string } | null;
      if (result && result.ok === false) {
        if (result.missing && result.missing.length > 0) {
          setMissing(result.missing);
        } else {
          setError(result.message || "Couldn't send the document. Please try again.");
        }
        return;
      }
      setSent(true);
      setTemplateId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the document. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <PencilSquareIcon className="w-5 h-5 text-gray-400" />
        Send for signature
      </h3>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={busy || templates.length === 0}
              className="flex-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 disabled:opacity-50"
            >
              <option value="">
                {templates.length === 0 ? "No templates available" : "Choose a document…"}
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={send}
              disabled={busy || !templateId}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-ocean-blue text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              {busy ? "Sending…" : "Send for signature"}
            </button>
          </div>

          {sent && (
            <p className="mt-3 text-sm text-green-600 dark:text-green-400">
              Sent — the merchant can now sign in their portal.
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          {missing && (
            <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                This document needs a few details filled in first:
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Existing documents for this deal */}
          {docs.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Documents on this deal
              </p>
              {docs.map((d) => {
                const chip = STATUS_CHIP[d.status] ?? STATUS_CHIP.draft;
                const stamp =
                  d.status === "signed" ? fmtDate(d.signed_at) : fmtDate(d.sent_at);
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{d.name}</p>
                      {stamp && (
                        <p className="text-xs text-gray-500">
                          {d.status === "signed" ? "Signed" : "Sent"} {stamp}
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full flex-shrink-0 ${chip.className}`}
                    >
                      {chip.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
