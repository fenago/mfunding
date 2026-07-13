import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { COMMISSION_DEFAULTS } from "@/types/commissions";
import type { Closer } from "@/types/commissions";
import { calculateCommission, splitForDeal } from "@/services/commissionService";
import { resolveCommissionLeadSource } from "@/types/commissions";

/**
 * Deals that actually funded, and what they actually paid.
 *
 * This is the only section on the page made of facts rather than forecasts — money
 * that landed, commission that is owed. It therefore must never be padded. There are
 * currently ZERO funded deals in the database, so the empty state below says exactly
 * that and explains what it means for the rest of the page. It does not render a table
 * of zeros (which reads like a bad month) and it does not render sample rows (which
 * would be a lie the owner might act on).
 *
 * SPLITS ARE READ, NOT ASSUMED. The closer's cut comes from splitForDeal() against the
 * closer's real row — company_lead_split / self_gen_split / renewal_split — and the
 * points from the deal's own is_renewal (8 new / 6 renewal). splitForDeal is the same
 * classifier the payout path uses, so what's shown here is what will actually be paid.
 * Deals with no assigned closer pay no closer commission; the company keeps the gross.
 */

type FundedDeal = {
  id: string;
  deal_number: string | null;
  status: string;
  amount_funded: number | null;
  funded_at: string | null;
  is_renewal: boolean | null;
  lead_source: string | null;
  assigned_closer_id: string | null;
  customer: { business_name: string | null } | null;
};

const usd = (n: number) => "$" + Math.round(n).toLocaleString();
const shortDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function FundedDeals() {
  const [deals, setDeals] = useState<FundedDeal[]>([]);
  const [closers, setClosers] = useState<Record<string, Closer>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: rows }, { data: closerRows }] = await Promise.all([
      supabase
        .from("deals")
        .select(
          "id, deal_number, status, amount_funded, funded_at, is_renewal, lead_source, assigned_closer_id, customer:customers!customer_id(business_name)",
        )
        .eq("status", "funded")
        .order("funded_at", { ascending: false }),
      supabase.from("closers").select("*"),
    ]);
    setDeals((rows ?? []) as unknown as FundedDeal[]);
    // deals.assigned_closer_id is a FK to profiles.id — a USER id, not closers.id.
    // Verified against the constraint; key the map by closers.user_id accordingly.
    const map: Record<string, Closer> = {};
    for (const c of (closerRows ?? []) as unknown as Closer[]) {
      if (c.user_id) map[c.user_id] = c;
    }
    setClosers(map);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    return deals.map((d) => {
      const funded = Number(d.amount_funded ?? 0);
      const isRenewal = !!d.is_renewal;
      const points = isRenewal ? COMMISSION_DEFAULTS.RENEWAL_POINTS : COMMISSION_DEFAULTS.NEW_DEAL_POINTS;
      const closer = d.assigned_closer_id ? closers[d.assigned_closer_id] : undefined;

      // The closer's ACTUAL rate for THIS deal's lead source — never a hardcoded 30%.
      const split = closer
        ? splitForDeal(closer, { isRenewal, leadSource: d.lead_source })
        : { splitPercentage: 0, splitLabel: "No closer assigned" };

      const calc = calculateCommission({
        amountFunded: funded,
        commissionPoints: points,
        closerId: d.assigned_closer_id ?? undefined,
        closerSplitPercentage: split.splitPercentage,
        leadSource: resolveCommissionLeadSource({ isRenewal, leadSource: d.lead_source }),
        isRenewal,
      });

      return {
        ...d,
        funded,
        points,
        closerName: closer ? `${closer.first_name} ${closer.last_name}` : null,
        splitPct: calc.closerSplitPercentage,
        splitLabel: split.splitLabel,
        gross: calc.grossCommission,
        closerCut: calc.closerAmount,
        company: calc.companyAmount,
      };
    });
  }, [deals, closers]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          funded: t.funded + r.funded,
          gross: t.gross + r.gross,
          closer: t.closer + r.closerCut,
          company: t.company + r.company,
        }),
        { funded: 0, gross: 0, closer: 0, company: 0 },
      ),
    [rows],
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <CheckCircleIcon className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Funded deals</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Money that landed and the commission it earned. {COMMISSION_DEFAULTS.NEW_DEAL_POINTS} points on new
              capital, {COMMISSION_DEFAULTS.RENEWAL_POINTS} on renewals — each closer's own split.
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-gray-400 hover:text-ocean-blue">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        /* The honest empty state. No zero-row table, no sample data. */
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 px-5 py-6">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">No funded deals yet.</h3>
          <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 max-w-2xl">
            Nothing has funded, so there is <b>no commission history</b> — not $0 of it, <i>none</i>. Every number
            elsewhere on this page and in Money in Play is therefore a <b>projection built on targets</b>, not a
            measurement of this business. The conversion table below says the same thing where it counts.
          </p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            The first funded deal turns this section into fact and gives the funnel its first real data point.{" "}
            <Link to="/admin/deals" className="underline font-semibold text-ocean-blue dark:text-mint-green">
              Go work the pipeline →
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label="Total funded" value={usd(totals.funded)} tone="text-gray-900 dark:text-white" />
            <Stat label="Gross commission" value={usd(totals.gross)} tone="text-ocean-blue dark:text-mint-green" />
            <Stat label="Closer commission" value={usd(totals.closer)} tone="text-amber-600 dark:text-amber-400" />
            <Stat label="Company net" value={usd(totals.company)} tone="text-emerald-600 dark:text-emerald-400" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3 font-semibold">Deal</th>
                  <th className="py-2 px-3 font-semibold">Merchant</th>
                  <th className="py-2 px-3 font-semibold">Funded</th>
                  <th className="py-2 px-3 font-semibold">Closer</th>
                  <th className="py-2 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2 px-3 font-semibold text-right">Gross</th>
                  <th className="py-2 px-3 font-semibold text-right">Closer cut</th>
                  <th className="py-2 pl-3 font-semibold text-right">Company net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 pr-3">
                      <Link
                        to={`/admin/deals/${r.id}`}
                        className="font-medium text-ocean-blue dark:text-mint-green hover:underline"
                      >
                        {r.deal_number ?? r.id.slice(0, 8)}
                      </Link>
                      {r.is_renewal && (
                        <span className="ml-1.5 rounded bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                          renewal · {r.points} pts
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-900 dark:text-white">{r.customer?.business_name ?? "—"}</td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {shortDate(r.funded_at)}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                      {r.closerName ?? <span className="text-gray-400">Unassigned</span>}
                      {r.closerName && (
                        <span className="ml-1 text-[10px] text-gray-400 tabular-nums">{r.splitPct}%</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-900 dark:text-white">{usd(r.funded)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-ocean-blue dark:text-mint-green">
                      {usd(r.gross)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {usd(r.closerCut)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {usd(r.company)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-bold">
                  <td className="py-2 pr-3 text-gray-900 dark:text-white" colSpan={4}>
                    {rows.length} funded deal{rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-gray-900 dark:text-white">
                    {usd(totals.funded)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-ocean-blue dark:text-mint-green">
                    {usd(totals.gross)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                    {usd(totals.closer)}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {usd(totals.company)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}
