import { useEffect, useMemo, useState } from "react";
import { ClipboardDocumentIcon, CheckIcon, DocumentTextIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CHANNEL_META, type Campaign } from "@/services/campaignService";
import {
  generateEmailQualityReport,
  ATTENTION_THRESHOLD_PCT,
  type EmailQualityReport,
} from "@/services/reports/emailQualityReport";

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const inputCls =
  "px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

export default function EmailQualityReportPanel({ campaigns }: { campaigns: Campaign[] }) {
  // Vendor scope = campaigns.partner (campaigns aren't formally linked to marketing_vendors —
  // vendor_id is null — so we group by the partner text the campaign already carries).
  const vendors = useMemo(() => {
    const set = new Map<string, number>();
    for (const c of campaigns) set.set(c.partner, (set.get(c.partner) ?? 0) + 1);
    return [...set.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  }, [campaigns]);

  const [vendor, setVendor] = useState<string>(vendors[0] ?? "");
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [addressee, setAddressee] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<EmailQualityReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "html" | "text">(null);

  const vendorCampaigns = useMemo(
    () => campaigns.filter((c) => c.partner === vendor),
    [campaigns, vendor],
  );

  // Default the vendor once campaigns arrive; keep the segment multi-select in sync
  // with the vendor — every one of that vendor's campaigns checked by default.
  useEffect(() => {
    if (!vendor && vendors.length) setVendor(vendors[0]);
  }, [vendors, vendor]);
  useEffect(() => {
    setSelected(new Set(vendorCampaigns.map((c) => c.id)));
    setReport(null);
  }, [vendor]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    setCopied(null);
    try {
      const picked = vendorCampaigns.filter((c) => selected.has(c.id));
      const r = await generateEmailQualityReport({
        vendor,
        campaigns: picked.map((c) => ({ id: c.id, code: c.code, name: c.name, channel: c.channel })),
        from,
        to,
        addresseeFirstName: addressee,
      });
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  async function copyForEmail() {
    if (!report) return;
    try {
      // Write BOTH flavors so a Gmail paste keeps the tables, and a plain editor still works.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([report.html], { type: "text/html" }),
            "text/plain": new Blob([report.text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(report.text);
      }
      flash("html");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clipboard copy failed");
    }
  }
  async function copyPlain() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      flash("text");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clipboard copy failed");
    }
  }
  function flash(which: "html" | "text") {
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
  }

  const canGenerate = vendor && selected.size > 0 && from <= to && !generating;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Vendor
            <select className={`mt-1 block ${inputCls}`} value={vendor} onChange={(e) => setVendor(e.target.value)}>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            From (lead date)
            <input type="date" className={`mt-1 block ${inputCls}`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            To (lead date)
            <input type="date" className={`mt-1 block ${inputCls}`} value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Addressee first name <span className="text-gray-400">(optional)</span>
            <input
              className={`mt-1 block ${inputCls}`}
              placeholder="e.g. Kyle — blank = no greeting"
              value={addressee}
              onChange={(e) => setAddressee(e.target.value)}
            />
          </label>
        </div>

        {/* Segments (campaigns) */}
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Campaigns to segment by ({selected.size} of {vendorCampaigns.length})</div>
          {vendorCampaigns.length === 0 ? (
            <p className="text-sm text-gray-400">No campaigns for this vendor.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {vendorCampaigns.map((c) => {
                const meta = CHANNEL_META[c.channel] ?? CHANNEL_META.other;
                const on = selected.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      on
                        ? "border-ocean-blue bg-ocean-blue/5 text-gray-900 dark:text-white"
                        : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {on ? <CheckIcon className="w-3.5 h-3.5 text-ocean-blue" /> : <span className="w-3.5 h-3.5 rounded border border-gray-300 dark:border-gray-600" />}
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${meta.chip}`}>{meta.short}</span>
                    <span className="font-mono">{c.code ?? c.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={!canGenerate} className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
            <DocumentTextIcon className="w-4 h-4" /> {generating ? "Generating…" : "Generate report"}
          </button>
          {report && (
            <>
              <button onClick={copyForEmail} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                {copied === "html" ? <><CheckIcon className="w-4 h-4 text-emerald-500" /> Copied ✓</> : <><ClipboardDocumentIcon className="w-4 h-4" /> Copy for email</>}
              </button>
              <button onClick={copyPlain} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                {copied === "text" ? <><CheckIcon className="w-4 h-4 text-emerald-500" /> Copied ✓</> : <><ClipboardDocumentIcon className="w-4 h-4" /> Copy as plain text</>}
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
      </div>

      {/* Output — rendered on a white card so it reads as an email preview in both themes */}
      {report && (
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400 mb-1.5">
            <span>Preview — this is exactly what "Copy for email" pastes.</span>
            {report.segments.map((s) => (
              <span key={s.campaignId} className={s.verdict === "attention" && s.total > 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>
                {s.code ?? s.name}: {s.total} leads · {s.hardBadPct == null ? "—" : `${s.hardBadPct.toFixed(s.hardBadPct < 10 ? 1 : 0)}%`} hard-bad
              </span>
            ))}
            <span className="text-gray-400">(healthy ≤ {ATTENTION_THRESHOLD_PCT}%)</span>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-5 overflow-x-auto">
            <div dangerouslySetInnerHTML={{ __html: report.html }} />
          </div>
        </div>
      )}
    </div>
  );
}
