import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { FUND_ODDS, MIN_RELIABLE_N } from "@/config/funnelOdds";

/**
 * MEASURED stage-to-stage conversion, shown next to the TARGET.
 *
 * The point of this component is to eventually retire the guesswork. The forecast on
 * Money in Play is weighted by FUND_ODDS, which are targets lifted from CLAUDE.md's
 * funnel — not history. This measures what actually happened so the owner can see the
 * drift and, once there's signal, replace the targets with the truth.
 *
 * WHERE THE HISTORY COMES FROM. `deals` carries a timestamp column per stage
 * (contacted_at, qualified_at, application_sent_at, … funded_at). A non-null timestamp
 * is durable proof the deal reached that rung, and it survives the deal later dying —
 * which is exactly what a conversion denominator needs. A DB trigger
 * (deals_stamp_stage_timestamps_trg) stamps the current stage and backfills every
 * earlier NULL stage on every status change, so the ladder is monotone at the source:
 * a deal can never hold a later stamp without the earlier ones. That means each column
 * can simply be COUNTED. No reconstruction, no inference — count(contacted_at),
 * count(qualified_at), and so on.
 *
 * TRUSTWORTHY IS NOT THE SAME AS SUFFICIENT. The data is now clean; there is still
 * almost none of it. Zero deals have funded. The honesty rules below are therefore
 * still enforced in code, not merely documented:
 *   - Every measured rate carries its sample size (n=).
 *   - Below MIN_RELIABLE_N a rate is NOT presented as a rate. It is suppressed and
 *     replaced with "n too small". A 1-of-1 conversion is not 100%; it is one event.
 *   - With zero funded deals, end-to-end fund rate is not measurable at all, and the
 *     component says so in plain language instead of rendering a 0% that looks like a
 *     finding.
 */

type Deal = {
  id: string;
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  offer_accepted_at: string | null;
  funded_at: string | null;
};

/** The ladder. `stamp` is the column whose non-null count IS the rung's population. */
const RUNGS: { key: string; label: string; stamp: keyof Deal | null }[] = [
  { key: "new", label: "New", stamp: null }, // every deal ever created
  { key: "contacted", label: "Contacted", stamp: "contacted_at" },
  { key: "qualifying", label: "Qualifying", stamp: "qualified_at" },
  { key: "application_sent", label: "Application sent", stamp: "application_sent_at" },
  { key: "docs_collected", label: "Docs collected", stamp: "docs_collected_at" },
  { key: "bank_statements", label: "Bank statements", stamp: "bank_statements_at" },
  { key: "submitted_to_funder", label: "Submitted to funder", stamp: "submitted_at" },
  { key: "offer_received", label: "Offer received", stamp: "offer_received_at" },
  { key: "offer_presented", label: "Offer presented", stamp: "offer_presented_at" },
  { key: "offer_accepted", label: "Offer accepted", stamp: "offer_accepted_at" },
  { key: "funded", label: "Funded", stamp: "funded_at" },
];

/**
 * The TARGET conversion for rung i → i+1, derived from the very odds the forecast
 * uses. P(fund | at rung i) = P(reach i+1 | at i) × P(fund | at i+1), so the implied
 * step target is odds[i] / odds[i+1]. This is not a second set of numbers to maintain
 * — it IS FUND_ODDS, read backwards, so the drift shown is drift against the forecast.
 * Neighbouring rungs the forecast assigns the same odds (docs/bank/submitted, offer
 * received/presented) imply no step target at all; we return null rather than invent a
 * 100% target the model never claimed.
 */
function stepTarget(i: number): number | null {
  const cur = FUND_ODDS[RUNGS[i].key];
  const next = RUNGS[i + 1].key === "funded" ? 1 : FUND_ODDS[RUNGS[i + 1].key];
  if (!cur || !next || cur === next) return null;
  return cur / next;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function StageConversion() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    // Every MCA deal ever created — including dead/nurture/declined ones. A deal that
    // died at "contacted" is precisely what makes the contacted→qualifying denominator
    // honest; excluding it would flatter every rate on this page.
    const { data } = await supabase
      .from("deals")
      .select(
        "id, contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at",
      )
      .neq("deal_type", "vcf");
    setDeals((data ?? []) as unknown as Deal[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const calc = useMemo(() => {
    // Straight column counts. The trigger guarantees monotonicity, so this is the
    // whole computation.
    const reached = RUNGS.map((r) => (r.stamp === null ? deals.length : deals.filter((d) => !!d[r.stamp!]).length));

    const steps = RUNGS.slice(0, -1).map((r, i) => {
      const n = reached[i]; // deals that reached this rung — the denominator
      const advanced = reached[i + 1];
      const target = stepTarget(i);
      const reliable = n >= MIN_RELIABLE_N;
      const measured = n > 0 ? advanced / n : null;
      return {
        key: r.key,
        from: r.label,
        to: RUNGS[i + 1].label,
        n,
        advanced,
        measured,
        reliable,
        target,
        // Drift is only meaningful when the sample can support a rate AND there's a
        // target to drift from.
        drift: reliable && measured !== null && target !== null ? measured - target : null,
      };
    });

    return {
      total: deals.length,
      funded: reached[RUNGS.length - 1],
      steps,
      // Any rung at all with enough volume to trust a rate?
      anyReliable: steps.some((s) => s.reliable),
      // Should never happen while the trigger is in place. If it ever does, the ladder
      // has regressed and the page must say so rather than quietly print >100%.
      broken: steps.some((s) => s.advanced > s.n),
    };
  }, [deals]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Measured conversion vs target</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            What actually happened, next to what we assumed. A direct count of the stage timestamps on every deal ever
            created ({calc.total} MCA deals) — dead and nurture deals included, because they are the denominator.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-gray-400 hover:text-ocean-blue">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* The headline: with zero funded deals, the one number everyone wants does not
          exist yet. Say it first, say it plainly, don't render a 0% that looks like a
          finding. */}
      <div
        className={`rounded-xl border px-4 py-3 mb-4 ${
          calc.funded === 0
            ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30"
            : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30"
        }`}
      >
        {calc.funded === 0 ? (
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900 dark:text-amber-200">
              <b>End-to-end fund rate: NOT MEASURABLE.</b> <b>0</b> of <b>{calc.total}</b> deals have funded, so there is
              no observed conversion to report and nothing on this page can yet confirm or refute the funnel targets.
              Every forecast in this app still rests on the <b>targets</b>, not on history.
              <div className="mt-1.5 text-[12px] text-amber-800 dark:text-amber-300/90">
                The stage timestamps are now <b>trustworthy</b> — a DB trigger stamps and backfills them, so the counts
                below are exact. <u>Trustworthy is not the same as sufficient.</u> The numbers are clean and{" "}
                <b>tiny</b>. Nothing here is yet real conversion data.
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-emerald-900 dark:text-emerald-200">
            <b>End-to-end fund rate:</b> <b>{pct(calc.funded / Math.max(calc.total, 1))}</b> — {calc.funded} funded of{" "}
            {calc.total} deals created (n={calc.total}).
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3 font-semibold">Step</th>
              <th className="py-2 px-3 font-semibold text-right">Reached</th>
              <th className="py-2 px-3 font-semibold text-right">Advanced</th>
              <th className="py-2 px-3 font-semibold text-right">Measured</th>
              <th className="py-2 px-3 font-semibold text-right">Target</th>
              <th className="py-2 pl-3 font-semibold text-right">Drift</th>
            </tr>
          </thead>
          <tbody>
            {calc.steps.map((s) => (
              <tr key={s.key} className="border-b border-gray-100 dark:border-gray-700/50">
                <td className="py-2 pr-3">
                  <span className="font-medium text-gray-900 dark:text-white">{s.from}</span>
                  <span className="text-gray-400 mx-1">→</span>
                  <span className="text-gray-600 dark:text-gray-300">{s.to}</span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">n={s.n}</td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{s.advanced}</td>

                {/* The rate — suppressed entirely when the sample can't carry it. */}
                <td className="py-2 px-3 text-right">
                  {s.n === 0 ? (
                    <span className="text-gray-400 dark:text-gray-500">no deals</span>
                  ) : !s.reliable ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400"
                      title={`${s.advanced} of ${s.n} advanced. Below n=${MIN_RELIABLE_N} this is not a reliable rate, so it is not shown as one.`}
                    >
                      n too small
                    </span>
                  ) : (
                    <span className="tabular-nums font-semibold text-gray-900 dark:text-white">{pct(s.measured!)}</span>
                  )}
                </td>

                <td className="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {s.target === null ? "—" : pct(s.target)}
                </td>

                <td className="py-2 pl-3 text-right">
                  {s.drift === null ? (
                    <span className="text-gray-400 dark:text-gray-500 text-[11px]">
                      {s.target === null ? "no target" : "—"}
                    </span>
                  ) : (
                    <span
                      className={`tabular-nums font-semibold ${
                        Math.abs(s.drift) < 0.1 || s.drift > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {s.drift > 0 ? "+" : ""}
                      {Math.round(s.drift * 100)} pts
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-gray-200 dark:border-gray-700 pt-3 text-[11px] text-gray-500 dark:text-gray-400">
        {calc.broken && (
          <p className="text-red-600 dark:text-red-400">
            <b>Ladder regression:</b> a later stage holds more deals than the stage before it. The stage-timestamp
            trigger is not doing its job — treat every number above as broken until that is fixed.
          </p>
        )}
        {!calc.anyReliable && (
          <p className="text-amber-700 dark:text-amber-400">
            <b>Not one step yet clears n={MIN_RELIABLE_N}.</b> Every measured rate on this page is suppressed. The data
            is clean, there just isn't enough of it — nothing here should be used to re-tune the funnel.
          </p>
        )}
        <p>
          <b>Reached</b> is a straight count of that stage's timestamp column. A DB trigger stamps the current stage and
          backfills every earlier one on each status change, so a deal can't hold a later stamp without the earlier ones
          — the ladder is monotone at the source and no rate can exceed 100%.
        </p>
        <p>
          <b>Target</b> is the step implied by the funnel odds the forecast already uses (odds at this stage ÷ odds at
          the next). Steps the model gives identical odds show no target. <b>Drift</b> only appears once a step has n≥
          {MIN_RELIABLE_N}.
        </p>
        <p>
          Stages a deal passed through <i>before</i> its stage-timestamp columns were being written are invisible here —
          the backfill repaired the ladder's shape, not history that was never recorded.
        </p>
      </div>
    </div>
  );
}
