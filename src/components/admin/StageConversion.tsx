import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { FUND_ODDS } from "@/config/funnelOdds";

/**
 * MEASURED stage-to-stage conversion, shown next to the TARGET.
 *
 * The whole point of this component is to eventually retire the guesswork. The
 * forecast on Money in Play is weighted by FUND_ODDS, which are targets lifted from
 * CLAUDE.md's funnel — not history. This measures what actually happened so the owner
 * can see the drift and, once there's signal, replace the targets with the truth.
 *
 * WHERE THE HISTORY COMES FROM. There is no stage-history table in this database. I
 * checked: `activity_log` has 170 rows for deals but only 2 of them carry old_status/
 * new_status, so it records almost no stage transitions and cannot be used to
 * reconstruct a funnel. What DOES exist is a per-stage timestamp column on `deals`
 * (contacted_at, qualified_at, application_sent_at, docs_collected_at,
 * bank_statements_at, submitted_at, offer_received_at, offer_presented_at,
 * offer_accepted_at, funded_at). A non-null timestamp is durable proof the deal
 * reached that rung, and it survives the deal later dying — which is exactly what a
 * conversion denominator needs. That is the source of truth here.
 *
 * WHY "FURTHEST RUNG REACHED" AND NOT A RAW COLUMN COUNT. The timestamps are not
 * monotone in practice — today 8 deals have contacted_at but 10 have qualified_at and
 * 11 have application_sent_at, because a deal can be advanced without every earlier
 * stamp being written. Counting each column on its own would produce conversion rates
 * ABOVE 100%, which is nonsense. So each deal is reduced to the FURTHEST rung it can
 * be proven to have reached (the latest stamp it holds, or its current status,
 * whichever is further), and every earlier rung is credited. That makes the ladder
 * monotone by construction and the rates real.
 *
 * HONESTY RULES, enforced below, not just documented:
 *   - Every measured rate carries its sample size (n=).
 *   - Below MIN_RELIABLE_N the rate is NOT presented as a rate. It is suppressed and
 *     replaced with "n too small". A 1-of-1 conversion is not 100%; it is one event.
 *   - With zero funded deals, end-to-end fund rate is not measurable at all, and the
 *     component says so in plain language instead of rendering 0%.
 */

// Below this many deals ENTERING a rung, the observed rate is noise, not a rate.
// 20 is the point where a single deal moves the number by ≤5 points.
const MIN_RELIABLE_N = 20;

type Deal = {
  id: string;
  status: string;
  created_at: string | null;
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

/** The ladder. `mark` = durable proof the deal reached this rung. */
const RUNGS: {
  key: string;
  label: string;
  /** Statuses that mean "the deal is sitting on this rung right now". */
  statuses: string[];
  mark: (d: Deal) => boolean;
}[] = [
  { key: "new", label: "New", statuses: ["new"], mark: () => true },
  { key: "contacted", label: "Contacted", statuses: ["contacted"], mark: (d) => !!d.contacted_at },
  { key: "qualifying", label: "Qualifying", statuses: ["qualifying"], mark: (d) => !!d.qualified_at },
  {
    key: "application_sent",
    label: "Application sent",
    statuses: ["application_sent"],
    mark: (d) => !!d.application_sent_at,
  },
  {
    key: "docs_collected",
    label: "Docs collected",
    statuses: ["docs_collected", "bank_statements"],
    mark: (d) => !!d.docs_collected_at || !!d.bank_statements_at,
  },
  {
    key: "submitted_to_funder",
    label: "Submitted to funder",
    statuses: ["submitted_to_funder"],
    mark: (d) => !!d.submitted_at,
  },
  { key: "offer_received", label: "Offer received", statuses: ["offer_received"], mark: (d) => !!d.offer_received_at },
  {
    key: "offer_presented",
    label: "Offer presented",
    statuses: ["offer_presented"],
    mark: (d) => !!d.offer_presented_at,
  },
  { key: "offer_accepted", label: "Offer accepted", statuses: ["offer_accepted"], mark: (d) => !!d.offer_accepted_at },
  { key: "funded", label: "Funded", statuses: ["funded"], mark: (d) => !!d.funded_at },
];

const STATUS_TO_RUNG = new Map<string, number>();
RUNGS.forEach((r, i) => r.statuses.forEach((s) => STATUS_TO_RUNG.set(s, i)));

/**
 * The TARGET conversion for rung i → i+1, derived from the very odds the forecast
 * uses. P(fund | at rung i) = P(reach i+1 | at i) × P(fund | at i+1), so the implied
 * step target is odds[i] / odds[i+1]. This is not a second set of numbers to maintain
 * — it IS FUND_ODDS, read backwards, so the drift shown is drift against the forecast.
 * Neighbouring rungs the forecast assigns the same odds (docs/submitted, offer
 * received/presented) imply no step target at all; we return null rather than invent
 * a 100% target the model never claimed.
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
        "id, status, created_at, contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at",
      )
      .neq("deal_type", "vcf");
    setDeals((data ?? []) as unknown as Deal[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const calc = useMemo(() => {
    // Reduce each deal to the furthest rung it can be PROVEN to have reached, then
    // credit every rung below it. Monotone by construction — no >100% rates.
    const reached = new Array(RUNGS.length).fill(0);
    for (const d of deals) {
      let furthest = 0;
      for (let i = 0; i < RUNGS.length; i++) if (RUNGS[i].mark(d)) furthest = Math.max(furthest, i);
      const byStatus = STATUS_TO_RUNG.get(d.status);
      if (byStatus !== undefined) furthest = Math.max(furthest, byStatus);
      for (let i = 0; i <= furthest; i++) reached[i] += 1;
    }

    const steps = RUNGS.slice(0, -1).map((r, i) => {
      const n = reached[i]; // deals that ENTERED this rung — the denominator
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
      reached,
      steps,
      // Any rung at all with enough volume to trust a rate?
      anyReliable: steps.some((s) => s.reliable),
    };
  }, [deals]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Measured conversion vs target</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            What actually happened, next to what we assumed. Built from the stage timestamps on every deal ever created
            ({calc.total} MCA deals) — dead and nurture deals included, because they are the denominator.
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
              <b>End-to-end fund rate: not measurable.</b> <b>0</b> of <b>{calc.total}</b> deals have funded, so there is
              no observed conversion to report and nothing on this page can yet confirm or refute the funnel targets. The
              rates below are early stage-to-stage signal only. Every forecast in this app still rests on the{" "}
              <b>targets</b>, not on history.
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
              <th className="py-2 px-3 font-semibold text-right">Entered</th>
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
                        Math.abs(s.drift) < 0.1
                          ? "text-emerald-600 dark:text-emerald-400"
                          : s.drift < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-emerald-600 dark:text-emerald-400"
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
        {!calc.anyReliable && (
          <p className="text-amber-700 dark:text-amber-400">
            <b>Not one step yet clears n={MIN_RELIABLE_N}.</b> Every measured rate on this page is suppressed. Nothing
            here should be used to re-tune the funnel — it is a scoreboard waiting for a game.
          </p>
        )}
        <p>
          <b>Entered</b> counts the furthest rung each deal can be proven to have reached (its stage timestamps, or its
          current status if that's further), crediting all earlier rungs — so the ladder is monotone and rates can't
          exceed 100%. Raw timestamp columns are not monotone on their own.
        </p>
        <p>
          <b>Target</b> is the step implied by the funnel odds the forecast already uses (odds at this stage ÷ odds at
          the next). Steps the model gives identical odds show no target. <b>Drift</b> only appears once a step has
          n≥{MIN_RELIABLE_N}.
        </p>
        <p>
          <b>No stage-history table exists</b> in this database — <code>activity_log</code> records a status change on
          only 2 of its 170 deal rows — so this is reconstructed from the stage timestamps on <code>deals</code>. Stages
          reached before those columns were being written are invisible to it.
        </p>
      </div>
    </div>
  );
}
