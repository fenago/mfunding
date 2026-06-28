import { useEffect, useState } from "react";
import { BuildingLibraryIcon, EnvelopeIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import {
  getFunderGuide, getProspects, commissionLabel, productLabels,
  type FunderGuideRow, type ProspectRow,
} from "../../services/funderGuideService";

// Static deal-routing cheat sheet (mirrors research/FUNDER_MASTER_REFERENCE.md §6).
const ROUTING: { scenario: string; send: string }[] = [
  { scenario: "Standard MCA ($25k+/mo, 12+ mo, 575+)", send: "United Capital Source, Corfin, GoKapital (shop 3–5)" },
  { scenario: "Lower credit / weaker file / higher position", send: "Corfin (to 4th pos, 520), Reliant → LCF overflow" },
  { scenario: "High-risk / declined-elsewhere MCA", send: "Reliant high-risk → The LCF Group" },
  { scenario: "LOC / Term / Equipment / SBA", send: "GoKapital, United Capital Source, Kapitus (when live)" },
  { scenario: "Real estate (fix-flip, rental, commercial, construction)", send: "GoKapital (only RE funder on roster)" },
  { scenario: "Startup / pre-revenue / 401k rollover", send: "Guidant Financial" },
  { scenario: "Over-leveraged / stacked / drowning in MCAs", send: "Value Capital Funding (/debt-relief)" },
];

const PACKET = [
  "Completed application (signed)",
  "Most recent bank statements — 3 mo min; 4 mo for UCS; 4–6 mo for GoKapital (PDF, all pages, unredacted)",
  "Owner's driver's license",
  "Voided business check / routing + account (name matches application)",
  "Subject line = exact legal or DBA business name",
  "CC your ISO rep",
];

function money(n: number | null) { return n == null ? "—" : `$${Number(n).toLocaleString()}`; }

export default function FunderGuidePage() {
  const [rows, setRows] = useState<FunderGuideRow[]>([]);
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { getFunderGuide().then(setRows).catch(() => setRows([])).finally(() => setLoading(false)); }, []);
  useEffect(() => { getProspects().then(setProspects).catch(() => setProspects([])); }, []);

  const prospectProducts = (p: ProspectRow) =>
    productLabels({ lender_types: p.lender_types, funding_products: null } as FunderGuideRow);
  const hostname = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return url ?? ""; } };

  const live = rows.filter((r) => r.status === "live_vendor");
  const pending = rows.filter((r) => r.status === "application_submitted");

  const Table = ({ list }: { list: FunderGuideRow[] }) => (
    <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
            <th className="py-3 px-4">Funder</th><th className="py-3 px-4">Products</th>
            <th className="py-3 px-4">Submit to</th><th className="py-3 px-4">Commission</th>
            <th className="py-3 px-4">Min criteria</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-b border-gray-50 dark:border-gray-800 align-top">
              <td className="py-3 px-4">
                <div className="font-medium text-gray-900 dark:text-white">{r.company_name}</div>
                {r.primary_contact_phone && <div className="text-xs text-gray-400">{r.primary_contact_phone}</div>}
              </td>
              <td className="py-3 px-4 text-gray-600 dark:text-gray-300">{productLabels(r)}</td>
              <td className="py-3 px-4">
                {r.submission_email
                  ? <a href={`mailto:${r.submission_email}`} className="inline-flex items-center gap-1 text-ocean-blue hover:underline"><EnvelopeIcon className="w-3.5 h-3.5" />{r.submission_email}</a>
                  : r.submission_portal_url
                    ? <a href={r.submission_portal_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ocean-blue hover:underline"><ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />Portal</a>
                    : <span className="text-gray-400">TBD on approval</span>}
                {r.submission_notes && <p className="text-xs text-gray-400 mt-1 max-w-md whitespace-pre-wrap line-clamp-3">{r.submission_notes}</p>}
              </td>
              <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{commissionLabel(r)}</td>
              <td className="py-3 px-4 text-xs text-gray-500">
                {r.min_credit_score != null && <div>{r.min_credit_score}+ FICO</div>}
                {r.min_monthly_revenue != null && <div>{money(r.min_monthly_revenue)}/mo</div>}
                {r.min_time_in_business != null && <div>{r.min_time_in_business}+ mo TIB</div>}
                {r.factor_rate_range && <div>factor {r.factor_rate_range}</div>}
                {r.min_credit_score == null && r.min_monthly_revenue == null && r.min_time_in_business == null && "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <BuildingLibraryIcon className="w-6 h-6 text-ocean-blue" /> Funder Submission Guide
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Who funds what + where to submit. Pulled live from the lender database.</p>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">🟢 Live funders — submit now</h2>
            <Table list={live} />
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">🟡 Pending (ISO application submitted)</h2>
            <Table list={pending} />
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">⚪ Prospects — apply pipeline ({prospects.length})</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Identified but not yet applied to. Apply, then move to "application submitted" in <span className="text-ocean-blue">/admin/lenders</span>.</p>
            <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="py-3 px-4">Funder</th><th className="py-3 px-4">Products</th>
                    <th className="py-3 px-4">Website</th><th className="py-3 px-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {prospects.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800 align-top">
                      <td className="py-2.5 px-4 font-medium text-gray-900 dark:text-white">{p.company_name}</td>
                      <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300">{prospectProducts(p)}</td>
                      <td className="py-2.5 px-4">
                        {p.website
                          ? <a href={p.website} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ocean-blue hover:underline"><ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />{hostname(p.website)}</a>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-gray-500 max-w-md line-clamp-2">{p.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Universal submission packet</h2>
          <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300 list-disc pl-5">
            {PACKET.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Deal-routing cheat sheet</h2>
          <div className="space-y-2 text-sm">
            {ROUTING.map((r) => (
              <div key={r.scenario} className="flex flex-col sm:flex-row sm:gap-3">
                <span className="text-gray-500 dark:text-gray-400 sm:w-1/2">{r.scenario}</span>
                <span className="text-gray-900 dark:text-white font-medium sm:w-1/2">→ {r.send}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <p className="text-xs text-gray-400">
        Full detail (GoKapital product catalog, VCF packets, commission ranges) is in <code>research/FUNDER_MASTER_REFERENCE.md</code>.
        Keep funder records current at <span className="text-ocean-blue">/admin/lenders</span>.
      </p>
    </div>
  );
}
