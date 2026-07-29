import { useCallback, useEffect, useState } from "react";
import {
  ArrowPathIcon, BuildingLibraryIcon, CheckCircleIcon, ClipboardDocumentIcon,
  ExclamationTriangleIcon, KeyIcon,
} from "@heroicons/react/24/outline";
import {
  getPlaidStatus, getPlaidLiveCounts, getPlaidRemediation, savePlaidStatus,
  PLAID_PRODUCTS, PRODUCT_STATUS_CYCLE, PRODUCT_STATUS_LABEL,
  type PlaidStatus, type PlaidRuntime, type PlaidLiveCounts, type PlaidRemediationItem,
  type ProductStatus, type ProductRecord,
} from "../../../services/plaidStatusService";

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const CHIP_CLS: Record<ProductStatus, string> = {
  enabled: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  not_requested: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  not_eligible: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 line-through",
};

const PLAID_LINKS = [
  { label: "API keys", url: "https://dashboard.plaid.com/developers/keys" },
  { label: "Products", url: "https://dashboard.plaid.com/developers/products" },
  { label: "Compliance center", url: "https://dashboard.plaid.com/settings/compliance" },
];

// Policy docs live in the repo — shown as copyable paths (no live file access from the UI).
const POLICY_DOCS = [
  "docs/policies/information-security-policy.md",
  "docs/policies/access-control-policy.html",
  "docs/policies/data-retention-and-disposal-policy.md",
  "docs/policies/mfa-implementation-evidence.html",
];

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-ocean-blue transition-colors group"
      title="Copy path"
    >
      <ClipboardDocumentIcon className="w-4 h-4 text-gray-400 group-hover:text-ocean-blue shrink-0" />
      <code className="text-xs text-gray-700 dark:text-gray-300 break-all">{path}</code>
      {copied && <span className="ml-auto text-xs text-emerald-600 dark:text-emerald-400">copied</span>}
    </button>
  );
}

export default function PlaidStatusPanel() {
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [runtime, setRuntime] = useState<PlaidRuntime | null>(null);
  const [counts, setCounts] = useState<PlaidLiveCounts | null>(null);
  const [remediation, setRemediation] = useState<PlaidRemediationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ status: s, runtime: r }, c, rem] = await Promise.all([
        getPlaidStatus(),
        getPlaidLiveCounts().catch(() => null),
        getPlaidRemediation().catch(() => []),
      ]);
      setStatus(s);
      setRuntime(r);
      setCounts(c);
      setRemediation(rem);
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Persist a mutated status object (used by every inline edit).
  const persist = async (next: PlaidStatus) => {
    setStatus(next);
    setSaving(true);
    setMessage(null);
    try {
      await savePlaidStatus(next);
      setMessage({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      refresh(); // reload the truth on failure
    } finally {
      setSaving(false);
    }
  };

  const cycleProduct = (id: string) => {
    if (!status) return;
    const cur = (status.products[id]?.status ?? "not_requested") as ProductStatus;
    const nextStatus = PRODUCT_STATUS_CYCLE[(PRODUCT_STATUS_CYCLE.indexOf(cur) + 1) % PRODUCT_STATUS_CYCLE.length];
    const rec: ProductRecord = { status: nextStatus, date: new Date().toISOString().slice(0, 10) };
    persist({ ...status, products: { ...status.products, [id]: rec } });
  };

  const setProductDate = (id: string, date: string) => {
    if (!status) return;
    const cur = status.products[id] ?? { status: "not_requested" as ProductStatus, date: null };
    persist({ ...status, products: { ...status.products, [id]: { ...cur, date: date || null } } });
  };

  const markKeysRotated = () => {
    if (!status) return;
    persist({ ...status, keys_rotated_at: new Date().toISOString() });
  };

  const clearKeysRotated = () => {
    if (!status) return;
    persist({ ...status, keys_rotated_at: null });
  };

  if (loading && !status) {
    return <Card title="Plaid Integration Status"><p className="text-sm text-gray-400">Loading…</p></Card>;
  }
  if (!status) return null;

  const keysPending = !status.keys_rotated_at;

  return (
    <Card
      title="Plaid Integration Status"
      action={
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-gray-400">Saving…</span>}
          {message && (
            <span className={`text-xs ${message.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{message.text}</span>
          )}
          <button onClick={refresh} disabled={loading}
            className="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 inline-flex items-center gap-1.5">
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      }
    >
      {/* Key-rotation banner */}
      {keysPending && (
        <div className="mb-5 flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <KeyIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <div className="font-medium">API keys were shared via chat (7/28) — rotate them.</div>
            <div className="mt-0.5">
              Rotate at <a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer" className="underline">dashboard.plaid.com/developers/keys</a>, update the vault, then mark done.
            </div>
            <button onClick={markKeysRotated} disabled={saving}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-60">
              Mark keys rotated
            </button>
          </div>
        </div>
      )}
      {!keysPending && (
        <div className="mb-5 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircleIcon className="w-5 h-5" />
          Keys rotated {new Date(status.keys_rotated_at as string).toLocaleDateString()}.
          <button onClick={clearKeysRotated} className="text-xs text-gray-400 underline hover:text-gray-600">reset</button>
        </div>
      )}

      {/* Environment + live counts */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6 text-sm">
        <div>
          <div className="text-gray-400">Environment</div>
          <div className="text-gray-900 dark:text-white font-semibold capitalize inline-flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${runtime?.environment === "production" ? "bg-emerald-500" : "bg-amber-500"}`} />
            {runtime?.environment ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-gray-400 inline-flex items-center gap-1"><BuildingLibraryIcon className="w-4 h-4" /> Connected banks</div>
          <div className="text-gray-900 dark:text-white font-semibold">{counts?.connectedBanks ?? 0}<span className="text-gray-400 font-normal text-xs"> ({counts?.activeBanks ?? 0} active)</span></div>
        </div>
        <div>
          <div className="text-gray-400">Transactions pulled</div>
          <div className="text-gray-900 dark:text-white font-semibold">{counts?.transactionsPulled ?? 0}</div>
        </div>
        <div>
          <div className="text-gray-400">Statement PDFs</div>
          <div className="text-gray-900 dark:text-white font-semibold">{counts?.statementDocs ?? 0}</div>
        </div>
        <div>
          <div className="text-gray-400">Last webhook</div>
          <div className="text-gray-900 dark:text-white font-semibold">{counts?.lastWebhookAt ? new Date(counts.lastWebhookAt).toLocaleString() : "—"}</div>
        </div>
      </div>

      {/* Per-product status — click a chip to cycle, edit the date inline */}
      <div className="mb-6">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          Products <span className="font-normal">— click a status to cycle it; dates are “as recorded”.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {PLAID_PRODUCTS.map((p) => {
                const rec = (status.products[p.id] ?? { status: "not_requested", date: null }) as ProductRecord;
                return (
                  <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <td className="py-2 pr-4 text-gray-700 dark:text-gray-300 w-40">{p.label}</td>
                    <td className="py-2 pr-4">
                      <button onClick={() => cycleProduct(p.id)} disabled={saving}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${CHIP_CLS[rec.status]} disabled:opacity-60`}
                        title="Click to change status">
                        {PRODUCT_STATUS_LABEL[rec.status]}
                      </button>
                    </td>
                    <td className="py-2">
                      <input type="date" value={rec.date ?? ""} onChange={(e) => setProductDate(p.id, e.target.value)}
                        className="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {status.statements_price_note && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{status.statements_price_note}</p>
        )}
      </div>

      {/* Remediation deadlines */}
      {remediation.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Remediation attestations</div>
          <div className="space-y-1.5">
            {remediation.map((r) => (
              <div key={r.id} className="flex items-start gap-2 text-sm">
                {r.status === "done"
                  ? <CheckCircleIcon className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  : <ExclamationTriangleIcon className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
                <span className="text-gray-700 dark:text-gray-300">{r.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">Managed on the <a href="/admin/rnd" className="underline">R&amp;D board</a> (section: Plaid).</p>
        </div>
      )}

      {/* Notes */}
      {status.notes && (
        <div className="mb-6">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</div>
          <textarea
            value={status.notes}
            onChange={(e) => setStatus({ ...status, notes: e.target.value })}
            onBlur={() => persist(status)}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ocean-blue/40"
          />
        </div>
      )}

      {/* Links + policy docs */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Plaid dashboard</div>
          <div className="flex flex-wrap gap-2">
            {PLAID_LINKS.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                className="px-2.5 py-1.5 text-xs font-medium text-ocean-blue border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Policy docs (repo paths)</div>
          <div className="space-y-1.5">
            {POLICY_DOCS.map((p) => <CopyPath key={p} path={p} />)}
          </div>
        </div>
      </div>
    </Card>
  );
}
