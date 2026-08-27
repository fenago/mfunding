// Dial Ceiling — how much of the shift is actually spent dialing, and how much
// of the "talking" is real.
//
// WHY THIS TAB EXISTS. Every other tab on Setter Performance counts DIALS. Dials
// alone cannot separate the two very different reasons one setter out-dials
// another:
//   • PACE   — how fast they dial while they are dialing, and
//   • OCCUPANCY — how much of the logged shift they were dialing at all.
// Those come apart constantly: two setters can hold an identical pace and still
// end the week hundreds of dials apart because one of them was idle inside the
// shift. That is a coaching problem with a completely different fix from "dial
// faster", so this tab puts the two side by side and refuses to blend them.
//
// ── WHERE THE NUMBERS COME FROM ──────────────────────────────────────────────
// Two RPCs, both range-scoped by the page's own date picker:
//   • setter_dial_ceiling(p_from, p_to)        — one row per LINE
//   • setter_dial_ceiling_daily(p_from, p_to)  — one row per LINE per day
// Everything rendered here is a column those functions return. NOTHING is
// re-derived in the browser, so this panel cannot drift from the aggregate.
//
// ── WHAT THE SHIFT COLUMNS ACTUALLY MEAN ─────────────────────────────────────
// These are NOT the time clock. There is no join to time_entries anywhere in
// either function. Per line per Eastern day, the RPC measures:
//   • logged_hours   = FIRST dial → LAST dial. The dialing window, not a shift.
//   • idle_hours     = the sum of gaps longer than 5 minutes inside that window.
//   • dialing_hours  = the window minus that idle.
//   • gaps_over_15min = how many of those gaps ran past 15 minutes.
// The consequence is stated in the UI and matters for reading the number: the
// window STARTS at the first dial, so time before the first dial and after the
// last one is invisible to idle_pct. A late start therefore does not raise idle%
// — it shortens the window. That is what typical_start_et is doing on the hero
// card, and why it must be read next to the idle share, never instead of it.
//
// ── THESE ROWS ARE LINES, AND LINES ARE SHARED ───────────────────────────────
// Both functions group by caller_id and hang the mapped setter's name on the
// group. That is the same caveat Talk Time carries and for the same measured
// reason: the outbound numbers are dialed by more than one seat at once, and
// WAVV's call object has no per-agent field to fall back on. So a row is a LINE
// wearing whoever the Numbers tab mapped it to — good enough to coach a line, and
// not proof about one person's hands when a line is shared.
//
// ── THE HONESTY RULES THIS PANEL OBEYS ───────────────────────────────────────
// 1. UNREADABLE IS NOT ZERO. A failed RPC leaves the rows NULL and renders an
//    error. A setter who did not dial and a setter we could not read are never
//    drawn the same way.
// 2. TALK TIME AND THE HUMAN FLAG ARE CONTAMINATED, and this panel says so out
//    loud rather than quietly ranking on them. WAVV flags voicemails as human
//    and those "calls" run long, so raw talk time and human_pct both reward
//    blasting voicemails. DISPOSITIONS are the honest conversation signal —
//    a setter can only pick "Interested / Not Interested / Appointment Set /
//    Callback / Full Application / Do Not Contact" after speaking to a person.
// 3. A LOW DISPOSITION RATE IS AMBIGUOUS, and the panel states the ambiguity:
//    it can mean "not talking to anyone" OR "talking and not logging it". The
//    two need opposite coaching, so the UI must not pick one silently.
// 4. NO INVENTED PEOPLE. setter_name can be null (a closer session cannot read
//    profiles). The row then falls back to the line's admin label, then to the
//    number itself — never to a guessed person.
// 4b. THE AMBIGUITY IN (3) HAS A TELL, and the panel shows it rather than
//    leaving the manager to guess. NEGATIVES are the hardest disposition to fake
//    and the easiest to skip — nobody forgets to log an appointment, but "Not
//    Interested" often goes unrecorded. So a setter whose negatives-per-positive
//    ratio is far below a peer's on the same list is logging SELECTIVELY, and
//    their conversation count is under-reported rather than low. The ratio is a
//    peer COMPARISON, not a threshold, so it is never coloured.
// 4c. SMALL NUMBERS ARE NOT RANKINGS. Appointments and positives run in single
//    digits, so every per-dial rate here is drawn WITH the count behind it and
//    flagged below LOW_N. Nothing computes a multiplier between setters: "4×
//    better" off six events is a coin flip wearing a suit. The honest phrasing,
//    used in the copy, is "at least as good on far fewer dials".
// 5. GREY, NEVER GREEN, WITHOUT A THRESHOLD. Bands on this tab are BUILT-IN
//    starting points unless the owner has stored one, and a built-in band is
//    marked with a · so a tuned threshold is distinguishable from a guessed one.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  ScaleIcon,
} from "@heroicons/react/24/outline";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import supabase from "@/supabase";

// ── Contract ─────────────────────────────────────────────────────────────────
// Exactly the columns setter_dial_ceiling / setter_dial_ceiling_daily return.
// Every numeric is typed `unknown` at the wire and coerced through num(): a
// Postgres numeric arrives as a STRING over PostgREST, and `Number(null)` is 0,
// which is precisely the lie this page exists to avoid.
interface CeilingRowRaw {
  setter_id: string | null;
  setter_name: string | null;
  caller_id: string | null;
  caller_label: string | null;
  dials: unknown;
  days_worked: unknown;
  logged_hours: unknown;
  dialing_hours: unknown;
  idle_hours: unknown;
  idle_pct: unknown;
  gaps_over_15min: unknown;
  typical_start_et: string | null;
  typical_end_et: string | null;
  dials_per_dialing_hour: unknown;
  connect_pct: unknown;
  human_pct: unknown;
  human_calls: unknown;
  dispositioned: unknown;
  disposition_rate: unknown;
  appts: unknown;
  positives: unknown;
  positives_per_1000: unknown;
  dials_per_appt: unknown;
  median_dispositioned_secs: unknown;
  avg_appt_secs: unknown;
  voicemail_secs: unknown;
  connected_secs: unknown;
  voicemail_pct_of_talk: unknown;
  agent_canceled: unknown;
  agent_canceled_pct: unknown;
  // Beyond the original contract, but returned by the deployed function — the
  // rejection side of the same conversations, which is the other half of "what
  // came of the talking".
  negatives: unknown;
  neg_pos_ratio: unknown;
}

interface CeilingDayRaw {
  day: string | null;
  setter_id: string | null;
  setter_name: string | null;
  caller_id: string | null;
  dials: unknown;
  dialing_hours: unknown;
  idle_pct: unknown;
  gaps_over_15min: unknown;
  first_call_et: string | null;
  last_call_et: string | null;
  human_calls: unknown;
  dispositioned: unknown;
  appts: unknown;
  talk_min: unknown;
}

/** A coerced row. Every metric is `number | null` — null means the RPC had no
 *  value for it, which renders as a dimmed dash and NEVER as 0. */
interface CeilingRow {
  key: string;
  setterId: string | null;
  setterName: string | null;
  callerId: string | null;
  callerLabel: string | null;
  dials: number | null;
  daysWorked: number | null;
  loggedHours: number | null;
  dialingHours: number | null;
  idleHours: number | null;
  idlePct: number | null;
  gapsOver15: number | null;
  typicalStartEt: string | null;
  typicalEndEt: string | null;
  dialsPerDialingHour: number | null;
  connectPct: number | null;
  humanPct: number | null;
  humanCalls: number | null;
  dispositioned: number | null;
  dispositionRate: number | null;
  appts: number | null;
  positives: number | null;
  positivesPer1000: number | null;
  dialsPerAppt: number | null;
  medianDispositionedSecs: number | null;
  avgApptSecs: number | null;
  voicemailSecs: number | null;
  connectedSecs: number | null;
  voicemailPctOfTalk: number | null;
  agentCanceled: number | null;
  agentCanceledPct: number | null;
  negatives: number | null;
  negPosRatio: number | null;
}

interface CeilingDay {
  key: string;
  day: string | null;
  setterKey: string;
  setterId: string | null;
  setterName: string | null;
  callerId: string | null;
  dials: number | null;
  dialingHours: number | null;
  idlePct: number | null;
  gapsOver15: number | null;
  firstCallEt: string | null;
  lastCallEt: string | null;
  humanCalls: number | null;
  dispositioned: number | null;
  appts: number | null;
  talkMin: number | null;
}

/** The one coercion. A null/empty/unparseable value stays NULL — it is absent
 *  data, not zero activity. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Group key: the LINE, because that is what the RPC groups by. Keying on the
 *  setter instead would silently merge two lines mapped to the same person into
 *  one row — a sum the RPC never computed, presented as if it had. */
function rowKey(r: { setter_id: string | null; caller_id: string | null }): string {
  if (r.caller_id) return `caller:${r.caller_id.replace(/\D/g, "")}`;
  if (r.setter_id) return `setter:${r.setter_id}`;
  return "unattributed";
}

function prettyPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return p;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Who a row belongs to, in falling order of certainty: the setter, the admin's
 *  label for the line, the number itself. Never a guess. */
function displayName(r: CeilingRow, names: Record<string, string>): string {
  if (r.setterName) return r.setterName;
  if (r.setterId && names[r.setterId]) return names[r.setterId];
  if (r.callerLabel) return r.callerLabel;
  const ph = prettyPhone(r.callerId);
  if (ph) return ph;
  if (r.setterId) return r.setterId.slice(0, 8);
  return "Unattributed line";
}

/** True when the row is a LINE, not a person — worth saying on the card so a
 *  manager does not read an unassigned number as a teammate. */
function isLineOnly(r: CeilingRow, names: Record<string, string>): boolean {
  return !r.setterName && !(r.setterId && names[r.setterId]);
}

// ── Formatters ───────────────────────────────────────────────────────────────
function hoursText(h: number | null): string {
  if (h === null) return "—";
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh > 0 ? `${hh}h ${String(mm).padStart(2, "0")}m` : `${mm}m`;
}

function secsText(s: number | null): string {
  if (s === null) return "—";
  const v = Math.max(0, Math.round(s));
  const m = Math.floor(v / 60);
  return `${m}:${String(v % 60).padStart(2, "0")}`;
}

/** A clock string from the RPC. It may be a full timestamp or an already-
 *  formatted "09:14" — both are rendered, neither is re-interpreted into a
 *  timezone it did not come with. The columns are named *_et, so they are
 *  LABELLED Eastern and never silently converted to the reader's clock. */
function clockText(v: string | null): string {
  if (!v) return "—";
  const s = v.trim();
  if (/^\d{1,2}:\d{2}/.test(s)) {
    const [hRaw, m] = s.split(":");
    const h = Number(hRaw);
    if (Number.isFinite(h)) {
      const ampm = h >= 12 ? "p" : "a";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12}:${m.slice(0, 2)}${ampm}`;
    }
    return s;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayText(v: string | null): string {
  if (!v) return "—";
  const s = v.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function intText(n: number | null): string {
  return n === null ? "—" : Math.round(n).toLocaleString();
}

function fixed(n: number | null, digits = 1): string {
  return n === null ? "—" : n.toFixed(digits);
}

// ── RAG ──────────────────────────────────────────────────────────────────────
// Same band semantics as the rest of the page (inclusive edges, 'lower' inverts
// the comparison), kept local because the page's copy is not exported. The
// THRESHOLDS below are BUILT-IN: this tab's metrics have no keys in
// platform_settings.ph_dialer_kpi_targets yet, so every band here is marked with
// a · in the UI, and a stored threshold (passed in via targetFor) always wins.
export interface CeilingTarget {
  direction: "higher" | "lower";
  green: number;
  amber: number;
}
type Rag = "green" | "amber" | "red" | "none";

// Only TWO metrics get a built-in band, and both are unit-free enough to defend
// without knowing this floor's setup:
const BUILT_IN: Record<string, CeilingTarget> = {
  // Idle inside the dialing window. Nobody dials every minute — notes, wrap-up
  // and a break are real work — so green is deliberately not near zero.
  ceiling_idle_pct: { direction: "lower", green: 25, amber: 40 },
  // Calls the agent side cancelled. Elevated is usually equipment, which is why
  // it is a health flag rather than a KPI.
  ceiling_agent_canceled_pct: { direction: "lower", green: 3, amber: 8 },
};
//
// PACE and DISPOSITION RATE deliberately have NO built-in band, and render grey:
//   • Pace is meaningless without knowing the dialer mode. This floor power-dials
//     at roughly 230 dials per dialing hour; a manual floor does twenty. Any
//     number picked here would paint every row green (or every row red) and call
//     it a judgment.
//   • Disposition rate is the metric this panel explicitly says is AMBIGUOUS —
//     low can mean "not talking" or "not logging". Colouring it would assert the
//     verdict the panel just told the reader it cannot make.
// Both stay wired to their keys, so storing `ceiling_dials_per_dialing_hour` or
// `ceiling_disposition_rate_pct` in platform_settings.ph_dialer_kpi_targets turns
// the colour on with a REAL owner-set threshold behind it, no deploy needed.

type TargetLookup = (key: string) => { target: CeilingTarget | null; isDefault: boolean };

function ragOf(value: number | null, t: CeilingTarget | null): Rag {
  if (t === null || value === null || !Number.isFinite(value)) return "none";
  if (t.direction === "lower") {
    if (value <= t.green) return "green";
    if (value <= t.amber) return "amber";
    return "red";
  }
  if (value >= t.green) return "green";
  if (value >= t.amber) return "amber";
  return "red";
}

const RAG_TEXT: Record<Rag, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  none: "text-gray-400 dark:text-gray-500",
};

function bandTitle(t: CeilingTarget | null, isDefault: boolean, unit: string): string {
  if (!t) return "No threshold configured for this metric — not judged";
  const op = t.direction === "lower" ? "≤" : "≥";
  return `${isDefault ? "Built-in band (no owner-set target stored). " : "Owner-set target. "}${op}${t.green}${unit} green, ${op}${t.amber}${unit} amber`;
}

/** A number with its RAG colour, the band it was judged against on hover, and a
 *  · when that band is a built-in rather than an owner-set target. */
function RagValue({
  value,
  targetKey,
  targetFor,
  suffix = "",
  digits = 1,
  className = "",
}: {
  value: number | null;
  targetKey: string | null;
  targetFor: TargetLookup;
  suffix?: string;
  digits?: number;
  className?: string;
}) {
  const { target, isDefault } = targetKey ? targetFor(targetKey) : { target: null, isDefault: false };
  if (value === null) {
    return (
      <span className="text-gray-300 dark:text-gray-600" title="The RPC returned no value for this metric">
        —
      </span>
    );
  }
  const rag = ragOf(value, target);
  return (
    <span className={`font-semibold ${RAG_TEXT[rag]} ${className}`} title={bandTitle(target, isDefault, suffix)}>
      {value.toFixed(digits)}
      {suffix}
      {target && isDefault && <span className="opacity-60"> ·</span>}
    </span>
  );
}

// ── Sample size ──────────────────────────────────────────────────────────────
// Appointments and positives land in the single digits over a normal range, and
// every per-dial rate here is built on that handful. Below this many events the
// rate is reported WITH the count and flagged, because at n=4 vs n=6 the two
// setters are not distinguishable and a confident-looking decimal says otherwise.
//
// This is also why nothing on this tab computes a ratio BETWEEN setters. A "4×
// better" headline off six events is a coin flip wearing a suit; the raw counts
// are shown side by side and left to speak.
const LOW_N = 10;

/** The marker for "this rate rests on too few events to rank people by". */
function SmallNChip({ n, noun }: { n?: number | null; noun?: string }) {
  const label = n === null || n === undefined ? "small n" : `n=${Math.round(n)}${noun ? ` ${noun}${Math.round(n) === 1 ? "" : "s"}` : ""}`;
  return (
    <span
      className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 align-middle"
      title="Too few events to separate one setter from another. Read the raw count, not the rate."
    >
      {label}
    </span>
  );
}

/** A per-dial rate shown WITH the raw count it was computed from. The count is
 *  never optional: a rate with its denominator hidden is the thing that turns
 *  four appointments into a confident-sounding verdict. */
function RateWithN({
  value,
  n,
  noun,
  digits,
}: {
  value: number | null;
  n: number | null;
  noun: string;
  digits: number;
}) {
  if (value === null) {
    return (
      <span className="text-gray-300 dark:text-gray-600" title={`No value — ${n === 0 ? `zero ${noun}s in range, so there is nothing to divide by` : "the RPC returned no value for this metric"}`}>
        —{" "}
        {n !== null && <span className="text-[10px] font-normal">({Math.round(n)})</span>}
      </span>
    );
  }
  const low = n !== null && n < LOW_N;
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <span className={low ? "text-gray-600 dark:text-gray-300" : "font-semibold"}>{value.toFixed(digits)}</span>
      {low ? (
        <SmallNChip n={n} noun={noun} />
      ) : (
        <span className="text-[10px] text-gray-400">
          n={Math.round(n ?? 0)}
        </span>
      )}
    </span>
  );
}

/** A metric with no threshold at all — rendered plainly, never coloured. */
function Plain({ value, suffix = "", digits = 0 }: { value: number | null; suffix?: string; digits?: number }) {
  if (value === null) {
    return (
      <span className="text-gray-300 dark:text-gray-600" title="The RPC returned no value for this metric">
        —
      </span>
    );
  }
  return (
    <span>
      {digits === 0 ? Math.round(value).toLocaleString() : value.toFixed(digits)}
      {suffix}
    </span>
  );
}

// ── Table chrome (mirrors the page's) ────────────────────────────────────────
const TABLE_WRAP = "overflow-x-auto rounded-lg border border-base-300";
const TABLE = "table w-full";
const THEAD = "bg-base-200/60 dark:bg-gray-800/50";
const TH =
  "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap border-b border-base-300";
const TH_NUM = `${TH} text-right`;
const TD = "px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200";
const TD_NUM = `${TD} text-right tabular-nums whitespace-nowrap`;
const TBODY = "divide-y divide-base-300/70";
const TR = "hover:bg-base-200/40 dark:hover:bg-gray-800/30 transition-colors";

const CARD = "card bg-base-100 border border-base-300 shadow-sm";

/** The two-colour split used for occupancy everywhere on this tab. */
const DIALING_FILL = "#00C49A";
const IDLE_FILL = "#9CA3AF";

// ═════════════════════════════════════════════════════════════════════════════

export default function DialCeilingPanel({
  fromIso,
  toIso,
  rangeLabel,
  targetFor,
}: {
  /** The page's active range, as UTC instants. Same picker as every other tab. */
  fromIso: string;
  toIso: string;
  rangeLabel: string;
  /** The page's threshold lookup. Optional: without it every band on this tab
   *  is the built-in one, which is exactly what the · marker says. */
  targetFor?: (key: string) => { target: CeilingTarget | null; isDefault: boolean };
}) {
  const [rows, setRows] = useState<CeilingRow[] | null>(null);
  const [days, setDays] = useState<CeilingDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  /** Which setter the per-day table is showing. "all" groups every setter. */
  const [dayScope, setDayScope] = useState<string>("all");

  const lookup = useCallback<TargetLookup>(
    (key: string) => {
      const stored = targetFor?.(key);
      if (stored?.target && !stored.isDefault) return stored;
      const builtIn = BUILT_IN[key];
      return builtIn ? { target: builtIn, isDefault: true } : { target: null, isDefault: false };
    },
    [targetFor],
  );

  // ── Load ───────────────────────────────────────────────────────────────────
  // Both RPCs fire together, and they fail INDEPENDENTLY: a broken daily read
  // must not blank the occupancy hero, and vice versa. Neither failure is ever
  // absorbed into an empty table.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDailyError(null);
    const [sumRes, dayRes] = await Promise.all([
      supabase.rpc("setter_dial_ceiling", { p_from: fromIso, p_to: toIso }),
      supabase.rpc("setter_dial_ceiling_daily", { p_from: fromIso, p_to: toIso }),
    ]);

    let loaded: CeilingRow[] | null = null;
    if (sumRes.error) {
      setRows(null);
      setError(sumRes.error.message);
    } else {
      loaded = ((sumRes.data ?? []) as CeilingRowRaw[]).map((r) => ({
        key: rowKey(r),
        setterId: r.setter_id,
        setterName: r.setter_name,
        callerId: r.caller_id,
        callerLabel: r.caller_label,
        dials: num(r.dials),
        daysWorked: num(r.days_worked),
        loggedHours: num(r.logged_hours),
        dialingHours: num(r.dialing_hours),
        idleHours: num(r.idle_hours),
        idlePct: num(r.idle_pct),
        gapsOver15: num(r.gaps_over_15min),
        typicalStartEt: r.typical_start_et,
        typicalEndEt: r.typical_end_et,
        dialsPerDialingHour: num(r.dials_per_dialing_hour),
        connectPct: num(r.connect_pct),
        humanPct: num(r.human_pct),
        humanCalls: num(r.human_calls),
        dispositioned: num(r.dispositioned),
        dispositionRate: num(r.disposition_rate),
        appts: num(r.appts),
        positives: num(r.positives),
        positivesPer1000: num(r.positives_per_1000),
        dialsPerAppt: num(r.dials_per_appt),
        medianDispositionedSecs: num(r.median_dispositioned_secs),
        avgApptSecs: num(r.avg_appt_secs),
        voicemailSecs: num(r.voicemail_secs),
        connectedSecs: num(r.connected_secs),
        voicemailPctOfTalk: num(r.voicemail_pct_of_talk),
        agentCanceled: num(r.agent_canceled),
        agentCanceledPct: num(r.agent_canceled_pct),
        negatives: num(r.negatives),
        negPosRatio: num(r.neg_pos_ratio),
      }));
      // Busiest first, so the head-to-head reads left to right.
      loaded.sort((a, b) => (b.dials ?? -1) - (a.dials ?? -1));
      setRows(loaded);
    }

    if (dayRes.error) {
      setDays(null);
      setDailyError(dayRes.error.message);
    } else {
      const list = ((dayRes.data ?? []) as CeilingDayRaw[]).map((r, i) => ({
        key: `${r.day ?? "nodate"}:${rowKey(r)}:${i}`,
        day: r.day,
        setterKey: rowKey(r),
        setterId: r.setter_id,
        setterName: r.setter_name,
        callerId: r.caller_id,
        dials: num(r.dials),
        dialingHours: num(r.dialing_hours),
        idlePct: num(r.idle_pct),
        gapsOver15: num(r.gaps_over_15min),
        firstCallEt: r.first_call_et,
        lastCallEt: r.last_call_et,
        humanCalls: num(r.human_calls),
        dispositioned: num(r.dispositioned),
        appts: num(r.appts),
        talkMin: num(r.talk_min),
      }));
      list.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""));
      setDays(list);
    }

    // Names for any setter the RPC could not name (profiles RLS hands a closer
    // only their own row). staff_directory is the staff-readable source the rest
    // of the page uses. A id we still cannot name keeps its id fragment.
    const unnamed = [
      ...new Set(
        [
          ...(loaded ?? []).filter((r) => r.setterId && !r.setterName).map((r) => r.setterId!),
          ...((dayRes.error ? [] : ((dayRes.data ?? []) as CeilingDayRaw[]))
            .filter((r) => r.setter_id && !r.setter_name)
            .map((r) => r.setter_id!)),
        ],
      ),
    ];
    if (unnamed.length > 0) {
      const { data: dir } = await supabase.from("staff_directory").select("id,name").in("id", unnamed);
      const map: Record<string, string> = {};
      for (const p of (dir ?? []) as { id: string; name: string | null }[]) {
        if (p.name) map[p.id] = p.name;
      }
      setNames((prev) => ({ ...prev, ...map }));
    }

    setLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useCallback((r: CeilingRow) => displayName(r, names), [names]);

  /** The occupancy chart's data — hours only, so the two bars are the same unit
   *  and stack into the logged shift. */
  const occupancyData = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.dialingHours !== null || r.idleHours !== null)
        .map((r) => ({
          name: nameOf(r),
          dialing: r.dialingHours ?? 0,
          idle: r.idleHours ?? 0,
        })),
    [rows, nameOf],
  );

  const dayGroups = useMemo(() => {
    if (!days) return [];
    const byKey = new Map<string, CeilingDay[]>();
    for (const d of days) {
      if (dayScope !== "all" && d.setterKey !== dayScope) continue;
      const list = byKey.get(d.setterKey);
      if (list) list.push(d);
      else byKey.set(d.setterKey, [d]);
    }
    return [...byKey.entries()].map(([key, list]) => {
      const summary = (rows ?? []).find((r) => r.key === key);
      const title = summary
        ? nameOf(summary)
        : list[0].setterName ?? prettyPhone(list[0].callerId) ?? "Unattributed line";
      return { key, title, list };
    });
  }, [days, dayScope, rows, nameOf]);

  const missingDailyError = dailyError && /function|does not exist|schema cache/i.test(dailyError);
  const missingSummaryError = error && /function|does not exist|schema cache/i.test(error);

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className={CARD}>
        <div className="card-body p-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <ScaleIcon className="w-5 h-5 text-mint-green" />
                Dial Ceiling — occupancy, pace, and honest conversations
                <span className="text-sm font-normal text-gray-400">({rangeLabel})</span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
                <b>Volume = pace × occupancy.</b> This tab separates the two, because they need opposite
                coaching: a setter dialing at a good pace for two hours of an eight-hour shift does not have a
                pace problem. Everything here comes from <code>setter_dial_ceiling</code> and{" "}
                <code>setter_dial_ceiling_daily</code>, scoped to the range picker above.
              </p>
            </div>
            <button type="button" className="btn btn-xs btn-ghost gap-1" onClick={() => void load()} disabled={loading}>
              <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {/* The two things a reader must know BEFORE reading any number here. */}
          <div className="rounded-md border border-base-300 bg-base-200/50 dark:bg-gray-800/40 px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300 space-y-1">
            <div>
              <b>"Shift" here means the dialing window, not the time clock.</b> Nothing on this tab reads{" "}
              <code>time_entries</code>. Per line per Eastern day it measures <b>first dial → last dial</b>,
              subtracts every gap longer than <b>5 minutes</b> as idle, and calls the remainder dialing time.
              So a late start does <b>not</b> raise idle% — it shortens the window. Read{" "}
              <b>typical start</b> next to the idle share, never instead of it.
            </div>
            <div>
              <b>A row is a LINE, named by whoever the Numbers tab maps it to.</b> Both RPCs group by{" "}
              <code>caller_id</code>, and these outbound numbers are dialed by more than one seat at once
              (the same measured caveat Talk Time carries). Good enough to coach a line; not proof about one
              person's hands when a line is shared.
            </div>
          </div>

          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Bands marked <span className="font-semibold">·</span> are <b>built-in starting points</b>, not
            owner-set targets. A metric with no band renders <b>grey — never green</b>.{" "}
            <b>Pace and disposition rate are deliberately uncoloured</b>: pace is meaningless without knowing
            the dialer mode, and disposition rate is the one metric here that is genuinely ambiguous. Store{" "}
            <code>ceiling_dials_per_dialing_hour</code> or <code>ceiling_disposition_rate_pct</code> in{" "}
            <code>ph_dialer_kpi_targets</code> to colour them against a real threshold.
          </div>
        </div>
      </div>

      {/* ── Unreadable ─────────────────────────────────────────────────────── */}
      {error ? (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <span>
            <b>Couldn't load the dial ceiling</b> — this is unreadable, not an idle floor. Nothing below can be
            read as "nobody dialed".
            {missingSummaryError && (
              <>
                <br />
                The <code>setter_dial_ceiling</code> function is not deployed (or not in the API schema cache)
                on this project yet.
              </>
            )}
            <br />
            <span className="text-xs font-mono opacity-80">{error}</span>
          </span>
        </div>
      ) : loading && !rows ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-6">
          <span className="loading loading-spinner loading-sm" /> Loading dial ceiling…
        </div>
      ) : rows && rows.length === 0 ? (
        <div className={CARD}>
          <div className="card-body p-8 text-center">
            <ScaleIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              No rows came back for this range.
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
              The call <b>succeeded</b>, so this is most likely a genuinely quiet range — widen it above.{" "}
              <b>One other thing produces the same empty result:</b> the RPC only returns rows to a staff
              session (closer / employee / admin / super_admin) and hands anyone else <b>zero rows rather than
              an error</b>. If dials definitely happened, check that first.
            </p>
          </div>
        </div>
      ) : rows ? (
        <>
          {/* ═══════════ 1. OCCUPANCY HERO ═══════════ */}
          <div className="space-y-3">
            <SectionHead
              n={1}
              title="Occupancy — how much of the dialing window was actually spent dialing"
              blurb={
                <>
                  <b>Present is not the same as dialing.</b> The left number is time on the phones; the right
                  is the share of the window (first dial → last dial) with <b>nothing being dialed</b> — every
                  gap over 5 minutes, added up. A big idle share next to a normal pace means the ceiling is{" "}
                  <b>occupancy</b>, not skill.
                </>
              }
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {rows.map((r) => (
                <OccupancyCard key={r.key} row={r} name={nameOf(r)} lineOnly={isLineOnly(r, names)} targetFor={lookup} />
              ))}
            </div>

            {occupancyData.length > 0 && (
              <div className={CARD}>
                <div className="card-body p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                    The dialing window, split — dialing vs idle (hours)
                  </div>
                  <div style={{ height: Math.max(140, occupancyData.length * 62) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={occupancyData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.25} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={120}
                          tick={{ fontSize: 11, fill: "#9CA3AF" }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#21262D",
                            border: "1px solid #30363D",
                            borderRadius: "8px",
                            color: "#E5E7EB",
                            fontSize: "12px",
                          }}
                          formatter={(v, n) => [hoursText(Number(v) || 0), String(n)]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="dialing" name="Dialing" stackId="shift" fill={DIALING_FILL} radius={[0, 0, 0, 0]} />
                        <Bar dataKey="idle" name="Idle inside shift" stackId="shift" fill={IDLE_FILL} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    Each bar is <b>first dial → last dial</b>, summed over the days worked — not a time-clock
                    shift. A bar with no idle segment means <b>idle hours were not reported</b> for that row,
                    not that every minute was occupied.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ═══════════ 2. PACE vs OCCUPANCY ═══════════ */}
          <div className="space-y-3">
            <SectionHead
              n={2}
              title="Pace when actually dialing"
              blurb={
                <>
                  Dials per hour <b>of dialing time</b> — not per hour of shift. Two setters can post the{" "}
                  <b>same pace</b> and finish the range hundreds of dials apart, and when they do, the whole
                  difference is occupancy above.
                </>
              }
            />
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>Setter</th>
                    <th className={TH_NUM} title="Dials ÷ hours actually dialing">
                      Pace / dialing hr
                    </th>
                    <th className={TH_NUM}>Dials</th>
                    <th className={TH_NUM}>Days worked</th>
                    <th className={TH_NUM}>Dialing hours</th>
                    <th className={TH_NUM} title="Share of the first-dial-to-last-dial window spent in gaps over 5 minutes">
                      Idle %
                    </th>
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {rows.map((r) => (
                    <tr key={r.key} className={TR}>
                      <td className={TD}>
                        <div className="font-semibold text-gray-900 dark:text-white">{nameOf(r)}</div>
                        {isLineOnly(r, names) && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400">
                            line, not a named setter
                          </div>
                        )}
                      </td>
                      <td className={`${TD_NUM} text-base`}>
                        <RagValue
                          value={r.dialsPerDialingHour}
                          targetKey="ceiling_dials_per_dialing_hour"
                          targetFor={lookup}
                          digits={1}
                        />
                      </td>
                      <td className={`${TD_NUM} font-semibold`}>
                        <Plain value={r.dials} />
                      </td>
                      <td className={TD_NUM}>
                        <Plain value={r.daysWorked} />
                      </td>
                      <td className={TD_NUM}>{hoursText(r.dialingHours)}</td>
                      <td className={TD_NUM}>
                        <RagValue value={r.idlePct} targetKey="ceiling_idle_pct" targetFor={lookup} suffix="%" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ═══════════ 3. HONEST CONVERSATIONS ═══════════ */}
          <div className="space-y-3">
            <SectionHead
              n={3}
              title="Honest conversations — dispositions, not talk time"
              blurb={
                <>
                  <b>Dispositions are the only reliable "they actually talked to somebody" signal here.</b>{" "}
                  Talk time and the human flag are not.
                </>
              }
            />

            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <b>Most raw "talk time" is voicemail</b> — WAVV flags voicemails as human and they run long,
                  so <u>talk-time and the human flag are NOT reliable; dispositions are.</u>
                </span>
              </div>
              <div className="flex items-start gap-2">
                <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <b>A low disposition rate is ambiguous.</b> It can mean <b>not talking to anyone</b> or{" "}
                  <b>talking and not logging it</b> — opposite problems with opposite fixes. Listen to a
                  recording before deciding which one you are looking at.
                </span>
              </div>
            </div>

            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>Setter</th>
                    <th className={TH_NUM} title="Calls the setter dispositioned as a real conversation">
                      Dispositioned
                    </th>
                    <th className={TH_NUM} title="Dispositioned calls as a share of dials">
                      Disposition rate
                    </th>
                    <th className={TH_NUM} title="Median length of a dispositioned call — the honest talk length">
                      Median talk (dispositioned)
                    </th>
                    <th className={TH_NUM} title="Share of connected seconds that were voicemail">
                      Voicemail % of talk
                    </th>
                    <th className={TH_NUM}>Voicemail time</th>
                    <th className={TH_NUM} title="Total connected seconds — CONTAMINATED, mostly voicemail">
                      Connected time <span className="opacity-60">(contaminated)</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {rows.map((r) => (
                    <tr key={r.key} className={TR}>
                      <td className={`${TD} font-semibold text-gray-900 dark:text-white`}>{nameOf(r)}</td>
                      <td className={`${TD_NUM} font-semibold`}>
                        <Plain value={r.dispositioned} />
                      </td>
                      <td className={`${TD_NUM} text-base`}>
                        <RagValue
                          value={r.dispositionRate}
                          targetKey="ceiling_disposition_rate_pct"
                          targetFor={lookup}
                          suffix="%"
                        />
                      </td>
                      <td className={TD_NUM}>{secsText(r.medianDispositionedSecs)}</td>
                      <td className={TD_NUM}>
                        <span
                          className="font-semibold text-gray-700 dark:text-gray-200"
                          title="No target: this is a description of what the talk clock is made of, not a score to beat"
                        >
                          {fixed(r.voicemailPctOfTalk, 1)}
                          {r.voicemailPctOfTalk === null ? "" : "%"}
                        </span>
                      </td>
                      <td className={TD_NUM}>{secsText(r.voicemailSecs)}</td>
                      <td className={`${TD_NUM} text-gray-400 dark:text-gray-500`}>
                        {secsText(r.connectedSecs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── LOGGING DISCIPLINE ────────────────────────────────────────
                The disambiguator for the ambiguity stated just above. A low
                disposition rate has two very different causes, and the MIX of
                what got logged tells them apart: a setter who logs their wins
                and skips their rejections posts a far lower negatives-per-
                positive ratio than a peer working the same list. When that
                happens the conversations ARE happening and simply are not being
                recorded, so that setter's conversation count — and every rate
                built on it — is UNDER-reported, not low. */}
            <div className={CARD}>
              <div className="card-body p-4 space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Logging discipline — is the rate low, or is the logging?
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 max-w-3xl">
                  Read these two together. <b>Negatives are the hardest thing to fake and the easiest to
                  skip</b> — nobody forgets to log an appointment, but "Not Interested" often goes unrecorded.
                  So a setter posting a much <b>lower neg : pos ratio than a peer on the same list is
                  selectively logging</b>: their conversations are happening and going unrecorded, and their
                  true conversation count is <b>under-reported</b> rather than genuinely low. A low
                  disposition rate <i>with</i> a healthy negative count is the opposite reading — the logging
                  is honest and the conversations really are scarce.
                </p>
                <div className={TABLE_WRAP}>
                  <table className={TABLE}>
                    <thead className={THEAD}>
                      <tr>
                        <th className={TH}>Setter</th>
                        <th className={TH_NUM}>Dispositioned</th>
                        <th className={TH_NUM} title="Dispositioned calls as a share of dials">
                          Disposition rate
                        </th>
                        <th className={TH_NUM} title="Not Interested · Do Not Contact — the calls with nothing to show for them">
                          Negatives logged
                        </th>
                        <th className={TH_NUM} title="Interested · Appointment Set · Callback · Full Application">
                          Positives logged
                        </th>
                        <th className={TH_NUM} title="Negatives per positive. Much lower than a peer on the same list = rejections are going unlogged, not unheard.">
                          Neg : pos
                        </th>
                      </tr>
                    </thead>
                    <tbody className={TBODY}>
                      {rows.map((r) => (
                        <tr key={r.key} className={TR}>
                          <td className={`${TD} font-semibold text-gray-900 dark:text-white`}>{nameOf(r)}</td>
                          <td className={TD_NUM}>
                            <Plain value={r.dispositioned} />
                          </td>
                          <td className={TD_NUM}>
                            <RagValue
                              value={r.dispositionRate}
                              targetKey="ceiling_disposition_rate_pct"
                              targetFor={lookup}
                              suffix="%"
                              digits={2}
                            />
                          </td>
                          <td className={`${TD_NUM} font-semibold`}>
                            <Plain value={r.negatives} />
                          </td>
                          <td className={TD_NUM}>
                            <Plain value={r.positives} />
                          </td>
                          <td className={`${TD_NUM} font-semibold`}>
                            <Plain value={r.negPosRatio} digits={2} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  <b>Neg : pos is blank when nobody logged a positive</b> — nothing to divide by, not a
                  perfect record. And this is a <b>comparison</b>, not a threshold: the ratio only means
                  something against a peer working the same list in the same range, which is why it is
                  uncoloured. The way to settle it is a recording, not a number.
                </p>
              </div>
            </div>

            {/* The contaminated pair, kept visible but explicitly labelled so
                nobody reads them off another tab and treats them as a score. */}
            <div className={CARD}>
              <div className="card-body p-4 space-y-2">
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Contaminated metrics — shown for completeness, <b>not</b> success measures
                </div>
                <div className={TABLE_WRAP}>
                  <table className={TABLE}>
                    <thead className={THEAD}>
                      <tr>
                        <th className={TH}>Setter</th>
                        <th className={TH_NUM}>Connect %</th>
                        <th className={TH_NUM}>Human % (WAVV flag)</th>
                        <th className={TH_NUM}>Human calls (WAVV flag)</th>
                      </tr>
                    </thead>
                    <tbody className={TBODY}>
                      {rows.map((r) => (
                        <tr key={r.key} className={TR}>
                          <td className={TD}>{nameOf(r)}</td>
                          <td className={`${TD_NUM} text-gray-400 dark:text-gray-500`}>
                            <Plain value={r.connectPct} suffix={r.connectPct === null ? "" : "%"} digits={1} />
                          </td>
                          <td className={`${TD_NUM} text-gray-400 dark:text-gray-500`}>
                            <Plain value={r.humanPct} suffix={r.humanPct === null ? "" : "%"} digits={1} />
                          </td>
                          <td className={`${TD_NUM} text-gray-400 dark:text-gray-500`}>
                            <Plain value={r.humanCalls} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  These are greyed on purpose. An answering machine counts as a connect, and WAVV marks plenty
                  of voicemails <code>human=true</code>, so <b>ranking anyone on these rewards blasting
                  voicemails</b>. They are useful only as context next to the disposition table above.
                </p>
              </div>
            </div>
          </div>

          {/* ═══════════ 4. CONVERSION PER DIAL ═══════════ */}
          <div className="space-y-3">
            <SectionHead
              n={4}
              title="Conversion per dial — read the counts, not the ratios"
              blurb={
                <>
                  A setter who dials <b>less</b> and still converts <b>at least as well per dial</b> shows up
                  here and nowhere else on the page. But the events are <b>single digits</b>, so the ratios
                  below are fragile — the raw count sits next to every rate for exactly that reason.
                </>
              }
            />

            {/* ── SAMPLE SIZE ───────────────────────────────────────────────
                The counts these rates are built on are tiny — a handful of
                appointments across a range. At that size one extra booking
                swings a per-1,000 rate enormously, so two setters four events
                apart are NOT distinguishable. The UI therefore refuses to
                compute or display a multiplier between setters ("4x better"),
                which would dress a coin-flip up as a finding, and marks any
                rate resting on fewer than LOW_N events as small-sample. */}
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <InformationCircleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>Small numbers — do not read a multiple into these.</b> With a handful of appointments in
                range, one extra booking moves a per-1,000 rate more than a week of real difference does.
                Two setters a few events apart are <b>not distinguishable</b>. The honest reading is{" "}
                <b>"at least as good on far fewer dials"</b>, never "<i>N</i>× better" — and a rate built on
                fewer than {LOW_N} events is flagged <SmallNChip /> below.
              </span>
            </div>

            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>Setter</th>
                    <th className={TH_NUM}>Dials</th>
                    <th className={TH_NUM}>Appointments</th>
                    <th className={TH_NUM} title="Interested · Appointment Set · Callback · Full Application">
                      Positives
                    </th>
                    <th className={TH_NUM} title="Positive dispositions per 1,000 dials, with the raw positive count it is built from">
                      Positives / 1,000 dials
                    </th>
                    <th className={TH_NUM} title="How many dials it took to book one appointment, with the raw appointment count it is built from">
                      Dials per appointment
                    </th>
                    <th className={TH_NUM} title="Average length of the calls that produced an appointment">
                      Avg appointment call
                    </th>
                  </tr>
                </thead>
                <tbody className={TBODY}>
                  {rows.map((r) => (
                    <tr key={r.key} className={TR}>
                      <td className={`${TD} font-semibold text-gray-900 dark:text-white`}>{nameOf(r)}</td>
                      <td className={TD_NUM}>
                        <Plain value={r.dials} />
                      </td>
                      <td className={`${TD_NUM} font-semibold`}>
                        <Plain value={r.appts} />
                      </td>
                      <td className={`${TD_NUM} font-semibold`}>
                        <Plain value={r.positives} />
                      </td>
                      <td className={TD_NUM}>
                        <RateWithN value={r.positivesPer1000} n={r.positives} noun="positive" digits={1} />
                      </td>
                      <td className={TD_NUM}>
                        <RateWithN value={r.dialsPerAppt} n={r.appts} noun="appt" digits={0} />
                      </td>
                      <td className={TD_NUM}>{secsText(r.avgApptSecs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              <b>Dials per appointment is blank when nobody booked</b> in the range — "no appointments to
              divide by", not an infinitely bad ratio. <b>Avg appointment call</b> is an average over those
              same few calls, so it moves with one long conversation.
            </p>
          </div>

          {/* ═══════════ 5. DIALER HEALTH ═══════════ */}
          <div className="space-y-3">
            <SectionHead
              n={5}
              title="Dialer health — agent-cancelled calls"
              blurb={
                <>
                  Calls the agent side dropped before they went anywhere. An elevated share is usually a{" "}
                  <b>headset, network or dialer problem</b> — check the equipment before reading it as
                  behaviour.
                </>
              }
            />
            <div className="flex flex-wrap gap-2">
              {rows.map((r) => (
                <div
                  key={r.key}
                  className="rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs flex items-center gap-2"
                >
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{nameOf(r)}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-600 dark:text-gray-300">
                    <Plain value={r.agentCanceled} /> cancelled
                  </span>
                  <span className="text-gray-400">·</span>
                  <RagValue
                    value={r.agentCanceledPct}
                    targetKey="ceiling_agent_canceled_pct"
                    targetFor={lookup}
                    suffix="%"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ═══════════ 6. PER-DAY ═══════════ */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHead
                n={6}
                title="Day by day"
                blurb={<>The same shift picture per calendar day, so one bad day is not read as a pattern — or hidden by one good one.</>}
              />
              <select
                className="select select-xs select-bordered"
                value={dayScope}
                onChange={(e) => setDayScope(e.target.value)}
                title="Which setter's days to show"
              >
                <option value="all">All setters</option>
                {rows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {nameOf(r)}
                  </option>
                ))}
              </select>
            </div>

            {dailyError ? (
              <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
                <span>
                  <b>Couldn't load the per-day breakdown</b> — the totals above are still good; only this table
                  is unknown.
                  {missingDailyError && (
                    <>
                      <br />
                      The <code>setter_dial_ceiling_daily</code> function is not deployed (or not in the API
                      schema cache) on this project yet.
                    </>
                  )}
                  <br />
                  <span className="text-xs font-mono opacity-80">{dailyError}</span>
                </span>
              </div>
            ) : days && dayGroups.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No days to show for this scope. The read succeeded — this range holds no dialing days for that
                selection.
              </p>
            ) : (
              <div className="space-y-4">
                {dayGroups.map((g) => (
                  <div key={g.key} className="space-y-1.5">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">{g.title}</div>
                    <div className={TABLE_WRAP}>
                      <table className={TABLE}>
                        <thead className={THEAD}>
                          <tr>
                            <th className={TH}>Day</th>
                            <th className={TH_NUM}>Dials</th>
                            <th className={TH_NUM} title="First dial → last dial that day, minus every gap over 5 minutes">
                              Dialing hrs
                            </th>
                            <th className={TH_NUM} title="Share of that day's first-dial-to-last-dial window spent in gaps over 5 minutes">
                              Idle %
                            </th>
                            <th className={TH_NUM} title="Gaps longer than 15 minutes with no dial placed">
                              Gaps &gt; 15m
                            </th>
                            <th className={TH_NUM}>First call (ET)</th>
                            <th className={TH_NUM}>Last call (ET)</th>
                            <th className={TH_NUM} title="WAVV's human flag — contaminated, see above">
                              Humans
                            </th>
                            <th className={TH_NUM}>Dispositioned</th>
                            <th className={TH_NUM}>Appts</th>
                            <th className={TH_NUM} title="Connected minutes — includes voicemail">
                              Talk min
                            </th>
                          </tr>
                        </thead>
                        <tbody className={TBODY}>
                          {g.list.map((d) => (
                            <tr key={d.key} className={TR}>
                              <td className={`${TD} whitespace-nowrap font-medium`}>{dayText(d.day)}</td>
                              <td className={`${TD_NUM} font-semibold`}>
                                <Plain value={d.dials} />
                              </td>
                              <td className={TD_NUM}>{hoursText(d.dialingHours)}</td>
                              <td className={TD_NUM}>
                                <RagValue
                                  value={d.idlePct}
                                  targetKey="ceiling_idle_pct"
                                  targetFor={lookup}
                                  suffix="%"
                                />
                              </td>
                              <td className={TD_NUM}>
                                {d.gapsOver15 === null ? (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                ) : d.gapsOver15 > 0 ? (
                                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                                    {Math.round(d.gapsOver15)}
                                  </span>
                                ) : (
                                  <span className="text-gray-500">0</span>
                                )}
                              </td>
                              <td className={TD_NUM}>{clockText(d.firstCallEt)}</td>
                              <td className={TD_NUM}>{clockText(d.lastCallEt)}</td>
                              <td className={`${TD_NUM} text-gray-400 dark:text-gray-500`}>
                                <Plain value={d.humanCalls} />
                              </td>
                              <td className={`${TD_NUM} font-semibold`}>
                                <Plain value={d.dispositioned} />
                              </td>
                              <td className={TD_NUM}>
                                <Plain value={d.appts} />
                              </td>
                              <td className={`${TD_NUM} text-gray-400 dark:text-gray-500`}>
                                <Plain value={d.talkMin} digits={0} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Section heading ──────────────────────────────────────────────────────────
function SectionHead({ n, title, blurb }: { n: number; title: string; blurb: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-mint-green/20 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          {n}
        </span>
        {title}
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">{blurb}</p>
    </div>
  );
}

// ── One setter's occupancy card — the headline of the tab ────────────────────
// Two numbers, side by side, at the same size: hours dialing and the idle share
// of the shift. The split bar underneath is the same two numbers drawn, so the
// "logged in but idle" story is visible before any of the words are read.
function OccupancyCard({
  row,
  name,
  lineOnly,
  targetFor,
}: {
  row: CeilingRow;
  name: string;
  lineOnly: boolean;
  targetFor: TargetLookup;
}) {
  const dial = row.dialingHours;
  const idle = row.idleHours;
  const total = (dial ?? 0) + (idle ?? 0);
  const dialShare = total > 0 && dial !== null ? (dial / total) * 100 : null;

  return (
    <div className={CARD}>
      <div className="card-body p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-gray-900 dark:text-white">{name}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {lineOnly ? (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                title="No setter is mapped to this line in the Numbers tab, so this row is a NUMBER, not a person"
              >
                unmapped line
              </span>
            ) : (
              row.callerId && (
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  title={`These are the dials placed FROM this line. The Numbers tab maps it to ${name} — and the line can be dialed by more than one seat.`}
                >
                  {prettyPhone(row.callerId)}
                </span>
              )
            )}
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              {row.daysWorked === null ? "days —" : `${Math.round(row.daysWorked)} day${row.daysWorked === 1 ? "" : "s"}`}
            </span>
            {row.gapsOver15 !== null && row.gapsOver15 > 0 && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                title="Breaks longer than 15 minutes with no dial placed"
              >
                ⚠ {Math.round(row.gapsOver15)} gap{row.gapsOver15 === 1 ? "" : "s"} &gt; 15m
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Hours actually dialing</div>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {dial === null ? <span className="text-gray-300 dark:text-gray-600">—</span> : hoursText(dial)}
            </div>
            <div
              className="text-[11px] text-gray-500 dark:text-gray-400"
              title="The dialing window: first dial to last dial, summed over the days worked. NOT a time-clock shift."
            >
              of {row.loggedHours === null ? "—" : hoursText(row.loggedHours)} first dial → last
            </div>
          </div>
          <div>
            <div
              className="text-[11px] uppercase tracking-wide text-gray-400"
              title="Share of the first-dial-to-last-dial window spent in gaps longer than 5 minutes"
            >
              Idle inside the window
            </div>
            <div className="text-3xl font-bold tabular-nums">
              <RagValue value={row.idlePct} targetKey="ceiling_idle_pct" targetFor={targetFor} suffix="%" />
            </div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {idle === null ? "idle hours not reported" : `${hoursText(idle)} not dialing`}
            </div>
          </div>
        </div>

        {/* The split, drawn. No bar at all when neither side is known — an empty
            track would read as a fully idle shift. */}
        {dialShare !== null ? (
          <div>
            <div className="h-2.5 w-full rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex">
              <div
                className="h-full"
                style={{ width: `${dialShare}%`, backgroundColor: DIALING_FILL }}
                title={`Dialing ${hoursText(dial)}`}
              />
              <div
                className="h-full"
                style={{ width: `${100 - dialShare}%`, backgroundColor: IDLE_FILL }}
                title={`Idle ${hoursText(idle)}`}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400 mt-1">
              <span>dialing {dialShare.toFixed(0)}%</span>
              <span>idle {(100 - dialShare).toFixed(0)}%</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">
            No hours reported for this row — the split cannot be drawn, which is not the same as a fully idle
            shift.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs border-t border-base-300 pt-2">
          <div
            title="Median first dial across the days worked. Idle% cannot see the time BEFORE this — a late start shortens the window instead of raising idle."
          >
            <span className="text-gray-400">Typical start</span>{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {clockText(row.typicalStartEt)} <span className="font-normal text-gray-400">ET</span>
            </span>
          </div>
          <div>
            <span className="text-gray-400">Typical end</span>{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {clockText(row.typicalEndEt)} <span className="font-normal text-gray-400">ET</span>
            </span>
          </div>
          <div>
            <span className="text-gray-400">Dials</span>{" "}
            <span className="font-semibold text-gray-700 dark:text-gray-200">{intText(row.dials)}</span>
          </div>
          <div>
            <span className="text-gray-400">Pace / dialing hr</span>{" "}
            <RagValue
              value={row.dialsPerDialingHour}
              targetKey="ceiling_dials_per_dialing_hour"
              targetFor={targetFor}
              digits={1}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
