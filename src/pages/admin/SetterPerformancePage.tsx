// Setter Performance — the WAVV dial-floor scorecard.
//
// REPLACES the HotProspector scorecard at /admin/dialer (HP is retired; that page
// is frozen as the historical record). Setters now dial with WAVV embedded in
// VibeReach, so per-call activity comes from the WAVV Public API v3, mirrored into
// public.wavv_calls every 10 minutes by the `wavv-sync` edge function. This page
// reads the MIRROR for every aggregate and only calls the edge function for three
// things: "Sync now", a recording URL, and a transcript.
//
// MANAGERS ONLY. Closers must not see each other's stats — the route is
// admin-gated and the wavv_calls RLS policy grants select to admin/super_admin
// alone, so a closer session reads nothing even if it reaches the URL.
//
// ── HONESTY RULES THIS PAGE OBEYS ────────────────────────────────────────────
// 1. UNREADABLE IS NOT ZERO. If the WAVV key is invalid the sync cannot pull, and
//    the page says so in a banner. It never renders an empty floor as "0 dials".
// 2. A missing metric renders as a dimmed "—", never 0.
// 3. Rep attribution is NEVER invented. WAVV's docs never named the per-agent
//    field on a call object, so wavv_calls.agent_key may be null for every row
//    until it is observed on live data and back-filled by the sync's `reparse`
//    action. Until then this page shows one honest "Unattributed" row and says
//    why, rather than fabricating a roster.

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
} from "@heroicons/react/24/outline";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import supabase from "@/supabase";

// ── Types (mirror the live DB contract) ──────────────────────────────────────
interface WavvCall {
  wavv_call_id: string;
  direction: string | null;
  phone: string | null;
  caller_id: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  seconds: number | null;
  outcome: string | null;
  disposition: string | null;
  human: boolean | null;
  recorded: boolean | null;
  summary: string | null;
  agent_key: string | null;
  agent_name: string | null;
}

interface SyncState {
  watermark: string | null;
  last_sync_at: string | null;
  last_status: string;
  last_error: string | null;
  key_invalid: boolean;
  rows_upserted_last: number;
  truncated: boolean;
}

// The aggregate pass pulls raw rows and folds them in the browser. Bounded so a
// wide range can never try to stream the whole table; hitting the cap is
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
function parseYmdLocal(s: string, endOfDay = false): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0 + (endOfDay ? 0 : 0));
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

// ── Per-rep aggregate shape ──────────────────────────────────────────────────
interface RepRow {
  key: string;            // agent_key, or the sentinel below
  name: string;
  dials: number;
  connects: number;
  conversations: number;
  talkSeconds: number;
  connectedSeconds: number;
  uniqueLeads: number;
}
const UNATTRIBUTED = "__unattributed__";

type SortKey = "name" | "dials" | "connects" | "conversations" | "convRate" | "talk" | "avg" | "unique";

const REP_COLUMNS: { key: SortKey; label: string; align: string; help?: string }[] = [
  { key: "name",          label: "Rep",              align: "text-left" },
  { key: "dials",         label: "Dials",            align: "text-right", help: "Calls placed in this range" },
  { key: "connects",      label: "Connects",         align: "text-right", help: "Calls that connected" },
  { key: "conversations", label: "Convos",           align: "text-right", help: "Calls with more than 60 seconds of talk time" },
  { key: "convRate",      label: "Convo rate",       align: "text-right", help: "Conversations ÷ dials" },
  { key: "talk",          label: "Talk time",        align: "text-right", help: "Total talk time" },
  { key: "avg",           label: "Avg call",         align: "text-right", help: "Mean talk time across connected calls" },
  { key: "unique",        label: "Unique leads",     align: "text-right", help: "Distinct phone numbers dialed" },
];

export default function SetterPerformancePage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState<string>(ymd(localDayStart(6)));
  const [customTo, setCustomTo] = useState<string>(ymd(localDayStart(0)));

  const [aggRows, setAggRows] = useState<WavvCall[]>([]);
  const [aggregateTruncated, setAggregateTruncated] = useState(false);
  const [totalRowsEver, setTotalRowsEver] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "dials", desc: true });

  // Call log (its own paged query — the aggregate slice is not reused, so the log
  // stays correct even when the aggregate pass hits its row cap).
  const [logRows, setLogRows] = useState<WavvCall[]>([]);
  const [logCount, setLogCount] = useState<number | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const [filterRep, setFilterRep] = useState<string>("all");
  const [filterDisposition, setFilterDisposition] = useState<string>("all");
  const [filterMinSeconds, setFilterMinSeconds] = useState<string>("");

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

  // ── Load: sync state + total-ever count + the range slice ─────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [stateRes, countRes, sliceRes] = await Promise.all([
        supabase.from("platform_settings").select("value").eq("key", "wavv_sync").maybeSingle(),
        supabase.from("wavv_calls").select("wavv_call_id", { count: "exact", head: true }),
        supabase.from("wavv_calls")
          .select("wavv_call_id,direction,phone,caller_id,started_at,answered_at,ended_at,seconds,outcome,disposition,human,recorded,summary,agent_key,agent_name")
          .gte("started_at", fromIso)
          .lt("started_at", toIso)
          .order("started_at", { ascending: false })
          .limit(AGG_ROW_CAP),
      ]);

      if (stateRes.error) throw new Error(stateRes.error.message);
      if (countRes.error) throw new Error(countRes.error.message);
      if (sliceRes.error) throw new Error(sliceRes.error.message);

      setSyncState((stateRes.data?.value ?? null) as SyncState | null);
      setTotalRowsEver(countRes.count ?? 0);
      const rows = (sliceRes.data ?? []) as WavvCall[];
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

  // ── Call log query (paged, filtered, independent of the aggregate slice) ──
  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      let q = supabase.from("wavv_calls")
        .select("wavv_call_id,direction,phone,caller_id,started_at,answered_at,ended_at,seconds,outcome,disposition,human,recorded,summary,agent_key,agent_name", { count: "exact" })
        .gte("started_at", fromIso)
        .lt("started_at", toIso);

      if (filterRep !== "all") {
        if (filterRep === UNATTRIBUTED) q = q.is("agent_key", null);
        else q = q.eq("agent_key", filterRep);
      }
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
      setLogRows((data ?? []) as WavvCall[]);
      setLogCount(count ?? 0);
    } catch (e) {
      setLogRows([]);
      setLogCount(null);
      setLoadError((prev) => prev ?? (e instanceof Error ? e.message : "Failed to load the call log"));
    }
    setLogLoading(false);
  }, [fromIso, toIso, filterRep, filterDisposition, filterMinSeconds, logPage]);

  useEffect(() => { void loadLog(); }, [loadLog]);
  // Any filter or range change restarts pagination — page 3 of a different
  // filter is a different question.
  useEffect(() => { setLogPage(0); }, [fromIso, toIso, filterRep, filterDisposition, filterMinSeconds]);

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

  // ── Connect definition ────────────────────────────────────────────────────
  // A call is a CONNECT when answered_at is set — that is WAVV's own record of
  // the moment the line was picked up. FALLBACK: if not one row in the range has
  // an answered_at, we assume WAVV is not populating that field for this account
  // and fall back to seconds > 0 (talk time cannot exist without a connection),
  // flagging it so the number is never silently redefined under the manager.
  // RE-VERIFY once a valid WAVV key lands and real calls arrive: we could not
  // probe the live API (the vault key is invalid), so this rests on the docs.
  const anyAnsweredAt = useMemo(() => aggRows.some((r) => !!r.answered_at), [aggRows]);
  const usingFallbackConnects = aggRows.length > 0 && !anyAnsweredAt;
  const isConnect = useCallback(
    (r: WavvCall) => (anyAnsweredAt ? !!r.answered_at : (r.seconds ?? 0) > 0),
    [anyAnsweredAt],
  );

  // Attribution: null agent_key means "WAVV has not told us who dialed", not
  // "nobody". It gets its own sentinel row and an explanatory note.
  const allUnattributed = aggRows.length > 0 && aggRows.every((r) => !r.agent_key);

  // ── Per-rep aggregates ────────────────────────────────────────────────────
  const repRows = useMemo(() => {
    const byRep = new Map<string, RepRow & { phones: Set<string> }>();
    for (const r of aggRows) {
      const key = r.agent_key ?? UNATTRIBUTED;
      let rep = byRep.get(key);
      if (!rep) {
        rep = {
          key,
          name: key === UNATTRIBUTED ? "Unattributed" : (r.agent_name ?? r.agent_key ?? key),
          dials: 0, connects: 0, conversations: 0, talkSeconds: 0, connectedSeconds: 0,
          uniqueLeads: 0, phones: new Set<string>(),
        };
        byRep.set(key, rep);
      }
      if (r.agent_name && key !== UNATTRIBUTED) rep.name = r.agent_name;
      rep.dials++;
      const secs = r.seconds ?? 0;
      rep.talkSeconds += secs;
      if (isConnect(r)) { rep.connects++; rep.connectedSeconds += secs; }
      if (secs > 60) rep.conversations++;
      if (r.phone) rep.phones.add(r.phone);
    }
    return [...byRep.values()].map(({ phones, ...rep }) => ({ ...rep, uniqueLeads: phones.size }));
  }, [aggRows, isConnect]);

  const sortedRepRows = useMemo(() => {
    const val = (r: RepRow, k: SortKey): number | string => {
      switch (k) {
        case "name":          return r.name.toLowerCase();
        case "dials":         return r.dials;
        case "connects":      return r.connects;
        case "conversations": return r.conversations;
        case "convRate":      return r.dials > 0 ? r.conversations / r.dials : -1;
        case "talk":          return r.talkSeconds;
        case "avg":           return r.connects > 0 ? r.connectedSeconds / r.connects : -1;
        case "unique":        return r.uniqueLeads;
      }
    };
    return [...repRows].sort((a, b) => {
      const av = val(a, sort.key), bv = val(b, sort.key);
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
      return sort.desc ? -cmp : cmp;
    });
  }, [repRows, sort]);

  // TOTALS. Unique leads is recomputed as a distinct count across the WHOLE
  // range — summing the per-rep counts would double-count a number two setters
  // both dialed.
  const totals = useMemo(() => {
    const phones = new Set<string>();
    let dials = 0, connects = 0, conversations = 0, talkSeconds = 0, connectedSeconds = 0;
    for (const r of aggRows) {
      dials++;
      const secs = r.seconds ?? 0;
      talkSeconds += secs;
      if (isConnect(r)) { connects++; connectedSeconds += secs; }
      if (secs > 60) conversations++;
      if (r.phone) phones.add(r.phone);
    }
    return { dials, connects, conversations, talkSeconds, connectedSeconds, uniqueLeads: phones.size };
  }, [aggRows, isConnect]);

  // ── Daily trend ───────────────────────────────────────────────────────────
  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; dials: number; conversations: number }>();
    for (const r of aggRows) {
      if (!r.started_at) continue;
      const day = ymd(new Date(r.started_at)); // local day, matching the picker
      const bucket = byDay.get(day) ?? { day, dials: 0, conversations: 0 };
      bucket.dials++;
      if ((r.seconds ?? 0) > 60) bucket.conversations++;
      byDay.set(day, bucket);
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({ ...d, label: d.day.slice(5) }));
  }, [aggRows]);

  // ── Breakdowns ────────────────────────────────────────────────────────────
  function breakdown(field: "disposition" | "outcome") {
    const counts = new Map<string, number>();
    for (const r of aggRows) {
      const k = r[field] ?? "(none)";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const total = aggRows.length;
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count, pct: total > 0 ? (count / total) * 100 : 0 }))
      .sort((a, b) => b.count - a.count);
  }
  const dispositionBreakdown = useMemo(() => breakdown("disposition"), [aggRows]);
  const outcomeBreakdown = useMemo(() => breakdown("outcome"), [aggRows]);

  // Filter options come from the range slice, so they only ever offer values that
  // actually occur in the data being looked at.
  const repOptions = useMemo(() => {
    const opts = new Map<string, string>();
    for (const r of aggRows) {
      const key = r.agent_key ?? UNATTRIBUTED;
      opts.set(key, key === UNATTRIBUTED ? "Unattributed" : (r.agent_name ?? r.agent_key ?? key));
    }
    return [...opts.entries()];
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

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PhoneIcon className="w-6 h-6 text-mint-green" /> Setter Performance
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
            Per-rep dialing activity from the <span className="font-medium">WAVV dialer</span> (embedded in
            VibeReach), mirrored here every 10 minutes. Effort and efficiency on the phones — pipeline and
            revenue live in GHL and <span className="font-medium">Deals</span>.
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

      {/* ── Range picker ── */}
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
            Waiting for first sync — no WAVV calls have been mirrored yet.
            {keyInvalid ? " Fix the API key above, then press Sync now." : " Press Sync now, or wait for the 10-minute cron."}
          </span>
        </div>
      )}

      {aggregateTruncated && (
        <div className="alert alert-warning">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>
            This range exceeds {AGG_ROW_CAP.toLocaleString()} calls — the scorecard, chart and breakdowns below
            cover only the {AGG_ROW_CAP.toLocaleString()} most recent calls in it. Narrow the range for exact totals.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="loading loading-spinner loading-sm" /> Loading WAVV calls…
        </div>
      ) : emptyRange ? (
        <div className="alert">
          <InformationCircleIcon className="w-5 h-5" />
          <span>No calls in this range. {totalRowsEver?.toLocaleString()} call{totalRowsEver === 1 ? "" : "s"} are mirrored across all time.</span>
        </div>
      ) : aggRows.length === 0 ? null : (
        <>
          {/* ── Floor totals ── */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {[
              { label: "Dials", value: totals.dials, fmt: (v: number) => v.toLocaleString() },
              { label: "Connects", value: totals.connects, fmt: (v: number) => v.toLocaleString() },
              { label: "Conversations", value: totals.conversations, fmt: (v: number) => v.toLocaleString() },
              { label: "Convo rate", value: totals.dials > 0 ? (totals.conversations / totals.dials) * 100 : null, fmt: (v: number) => `${v.toFixed(1)}%` },
              { label: "Talk time", value: totals.talkSeconds, fmt: hms },
              { label: "Unique leads", value: totals.uniqueLeads, fmt: (v: number) => v.toLocaleString() },
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

          {(usingFallbackConnects || allUnattributed) && (
            <div className="alert alert-info">
              <InformationCircleIcon className="w-5 h-5 shrink-0" />
              <div className="text-sm space-y-1">
                {usingFallbackConnects && (
                  <div>
                    WAVV reported no answer timestamp on any call in this range, so <b>Connects</b> is counted
                    as "any call with talk time" instead. Verify against the dialer before trusting it as an
                    answer rate.
                  </div>
                )}
                {allUnattributed && (
                  <div>
                    WAVV has not reported a per-agent field on these calls yet, so every call is grouped as
                    <b> Unattributed</b> — this is missing attribution, not one rep doing all the dialing. Run
                    the sync's <code>reparse</code> action once the agent field is confirmed and the whole
                    history re-attributes with no re-pull.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Per-rep scorecard ── */}
          <div className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <UserGroupIcon className="w-5 h-5 text-mint-green" /> Rep scorecard
              </h2>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      {REP_COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          className={`${c.align} cursor-pointer select-none whitespace-nowrap`}
                          onClick={() => sortBy(c.key)}
                          title={c.help}
                        >
                          {c.label}
                          {sort.key === c.key && <span className="ml-1 text-mint-green">{sort.desc ? "▼" : "▲"}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRepRows.map((r) => (
                      <tr key={r.key} className="hover">
                        <td className="font-medium text-gray-900 dark:text-white">
                          {r.key === UNATTRIBUTED
                            ? <span className="text-gray-400 italic" title="WAVV did not report which rep placed these calls">Unattributed</span>
                            : r.name}
                        </td>
                        <td className="text-right">{r.dials.toLocaleString()}</td>
                        <td className="text-right">{r.connects.toLocaleString()}</td>
                        <td className="text-right">{r.conversations.toLocaleString()}</td>
                        <td className="text-right">
                          <Metric value={r.dials > 0 ? (r.conversations / r.dials) * 100 : null} suffix="%" digits={1} />
                        </td>
                        <td className="text-right">{hms(r.talkSeconds)}</td>
                        <td className="text-right">
                          {r.connects > 0 ? hms(r.connectedSeconds / r.connects) : <Metric value={null} />}
                        </td>
                        <td className="text-right">{r.uniqueLeads.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold border-t-2 border-base-300">
                      <td>Total</td>
                      <td className="text-right">{totals.dials.toLocaleString()}</td>
                      <td className="text-right">{totals.connects.toLocaleString()}</td>
                      <td className="text-right">{totals.conversations.toLocaleString()}</td>
                      <td className="text-right">
                        <Metric value={totals.dials > 0 ? (totals.conversations / totals.dials) * 100 : null} suffix="%" digits={1} />
                      </td>
                      <td className="text-right">{hms(totals.talkSeconds)}</td>
                      <td className="text-right">
                        {totals.connects > 0 ? hms(totals.connectedSeconds / totals.connects) : <Metric value={null} />}
                      </td>
                      {/* Distinct across the whole range — NOT the sum of the per-rep
                          counts, which would double-count a number two setters both dialed. */}
                      <td className="text-right" title="Distinct phone numbers across the whole range">
                        {totals.uniqueLeads.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* ── Trend ── */}
          {trend.length > 1 && (
            <div className="card bg-base-100 border border-base-300 shadow-sm">
              <div className="card-body p-4">
                <h2 className="font-semibold text-gray-900 dark:text-white">Daily dials &amp; conversations</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trend} margin={{ top: 8, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#9CA3AF" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="dials" name="Dials" stroke="#007EA7" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="conversations" name="Conversations" stroke="#00C49A" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Breakdowns ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[
              { title: "Dispositions (rep-selected)", rows: dispositionBreakdown, fill: "#007EA7" },
              { title: "Outcomes (dialer-reported)", rows: outcomeBreakdown, fill: "#8B5CF6" },
            ].map((panel) => (
              <div key={panel.title} className="card bg-base-100 border border-base-300 shadow-sm">
                <div className="card-body p-4">
                  <h2 className="font-semibold text-gray-900 dark:text-white">{panel.title}</h2>
                  {panel.rows.length === 0 ? (
                    <p className="text-sm text-gray-400">Nothing reported in this range.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(160, panel.rows.length * 34)}>
                      <BarChart data={panel.rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                        <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(v: unknown, _n: unknown, item: unknown) => {
                            const pct = (item as { payload?: { pct?: number } })?.payload?.pct ?? 0;
                            return [`${Number(v).toLocaleString()} (${pct.toFixed(1)}%)`, "Calls"];
                          }}
                        />
                        <Bar dataKey="count" fill={panel.fill} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Call log ── */}
      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-mint-green" /> Call log
              {logCount !== null && <span className="text-sm font-normal text-gray-400">({logCount.toLocaleString()})</span>}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select className="select select-xs select-bordered" value={filterRep} onChange={(e) => setFilterRep(e.target.value)}>
                <option value="all">All reps</option>
                {repOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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

          {logLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <span className="loading loading-spinner loading-sm" /> Loading calls…
            </div>
          ) : logRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">
              {neverSynced ? "Waiting for first sync — no WAVV calls have been mirrored yet." : "No calls match these filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Time</th><th>Rep</th><th>Phone</th><th className="text-right">Duration</th>
                    <th>Outcome</th><th>Disposition</th><th>Human</th><th>Recording</th><th>Transcript</th>
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
                        <td>
                          {r.agent_name ?? r.agent_key ?? <span className="text-gray-300 dark:text-gray-600 italic" title="WAVV did not report which rep placed this call">Unattributed</span>}
                        </td>
                        <td className="whitespace-nowrap">{prettyPhone(r.phone)}</td>
                        <td className="text-right whitespace-nowrap">{r.seconds === null ? <Metric value={null} /> : hms(r.seconds)}</td>
                        <td><Text value={r.outcome} /></td>
                        <td><Text value={r.disposition} /></td>
                        <td>
                          {r.human === null
                            ? <Metric value={null} />
                            : <span className={`badge badge-xs ${r.human ? "badge-success" : "badge-ghost"}`}>{r.human ? "human" : "machine"}</span>}
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
    </div>
  );
}
