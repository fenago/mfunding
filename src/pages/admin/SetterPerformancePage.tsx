// Setter Performance — the WAVV dial-floor scorecard.
//
// The ONLY dial-floor scorecard: it replaced the HotProspector one that used to
// live at /admin/dialer, and that page has since been deleted with the rest of
// the HP teardown (the historical hotprospector_* tables are untouched in the
// DB — this page just never reads them). Setters dial with WAVV embedded in
// VibeReach, so per-call activity comes from the WAVV Public API v3, mirrored into
// public.wavv_calls every 10 minutes by the `wavv-sync` edge function. This page
// reads the MIRROR for every aggregate and only calls the edge function for three
// things: "Sync now", a recording URL, and a transcript.
//
// MANAGERS ONLY. Closers must not see each other's stats — the route is
// admin-gated and the wavv_calls RLS policy grants select to admin/super_admin
// alone, so a closer session reads nothing even if it reaches the URL. The
// Numbers tab (the attribution control surface) is additionally gated in the UI.
//
// ── READ PATH: THE VIEWS, NOT THE TABLE ──────────────────────────────────────
// Every call this page reads comes from public.v_wavv_outbound_setter_calls, and
// the Numbers tab's worklist from public.v_wavv_outbound_caller_ids. Both are
// security_invoker, so wavv_calls RLS still governs the rows. The view already
// does three things this page must never redo by hand:
//   • filters direction = 'outbound',
//   • joins caller_id -> wavv_caller_setters -> profiles,
//   • normalizes the mapping key.
// So there is NO client-side join here and NO read of wavv_calls — a second
// implementation of the join is a second thing to drift.
//
// ── HONESTY RULES THIS PAGE OBEYS ────────────────────────────────────────────
// 1. UNREADABLE IS NOT ZERO. If the WAVV key is invalid the sync cannot pull, and
//    the page says so in a banner. It never renders an empty floor as "0 dials".
// 2. A missing metric renders as a dimmed "—", never 0. A metric with no value,
//    or no threshold to judge it against, renders GREY — never green.
// 3. ATTRIBUTION IS NEVER INVENTED. WAVV's call object carries NO per-user field
//    (agent_key / agent_name are null on every row, and team_id is one constant
//    for the whole account) — this is permanent, not a sync bug, so there is no
//    "reparse" that fixes it. The only dial-side identifier is caller_id, the
//    number we dialed FROM, so per-setter attribution is an ADMIN-MAINTAINED MAP
//    edited in the Numbers tab. A number with no setter shows under its own
//    caller_label, never as a person. A number two setters share attributes
//    wholly to whoever is assigned to it.
// 4. INBOUND IS OUT OF SCOPE HERE. On an inbound row caller_id is the MERCHANT's
//    number, so it can carry no setter attribution at all. The view excludes it
//    and this page never adds it back.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PhoneIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  PlayIcon,
  DocumentTextIcon,
  FunnelIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  HashtagIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";

// ── Types (mirror the live view contracts) ───────────────────────────────────
/** One row of public.v_wavv_outbound_setter_calls — an OUTBOUND call already
 *  resolved to its setter. `setter_id` null = the number it was dialed from has
 *  nobody assigned to it yet, which is missing attribution, not "no setter". */
interface SetterCall {
  wavv_call_id: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  seconds: number | null;
  outcome: string | null;
  disposition: string | null;
  human: boolean | null;
  recorded: boolean | null;
  phone: string | null;
  contact_name: string | null;
  caller_id: string | null;
  setter_id: string | null;
  setter_name: string | null;
  caller_label: string | null;
  is_attributed: boolean | null;
  note: string | null;
  summary: string | null;
}

// One unbroken string literal on purpose: the client is untyped, so supabase-js
// infers the row shape by parsing this literal. Splitting it across a `+`
// concatenation defeats that parse and the result degrades to GenericStringError.
const CALL_COLS = "wavv_call_id,started_at,answered_at,ended_at,seconds,outcome,disposition,human,recorded,phone,contact_name,caller_id,setter_id,setter_name,caller_label,is_attributed,note,summary";

const CALLS_VIEW = "v_wavv_outbound_setter_calls";
const NUMBERS_VIEW = "v_wavv_outbound_caller_ids";

interface SyncState {
  watermark: string | null;
  last_sync_at: string | null;
  last_status: string;
  last_error: string | null;
  key_invalid: boolean;
  rows_upserted_last: number;
  truncated: boolean;
}

/** v_wavv_outbound_caller_ids — every outbound number seen on the wire, joined
 *  to its mapping state. `call_count` is all-time, not range-scoped. */
interface NumberRow {
  caller_id: string;
  call_count: number;
  first_seen: string | null;
  last_seen: string | null;
  setter_id: string | null;
  setter_name: string | null;
  setter_email: string | null;
  label: string | null;
  source: string | null;
  in_mapping_table: boolean;
  is_assigned: boolean;
}

interface DealRow {
  id: string;
  assigned_closer_id: string | null;
  appointment_at: string | null;
  application_sent_at: string | null;
  funded_at: string | null;
  amount_funded: number | null;
  status: string | null;
}

interface SetterOption {
  id: string;      // profiles.id — what wavv_caller_setters.setter_id references
  name: string;
}

// The aggregate pass pulls raw rows and folds them in the browser. Bounded so a
// wide range can never try to stream the whole view; hitting the cap is
// REPORTED (see aggregateTruncated), never silently absorbed.
const AGG_ROW_CAP = 20000;
const LOG_PAGE_SIZE = 50;
const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  color: "#E5E7EB",
  fontSize: "12px",
};

/** Dispositions that mean the conversation went somewhere. Exact strings as WAVV
 *  reports them — anything not on this list is neutral or negative, never
 *  fuzzy-matched into "positive". */
const POSITIVE_DISPOSITIONS = ["Interested", "Appointment Set", "Full Application", "Callback"];

const UNASSIGNED_FILTER = "__unassigned__";

// ── Date helpers ─────────────────────────────────────────────────────────────
// Ranges are chosen in the MANAGER'S LOCAL DAY (a shift is a local-clock thing),
// then converted to UTC instants for the started_at filters, because started_at
// is timestamptz. dayStart/dayEnd therefore build local midnights and let
// toISOString do the conversion.
function localDayStart(offsetDays = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  d.setHours(0, 0, 0, 0);
  return d;
}
function localDayEnd(offsetDays = 0): Date {
  const d = localDayStart(offsetDays);
  d.setDate(d.getDate() + 1);
  return d;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** A yyyy-mm-dd from a <input type="date"> is a LOCAL calendar day, so it is
 * built as local midnight (not Date.parse, which would read it as UTC). */
function parseYmdLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}
/** True when an ISO instant falls inside the active range. Used for the deal
 *  columns, where three different timestamps are filtered from one query. */
function inRange(iso: string | null, from: Date, to: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
}

type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";
const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today", yesterday: "Yesterday", "7d": "Last 7 days", "30d": "Last 30 days", custom: "Custom",
};

function sinceText(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function prettyPhone(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** How a call's dialing side should be named: the assigned setter, else the
 *  number's admin label, else the number itself. Never a guess. */
function attributionName(r: { setter_name: string | null; caller_label: string | null; caller_id: string | null }): string {
  return r.setter_name ?? r.caller_label ?? (r.caller_id ? prettyPhone(r.caller_id) : "Unknown number");
}

// ── Honest metric rendering ──────────────────────────────────────────────────
// NULL means the mirror has no value for this metric. It renders as a dimmed
// dash — never 0, which would read as real activity ("this rep made zero calls")
// when it is actually absent data.
function Metric({ value, suffix = "", digits = 0 }: { value: number | null; suffix?: string; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-gray-300 dark:text-gray-600" title="Not reported by WAVV for these calls">—</span>;
  }
  return <span>{value.toFixed(digits)}{suffix}</span>;
}

function Text({ value }: { value: string | null }) {
  if (!value) return <span className="text-gray-300 dark:text-gray-600" title="Not reported by WAVV">—</span>;
  return <span>{value}</span>;
}

// ── RAG (red / amber / green) ────────────────────────────────────────────────
// Thresholds live in platform_settings.ph_dialer_kpi_targets so the owner can
// tune them without a deploy. BAND SEMANTICS (one rule, every metric):
//   direction 'higher' → green when value >= green, else amber when >= amber, else red
//   direction 'lower'  → green when value <= green, else amber when <= amber, else red
// Both comparisons are INCLUSIVE of the named edge.
//
// A metric with no value, or with no stored/known threshold, is GREY ("no
// target"). Green must always mean a real number was measured against a real
// threshold — never a default that happens to be lenient.
interface KpiTarget {
  label: string;
  direction: "higher" | "lower";
  green: number;
  amber: number;
  unit?: string;
}
type Rag = "green" | "amber" | "red" | "none";

// Built-in fallbacks for the funnel-stage rates, which the HotProspector-era
// settings blob never had keys for. These are marked in the UI as defaults so a
// manager can tell a tuned threshold from a guessed one.
const DEFAULT_TARGETS: Record<string, KpiTarget> = {
  answer_rate_pct:       { label: "Answer rate",       direction: "higher", green: 35, amber: 20, unit: "%" },
  human_rate_pct:        { label: "Reached a human",   direction: "higher", green: 30, amber: 15, unit: "%" },
  conversation_rate_pct: { label: "Conversation rate", direction: "higher", green: 15, amber: 7,  unit: "%" },
  positive_rate_pct:     { label: "Positive rate",     direction: "higher", green: 20, amber: 10, unit: "%" },
};

function ragOf(value: number | null, t: KpiTarget | null): Rag {
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
  red:   "text-red-600 dark:text-red-400",
  none:  "text-gray-400 dark:text-gray-500",
};
const RAG_CHIP: Record<Rag, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  red:   "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  none:  "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30",
};
const RAG_BAR: Record<Rag, string> = {
  green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", none: "bg-gray-400",
};

/** A percentage with its RAG colour and a tooltip naming the threshold it was
 *  judged against — so a colour is never an unexplained opinion. */
function RagPct({ value, target, digits = 1 }: { value: number | null; target: KpiTarget | null; digits?: number }) {
  const rag = ragOf(value, target);
  if (value === null || !Number.isFinite(value)) return <Metric value={null} />;
  const title = target
    ? `Target: ${target.direction === "lower" ? "≤" : "≥"}${target.green}% green, ${target.direction === "lower" ? "≤" : "≥"}${target.amber}% amber`
    : "No threshold configured for this metric — not judged";
  return <span className={`font-semibold ${RAG_TEXT[rag]}`} title={title}>{value.toFixed(digits)}%</span>;
}

// ── Per-setter aggregate shape ───────────────────────────────────────────────
interface SetterRow {
  key: string;              // profiles.id, or `caller:<digits>` for an unassigned number
  name: string;
  attributed: boolean;      // false = a number with nobody assigned to it
  numbers: string[];        // caller_ids feeding this row
  dials: number;
  connects: number;
  human: number;
  conversations: number;
  positives: number;
  talkSeconds: number;
  connectedSeconds: number;
  activeDays: number;
  uniqueLeads: number;
  // Pipeline side — only meaningful for a real setter (deals join on profiles.id)
  appointments: number | null;
  appsSent: number | null;
  funded: number | null;
  fundedAmount: number | null;
}

type TabId = "funnel" | "setters" | "dispositions" | "trends" | "log" | "numbers";
const TABS: { id: TabId; label: string; icon: typeof PhoneIcon; adminOnly?: boolean }[] = [
  { id: "funnel",       label: "Funnel",       icon: FunnelIcon },
  { id: "setters",      label: "Setters",      icon: UserGroupIcon },
  { id: "dispositions", label: "Dispositions", icon: ChartBarIcon },
  { id: "trends",       label: "Trends",       icon: ArrowTrendingUpIcon },
  { id: "log",          label: "Call log",     icon: ChatBubbleLeftRightIcon },
  { id: "numbers",      label: "Numbers",      icon: HashtagIcon, adminOnly: true },
];

export default function SetterPerformancePage() {
  const { isAdmin, isSuperAdmin } = useUserProfile();
  const canManageNumbers = isAdmin || isSuperAdmin;

  const [tab, setTab] = useState<TabId>("funnel");
  const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
  const [customFrom, setCustomFrom] = useState<string>(ymd(localDayStart(6)));
  const [customTo, setCustomTo] = useState<string>(ymd(localDayStart(0)));

  const [aggRows, setAggRows] = useState<SetterCall[]>([]);
  const [aggregateTruncated, setAggregateTruncated] = useState(false);
  const [totalRowsEver, setTotalRowsEver] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [dealRows, setDealRows] = useState<DealRow[] | null>(null);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, KpiTarget> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "dials", desc: true });

  // Call log (its own paged query — the aggregate slice is not reused, so the log
  // stays correct even when the aggregate pass hits its row cap).
  const [logRows, setLogRows] = useState<SetterCall[]>([]);
  const [logCount, setLogCount] = useState<number | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const [filterSetter, setFilterSetter] = useState<string>("all");
  const [filterNumber, setFilterNumber] = useState<string>("all");
  const [filterDisposition, setFilterDisposition] = useState<string>("all");
  const [filterMinSeconds, setFilterMinSeconds] = useState<string>("");

  // Numbers tab (admin control surface for attribution).
  const [numberRows, setNumberRows] = useState<NumberRow[] | null>(null);
  const [setterOptions, setSetterOptions] = useState<SetterOption[]>([]);
  const [numbersError, setNumbersError] = useState<string | null>(null);
  const [savingNumber, setSavingNumber] = useState<string | null>(null);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, { setter_id: string; label: string }>>({});
  const [numberSaved, setNumberSaved] = useState<string | null>(null);

  // Per-row on-demand media. Signed recording URLs live in component state ONLY —
  // they expire in ~72h, so persisting one would rot into a link that looks valid.
  const [media, setMedia] = useState<Record<string, {
    loadingRec?: boolean; url?: string | null; recError?: string | null;
    open?: boolean; loadingTx?: boolean; transcript?: string | null; summary?: string | null; txError?: string | null;
  }>>({});

  // ── The active range as UTC instants ──────────────────────────────────────
  const range = useMemo(() => {
    switch (rangeKey) {
      case "today":     return { from: localDayStart(0), to: localDayEnd(0) };
      case "yesterday": return { from: localDayStart(1), to: localDayEnd(1) };
      case "7d":        return { from: localDayStart(6), to: localDayEnd(0) };
      case "30d":       return { from: localDayStart(29), to: localDayEnd(0) };
      case "custom": {
        const from = parseYmdLocal(customFrom);
        const to = parseYmdLocal(customTo);
        to.setDate(to.getDate() + 1); // inclusive of the chosen end day
        return { from, to };
      }
    }
  }, [rangeKey, customFrom, customTo]);

  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  // ── Load: sync state + targets + total-ever count + the range slice ───────
  // `to` is the EXCLUSIVE next local midnight, so the bound is .lt — .lte would
  // pull the first instant of the following day into the range.
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [stateRes, targetRes, countRes, sliceRes] = await Promise.all([
        supabase.from("platform_settings").select("value").eq("key", "wavv_sync").maybeSingle(),
        supabase.from("platform_settings").select("value").eq("key", "ph_dialer_kpi_targets").maybeSingle(),
        supabase.from(CALLS_VIEW).select("wavv_call_id", { count: "exact", head: true }),
        supabase.from(CALLS_VIEW)
          .select(CALL_COLS)
          .gte("started_at", fromIso)
          .lt("started_at", toIso)
          .order("started_at", { ascending: false })
          .limit(AGG_ROW_CAP),
      ]);

      if (stateRes.error) throw new Error(stateRes.error.message);
      if (countRes.error) throw new Error(countRes.error.message);
      if (sliceRes.error) throw new Error(sliceRes.error.message);

      setSyncState((stateRes.data?.value ?? null) as SyncState | null);
      // A failed/absent targets read leaves targets null — every RAG then reads
      // "no target" (grey), which is the honest state, not a silent all-green.
      setTargets(targetRes.error ? null : ((targetRes.data?.value ?? null) as Record<string, KpiTarget> | null));
      setTotalRowsEver(countRes.count ?? 0);
      const rows = (sliceRes.data ?? []) as SetterCall[];
      setAggRows(rows);
      setAggregateTruncated(rows.length >= AGG_ROW_CAP);
    } catch (e) {
      // A failed read is UNREADABLE, not an empty floor — blank the slice and
      // show the error rather than letting stale rows imply fresh truth.
      setAggRows([]);
      setLoadError(e instanceof Error ? e.message : "Failed to load WAVV calls");
    }
    setLoading(false);
  }, [fromIso, toIso]);

  useEffect(() => { void load(); }, [load]);

  // ── Pipeline outcomes from deals (the right-hand half of the Setters tab) ──
  // Three different timestamps are in play, so one OR'd query pulls anything
  // that touched the range on ANY of them and the per-metric range test is done
  // in the fold below.
  const loadDeals = useCallback(async () => {
    setDealsError(null);
    try {
      const { data, error } = await supabase
        .from("deals")
        .select("id,assigned_closer_id,appointment_at,application_sent_at,funded_at,amount_funded,status")
        .or(
          `and(appointment_at.gte.${fromIso},appointment_at.lt.${toIso}),` +
          `and(application_sent_at.gte.${fromIso},application_sent_at.lt.${toIso}),` +
          `and(funded_at.gte.${fromIso},funded_at.lt.${toIso})`,
        )
        .limit(5000);
      if (error) throw new Error(error.message);
      setDealRows((data ?? []) as DealRow[]);
    } catch (e) {
      // null (not []) so the pipeline columns render "—", never a fabricated 0.
      setDealRows(null);
      setDealsError(e instanceof Error ? e.message : "Failed to read deals");
    }
  }, [fromIso, toIso]);

  useEffect(() => { void loadDeals(); }, [loadDeals]);

  // ── Numbers tab data (worklist view + the setter roster to assign from) ───
  // The roster is the ACTIVE CLOSERS, resolved to their profiles.id because that
  // is what wavv_caller_setters.setter_id references. A closer with no linked
  // profile cannot be assigned and is left out rather than shown as a dead option.
  const loadNumbers = useCallback(async () => {
    if (!canManageNumbers) return;
    setNumbersError(null);
    try {
      const [numRes, closerRes] = await Promise.all([
        supabase.from(NUMBERS_VIEW).select("*").order("call_count", { ascending: false }),
        supabase.from("closers").select("user_id,first_name,last_name,email,status").eq("status", "active"),
      ]);
      if (numRes.error) throw new Error(numRes.error.message);
      if (closerRes.error) throw new Error(closerRes.error.message);

      setNumberRows((numRes.data ?? []) as NumberRow[]);

      const closers = ((closerRes.data ?? []) as {
        user_id: string | null; first_name: string | null; last_name: string | null; email: string | null;
      }[]).filter((c) => !!c.user_id);

      // Prefer profiles.display_name so the name in the picker is the same name
      // the rest of the page shows (the calls view reads display_name too).
      const ids = closers.map((c) => c.user_id!);
      const nameById = new Map<string, string>();
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id,display_name").in("id", ids);
        for (const p of (profs ?? []) as { id: string; display_name: string | null }[]) {
          if (p.display_name) nameById.set(p.id, p.display_name);
        }
      }
      setSetterOptions(
        closers
          .map((c) => ({
            id: c.user_id!,
            // `||`, not `??`: an all-null name joins to "", which is falsy but
            // NOT nullish, so `??` would happily show a blank option.
            name: nameById.get(c.user_id!)
              || [c.first_name, c.last_name].filter(Boolean).join(" ")
              || c.email
              || c.user_id!.slice(0, 8),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e) {
      setNumberRows(null);
      setNumbersError(e instanceof Error ? e.message : "Failed to load outbound numbers");
    }
  }, [canManageNumbers]);

  useEffect(() => { void loadNumbers(); }, [loadNumbers]);

  // ── Call log query (paged, filtered, independent of the aggregate slice) ──
  // caller_id filters use BARE 10-digit strings: the mapping table's normalizing
  // trigger fires on WRITE only, so a read filter must already be normalized.
  // Every value offered by the filters comes from the view itself, so it is.
  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      let q = supabase.from(CALLS_VIEW)
        .select(CALL_COLS, { count: "exact" })
        .gte("started_at", fromIso)
        .lt("started_at", toIso);

      if (filterSetter !== "all") {
        if (filterSetter === UNASSIGNED_FILTER) q = q.is("setter_id", null);
        else q = q.eq("setter_id", filterSetter);
      }
      if (filterNumber !== "all") q = q.eq("caller_id", filterNumber);
      if (filterDisposition !== "all") {
        if (filterDisposition === "__none__") q = q.is("disposition", null);
        else q = q.eq("disposition", filterDisposition);
      }
      const minSec = parseInt(filterMinSeconds, 10);
      if (Number.isFinite(minSec) && minSec > 0) q = q.gte("seconds", minSec);

      const { data, error, count } = await q
        .order("started_at", { ascending: false })
        .range(logPage * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE + LOG_PAGE_SIZE - 1);

      if (error) throw new Error(error.message);
      setLogRows((data ?? []) as SetterCall[]);
      setLogCount(count ?? 0);
    } catch (e) {
      setLogRows([]);
      setLogCount(null);
      setLoadError((prev) => prev ?? (e instanceof Error ? e.message : "Failed to load the call log"));
    }
    setLogLoading(false);
  }, [fromIso, toIso, filterSetter, filterNumber, filterDisposition, filterMinSeconds, logPage]);

  useEffect(() => { void loadLog(); }, [loadLog]);
  // Any filter or range change restarts pagination — page 3 of a different
  // filter is a different question.
  useEffect(() => { setLogPage(0); }, [fromIso, toIso, filterSetter, filterNumber, filterDisposition, filterMinSeconds]);

  // ── Sync now ──────────────────────────────────────────────────────────────
  async function syncNow() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("wavv-sync", { body: { action: "sync" } });
      if (error) throw new Error(error.message);
      if (data?.key_invalid) {
        setSyncMsg({ ok: false, text: data?.error || "WAVV API key invalid — update it in the Supabase vault." });
      } else if (!data?.ok) {
        setSyncMsg({ ok: false, text: data?.error || "Sync failed." });
      } else {
        const n = data.upserted ?? 0;
        setSyncMsg({
          ok: true,
          text: n === 0
            ? "Synced — WAVV reported no new calls."
            : `Synced ${n} call${n === 1 ? "" : "s"}${data.truncated ? " (more remain — run again)" : ""}.`,
        });
      }
      await load();
      await loadLog();
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : "Sync failed" });
    }
    setSyncing(false);
  }

  // ── Assign a number to a setter (the ONLY way attribution happens) ────────
  // Writes the BASE table, not the view. updated_at / updated_by are set by the
  // table's trigger, which also normalizes caller_id — so the label box can take
  // a number typed with +1, dashes or parens and it still joins cleanly.
  async function saveNumber(row: NumberRow) {
    const draft = numberDrafts[row.caller_id] ?? {
      setter_id: row.setter_id ?? "",
      label: row.label ?? "",
    };
    setSavingNumber(row.caller_id);
    setNumbersError(null);
    setNumberSaved(null);
    try {
      await mustWrite(
        "Assign WAVV caller ID",
        supabase.from("wavv_caller_setters").upsert({
          caller_id: row.caller_id,
          setter_id: draft.setter_id || null,
          label: draft.label.trim() || null,
        }, { onConflict: "caller_id" }),
      );
      setNumberSaved(row.caller_id);
      setNumberDrafts((d) => {
        const next = { ...d };
        delete next[row.caller_id];   // re-seed from the reloaded row
        return next;
      });
      await loadNumbers();
      await load();   // every attributed metric on the page depends on this map
      await loadLog();
    } catch (e) {
      setNumbersError(e instanceof Error ? e.message : "Failed to save the assignment");
    }
    setSavingNumber(null);
  }

  // ── Team funnel ───────────────────────────────────────────────────────────
  // Dial → Connect (answered_at set) → Human (human=true) → Conversation
  // (human AND >=60s) → Positive disposition. Each stage is a strict subset of
  // the one above it, so the step rates below are real conditional rates.
  const funnel = useMemo(() => {
    let dials = 0, connects = 0, humans = 0, conversations = 0, positives = 0;
    let talkSeconds = 0, connectedSeconds = 0;
    const phones = new Set<string>();
    for (const r of aggRows) {
      dials++;
      const secs = r.seconds ?? 0;
      talkSeconds += secs;
      if (r.answered_at) { connects++; connectedSeconds += secs; }
      if (r.human === true) {
        humans++;
        if (secs >= 60) conversations++;
      }
      if (r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition)) positives++;
      if (r.phone) phones.add(r.phone);
    }
    return { dials, connects, humans, conversations, positives, talkSeconds, connectedSeconds, uniqueLeads: phones.size };
  }, [aggRows]);

  const targetFor = useCallback(
    (key: string): { target: KpiTarget | null; isDefault: boolean } => {
      const stored = targets?.[key];
      if (stored && typeof stored.green === "number" && typeof stored.amber === "number") {
        return { target: stored, isDefault: false };
      }
      const fallback = DEFAULT_TARGETS[key];
      return fallback ? { target: fallback, isDefault: true } : { target: null, isDefault: false };
    },
    [targets],
  );

  const funnelStages = useMemo(() => {
    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
    return [
      {
        key: "dials", label: "Dials", help: "Outbound call rows in this range",
        count: funnel.dials, stepLabel: "—", stepPct: null as number | null, targetKey: null as string | null,
      },
      {
        key: "connects", label: "Connects", help: "WAVV recorded an answer timestamp — INCLUDING answering machines",
        count: funnel.connects, stepLabel: "of dials answered", stepPct: pct(funnel.connects, funnel.dials), targetKey: "answer_rate_pct",
      },
      {
        key: "human", label: "Reached a human", help: "WAVV classified the answer as a live person, not voicemail",
        count: funnel.humans, stepLabel: "of answers were human", stepPct: pct(funnel.humans, funnel.connects), targetKey: "human_rate_pct",
      },
      {
        key: "conversations", label: "Conversations (≥60s)", help: "Human answer with at least 60 seconds of talk time",
        count: funnel.conversations, stepLabel: "of humans talked ≥60s", stepPct: pct(funnel.conversations, funnel.humans), targetKey: "conversation_rate_pct",
      },
      {
        key: "positives", label: "Positive dispositions", help: POSITIVE_DISPOSITIONS.join(" · "),
        count: funnel.positives, stepLabel: "of conversations", stepPct: pct(funnel.positives, funnel.conversations), targetKey: "positive_rate_pct",
      },
    ];
  }, [funnel]);

  // ── Per-setter aggregates ─────────────────────────────────────────────────
  // Grouped on the view's own setter_id. A row the view could not attribute
  // (setter_id null) groups under its caller_label — a number is never promoted
  // into a person it was not assigned to.
  const setterRows = useMemo((): SetterRow[] => {
    interface Acc extends Omit<SetterRow, "uniqueLeads" | "activeDays" | "appointments" | "appsSent" | "funded" | "fundedAmount"> {
      phones: Set<string>; days: Set<string>; numberSet: Set<string>;
    }
    const acc = new Map<string, Acc>();
    for (const r of aggRows) {
      const attributed = !!r.setter_id;
      const key = attributed ? r.setter_id! : `caller:${r.caller_id ?? "unknown"}`;
      let row = acc.get(key);
      if (!row) {
        row = {
          key, name: attributionName(r), attributed, numbers: [],
          dials: 0, connects: 0, human: 0, conversations: 0, positives: 0,
          talkSeconds: 0, connectedSeconds: 0,
          phones: new Set<string>(), days: new Set<string>(), numberSet: new Set<string>(),
        };
        acc.set(key, row);
      }
      if (r.caller_id) row.numberSet.add(r.caller_id);
      row.dials++;
      const secs = r.seconds ?? 0;
      row.talkSeconds += secs;
      if (r.answered_at) { row.connects++; row.connectedSeconds += secs; }
      if (r.human === true) {
        row.human++;
        if (secs >= 60) row.conversations++;
      }
      if (r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition)) row.positives++;
      if (r.phone) row.phones.add(r.phone);
      if (r.started_at) row.days.add(ymd(new Date(r.started_at)));
    }

    // Pipeline half. Only a mapped setter has a profiles.id to join deals on;
    // an unassigned number gets null (renders "—"), never 0.
    const byCloser = new Map<string, { appts: number; apps: number; funded: number; amount: number }>();
    if (dealRows) {
      for (const d of dealRows) {
        if (!d.assigned_closer_id) continue;
        const b = byCloser.get(d.assigned_closer_id) ?? { appts: 0, apps: 0, funded: 0, amount: 0 };
        if (inRange(d.appointment_at, range.from, range.to)) b.appts++;
        if (inRange(d.application_sent_at, range.from, range.to)) b.apps++;
        if (inRange(d.funded_at, range.from, range.to) && d.status === "funded") {
          b.funded++;
          b.amount += d.amount_funded ?? 0;
        }
        byCloser.set(d.assigned_closer_id, b);
      }
    }

    return [...acc.values()].map(({ phones, days, numberSet, ...row }) => {
      const deal = row.attributed && dealRows ? (byCloser.get(row.key) ?? { appts: 0, apps: 0, funded: 0, amount: 0 }) : null;
      return {
        ...row,
        numbers: [...numberSet],
        uniqueLeads: phones.size,
        activeDays: days.size,
        appointments: deal ? deal.appts : null,
        appsSent: deal ? deal.apps : null,
        funded: deal ? deal.funded : null,
        fundedAmount: deal ? deal.amount : null,
      };
    });
  }, [aggRows, dealRows, range]);

  const sortedSetterRows = useMemo(() => {
    const val = (r: SetterRow, k: SortKey): number | string => {
      switch (k) {
        case "name":          return r.name.toLowerCase();
        case "dials":         return r.dials;
        case "dialsPerDay":   return r.activeDays > 0 ? r.dials / r.activeDays : -1;
        case "connects":      return r.connects;
        case "human":         return r.human;
        case "conversations": return r.conversations;
        case "positives":     return r.positives;
        case "talk":          return r.talkSeconds;
        case "appointments":  return r.appointments ?? -1;
        case "appsSent":      return r.appsSent ?? -1;
        case "funded":        return r.funded ?? -1;
      }
    };
    return [...setterRows].sort((a, b) => {
      const av = val(a, sort.key), bv = val(b, sort.key);
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
      return sort.desc ? -cmp : cmp;
    });
  }, [setterRows, sort]);

  const anyAttributed = setterRows.some((r) => r.attributed);

  // ── Daily trend ───────────────────────────────────────────────────────────
  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; dials: number; connects: number; human: number; appointments: number }>();
    const touch = (day: string) => {
      let b = byDay.get(day);
      if (!b) { b = { day, dials: 0, connects: 0, human: 0, appointments: 0 }; byDay.set(day, b); }
      return b;
    };
    for (const r of aggRows) {
      if (!r.started_at) continue;
      const b = touch(ymd(new Date(r.started_at))); // local day, matching the picker
      b.dials++;
      if (r.answered_at) b.connects++;
      if (r.human === true) b.human++;
    }
    for (const d of dealRows ?? []) {
      if (inRange(d.appointment_at, range.from, range.to) && d.appointment_at) {
        touch(ymd(new Date(d.appointment_at))).appointments++;
      }
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, label: d.day.slice(5) }));
  }, [aggRows, dealRows, range]);

  // ── Breakdowns ────────────────────────────────────────────────────────────
  const breakdown = useCallback((field: "disposition" | "outcome") => {
    const counts = new Map<string, number>();
    for (const r of aggRows) {
      const k = r[field] ?? "(none)";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = aggRows.length;
    return [...counts.entries()]
      .map(([label, count]) => ({
        label, count,
        pct: total > 0 ? (count / total) * 100 : 0,
        positive: field === "disposition" && POSITIVE_DISPOSITIONS.includes(label),
      }))
      .sort((a, b) => b.count - a.count);
  }, [aggRows]);

  const dispositionBreakdown = useMemo(() => breakdown("disposition"), [breakdown]);
  const outcomeBreakdown = useMemo(() => breakdown("outcome"), [breakdown]);

  // Filter options come from the range slice, so they only ever offer values
  // that actually occur in the data being looked at.
  const numberOptions = useMemo(() => {
    const opts = new Map<string, string>();
    for (const r of aggRows) {
      if (!r.caller_id) continue;
      const who = r.setter_name ?? r.caller_label;
      opts.set(r.caller_id, `${prettyPhone(r.caller_id)}${who ? ` — ${who}` : ""}`);
    }
    return [...opts.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [aggRows]);

  const setterFilterOptions = useMemo(() => {
    const opts = new Map<string, string>();
    let anyUnassigned = false;
    for (const r of aggRows) {
      if (r.setter_id) opts.set(r.setter_id, r.setter_name ?? "Assigned setter");
      else anyUnassigned = true;
    }
    const list = [...opts.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    if (anyUnassigned) list.push([UNASSIGNED_FILTER, "Unassigned numbers"]);
    return list;
  }, [aggRows]);

  const dispositionOptions = useMemo(
    () => dispositionBreakdown.map((d) => (d.label === "(none)" ? ["__none__", "(none)"] as const : [d.label, d.label] as const)),
    [dispositionBreakdown],
  );

  // ── On-demand recording / transcript ──────────────────────────────────────
  async function fetchRecording(callId: string) {
    setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: true, recError: null } }));
    try {
      const { data, error } = await supabase.functions.invoke("wavv-sync", {
        body: { action: "recording", call_id: callId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: false, url: null, recError: data?.error || "No recording available." } }));
        return;
      }
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: false, url: data.url ?? null, recError: data.url ? null : "WAVV returned no recording URL." } }));
    } catch (e) {
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingRec: false, recError: e instanceof Error ? e.message : "Failed to load the recording" } }));
    }
  }

  async function toggleTranscript(callId: string) {
    const cur = media[callId];
    if (cur?.open) { setMedia((m) => ({ ...m, [callId]: { ...m[callId], open: false } })); return; }
    setMedia((m) => ({ ...m, [callId]: { ...m[callId], open: true, loadingTx: true, txError: null } }));
    try {
      const { data, error } = await supabase.functions.invoke("wavv-sync", {
        body: { action: "transcript", call_id: callId },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) {
        setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingTx: false, txError: data?.error || "No transcript available yet." } }));
        return;
      }
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingTx: false, transcript: data.transcript ?? null, summary: data.summary ?? null } }));
    } catch (e) {
      setMedia((m) => ({ ...m, [callId]: { ...m[callId], loadingTx: false, txError: e instanceof Error ? e.message : "Failed to load the transcript" } }));
    }
  }

  // ── Derived banner conditions ─────────────────────────────────────────────
  const keyInvalid = syncState?.key_invalid === true || syncState?.last_status === "key_invalid";
  const neverSynced = (totalRowsEver ?? 0) === 0;
  const emptyRange = !neverSynced && aggRows.length === 0 && !loading;
  const logPages = logCount === null ? 0 : Math.ceil(logCount / LOG_PAGE_SIZE);
  const visibleTabs = TABS.filter((t) => !t.adminOnly || canManageNumbers);

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PhoneIcon className="w-6 h-6 text-mint-green" /> Setter Performance
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-3xl text-sm">
            Outbound dial-floor activity from the <span className="font-medium">WAVV dialer</span> (embedded in
            VibeReach), mirrored here every 10 minutes, joined to pipeline outcomes from{" "}
            <span className="font-medium">Deals</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <span className={`text-sm ${syncMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {syncMsg.text}
            </span>
          )}
          <div className="text-right">
            <button className="btn btn-sm btn-primary gap-2" onClick={syncNow} disabled={syncing}>
              <ArrowPathIcon className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <div className="text-xs text-gray-400 mt-1">
              Last sync {sinceText(syncState?.last_sync_at ?? null)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Range picker (applies to EVERY tab) ── */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
          <button
            key={k}
            className={`btn btn-xs ${rangeKey === k ? "btn-primary" : "btn-ghost border border-base-300"}`}
            onClick={() => setRangeKey(k)}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
        {rangeKey === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input type="date" className="input input-xs input-bordered" value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" className="input input-xs input-bordered" value={customTo}
              onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
        <span className="text-xs text-gray-400 ml-2">
          {range.from.toLocaleDateString()} – {new Date(range.to.getTime() - 1).toLocaleDateString()} (your local days)
        </span>
      </div>

      {/* ── Banners ── */}
      {keyInvalid && (
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-semibold">WAVV API key invalid — the sync cannot pull calls.</div>
            <div className="text-sm opacity-90">
              Update <code>WAVV_API_KEY</code> in the Supabase vault. Until then this page can only show calls
              that were already mirrored; anything below may be stale or incomplete — it is not a report that
              the floor was quiet.
              {syncState?.last_error ? <div className="mt-1 opacity-80">{syncState.last_error}</div> : null}
            </div>
          </div>
        </div>
      )}

      {loadError && (
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>Could not read setter performance: {loadError}</span>
        </div>
      )}

      {!loading && neverSynced && !loadError && (
        <div className="alert">
          <InformationCircleIcon className="w-5 h-5" />
          <span>
            Waiting for first sync — no outbound WAVV calls have been mirrored yet.
            {keyInvalid ? " Fix the API key above, then press Sync now." : " Press Sync now, or wait for the 10-minute cron."}
          </span>
        </div>
      )}

      {aggregateTruncated && (
        <div className="alert alert-warning">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>
            This range exceeds {AGG_ROW_CAP.toLocaleString()} calls — the funnel, scorecard, charts and
            breakdowns cover only the {AGG_ROW_CAP.toLocaleString()} most recent calls in it. Narrow the
            range for exact totals. (The call log is queried separately and stays exact.)
          </span>
        </div>
      )}

      {/* ── Attribution notice — permanent, not a bug to be fixed by a reparse ── */}
      {!loading && aggRows.length > 0 && !anyAttributed && (
        <div className="alert alert-info">
          <InformationCircleIcon className="w-5 h-5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">No outbound number is assigned to a setter yet.</div>
            WAVV's call records carry no per-agent field, so dials are attributed by the number they were
            placed FROM. Until a number is assigned{canManageNumbers ? <> in the <b>Numbers</b> tab</> : " by an admin"},
            each one shows as its own row — that is missing attribution, not one person doing all the dialing.
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-mint-green text-mint-green"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="loading loading-spinner loading-sm" /> Loading WAVV calls…
        </div>
      ) : (
        <>
          {/* ═══════════════ FUNNEL ═══════════════ */}
          {tab === "funnel" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="space-y-5">
                {/* Floor totals */}
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Dials", value: funnel.dials, fmt: (v: number) => v.toLocaleString() },
                    { label: "Connects", value: funnel.connects, fmt: (v: number) => v.toLocaleString() },
                    { label: "Humans", value: funnel.humans, fmt: (v: number) => v.toLocaleString() },
                    { label: "Convos ≥60s", value: funnel.conversations, fmt: (v: number) => v.toLocaleString() },
                    { label: "Talk time", value: funnel.talkSeconds, fmt: hms },
                    { label: "Unique leads", value: funnel.uniqueLeads, fmt: (v: number) => v.toLocaleString() },
                  ].map((kpi) => (
                    <div key={kpi.label} className="card bg-base-100 border border-base-300 shadow-sm">
                      <div className="card-body p-4">
                        <div className="text-xs uppercase tracking-wide text-gray-400">{kpi.label}</div>
                        <div className="text-xl font-semibold text-gray-900 dark:text-white">
                          {kpi.value === null ? <Metric value={null} /> : kpi.fmt(kpi.value)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* The funnel itself */}
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <FunnelIcon className="w-5 h-5 text-mint-green" /> Dial funnel (outbound)
                      </h2>
                      <RagLegend />
                    </div>

                    <div className="space-y-3">
                      {funnelStages.map((s, i) => {
                        const { target, isDefault } = s.targetKey ? targetFor(s.targetKey) : { target: null, isDefault: false };
                        const rag = ragOf(s.stepPct, target);
                        const widthPct = funnel.dials > 0 ? Math.max((s.count / funnel.dials) * 100, s.count > 0 ? 1.5 : 0) : 0;
                        return (
                          <div key={s.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                            <div className="w-full sm:w-52 shrink-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-white" title={s.help}>{s.label}</div>
                              <div className="text-xs text-gray-400">
                                {funnel.dials > 0 ? `${((s.count / funnel.dials) * 100).toFixed(1)}% of dials` : "—"}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="h-7 w-full rounded bg-base-200 dark:bg-gray-700/40 overflow-hidden">
                                <div
                                  className={`h-full ${i === 0 ? "bg-sky-500" : RAG_BAR[rag]} transition-all`}
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                            </div>
                            <div className="w-full sm:w-56 shrink-0 flex items-center justify-between sm:justify-end gap-3">
                              <span className="text-base font-semibold text-gray-900 dark:text-white tabular-nums">
                                {s.count.toLocaleString()}
                              </span>
                              {i === 0 ? (
                                <span className="text-xs text-gray-400">start</span>
                              ) : (
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${RAG_CHIP[rag]}`}>
                                  <RagPct value={s.stepPct} target={target} />
                                  <span className="opacity-70">{s.stepLabel}</span>
                                  {isDefault && <span title="Judged against a built-in default — no threshold stored in ph_dialer_kpi_targets">·</span>}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-xs text-gray-400">
                      Thresholds come from <code>platform_settings.ph_dialer_kpi_targets</code>. A rate marked
                      with <span className="font-semibold">·</span> has no stored threshold and is judged against a
                      built-in default. A rate with no threshold at all renders grey — never green.
                      {targets === null && <span className="text-amber-600 dark:text-amber-400"> Targets could not be read this load, so stored thresholds are not in play.</span>}
                    </p>
                  </div>
                </div>

                {/* The insight — the thing a manager should act on */}
                {funnel.dials > 0 && (
                  <div className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4">
                      <h2 className="font-semibold text-gray-900 dark:text-white">Where the floor is losing the day</h2>
                      <ul className="mt-2 space-y-2 text-sm text-gray-600 dark:text-gray-300">
                        <li>
                          <span className="font-semibold text-gray-900 dark:text-white">Answers are not contacts.</span>{" "}
                          {funnel.connects.toLocaleString()} of {funnel.dials.toLocaleString()} dials registered an answer
                          ({funnel.dials > 0 ? ((funnel.connects / funnel.dials) * 100).toFixed(0) : "—"}%), but only{" "}
                          <b className="text-gray-900 dark:text-white">{funnel.connects > 0 ? ((funnel.humans / funnel.connects) * 100).toFixed(0) : "—"}%</b>{" "}
                          of those reached a <b>human</b> — the rest are answering machines. Judge the floor on humans, not connects.
                        </li>
                        <li>
                          <span className="font-semibold text-gray-900 dark:text-white">The tail is thin.</span>{" "}
                          <b className="text-gray-900 dark:text-white">{funnel.conversations.toLocaleString()}</b> conversations
                          ran 60 seconds or longer, and <b className="text-gray-900 dark:text-white">{funnel.positives.toLocaleString()}</b>{" "}
                          calls carried a positive disposition ({POSITIVE_DISPOSITIONS.join(", ")}) — that is{" "}
                          <b className="text-gray-900 dark:text-white">
                            {funnel.dials > 0 ? ((funnel.positives / funnel.dials) * 100).toFixed(2) : "—"}%
                          </b>{" "}
                          of all dials.
                        </li>
                        <li>
                          <span className="font-semibold text-gray-900 dark:text-white">Dials per conversation:</span>{" "}
                          <b className="text-gray-900 dark:text-white">
                            {funnel.conversations > 0 ? Math.round(funnel.dials / funnel.conversations).toLocaleString() : "—"}
                          </b>
                          {funnel.conversations > 0 && " dials buy one real conversation at the current list and script quality."}
                        </li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )
          )}

          {/* ═══════════════ SETTERS ═══════════════ */}
          {tab === "setters" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="space-y-4">
                <div className="card bg-base-100 border border-base-300 shadow-sm">
                  <div className="card-body p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <UserGroupIcon className="w-5 h-5 text-mint-green" /> Per-setter scorecard
                      </h2>
                      <RagLegend />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      Left half = dialing, attributed by the number dialed FROM. Right half = pipeline, from
                      Deals assigned to that person in this range. An unassigned number has no person to join
                      deals on, so its pipeline cells read “—”.
                    </p>
                    {dealsError && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Pipeline columns unreadable this load ({dealsError}) — they show “—”, which is unknown, not zero.
                      </p>
                    )}

                    <div className="overflow-x-auto mt-3">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th className="text-left" />
                            <th colSpan={8} className="text-center text-xs uppercase tracking-wide text-gray-400 border-b border-base-300">Dialing (WAVV)</th>
                            <th colSpan={3} className="text-center text-xs uppercase tracking-wide text-gray-400 border-b border-base-300">Pipeline (Deals)</th>
                          </tr>
                          <tr>
                            {SETTER_COLUMNS.map((c) => (
                              <th
                                key={c.key ?? c.label}
                                className={`${c.align} ${c.key ? "cursor-pointer select-none" : ""} whitespace-nowrap`}
                                onClick={() => c.key && sortBy(c.key)}
                                title={c.help}
                              >
                                {c.label}
                                {c.key && sort.key === c.key && <span className="ml-1 text-mint-green">{sort.desc ? "▼" : "▲"}</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedSetterRows.map((r) => {
                            const dialsPerDay = r.activeDays > 0 ? r.dials / r.activeDays : null;
                            const answerRate = r.dials > 0 ? (r.connects / r.dials) * 100 : null;
                            const humanRate = r.connects > 0 ? (r.human / r.connects) * 100 : null;
                            const dpd = targetFor("dials_per_day");
                            const dpdRag = ragOf(dialsPerDay, dpd.target);
                            return (
                              <tr key={r.key} className="hover">
                                <td className="font-medium text-gray-900 dark:text-white min-w-[12rem]">
                                  <div className="flex items-center gap-2">
                                    {r.name}
                                    {!r.attributed && (
                                      <span className="badge badge-xs badge-ghost" title="This number has no setter assigned — assign it in the Numbers tab">
                                        unassigned
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-400">{r.numbers.map(prettyPhone).join(" · ") || "—"}</div>
                                </td>
                                <td className="text-right tabular-nums">{r.dials.toLocaleString()}</td>
                                <td className="text-right tabular-nums">
                                  <span className={`font-semibold ${RAG_TEXT[dpdRag]}`} title={dpd.target ? `Target ≥${dpd.target.green}/day green, ≥${dpd.target.amber} amber · over ${r.activeDays} day${r.activeDays === 1 ? "" : "s"} with activity` : "No threshold configured"}>
                                    <Metric value={dialsPerDay} />
                                  </span>
                                </td>
                                <td className="text-right tabular-nums">{r.connects.toLocaleString()}</td>
                                <td className="text-right tabular-nums"><RagPct value={answerRate} target={targetFor("answer_rate_pct").target} /></td>
                                <td className="text-right tabular-nums">{r.human.toLocaleString()}</td>
                                <td className="text-right tabular-nums"><RagPct value={humanRate} target={targetFor("human_rate_pct").target} /></td>
                                <td className="text-right tabular-nums">
                                  <span title={`${hms(r.talkSeconds)} total talk time`}>{r.conversations.toLocaleString()}</span>
                                </td>
                                <td className="text-right tabular-nums">{r.positives.toLocaleString()}</td>
                                <td className="text-right tabular-nums">{r.appointments === null ? <Metric value={null} /> : r.appointments.toLocaleString()}</td>
                                <td className="text-right tabular-nums">{r.appsSent === null ? <Metric value={null} /> : r.appsSent.toLocaleString()}</td>
                                <td className="text-right tabular-nums">
                                  {r.funded === null ? <Metric value={null} /> : (
                                    <span title={r.fundedAmount ? `${usd(r.fundedAmount)} funded` : undefined}>
                                      {r.funded.toLocaleString()}
                                      {r.fundedAmount ? <span className="text-xs text-gray-400 ml-1">{usd(r.fundedAmount)}</span> : null}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {sortedSetterRows.length === 0 && (
                            <tr><td colSpan={12} className="text-center text-sm text-gray-400 py-6">No outbound calls in this range.</td></tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold border-t-2 border-base-300">
                            <td>Team</td>
                            <td className="text-right tabular-nums">{funnel.dials.toLocaleString()}</td>
                            <td className="text-right"><Metric value={null} /></td>
                            <td className="text-right tabular-nums">{funnel.connects.toLocaleString()}</td>
                            <td className="text-right tabular-nums"><RagPct value={funnel.dials > 0 ? (funnel.connects / funnel.dials) * 100 : null} target={targetFor("answer_rate_pct").target} /></td>
                            <td className="text-right tabular-nums">{funnel.humans.toLocaleString()}</td>
                            <td className="text-right tabular-nums"><RagPct value={funnel.connects > 0 ? (funnel.humans / funnel.connects) * 100 : null} target={targetFor("human_rate_pct").target} /></td>
                            <td className="text-right tabular-nums">{funnel.conversations.toLocaleString()}</td>
                            <td className="text-right tabular-nums">{funnel.positives.toLocaleString()}</td>
                            <td className="text-right tabular-nums">{sumOrDash(sortedSetterRows.map((r) => r.appointments))}</td>
                            <td className="text-right tabular-nums">{sumOrDash(sortedSetterRows.map((r) => r.appsSent))}</td>
                            <td className="text-right tabular-nums">{sumOrDash(sortedSetterRows.map((r) => r.funded))}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* ═══════════════ DISPOSITIONS ═══════════════ */}
          {tab === "dispositions" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {[
                  { title: "Dispositions (setter-selected)", rows: dispositionBreakdown, fill: "#007EA7", note: "What the setter marked after the call. Highlighted rows are the positive set." },
                  { title: "Outcomes (dialer-reported)", rows: outcomeBreakdown, fill: "#8B5CF6", note: "What WAVV's telephony layer observed. Independent of what the setter marked." },
                ].map((panel) => (
                  <div key={panel.title} className="card bg-base-100 border border-base-300 shadow-sm">
                    <div className="card-body p-4">
                      <h2 className="font-semibold text-gray-900 dark:text-white">{panel.title}</h2>
                      <p className="text-xs text-gray-400">{panel.note} Across {funnel.dials.toLocaleString()} outbound calls in range.</p>
                      {panel.rows.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4">Nothing reported in this range.</p>
                      ) : (
                        <>
                          <div className="overflow-x-auto mt-2">
                            <table className="table table-xs">
                              <thead>
                                <tr><th>Value</th><th className="text-right">Calls</th><th className="text-right">%</th><th className="w-1/3">Share</th></tr>
                              </thead>
                              <tbody>
                                {panel.rows.map((d) => (
                                  <tr key={d.label} className="hover">
                                    <td className="whitespace-nowrap">
                                      {d.label === "(none)"
                                        ? <span className="text-gray-300 dark:text-gray-600 italic" title="No disposition was recorded on these calls">(none)</span>
                                        : d.label}
                                      {d.positive && (
                                        <span className="ml-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                                          <CheckCircleIcon className="w-3 h-3" /> positive
                                        </span>
                                      )}
                                    </td>
                                    <td className="text-right tabular-nums">{d.count.toLocaleString()}</td>
                                    <td className="text-right tabular-nums">{d.pct.toFixed(1)}%</td>
                                    <td>
                                      <div className="h-2 w-full rounded bg-base-200 dark:bg-gray-700/40 overflow-hidden">
                                        <div className={`h-full ${d.positive ? "bg-emerald-500" : "bg-sky-600"}`} style={{ width: `${Math.min(100, d.pct)}%` }} />
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <ResponsiveContainer width="100%" height={Math.max(160, panel.rows.length * 30)}>
                            <BarChart data={panel.rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
                              <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                              <Tooltip
                                contentStyle={TOOLTIP_STYLE}
                                formatter={(v, _n, item) => {
                                  const pct = (item as { payload?: { pct?: number } })?.payload?.pct ?? 0;
                                  return [`${(Number(v) || 0).toLocaleString()} (${pct.toFixed(1)}%)`, "Calls"];
                                }}
                              />
                              <Bar dataKey="count" fill={panel.fill} radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ═══════════════ TRENDS ═══════════════ */}
          {tab === "trends" && (
            emptyRange ? <EmptyRange total={totalRowsEver} /> : (
              <div className="card bg-base-100 border border-base-300 shadow-sm">
                <div className="card-body p-4">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Daily activity</h2>
                  <p className="text-xs text-gray-400">
                    Dials, connects and human contacts from WAVV (outbound); appointments from Deals by
                    <code className="mx-1">appointment_at</code>. Days with no calls simply do not appear —
                    the axis is the days that had activity, not a zero-filled calendar.
                  </p>
                  {trend.length === 0 ? (
                    <p className="text-sm text-gray-400 py-6">No activity in this range.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={trend} margin={{ top: 12, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#9CA3AF" }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [(Number(v) || 0).toLocaleString(), String(n)]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="right" dataKey="appointments" name="Appointments" fill="#F59E0B" radius={[4, 4, 0, 0]} barSize={18} />
                        <Line yAxisId="left" type="monotone" dataKey="dials" name="Dials" stroke="#007EA7" strokeWidth={2} dot={false} />
                        <Line yAxisId="left" type="monotone" dataKey="connects" name="Connects" stroke="#8B5CF6" strokeWidth={2} dot={false} />
                        <Line yAxisId="left" type="monotone" dataKey="human" name="Humans" stroke="#00C49A" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            )
          )}

          {/* ═══════════════ CALL LOG ═══════════════ */}
          {tab === "log" && (
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-mint-green" /> Call log
                    {logCount !== null && <span className="text-sm font-normal text-gray-400">({logCount.toLocaleString()})</span>}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="select select-xs select-bordered" value={filterSetter} onChange={(e) => setFilterSetter(e.target.value)}>
                      <option value="all">All setters</option>
                      {setterFilterOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select className="select select-xs select-bordered" value={filterNumber} onChange={(e) => setFilterNumber(e.target.value)}>
                      <option value="all">All numbers</option>
                      {numberOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                    <select className="select select-xs select-bordered" value={filterDisposition} onChange={(e) => setFilterDisposition(e.target.value)}>
                      <option value="all">All dispositions</option>
                      {dispositionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input
                      type="number" min={0} placeholder="Min secs"
                      className="input input-xs input-bordered w-24"
                      value={filterMinSeconds}
                      onChange={(e) => setFilterMinSeconds(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400">Outbound calls only — an inbound call's caller ID is the merchant, so it carries no setter attribution.</p>

                {logLoading ? (
                  <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                    <span className="loading loading-spinner loading-sm" /> Loading calls…
                  </div>
                ) : logRows.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">
                    {neverSynced ? "Waiting for first sync — no outbound WAVV calls have been mirrored yet." : "No calls match these filters."}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Time</th><th>Attributed to</th><th>Contact</th><th className="text-right">Duration</th>
                          <th>Outcome</th><th>Disposition</th><th>Human</th><th>Note</th><th>Recording</th><th>Transcript</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logRows.map((r) => {
                          const m = media[r.wavv_call_id] ?? {};
                          return (
                            <tr key={r.wavv_call_id} className="hover align-top">
                              <td className="whitespace-nowrap">
                                {r.started_at ? new Date(r.started_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : <Metric value={null} />}
                              </td>
                              <td className="min-w-[10rem]">
                                {r.setter_name ? (
                                  <span className="font-medium text-gray-900 dark:text-white">{r.setter_name}</span>
                                ) : (
                                  <span className="text-gray-400 italic" title="This outbound number has no setter assigned — assign it in the Numbers tab">
                                    {r.caller_label ?? prettyPhone(r.caller_id)}
                                  </span>
                                )}
                                <div className="text-xs text-gray-400">{prettyPhone(r.caller_id)}</div>
                              </td>
                              <td className="min-w-[9rem]">
                                <Text value={r.contact_name} />
                                <div className="text-xs text-gray-400">{prettyPhone(r.phone)}</div>
                              </td>
                              <td className="text-right whitespace-nowrap">{r.seconds === null ? <Metric value={null} /> : hms(r.seconds)}</td>
                              <td><Text value={r.outcome} /></td>
                              <td>
                                {r.disposition && POSITIVE_DISPOSITIONS.includes(r.disposition)
                                  ? <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.disposition}</span>
                                  : <Text value={r.disposition} />}
                              </td>
                              <td>
                                {r.human === null
                                  ? <Metric value={null} />
                                  : <span className={`badge badge-xs ${r.human ? "badge-success" : "badge-ghost"}`}>{r.human ? "human" : "machine"}</span>}
                              </td>
                              <td className="max-w-[14rem]">
                                {r.note
                                  ? <span className="text-xs whitespace-pre-wrap break-words">{r.note}</span>
                                  : <span className="text-gray-300 dark:text-gray-600" title="No note left on this call">—</span>}
                              </td>
                              <td className="min-w-[13rem]">
                                {r.recorded === false || r.recorded === null ? (
                                  <span className="text-gray-300 dark:text-gray-600 text-xs" title={r.recorded === null ? "WAVV did not report whether this call was recorded" : "This call was not recorded"}>
                                    no recording
                                  </span>
                                ) : m.url ? (
                                  <audio controls preload="none" src={m.url} className="w-52 h-8" />
                                ) : (
                                  <div className="space-y-1">
                                    <button className="btn btn-xs btn-ghost gap-1" onClick={() => fetchRecording(r.wavv_call_id)} disabled={m.loadingRec}>
                                      <PlayIcon className="w-3 h-3" />{m.loadingRec ? "Loading…" : "Play"}
                                    </button>
                                    {m.recError && <div className="text-xs text-red-500 max-w-[13rem]">{m.recError}</div>}
                                  </div>
                                )}
                              </td>
                              <td className="min-w-[16rem]">
                                <button className="btn btn-xs btn-ghost gap-1" onClick={() => toggleTranscript(r.wavv_call_id)}>
                                  <DocumentTextIcon className="w-3 h-3" />{m.open ? "Hide" : "Transcript"}
                                </button>
                                {m.open && (
                                  <div className="mt-1 text-xs max-w-md">
                                    {m.loadingTx ? (
                                      <span className="text-gray-400">Loading…</span>
                                    ) : m.txError ? (
                                      <span className="text-amber-600 dark:text-amber-400">{m.txError}</span>
                                    ) : (
                                      <>
                                        {(m.summary ?? r.summary) && (
                                          <div className="mb-1 p-2 rounded bg-base-200">
                                            <span className="font-semibold">Summary: </span>{m.summary ?? r.summary}
                                          </div>
                                        )}
                                        {m.transcript
                                          ? <div className="whitespace-pre-wrap p-2 rounded bg-base-200 max-h-48 overflow-y-auto">{m.transcript}</div>
                                          : <span className="text-gray-400">No transcript yet — WAVV populates these after the call.</span>}
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {logPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-gray-400">Page {logPage + 1} of {logPages}</span>
                    <div className="join">
                      <button className="btn btn-xs join-item" disabled={logPage === 0} onClick={() => setLogPage((p) => Math.max(0, p - 1))}>Prev</button>
                      <button className="btn btn-xs join-item" disabled={logPage + 1 >= logPages} onClick={() => setLogPage((p) => p + 1)}>Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════ NUMBERS (admin only) ═══════════════ */}
          {tab === "numbers" && canManageNumbers && (
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
                <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <HashtagIcon className="w-5 h-5 text-mint-green" /> Outbound numbers → setters
                </h2>
                <div className="alert alert-info mt-2">
                  <InformationCircleIcon className="w-5 h-5 shrink-0" />
                  <div className="text-sm space-y-1">
                    <div>
                      <b>This is the only place per-setter attribution comes from.</b> WAVV's API exposes no
                      per-agent field on a call, so a dial is credited to whoever is assigned to the number it
                      was placed FROM. Assign a number here and every tab on this page re-attributes at once.
                    </div>
                    <div>
                      <b>Shared-number caveat:</b> if two setters dial from the same number, <u>all</u> of that
                      number's dials credit to the single assigned setter. To split credit, give each setter
                      their own outbound number in WAVV.
                    </div>
                    <div className="opacity-80">
                      Numbers seen on the wire but never added are listed too — assigning one adds it. Call
                      counts here are <b>all-time</b>, not limited to the date range above. The picker lists
                      active closers.
                    </div>
                  </div>
                </div>

                {numbersError && (
                  <div className="alert alert-error mt-3">
                    <ExclamationTriangleIcon className="w-5 h-5" />
                    <span>{numbersError}</span>
                  </div>
                )}

                {numberRows === null ? (
                  <p className="text-sm text-gray-400 py-4">
                    {numbersError ? "Outbound numbers could not be read — this is unknown, not an empty list." : "Loading numbers…"}
                  </p>
                ) : numberRows.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">No outbound numbers have been seen in wavv_calls yet.</p>
                ) : (
                  <div className="overflow-x-auto mt-3">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Number</th><th className="text-right">Calls (all time)</th><th>Last used</th>
                          <th>Label</th><th>Assigned setter</th><th>State</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {numberRows.map((n) => {
                          const draft = numberDrafts[n.caller_id] ?? { setter_id: n.setter_id ?? "", label: n.label ?? "" };
                          const dirty = draft.setter_id !== (n.setter_id ?? "") || draft.label !== (n.label ?? "");
                          return (
                            <tr key={n.caller_id} className="hover align-top">
                              <td className="font-medium text-gray-900 dark:text-white whitespace-nowrap">
                                {prettyPhone(n.caller_id)}
                                <div className="text-xs text-gray-400">{n.caller_id}</div>
                              </td>
                              <td className="text-right tabular-nums">{n.call_count.toLocaleString()}</td>
                              <td className="whitespace-nowrap text-sm">
                                {n.last_seen ? new Date(n.last_seen).toLocaleDateString() : <Metric value={null} />}
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="input input-xs input-bordered w-44"
                                  placeholder="e.g. WAVV outbound line 1"
                                  value={draft.label}
                                  onChange={(e) => setNumberDrafts((d) => ({ ...d, [n.caller_id]: { ...draft, label: e.target.value } }))}
                                />
                              </td>
                              <td>
                                <select
                                  className="select select-xs select-bordered w-52"
                                  value={draft.setter_id}
                                  onChange={(e) => setNumberDrafts((d) => ({ ...d, [n.caller_id]: { ...draft, setter_id: e.target.value } }))}
                                >
                                  <option value="">— Unassigned —</option>
                                  {setterOptions.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                  {/* A setter assigned earlier who has since left the active roster must
                                      still render, or the picker would silently show "Unassigned". */}
                                  {n.setter_id && !setterOptions.some((s) => s.id === n.setter_id) && (
                                    <option value={n.setter_id}>{n.setter_name ?? "Assigned (inactive closer)"}</option>
                                  )}
                                </select>
                              </td>
                              <td className="whitespace-nowrap">
                                {n.is_assigned ? (
                                  <span className="badge badge-xs badge-success">assigned</span>
                                ) : n.in_mapping_table ? (
                                  <span className="badge badge-xs badge-warning">unassigned</span>
                                ) : (
                                  <span className="badge badge-xs badge-ghost" title="Seen on the wire but never added to the mapping table — saving adds it">new</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap">
                                <button
                                  className="btn btn-xs btn-primary"
                                  disabled={!dirty || savingNumber === n.caller_id}
                                  onClick={() => saveNumber(n)}
                                >
                                  {savingNumber === n.caller_id ? "Saving…" : "Save"}
                                </button>
                                {numberSaved === n.caller_id && !dirty && (
                                  <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Small shared pieces ──────────────────────────────────────────────────────
type SortKey =
  | "name" | "dials" | "dialsPerDay" | "connects" | "human" | "conversations"
  | "positives" | "talk" | "appointments" | "appsSent" | "funded";

const SETTER_COLUMNS: { key: SortKey | null; label: string; align: string; help?: string }[] = [
  { key: "name",          label: "Setter / number", align: "text-left" },
  { key: "dials",         label: "Dials",     align: "text-right", help: "Outbound calls placed from this setter's number(s)" },
  { key: "dialsPerDay",   label: "Dials/day", align: "text-right", help: "Dials ÷ days in this range on which this setter actually dialed" },
  { key: "connects",      label: "Connects",  align: "text-right", help: "Calls with an answer timestamp — includes answering machines" },
  { key: null,            label: "Answer %",  align: "text-right", help: "Connects ÷ dials" },
  { key: "human",         label: "Humans",    align: "text-right", help: "Calls WAVV classified as reaching a live person" },
  { key: null,            label: "Human %",   align: "text-right", help: "Humans ÷ connects" },
  { key: "conversations", label: "Convos",    align: "text-right", help: "Human answer with at least 60 seconds of talk time" },
  { key: "positives",     label: "Positive",  align: "text-right", help: "Interested · Appointment Set · Full Application · Callback" },
  { key: "appointments",  label: "Appts",     align: "text-right", help: "Deals with an appointment booked in this range" },
  { key: "appsSent",      label: "Apps sent", align: "text-right", help: "Deals whose application was sent in this range" },
  { key: "funded",        label: "Funded",    align: "text-right", help: "Deals funded in this range" },
];

/** Sum a column of possibly-null values. If ANY value is unknown the total is
 *  unknown — a partial sum presented as a total is a lie. */
function sumOrDash(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <Metric value={null} />;
  return <span>{known.reduce((a, b) => a + b, 0).toLocaleString()}</span>;
}

function RagLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> on target</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> below target</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> off target</span>
      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-400" /> no target / no data</span>
    </div>
  );
}

function EmptyRange({ total }: { total: number | null }) {
  return (
    <div className="alert">
      <InformationCircleIcon className="w-5 h-5" />
      <span>
        No outbound calls in this range. {total === null ? "The all-time count is unreadable." : `${total.toLocaleString()} outbound call${total === 1 ? "" : "s"} are mirrored across all time.`}
      </span>
    </div>
  );
}
