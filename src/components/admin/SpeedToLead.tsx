import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, BoltIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { MIN_RELIABLE_N } from "@/config/funnelOdds";
import { dateTimeET } from "@/utils/time";

/**
 * SPEED TO LEAD — real-time appointment leads only.
 *
 * WHAT IS BEING MEASURED. A real-time lead (lead_source = 'realtime_appt') arrives with
 * a 5-minute clock: `first_call_due_at`. The SLA is judged on `first_attempt_at` — when
 * the closer first REACHED OUT — not on `contacted_at`, which is when the merchant
 * actually picked up. A closer who dials inside five minutes has done their job even if
 * the merchant lets it ring.
 *
 * WHY LIVE TRANSFERS ARE EXCLUDED, NOT COUNTED AS MISSES. On a live transfer the
 * merchant is already on the phone — there is nothing to be late for, so the DB leaves
 * `first_call_due_at` NULL. Folding those into the denominator would manufacture a miss
 * rate out of deals that never had a clock. They are excluded here and the exclusion is
 * stated on screen.
 *
 * THE ARITHMETIC IS THE DATABASE'S. `deal_sla_met(deals)` and
 * `deal_speed_to_lead_seconds(deals)` are IMMUTABLE SQL functions selected as PostgREST
 * computed columns, so this screen cannot drift from any other consumer of the same
 * rule.
 *
 * HONESTY. Sample sizes are shown on everything. Below MIN_RELIABLE_N the SLA
 * percentage is suppressed rather than rendered as a rate — with a handful of leads,
 * "60%" is three coin flips, not a benchmark. And a lead with no `first_attempt_at` is
 * NOT silently counted as a miss: it is reported separately, and split by whether the
 * merchant was reached anyway (attempt never stamped — an instrumentation gap, not a
 * blown SLA) or genuinely never worked.
 */

type SpeedDeal = {
  id: string;
  status: string;
  created_at: string | null;
  first_attempt_at: string | null;
  contacted_at: string | null;
  first_call_due_at: string | null;
  contact_attempts: number | null;
  callback_at: string | null;
  deal_sla_met: boolean | null;
  deal_speed_to_lead_seconds: number | null;
};

const SELECT =
  "id, status, created_at, first_attempt_at, contacted_at, first_call_due_at, contact_attempts, callback_at, deal_sla_met, deal_speed_to_lead_seconds";

/** 115 → "1m 55s". Seconds matter here; this is a five-minute clock. */
function dur(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m === 0 ? `${s}s` : `${m}m ${s % 60}s`;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "warn";
}) {
  const valueTone =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-gray-900 dark:text-white";
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueTone}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>
    </div>
  );
}

export default function SpeedToLead() {
  const [deals, setDeals] = useState<SpeedDeal[]>([]);
  const [liveTransfers, setLiveTransfers] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [rt, lt] = await Promise.all([
      supabase.from("deals").select(SELECT).eq("lead_source", "realtime_appt").neq("deal_type", "vcf"),
      supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("lead_source", "live_transfer")
        .neq("deal_type", "vcf"),
    ]);
    setDeals((rt.data ?? []) as unknown as SpeedDeal[]);
    setLiveTransfers(lt.count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const calc = useMemo(() => {
    const total = deals.length;
    const worked = deals.filter((d) => d.first_attempt_at); // has a first attempt = has a measurement
    const speeds = worked
      .map((d) => d.deal_speed_to_lead_seconds)
      .filter((s): s is number => typeof s === "number" && Number.isFinite(s));

    // SLA is only judged where the DB says it can be judged (clock exists AND worked).
    const judged = deals.filter((d) => d.deal_sla_met !== null);
    const met = judged.filter((d) => d.deal_sla_met === true).length;

    // No first_attempt_at → no SLA verdict. Do NOT call these misses. Split them.
    const unattempted = deals.filter((d) => !d.first_attempt_at);
    const reachedAnyway = unattempted.filter((d) => d.contacted_at).length; // attempt never stamped
    const untouched = unattempted.filter((d) => !d.contacted_at).length; // genuinely never worked

    // Deals with no clock at all shouldn't exist inside realtime_appt — flag if they do.
    const noClock = deals.filter((d) => !d.first_call_due_at).length;

    return {
      total,
      workedN: worked.length,
      median: median(speeds),
      avg: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
      judgedN: judged.length,
      met,
      slaReliable: judged.length >= MIN_RELIABLE_N,
      reachedAnyway,
      untouched,
      noClock,
      rows: [...worked].sort((a, b) => (b.first_attempt_at ?? "").localeCompare(a.first_attempt_at ?? "")).slice(0, 8),
    };
  }, [deals]);

  const thin = calc.judgedN < MIN_RELIABLE_N;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2">
          <BoltIcon className="w-5 h-5 text-mint-green flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Speed to lead — real-time leads</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              How fast a closer <b>reaches out</b> after a real-time lead lands, against the <b>5-minute</b> clock.
              Judged on the first attempt, not on whether the merchant picked up. {calc.total} real-time leads.
            </p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-gray-400 hover:text-ocean-blue">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Chips: what's in and what's out, before any number is read. */}
      <div className="flex flex-wrap gap-1.5 mb-4 text-[11px] font-semibold">
        <span className="rounded-md bg-ocean-blue/10 text-ocean-blue dark:bg-ocean-blue/20 dark:text-sky-300 px-2 py-0.5">
          realtime_appt · n={calc.total}
        </span>
        <span className="rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5">
          live transfers excluded · {liveTransfers} (no clock by design)
        </span>
        <span
          className={`rounded-md px-2 py-0.5 ${
            thin
              ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
              : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {thin ? `SLA % suppressed · n<${MIN_RELIABLE_N}` : `SLA % reportable · n=${calc.judgedN}`}
        </span>
      </div>

      {calc.workedN === 0 ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <b>Not enough data yet.</b> No real-time lead has a recorded first attempt, so speed to lead cannot be
            computed at all. This is <b>not</b> a 0% — it is an empty measurement.
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile
              label="Median speed to lead"
              value={dur(calc.median)}
              sub={`n=${calc.workedN} worked leads`}
              tone={calc.median !== null && calc.median <= 300 ? "good" : "warn"}
            />
            <Tile label="Average speed to lead" value={dur(calc.avg)} sub={`n=${calc.workedN} · skewed by outliers`} />
            <Tile
              label="SLA met (≤5 min)"
              value={calc.slaReliable ? `${Math.round((calc.met / calc.judgedN) * 100)}%` : "n too small"}
              sub={`${calc.met} of ${calc.judgedN} judged${calc.slaReliable ? "" : ` · need n≥${MIN_RELIABLE_N}`}`}
              tone={calc.slaReliable ? "neutral" : "warn"}
            />
            <Tile
              label="No attempt recorded"
              value={String(calc.untouched + calc.reachedAnyway)}
              sub={`${calc.untouched} never worked · ${calc.reachedAnyway} reached, attempt unstamped`}
              tone={calc.untouched > 0 ? "warn" : "neutral"}
            />
          </div>

          {thin && (
            <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 flex items-start gap-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900 dark:text-amber-200">
                <b>Not enough data yet — read the times, not the rate.</b> Only <b>{calc.judgedN}</b> real-time leads
                have both a clock and a recorded first attempt, so the SLA percentage is <b>suppressed</b> ({calc.met}{" "}
                of {calc.judgedN} met, which is an anecdote, not a rate). The median and average above are descriptive
                only. <u>Do not manage anyone against these numbers yet.</u>
              </div>
            </div>
          )}

          {calc.reachedAnyway > 0 && (
            <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              <b>{calc.reachedAnyway}</b> real-time lead{calc.reachedAnyway === 1 ? " was" : "s were"} reached
              (contacted_at is set) with <b>no first_attempt_at</b> — the outreach happened but was never stamped, so it
              can't be scored. Those are excluded from the SLA denominator rather than counted as misses. Until every
              attempt is stamped, the SLA sample will keep growing slower than the lead count.
            </p>
          )}
          {calc.noClock > 0 && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
              <b>{calc.noClock}</b> real-time lead{calc.noClock === 1 ? " has" : "s have"} no{" "}
              <code>first_call_due_at</code>. Real-time leads should always get a 5-minute clock — those are unscoreable.
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3 font-semibold">Lead arrived (ET)</th>
                  <th className="py-2 px-3 font-semibold">First attempt (ET)</th>
                  <th className="py-2 px-3 font-semibold text-right">Speed</th>
                  <th className="py-2 px-3 font-semibold text-right">Attempts</th>
                  <th className="py-2 pl-3 font-semibold text-right">SLA</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map((d) => (
                  <tr key={d.id} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                      {d.created_at ? dateTimeET(d.created_at) : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                      {d.first_attempt_at ? dateTimeET(d.first_attempt_at) : "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900 dark:text-white">
                      {dur(d.deal_speed_to_lead_seconds)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {d.contact_attempts ?? 0}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {d.deal_sla_met === null ? (
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">no clock</span>
                      ) : d.deal_sla_met ? (
                        <span className="inline-flex rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold">
                          met ✓
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 text-[11px] font-semibold">
                          missed ✗
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-3 space-y-1.5 border-t border-gray-200 dark:border-gray-700 pt-3 text-[11px] text-gray-500 dark:text-gray-400">
        <p>
          <b>Speed to lead</b> = <code>first_attempt_at</code> − <code>created_at</code>. <b>SLA met</b> ={" "}
          <code>first_attempt_at ≤ first_call_due_at</code> (the 5-minute deadline). Both come straight from the
          database functions, so this page and the closer's queue can never disagree.
        </p>
        <p>
          <b>Live transfers are excluded on purpose.</b> The merchant is already on the phone, so there is no clock and
          no way to be late. Counting them would invent a miss rate. All times are Eastern.
        </p>
      </div>
    </div>
  );
}
