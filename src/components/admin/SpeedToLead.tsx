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
 * THE ARITHMETIC IS THE DATABASE'S — public.deal_speed_to_lead(uuid[]), which judges the
 * clock on public.deal_call_events, the canonical wavv + ghl + hand-logged union.
 *
 * ⚠ IT USED TO READ deals.first_attempt_at, WHICH IS BLIND TO WAVV — the dialer the
 * setters actually use — and is back-filled from contacted_at by the stage-timestamp
 * trigger. So this panel was judging setters on when the MERCHANT PICKED UP, or on a
 * stage move. Measured 2026-09-18: it branded dials of 28, 35, 105 and 111 SECONDS as
 * 12 minutes, 21.8 hours, 20.3 hours and 43.6 hours late. The headline barely moved
 * (54.2% -> 58.2%) because errors ran in both directions and cancelled; what was wrong
 * was fifteen individual judgements about named people's work, and nobody is managed
 * against the mean.
 *
 * TRI-STATE, BECAUSE A MISS IS AN ACCUSATION. A deal whose call history cannot be read
 * renders as `unverified` and NEVER as met and NEVER as missed. If the RPC itself fails,
 * EVERY row is unverified and the panel says so — it does not fall back to the blind
 * column, which would be the old bug returning silently.
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
  /** LEGACY, kept only to count how many verdicts the canonical rule corrects. */
  deal_sla_met: boolean | null;
  deal_speed_to_lead_seconds: number | null;
};

/** One row of public.deal_speed_to_lead(uuid[]) — the canonical judgement. */
type SpeedVerdict = {
  deal_id: string;
  first_attempt_at: string | null;
  first_attempt_source: "call" | "stamp" | null;
  speed_seconds: number | null;
  sla_verdict: "met" | "missed" | "no_clock" | "never_worked" | "unverified";
  verdict_basis: string | null;
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
  const [verdicts, setVerdicts] = useState<Map<string, SpeedVerdict>>(new Map());
  /** The canonical judgement could not be read. NOT the same as "no misses" —
   *  every row renders unverified and the panel says why. */
  const [verdictError, setVerdictError] = useState<string | null>(null);
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
    const rows = (rt.data ?? []) as unknown as SpeedDeal[];
    setDeals(rows);
    setLiveTransfers(lt.count ?? 0);

    // The canonical verdicts. On failure we keep NOTHING — falling back to the
    // blind computed columns would quietly restore the bug this panel exists to
    // have fixed, and it would look identical on screen.
    if (rows.length === 0) {
      setVerdicts(new Map());
      setVerdictError(null);
    } else {
      const { data, error } = await supabase.rpc("deal_speed_to_lead", {
        p_deal_ids: rows.map((d) => d.id),
      });
      if (error) {
        setVerdicts(new Map());
        setVerdictError(error.message);
      } else {
        setVerdicts(new Map(((data ?? []) as SpeedVerdict[]).map((v) => [v.deal_id, v])));
        setVerdictError(null);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const calc = useMemo(() => {
    const total = deals.length;
    const v = (d: SpeedDeal): SpeedVerdict | undefined => verdicts.get(d.id);
    /** UNREADABLE wins over everything. If the canonical judgement is missing —
     *  the RPC failed, or it returned no row for this deal — the verdict is
     *  `unverified`, never a fallback to the blind column. */
    const verdictOf = (d: SpeedDeal): SpeedVerdict["sla_verdict"] =>
      verdictError ? "unverified" : (v(d)?.sla_verdict ?? "unverified");

    const worked = deals.filter((d) => v(d)?.first_attempt_at);
    const speeds = worked
      .map((d) => v(d)?.speed_seconds)
      .filter((s): s is number => typeof s === "number" && Number.isFinite(s));

    const judged = deals.filter((d) => verdictOf(d) === "met" || verdictOf(d) === "missed");
    const met = deals.filter((d) => verdictOf(d) === "met").length;
    const unverified = deals.filter((d) => verdictOf(d) === "unverified").length;
    const untouched = deals.filter((d) => verdictOf(d) === "never_worked").length;
    const noClock = deals.filter((d) => verdictOf(d) === "no_clock").length;
    /** First attempt known only from the legacy stamp — the call mirror predates
     *  the lead, so its silence proves nothing. Shown, never hidden. */
    const fromStamp = deals.filter((d) => v(d)?.first_attempt_source === "stamp").length;

    // ── HOW MANY JUDGEMENTS THE CANONICAL RULE CORRECTS ────────────────────
    // The owner has read this panel before. A verdict that changes under him
    // has to arrive as an explained correction, not as a number that differs
    // from the one he remembers. Computed against the legacy columns still
    // selected above, purely so the delta can be named on screen.
    let flippedToMet = 0;
    let flippedToMiss = 0;
    for (const d of deals) {
      const now = verdictOf(d);
      if (d.deal_sla_met === false && now === "met") flippedToMet++;
      if (d.deal_sla_met === true && now === "missed") flippedToMiss++;
    }

    return {
      total,
      workedN: worked.length,
      median: median(speeds),
      avg: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
      judgedN: judged.length,
      met,
      slaReliable: judged.length >= MIN_RELIABLE_N,
      unverified,
      untouched,
      noClock,
      fromStamp,
      flippedToMet,
      flippedToMiss,
      verdictOf,
      v,
      rows: [...worked]
        .sort((a, b) => (v(b)?.first_attempt_at ?? "").localeCompare(v(a)?.first_attempt_at ?? ""))
        .slice(0, 8),
    };
  }, [deals, verdicts, verdictError]);

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

      {/* ── THE JUDGEMENT ITSELF IS UNREADABLE ───────────────────────────────
          If the canonical RPC fails there is no honest SLA on this screen. It
          does NOT fall back to the blind computed columns: that would restore
          the exact defect this panel was fixed for, and would look identical.
          Every badge below reads `unverified` while this is up. */}
      {verdictError && (
        <div className="mb-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-900 dark:text-red-200">
            <b>Speed to lead cannot be judged right now.</b> The canonical call history could not be read, so every
            lead below shows <b>unverified</b> — that is unreadable, <b>not</b> a clean sheet and <b>not</b> a wall of
            misses. Nobody should be managed on this panel until it clears.
            <div className="mt-1 text-[11px] opacity-80">{verdictError}</div>
          </div>
        </div>
      )}

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
              label="No verdict"
              value={String(calc.untouched + calc.unverified)}
              sub={`${calc.untouched} never worked · ${calc.unverified} unverifiable`}
              tone={calc.untouched > 0 || calc.unverified > 0 ? "warn" : "neutral"}
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

          {/* ── THE CORRECTION, NAMED ON SCREEN ──────────────────────────────
              The owner has read this panel before. A verdict that moves under
              him must arrive explained, not as a number that differs from the
              one he remembers. */}
          {(calc.flippedToMet > 0 || calc.flippedToMiss > 0) && (
            <div className="mt-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/30 px-4 py-3 text-sm text-sky-900 dark:text-sky-200">
              <b>
                {calc.flippedToMet + calc.flippedToMiss} verdict
                {calc.flippedToMet + calc.flippedToMiss === 1 ? "" : "s"} changed when this panel stopped judging on{" "}
                <code>first_attempt_at</code>.
              </b>{" "}
              That column is blind to WAVV — the dialer the setters actually use — and is back-filled from{" "}
              <code>contacted_at</code>, so it measured when the <i>merchant picked up</i>, or a stage move.{" "}
              {calc.flippedToMet > 0 && (
                <>
                  <b>{calc.flippedToMet}</b> lead{calc.flippedToMet === 1 ? " was" : "s were"} shown as missed and{" "}
                  {calc.flippedToMet === 1 ? "was" : "were"} answered inside the clock — dials of 28 and 35 seconds were
                  rendering as 12 minutes and 21.8 hours late.{" "}
                </>
              )}
              {calc.flippedToMiss > 0 && (
                <>
                  <b>{calc.flippedToMiss}</b> went the other way and had been flattered by the old column.{" "}
                </>
              )}
              The headline rate barely moves, because the two directions largely cancel — what was wrong was the
              per-lead judgements, and nobody is managed against an average.
            </div>
          )}

          {calc.fromStamp > 0 && (
            <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
              <b>{calc.fromStamp}</b> lead{calc.fromStamp === 1 ? "'s" : "s'"} first attempt is known only from{" "}
              <code>first_attempt_at</code>, with no mirrored call to corroborate it — these pre-date the WAVV mirror
              entirely. They are counted as attempts, not as misses: <b>the call mirror's silence about a call placed
              before it existed is not evidence that nobody dialled.</b>
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
                {calc.rows.map((d) => {
                  const ver = calc.v(d);
                  const verdict = calc.verdictOf(d);
                  return (
                  <tr key={d.id} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                      {d.created_at ? dateTimeET(d.created_at) : "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-600 dark:text-gray-300">
                      {ver?.first_attempt_at ? dateTimeET(ver.first_attempt_at) : "—"}
                      {ver?.first_attempt_source === "stamp" && (
                        <span
                          className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 cursor-help"
                          title="No mirrored call corroborates this — it comes from deals.first_attempt_at, and this lead pre-dates the WAVV mirror. Counted as an attempt because the mirror's silence about a call placed before it existed is not evidence that nobody dialled."
                        >
                          stamp only
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-gray-900 dark:text-white">
                      {dur(ver?.speed_seconds ?? null)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {d.contact_attempts ?? 0}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {/* TRI-STATE. `unverified` is never a miss and never a met —
                          a red badge here is an accusation about a named person's
                          response time and has to clear the same bar as any other
                          claim this app makes. */}
                      {verdict === "no_clock" ? (
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">no clock</span>
                      ) : verdict === "unverified" ? (
                        <span
                          className="inline-flex rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 text-[11px] font-semibold cursor-help"
                          title={verdictError
                            ? `The canonical call history could not be read, so this lead cannot be judged either way. This is unreadable, NOT a met and NOT a miss. ${verdictError}`
                            : (ver?.verdict_basis ?? "This lead's call history cannot be read, so it is not judged either way.")}
                        >
                          unverified
                        </span>
                      ) : verdict === "never_worked" ? (
                        <span
                          className="inline-flex rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[11px] font-semibold cursor-help"
                          title={ver?.verdict_basis ?? "No dial on record from any source since this lead arrived."}
                        >
                          never worked
                        </span>
                      ) : verdict === "met" ? (
                        <span
                          className="inline-flex rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold cursor-help"
                          title={ver?.verdict_basis ?? ""}
                        >
                          met ✓
                        </span>
                      ) : (
                        <span
                          className="inline-flex rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 text-[11px] font-semibold cursor-help"
                          title={ver?.verdict_basis ?? ""}
                        >
                          missed ✗
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-3 space-y-1.5 border-t border-gray-200 dark:border-gray-700 pt-3 text-[11px] text-gray-500 dark:text-gray-400">
        <p>
          <b>Speed to lead</b> = the first dial on record − <code>created_at</code>, judged by{" "}
          <code>deal_speed_to_lead()</code> against <code>deal_call_events</code> — the canonical WAVV + GHL +
          hand-logged union — so it sees the dialer the setters actually use. Only calls{" "}
          <b>at or after the lead arrived</b> count; the call window otherwise reaches back into the merchant's earlier
          history, and 18 of these leads have a call up to 41 days before they existed.
        </p>
        <p>
          <b>Live transfers are excluded on purpose.</b> The merchant is already on the phone, so there is no clock and
          no way to be late. Counting them would invent a miss rate. All times are Eastern.
        </p>
      </div>
    </div>
  );
}
