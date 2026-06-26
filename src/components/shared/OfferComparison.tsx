import { TrophyIcon } from "@heroicons/react/24/solid";
import type { DealSubmissionWithLender } from "../../types/deals";

interface Props {
  submissions: DealSubmissionWithLender[];
  onAccept?: (submission: DealSubmissionWithLender) => void;
}

const OFFER_STATUSES = new Set(["offer_made", "approved", "offer_accepted", "funded"]);

/** Side-by-side comparison of the offers that came back, ranked best-first.
 * "Best" = lowest total payback (cheapest for the merchant); ties → lowest factor. */
export default function OfferComparison({ submissions, onAccept }: Props) {
  const offers = submissions
    .filter((s) => s.offer_amount != null || OFFER_STATUSES.has(s.status))
    .filter((s) => s.offer_amount != null);

  if (offers.length < 1) return null;

  const ranked = [...offers].sort((a, b) => {
    const pa = a.total_payback ?? (a.offer_amount ?? 0) * (a.factor_rate ?? 1);
    const pb = b.total_payback ?? (b.offer_amount ?? 0) * (b.factor_rate ?? 1);
    if (pa !== pb) return pa - pb;
    return (a.factor_rate ?? 99) - (b.factor_rate ?? 99);
  });
  const bestId = ranked[0]?.id;

  const fmt = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString()}`);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Offer Comparison</h3>
      <p className="text-xs text-gray-400 mb-4">{ranked.length} offer(s) — ranked by total payback (best for the merchant first).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
              <th className="py-2 pr-4">Funder</th>
              <th className="py-2 pr-4">Amount</th>
              <th className="py-2 pr-4">Factor</th>
              <th className="py-2 pr-4">Term</th>
              <th className="py-2 pr-4">Daily</th>
              <th className="py-2 pr-4">Total Payback</th>
              <th className="py-2 pr-4">Our Comm.</th>
              {onAccept && <th className="py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {ranked.map((s) => {
              const isBest = s.id === bestId;
              return (
                <tr key={s.id} className={`border-b border-gray-50 dark:border-gray-800 ${isBest ? "bg-emerald-50/60 dark:bg-emerald-900/15" : ""}`}>
                  <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                    <span className="inline-flex items-center gap-1">
                      {isBest && <TrophyIcon className="w-4 h-4 text-emerald-500" title="Best value" />}
                      {s.lender?.company_name ?? "Funder"}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{fmt(s.offer_amount)}</td>
                  <td className="py-2 pr-4">{s.factor_rate ?? "—"}</td>
                  <td className="py-2 pr-4">{s.term_months ? `${s.term_months} mo` : "—"}</td>
                  <td className="py-2 pr-4">{fmt(s.daily_payment)}</td>
                  <td className="py-2 pr-4 font-medium">{fmt(s.total_payback)}</td>
                  <td className="py-2 pr-4 text-gray-500">{fmt(s.commission_amount)}</td>
                  {onAccept && (
                    <td className="py-2">
                      <button
                        onClick={() => onAccept(s)}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-ocean-blue rounded-md hover:opacity-90"
                      >
                        Accept
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
