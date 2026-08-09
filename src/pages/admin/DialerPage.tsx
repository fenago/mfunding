import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PhoneIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  BoltIcon,
  UserGroupIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";

// ── Types (mirror the live DB contract) ──────────────────────────────────────
// Every numeric is nullable on purpose: hotprospector_agent_daily stores NULL for
// a metric HotProspector did not report, so this page can show "not reported"
// instead of a fake zero.
interface AgentDaily {
  stat_date: string;
  member_id: string;
  agent_name: string | null;
  agent_email: string | null;
  first_call: string | null;
  last_call: string | null;
  gap_time: string | null;
  gap_time_seconds: number | null;
  hours: string | null;
  hours_seconds: number | null;
  outbound_calls: number | null;
  inbound_calls: number | null;
  answered_calls: number | null;
  hangups: number | null;
  sms: number | null;
  talk_min: number | null;
  avg_min: number | null;
  ans_per_hour: number | null;
  answer_rate: number | null;
  convos: number | null;
  conversion_rate: number | null;
  prospects: number | null;
  appts: number | null;
  abr: number | null;
  avg_speed_to_lead: number | null;
  speed_to_lead_samples: number | null;
  transfers: number | null;
  synced_at: string;
}

interface NumberHealth {
  phone: string;
  friendly_name: string | null;
  is_spam_detected: boolean | null;
  status: string | null;
  last_checked: string | null;
  synced_at: string;
}

interface AccountDaily {
  stat_date: string;
  credits: number | null;
  seats_total: number | null;
  seats_active: number | null;
  seats_remaining: number | null;
  campaign_count: number | null;
  agents_returned: number;
  calls_logged: number | null;
  dashboard_last_updated: string | null;
  dashboard_message: string | null;
  synced_at: string;
  // The poller stashes the campaign list here so the campaign filter still has
  // options on a day that produced zero disposition rows.
  raw: { campaigns?: unknown[] } | null;
}

interface DispositionDaily {
  stat_date: string;
  campaign_id: string;
  campaign_title: string | null;
  member_id: string;
  agent_name: string | null;
  disposition: string;
  cnt: number;
}

// Credits are consumed per dial, so a low balance silently stops the floor.
const CREDITS_LOW = 500;
const CREDITS_CRITICAL = 150;

const TREND_DAYS = 7;

// ── Date helpers ─────────────────────────────────────────────────────────────
// HotProspector reports on a PST clock (its dashboard stamps are "(PST)"), so
// "today" here means the PST day, not the browser's day.
function pstDay(offsetDays = 0): string {
  const nowPst = new Date(Date.now() - 8 * 3600_000 - offsetDays * 86_400_000);
  return nowPst.toISOString().slice(0, 10);
}

function prettyDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function sinceText(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Honest metric rendering ──────────────────────────────────────────────────
// NULL means HotProspector did not report the metric. It renders as a dimmed
// dash with an explanatory title — never as 0, which would read as real activity
// data ("this rep made zero calls") when it is actually missing data.
function Metric({ value, suffix = "", digits = 0 }: { value: number | null; suffix?: string; digits?: number }) {
  if (value === null || value === undefined) {
    return (
      <span className="text-gray-300 dark:text-gray-600" title="Not reported by HotProspector for this day">
        —
      </span>
    );
  }
  return <span>{value.toFixed(digits)}{suffix}</span>;
}

function Text({ value }: { value: string | null }) {
  if (!value) {
    return (
      <span className="text-gray-300 dark:text-gray-600" title="Not reported by HotProspector for this day">
        —
      </span>
    );
  }
  return <span>{value}</span>;
}

// ── KPI targets + RAG ────────────────────────────────────────────────────────
// Thresholds are NOT hardcoded here — they live in platform_settings under
// `ph_dialer_kpi_targets` so the owner can tune them without a deploy. This file
// only knows how to APPLY a band, never what the band is.
interface KpiTarget {
  label: string;
  direction: "higher" | "lower";
  green: number;
  amber: number;
  unit: string;
}
type Targets = Record<string, KpiTarget>;

type Rag = "green" | "amber" | "red" | "none";

// Colour is never the only signal — each tier carries a distinct SHAPE too, so
// the page reads correctly for red/green colourblind users and in greyscale.
const RAG_STYLE: Record<Rag, { text: string; glyph: string; label: string; chip: string }> = {
  green: {
    text: "text-emerald-700 dark:text-emerald-400",
    glyph: "●", label: "On track",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  amber: {
    text: "text-amber-700 dark:text-amber-400",
    glyph: "▲", label: "Watch",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  red: {
    text: "text-red-700 dark:text-red-400",
    glyph: "■", label: "At risk",
    chip: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
  none: {
    text: "text-gray-400 dark:text-gray-500",
    glyph: "", label: "No data",
    chip: "bg-base-200 text-gray-500 dark:text-gray-400",
  },
};

/** Grade a value against its configured band.
 * Returns "none" — deliberately NOT green — when either the value or the target
 * is missing. Green must always mean a real number cleared a real threshold. */
function rag(value: number | null | undefined, t: KpiTarget | undefined): Rag {
  if (value === null || value === undefined || !Number.isFinite(value)) return "none";
  if (!t || !Number.isFinite(t.green) || !Number.isFinite(t.amber)) return "none";
  if (t.direction === "lower") {
    if (value <= t.green) return "green";
    return value <= t.amber ? "amber" : "red";
  }
  if (value >= t.green) return "green";
  return value >= t.amber ? "amber" : "red";
}

/** Human-readable band, for the cell tooltip — so a colour always explains itself. */
function targetHint(t: KpiTarget | undefined): string {
  if (!t) return "No target configured — set one in platform_settings.ph_dialer_kpi_targets";
  const u = t.unit ?? "";
  return t.direction === "lower"
    ? `Target: green ≤${t.green}${u}, watch ≤${t.amber}${u}, at risk >${t.amber}${u}`
    : `Target: green ≥${t.green}${u}, watch ≥${t.amber}${u}, at risk <${t.amber}${u}`;
}

/** Worst tier wins. "none" is ignored so an unmeasured metric can neither rescue
 * nor condemn a rep; if NOTHING was measured the rollup is honestly "none". */
function rollup(tiers: Rag[]): Rag {
  const real = tiers.filter((t) => t !== "none");
  if (real.length === 0) return "none";
  if (real.includes("red")) return "red";
  if (real.includes("amber")) return "amber";
  return "green";
}

// ── Derived metrics ──────────────────────────────────────────────────────────
// "Dials" means OUTBOUND calls — what the dialer actually dialed. Inbound is
// shown alongside but never counted toward a dialing-effort target.
function dials(r: AgentDaily): number | null {
  return r.outbound_calls;
}
function totalCalls(r: AgentDaily): number | null {
  if (r.outbound_calls === null && r.inbound_calls === null) return null;
  return (r.outbound_calls ?? 0) + (r.inbound_calls ?? 0);
}
// A rate needs a denominator big enough to mean something. Without this floor,
// 1 dial in 14 seconds on the dialer extrapolates to 257 dials/hr and grades
// GREEN — a rep who logs on for a moment would outrank one who worked all day.
// Below the floor the pace is reported as unknown, not as a number.
const MIN_DIALER_SECONDS_FOR_RATE = 600; // 10 minutes

function dialsPerHour(r: AgentDaily): number | null {
  const d = dials(r);
  if (d === null || !r.hours_seconds || r.hours_seconds < MIN_DIALER_SECONDS_FOR_RATE) return null;
  return d / (r.hours_seconds / 3600);
}
function idleGapMin(r: AgentDaily): number | null {
  return r.gap_time_seconds === null ? null : r.gap_time_seconds / 60;
}
function apptsPlusTransfers(r: AgentDaily): number | null {
  if (r.appts === null && r.transfers === null) return null;
  return (r.appts ?? 0) + (r.transfers ?? 0);
}
/** Dials burned per prospect produced. Undefined (not "bad") at zero prospects —
 * the division has no answer. prospects_per_day already flags a zero-prospect day. */
function dialsPerProspect(r: AgentDaily): number | null {
  const d = dials(r);
  if (d === null || !r.prospects || r.prospects <= 0) return null;
  return d / r.prospects;
}

// ── Sortable columns ─────────────────────────────────────────────────────────
type SortKey =
  | "agent" | "calls" | "dials" | "dials_per_hour" | "answered_calls"
  | "talk_min" | "answer_rate" | "ans_per_hour" | "gap_time_seconds"
  | "convos" | "conversion_rate" | "prospects" | "appts_transfers" | "sms"
  | "avg_speed_to_lead" | "hours_seconds" | "dials_per_prospect";

interface Column {
  key: SortKey;
  label: string;
  hint: string;
  // Higher is better → used to pick the leader and to default the sort direction.
  higherIsBetter: boolean;
  render: (r: AgentDaily) => React.ReactNode;
  value: (r: AgentDaily) => number | null;
  // Which configured KPI band grades this column. Columns without one render
  // uncoloured — no target, no verdict.
  kpi?: string;
  // The value handed to the band, when it differs from the sort value.
  kpiValue?: (r: AgentDaily) => number | null;
}

const COLUMNS: Column[] = [
  {
    key: "dials", label: "Dials", hint: "Outbound dials (inbound shown alongside, not counted toward the target)",
    higherIsBetter: true, kpi: "dials_per_day",
    value: dials,
    render: (r) => (
      <span>
        <Metric value={dials(r)} />
        <span className="text-xs text-gray-400 ml-1">
          (+{r.inbound_calls ?? "—"} in)
        </span>
      </span>
    ),
  },
  {
    key: "dials_per_hour", label: "Dials/hr",
    hint: "Dialing pace while logged on. Blank under 10 minutes on the dialer — too small a denominator to extrapolate an hourly rate",
    higherIsBetter: true,
    kpi: "dials_per_hour",
    value: dialsPerHour, render: (r) => <Metric value={dialsPerHour(r)} digits={1} />,
  },
  {
    key: "answered_calls", label: "Answered", hint: "Calls a human picked up", higherIsBetter: true,
    value: (r) => r.answered_calls, render: (r) => <Metric value={r.answered_calls} />,
  },
  {
    key: "answer_rate", label: "Connect %", hint: "HotProspector's answer rate", higherIsBetter: true,
    kpi: "connect_rate_pct",
    value: (r) => r.answer_rate, render: (r) => <Metric value={r.answer_rate} suffix="%" digits={1} />,
  },
  {
    key: "ans_per_hour", label: "Ans/hr", hint: "Answered calls per hour on the dialer", higherIsBetter: true,
    value: (r) => r.ans_per_hour, render: (r) => <Metric value={r.ans_per_hour} digits={1} />,
  },
  {
    key: "talk_min", label: "Talk min", hint: "Total minutes in conversation", higherIsBetter: true,
    kpi: "talk_min",
    value: (r) => r.talk_min, render: (r) => <Metric value={r.talk_min} digits={0} />,
  },
  {
    key: "hours_seconds", label: "On dialer", hint: "Logged time on the dialer", higherIsBetter: true,
    value: (r) => r.hours_seconds, render: (r) => <Text value={r.hours} />,
  },
  {
    key: "gap_time_seconds", label: "Idle gap", hint: "Dead time between calls — LOWER is better", higherIsBetter: false,
    kpi: "idle_gap_min", kpiValue: idleGapMin,
    value: (r) => r.gap_time_seconds, render: (r) => <Text value={r.gap_time} />,
  },
  {
    key: "convos", label: "Convos", hint: "Live conversations (contacts) for the day", higherIsBetter: true,
    kpi: "contacts_per_day",
    value: (r) => r.convos, render: (r) => <Metric value={r.convos} />,
  },
  {
    key: "conversion_rate", label: "CR %", hint: "HotProspector's conversion rate", higherIsBetter: true,
    kpi: "conversion_rate_pct",
    value: (r) => r.conversion_rate, render: (r) => <Metric value={r.conversion_rate} suffix="%" digits={1} />,
  },
  {
    key: "prospects", label: "Prospects", hint: "Prospects created", higherIsBetter: true,
    kpi: "prospects_per_day",
    value: (r) => r.prospects, render: (r) => <Metric value={r.prospects} />,
  },
  {
    key: "dials_per_prospect", label: "Dials/prospect",
    hint: "Dials burned per prospect produced — LOWER is better. Blank at zero prospects (no answer to the division)",
    higherIsBetter: false, kpi: "dials_per_prospect",
    value: dialsPerProspect, render: (r) => <Metric value={dialsPerProspect(r)} digits={0} />,
  },
  {
    key: "appts_transfers", label: "Appts+xfer", hint: "Appointments booked plus live transfers", higherIsBetter: true,
    kpi: "appts_per_day",
    value: apptsPlusTransfers,
    render: (r) => (
      <span>
        <Metric value={apptsPlusTransfers(r)} />
        <span className="text-xs text-gray-400 ml-1">
          ({r.appts ?? "—"}a / {r.transfers ?? "—"}x)
        </span>
      </span>
    ),
  },
  {
    key: "sms", label: "SMS", hint: "Texts sent", higherIsBetter: true,
    value: (r) => r.sms, render: (r) => <Metric value={r.sms} />,
  },
  {
    key: "avg_speed_to_lead", label: "Speed to lead", hint:
      "Avg seconds from lead arriving to first dial, computed from the call log — LOWER is better",
    higherIsBetter: false,
    value: (r) => r.avg_speed_to_lead,
    render: (r) => (
      <span>
        <Metric value={r.avg_speed_to_lead} suffix="s" digits={0} />
        {r.speed_to_lead_samples ? (
          <span className="text-xs text-gray-400 ml-1">(n={r.speed_to_lead_samples})</span>
        ) : null}
      </span>
    ),
  },
];

// ── Disposition tone ─────────────────────────────────────────────────────────
// HotProspector disposition labels are free text set per account, so these are
// heuristics on the label, not a fixed enum. NEGATIVE is tested first: "Not
// Interested" contains "Interested" and must never read as a win.
function dispositionTone(label: string): "good" | "bad" | "neutral" {
  const l = label.toLowerCase();
  if (/\b(not interested|no answer|dnc|do not call|wrong|bad number|disconnect|dead|unqualified|declin)/.test(l)) {
    return "bad";
  }
  if (/\b(hot lead|appointment|appt|sale|sold|qualified|interested|transfer|closed won|booked)/.test(l)) {
    return "good";
  }
  return "neutral";
}

const TONE_TEXT: Record<"good" | "bad" | "neutral", string> = {
  good: "text-emerald-600 dark:text-emerald-400 font-semibold",
  bad: "text-gray-500 dark:text-gray-400",
  neutral: "text-gray-700 dark:text-gray-300",
};
const TONE_BAR: Record<"good" | "bad" | "neutral", string> = {
  good: "bg-emerald-500",
  bad: "bg-gray-300 dark:bg-gray-600",
  neutral: "bg-sky-400",
};

// ── Trend metric options ─────────────────────────────────────────────────────
type TrendKey = "calls" | "convos" | "appts";
const TREND_META: Record<TrendKey, { label: string; value: (r: AgentDaily) => number | null }> = {
  calls: { label: "Calls", value: totalCalls },
  convos: { label: "Convos", value: (r) => r.convos },
  appts: { label: "Appts", value: (r) => r.appts },
};

export default function DialerPage() {
  const { isSuperAdmin } = useUserProfile();
  const [date, setDate] = useState<string>(pstDay(0));
  const [agents, setAgents] = useState<AgentDaily[]>([]);
  const [trend, setTrend] = useState<AgentDaily[]>([]);
  const [account, setAccount] = useState<AccountDaily | null>(null);
  const [latestAccount, setLatestAccount] = useState<AccountDaily | null>(null);
  const [dispositions, setDispositions] = useState<DispositionDaily[]>([]);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [targets, setTargets] = useState<Targets | null>(null);
  const [numbers, setNumbers] = useState<NumberHealth[]>([]);
  // 14 days of account snapshots — enough to estimate the credit burn rate.
  const [creditHistory, setCreditHistory] = useState<{ stat_date: string; credits: number | null }[]>([]);
  const [showTargets, setShowTargets] = useState(true); // open by default — the owner wants the targets visible at a glance
  const [draftTargets, setDraftTargets] = useState<Targets | null>(null);
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetMsg, setTargetMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "calls", desc: true });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const trendStart = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d - (TREND_DAYS - 1))).toISOString().slice(0, 10);
  }, [date]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [agentRes, trendRes, acctRes, latestAcctRes, dispRes, targetRes, numberRes, creditRes] = await Promise.all([
      supabase.from("hotprospector_agent_daily").select("*").eq("stat_date", date),
      supabase.from("hotprospector_agent_daily").select("*")
        .gte("stat_date", trendStart).lte("stat_date", date).order("stat_date"),
      supabase.from("hotprospector_account_daily").select("*").eq("stat_date", date).maybeSingle(),
      supabase.from("hotprospector_account_daily").select("*")
        .order("synced_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("hotprospector_disposition_daily")
        .select("stat_date, campaign_id, campaign_title, member_id, agent_name, disposition, cnt")
        .eq("stat_date", date),
      supabase.from("platform_settings").select("value").eq("key", "ph_dialer_kpi_targets").maybeSingle(),
      supabase.from("hotprospector_number_health")
        .select("phone, friendly_name, is_spam_detected, status, last_checked, synced_at"),
      supabase.from("hotprospector_account_daily")
        .select("stat_date, credits").order("stat_date", { ascending: false }).limit(14),
    ]);
    // Loud on failure — a read error must never render as an empty floor.
    const err = agentRes.error || trendRes.error || acctRes.error || latestAcctRes.error || dispRes.error
      || targetRes.error || numberRes.error || creditRes.error;
    if (err) {
      setLoadError(err.message);
      setAgents([]); setTrend([]); setAccount(null); setLatestAccount(null); setDispositions([]);
      setTargets(null); setNumbers([]); setCreditHistory([]);
      setLoading(false);
      return;
    }
    setTargets((targetRes.data?.value ?? null) as Targets | null);
    setNumbers((numberRes.data ?? []) as NumberHealth[]);
    setCreditHistory((creditRes.data ?? []) as { stat_date: string; credits: number | null }[]);
    setAgents((agentRes.data ?? []) as AgentDaily[]);
    setTrend((trendRes.data ?? []) as AgentDaily[]);
    setAccount((acctRes.data ?? null) as AccountDaily | null);
    setLatestAccount((latestAcctRes.data ?? null) as AccountDaily | null);
    setDispositions((dispRes.data ?? []) as DispositionDaily[]);
    setLoading(false);
  }, [date, trendStart]);

  useEffect(() => { load(); }, [load]);

  async function saveTargets() {
    if (!draftTargets) return;
    setSavingTargets(true);
    setTargetMsg(null);
    try {
      await mustWrite(
        "Save dialer KPI targets",
        supabase.from("platform_settings")
          .update({ value: draftTargets, updated_at: new Date().toISOString() })
          .eq("key", "ph_dialer_kpi_targets"),
      );
      setTargets(draftTargets);
      setTargetMsg({ ok: true, text: "Targets saved — the whole page re-grades against them." });
    } catch (e) {
      setTargetMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    }
    setSavingTargets(false);
  }

  async function refreshNow() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("hotprospector-sync", { body: { date } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || `Sync failed at stage: ${data?.stage ?? "unknown"}`);
      const n = data.agents_synced ?? 0;
      setRefreshMsg({
        ok: true,
        text: n === 0
          ? `Synced — HotProspector returned no agent activity for ${prettyDate(date)}`
          : `Synced ${n} agent${n === 1 ? "" : "s"} for ${prettyDate(date)}`,
      });
      await load();
    } catch (e) {
      setRefreshMsg({ ok: false, text: e instanceof Error ? e.message : "Sync failed" });
    }
    setRefreshing(false);
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  const sortedAgents = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    return [...agents].sort((a, b) => {
      if (sort.key === "agent") {
        const cmp = (a.agent_name ?? "").localeCompare(b.agent_name ?? "");
        return sort.desc ? -cmp : cmp;
      }
      const av = col?.value(a) ?? null;
      const bv = col?.value(b) ?? null;
      // Rows missing the metric always sink to the bottom, in both directions —
      // "no data" is not a low score.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sort.desc ? bv - av : av - bv;
    });
  }, [agents, sort]);

  // The leader on the currently sorted metric, so the highlight always explains
  // itself against the column the manager is looking at.
  const leaderId = useMemo(() => {
    if (sort.key === "agent" || agents.length < 2) return null;
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return null;
    let best: AgentDaily | null = null;
    for (const r of agents) {
      const v = col.value(r);
      if (v === null) continue;
      const bv = best ? col.value(best) : null;
      if (bv === null || (col.higherIsBetter ? v > bv : v < bv)) best = r;
    }
    return best?.member_id ?? null;
  }, [agents, sort.key]);

  function toggleSort(key: SortKey) {
    setSort((s) => {
      if (s.key === key) return { key, desc: !s.desc };
      const col = COLUMNS.find((c) => c.key === key);
      return { key, desc: col ? col.higherIsBetter : true };
    });
  }

  // ── 7-day trend, grouped per rep ───────────────────────────────────────────
  const [trendKey, setTrendKey] = useState<TrendKey>("calls");
  const trendDays = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    return Array.from({ length: TREND_DAYS }, (_, i) =>
      new Date(Date.UTC(y, m - 1, d - (TREND_DAYS - 1 - i))).toISOString().slice(0, 10));
  }, [date]);

  const trendByRep = useMemo(() => {
    const map = new Map<string, { name: string; byDay: Map<string, number | null> }>();
    for (const r of trend) {
      const entry = map.get(r.member_id) ?? { name: r.agent_name ?? r.member_id, byDay: new Map() };
      entry.name = r.agent_name ?? entry.name;
      entry.byDay.set(r.stat_date, TREND_META[trendKey].value(r));
      map.set(r.member_id, entry);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [trend, trendKey]);

  const trendMax = useMemo(() => {
    let max = 0;
    for (const rep of trendByRep) for (const v of rep.byDay.values()) if (v !== null && v > max) max = v;
    return max;
  }, [trendByRep]);

  // ── Per-agent health rollup ────────────────────────────────────────────────
  // Worst tier across every graded column that actually has data.
  const healthByAgent = useMemo(() => {
    const map = new Map<string, Rag>();
    for (const r of agents) {
      const tiers = COLUMNS
        .filter((c) => c.kpi)
        .map((c) => rag((c.kpiValue ?? c.value)(r), targets?.[c.kpi!]));
      map.set(r.member_id, rollup(tiers));
    }
    return map;
  }, [agents, targets]);

  // ── Credit runway ──────────────────────────────────────────────────────────
  // Days of dialing left = current balance / recent daily burn. Burn is measured
  // from the credit balance across snapshots; a top-up (balance went UP) makes the
  // window unusable, and we say so rather than inventing a runway.
  const creditRunway = useMemo((): { days: number | null; burn: number | null; reason: string } => {
    const usable = creditHistory.filter((c) => c.credits !== null) as { stat_date: string; credits: number }[];
    if (usable.length < 2) {
      return { days: null, burn: null, reason: "needs at least two daily snapshots to measure burn" };
    }
    // creditHistory is newest-first.
    const newest = usable[0];
    const oldest = usable[usable.length - 1];
    const spanDays =
      (Date.parse(`${newest.stat_date}T00:00:00Z`) - Date.parse(`${oldest.stat_date}T00:00:00Z`)) / 86_400_000;
    if (spanDays <= 0) return { days: null, burn: null, reason: "all snapshots are from the same day" };
    const used = oldest.credits - newest.credits;
    if (used <= 0) {
      return { days: null, burn: null, reason: "no credits consumed over the window (or the balance was topped up)" };
    }
    const burn = used / spanDays;
    return { days: newest.credits / burn, burn, reason: "" };
  }, [creditHistory]);

  const creditRag = rag(creditRunway.days, targets?.credit_days_remaining);

  // ── Number health rollup ───────────────────────────────────────────────────
  // A number whose spam status the API didn't report counts as UNKNOWN, never as
  // clean — silence about a burned caller ID is not a clean bill of health.
  const numberHealth = useMemo(() => {
    const flagged = numbers.filter((n) => n.is_spam_detected === true);
    const unknown = numbers.filter((n) => n.is_spam_detected === null);
    const clean = numbers.filter((n) => n.is_spam_detected === false);
    const tier: Rag =
      numbers.length === 0 ? "none"
        : flagged.length > 0 ? "red"
          : unknown.length > 0 ? "amber"
            : "green";
    return { flagged, unknown, clean, tier };
  }, [numbers]);

  // ── Dispositions ───────────────────────────────────────────────────────────
  // Campaign options come from the stored campaign list (so the filter exists even
  // on a zero-disposition day) unioned with whatever campaigns actually produced
  // rows — a campaign that vanished from the account still explains old data.
  const campaignOptions = useMemo(() => {
    const opts = new Map<string, string>();
    const listed = (account?.raw?.campaigns ?? latestAccount?.raw?.campaigns ?? []) as Record<string, unknown>[];
    for (const c of listed) {
      const id = c?.campaign_id ?? c?.campaignId ?? c?.id;
      if (id === undefined || id === null) continue;
      const title = c?.CampaignTitle ?? c?.campaign_title ?? c?.title ?? c?.name;
      opts.set(String(id), title ? String(title) : `Campaign ${id}`);
    }
    for (const d of dispositions) {
      if (!opts.has(d.campaign_id)) opts.set(d.campaign_id, d.campaign_title ?? `Campaign ${d.campaign_id}`);
    }
    return [...opts.entries()].map(([id, title]) => ({ id, title }));
  }, [account, latestAccount, dispositions]);

  const visibleDispositions = useMemo(
    () => (campaignFilter === "all" ? dispositions : dispositions.filter((d) => d.campaign_id === campaignFilter)),
    [dispositions, campaignFilter],
  );

  // Disposition → total, biggest first.
  const dispositionTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of visibleDispositions) totals.set(d.disposition, (totals.get(d.disposition) ?? 0) + d.cnt);
    return [...totals.entries()]
      .map(([disposition, total]) => ({ disposition, total, tone: dispositionTone(disposition) }))
      .sort((a, b) => b.total - a.total);
  }, [visibleDispositions]);

  const dispositionGrandTotal = useMemo(
    () => dispositionTotals.reduce((s, d) => s + d.total, 0),
    [dispositionTotals],
  );

  // Rep × disposition. A rep with no row for a disposition renders "—", not 0 —
  // HotProspector simply didn't report that pairing.
  const dispositionByRep = useMemo(() => {
    const reps = new Map<string, { name: string; byDisposition: Map<string, number>; total: number; good: number }>();
    for (const d of visibleDispositions) {
      const rep = reps.get(d.member_id)
        ?? { name: d.agent_name ?? d.member_id, byDisposition: new Map(), total: 0, good: 0 };
      rep.name = d.agent_name ?? rep.name;
      rep.byDisposition.set(d.disposition, (rep.byDisposition.get(d.disposition) ?? 0) + d.cnt);
      rep.total += d.cnt;
      if (dispositionTone(d.disposition) === "good") rep.good += d.cnt;
      reps.set(d.member_id, rep);
    }
    // Best "positive" producer first — the question this table answers is
    // "who is generating Hot Leads".
    return [...reps.entries()]
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => b.good - a.good || b.total - a.total);
  }, [visibleDispositions]);

  const credits = account?.credits ?? latestAccount?.credits ?? null;
  const creditTone =
    credits === null ? "text-gray-400"
      : credits <= CREDITS_CRITICAL ? "text-red-500"
        : credits <= CREDITS_LOW ? "text-amber-500"
          : "text-gray-900 dark:text-white";
  const seatSource = account ?? latestAccount;

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PhoneIcon className="w-6 h-6 text-mint-green" /> Dialer Metrics
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
            Per-rep activity from HotProspector (PowerDialer) — effort and efficiency on the phones.
            Numbers are HotProspector's own dashboard, mirrored here; pipeline and revenue live in
            GHL and <span className="font-medium">Deals</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {refreshMsg && (
            <span className={`text-sm ${refreshMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {refreshMsg.text}
            </span>
          )}
          <button
            className="btn btn-sm btn-primary gap-2"
            onClick={refreshNow}
            disabled={refreshing}
          >
            <ArrowPathIcon className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Syncing…" : "Refresh now"}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-error">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>Could not read dialer metrics: {loadError}</span>
        </div>
      )}

      {/* ── Operation alert strip ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Caller-ID / number health */}
        <div className={`card border ${
          numberHealth.tier === "red" ? "border-red-400 dark:border-red-700"
            : numberHealth.tier === "amber" ? "border-amber-400 dark:border-amber-700"
              : "border-base-300"} bg-base-100 shadow-sm`}
        >
          <div className="card-body p-4">
            <div className="flex items-center gap-2">
              <span className={`badge gap-1 ${RAG_STYLE[numberHealth.tier].chip}`}>
                <span aria-hidden>{RAG_STYLE[numberHealth.tier].glyph}</span>
                {numberHealth.tier === "none" ? "No data" : RAG_STYLE[numberHealth.tier].label}
              </span>
              <span className="font-semibold text-gray-900 dark:text-white">Caller-ID health</span>
            </div>
            {numbers.length === 0 ? (
              <p className="text-sm text-gray-500">
                HotProspector reports no numbers on the account yet, so there is nothing to check.
                This is not a clean bill of health — it is an empty list.
              </p>
            ) : numberHealth.flagged.length > 0 ? (
              <>
                <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                  {numberHealth.flagged.length} of {numbers.length} caller IDs are flagged as spam / Scam Likely.
                  Burned numbers destroy connect rate — rotate these before the next dialing block.
                </p>
                <ul className="text-sm mt-1 space-y-0.5">
                  {numberHealth.flagged.slice(0, 8).map((n) => (
                    <li key={n.phone} className="font-mono text-red-700 dark:text-red-400">
                      {n.phone}
                      {n.friendly_name ? <span className="font-sans text-gray-500 ml-2">{n.friendly_name}</span> : null}
                      {n.status ? <span className="font-sans text-gray-500 ml-2">({n.status})</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : numberHealth.unknown.length > 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {numberHealth.clean.length} of {numbers.length} caller IDs confirmed clean;
                HotProspector reported no spam status for the other {numberHealth.unknown.length}.
                Unknown is not clean — check these in the HotProspector console.
              </p>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                All {numbers.length} caller IDs report clean.
              </p>
            )}
          </div>
        </div>

        {/* Credit runway */}
        <div className={`card border ${
          creditRag === "red" ? "border-red-400 dark:border-red-700"
            : creditRag === "amber" ? "border-amber-400 dark:border-amber-700"
              : "border-base-300"} bg-base-100 shadow-sm`}
        >
          <div className="card-body p-4">
            <div className="flex items-center gap-2">
              <span className={`badge gap-1 ${RAG_STYLE[creditRag].chip}`}>
                <span aria-hidden>{RAG_STYLE[creditRag].glyph}</span>
                {creditRag === "none" ? "No data" : RAG_STYLE[creditRag].label}
              </span>
              <span className="font-semibold text-gray-900 dark:text-white">Credit runway</span>
            </div>
            {creditRunway.days === null ? (
              <p className="text-sm text-gray-500">
                Can't estimate days remaining — {creditRunway.reason}.
                {credits !== null && <> Balance is {credits.toLocaleString()} credits.</>}
              </p>
            ) : (
              <p className={`text-sm ${RAG_STYLE[creditRag].text}`}>
                <span className="text-2xl font-bold">{creditRunway.days.toFixed(1)}</span> days of dialing left
                <span className="text-gray-500">
                  {" "}— {credits?.toLocaleString()} credits at {creditRunway.burn?.toFixed(0)}/day
                </span>
              </p>
            )}
            <p className="text-xs text-gray-500" title={targetHint(targets?.credit_days_remaining)}>
              {targetHint(targets?.credit_days_remaining)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Account strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1">
              <BoltIcon className="w-4 h-4" /> Dialer credits
            </div>
            <div className={`text-2xl font-bold ${creditTone}`}>
              {credits === null ? "—" : credits.toLocaleString()}
            </div>
            {credits !== null && credits <= CREDITS_LOW && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                Low — the floor stops dialing when this hits zero.
              </div>
            )}
          </div>
        </div>

        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1">
              <UserGroupIcon className="w-4 h-4" /> Seats
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {seatSource?.seats_active ?? "—"}
              <span className="text-base font-normal text-gray-500"> / {seatSource?.seats_total ?? "—"}</span>
            </div>
            <div className="text-xs text-gray-500">
              {seatSource?.seats_remaining === null || seatSource?.seats_remaining === undefined
                ? "seat usage not reported"
                : `${seatSource.seats_remaining} seat${seatSource.seats_remaining === 1 ? "" : "s"} open`}
            </div>
          </div>
        </div>

        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">Campaigns</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {seatSource?.campaign_count ?? "—"}
            </div>
            <div className="text-xs text-gray-500">dialer campaigns configured</div>
          </div>
        </div>

        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">Last synced</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {sinceText(account?.synced_at ?? latestAccount?.synced_at ?? null)}
            </div>
            <div className="text-xs text-gray-500">
              {account?.dashboard_last_updated
                ? `HotProspector report: ${account.dashboard_last_updated}`
                : "auto-syncs hourly during business hours"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Date picker ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="join">
          <button
            className={`btn btn-sm join-item ${date === pstDay(0) ? "btn-active" : ""}`}
            onClick={() => setDate(pstDay(0))}
          >
            Today
          </button>
          <button
            className={`btn btn-sm join-item ${date === pstDay(1) ? "btn-active" : ""}`}
            onClick={() => setDate(pstDay(1))}
          >
            Yesterday
          </button>
        </div>
        <input
          type="date"
          className="input input-sm input-bordered"
          value={date}
          max={pstDay(0)}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <span className="text-sm text-gray-500">{prettyDate(date)} (HotProspector reports on a PST day)</span>

        <div className="ml-auto flex items-center gap-3">
          {/* Legend — shape carries the tier as well as colour. */}
          <div className="flex items-center gap-3 text-xs">
            {(["green", "amber", "red"] as Rag[]).map((t) => (
              <span key={t} className={`flex items-center gap-1 ${RAG_STYLE[t].text}`}>
                <span aria-hidden>{RAG_STYLE[t].glyph}</span> {RAG_STYLE[t].label}
              </span>
            ))}
            <span className="flex items-center gap-1 text-gray-400">— No data</span>
          </div>
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => { setShowTargets((s) => !s); setDraftTargets(targets); setTargetMsg(null); }}
          >
            {showTargets ? "Hide targets" : "Targets"}
          </button>
        </div>
      </div>

      {/* ── KPI targets ── */}
      {showTargets && (
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">KPI targets</h2>
                <p className="text-xs text-gray-500">
                  Stored in <code>platform_settings.ph_dialer_kpi_targets</code> — every colour on this page
                  comes from these bands, not from anything hardcoded.
                  {" "}Bands are inclusive of the named edge.
                </p>
              </div>
              {isSuperAdmin && (
                <div className="flex items-center gap-2">
                  {targetMsg && (
                    <span className={`text-sm ${targetMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                      {targetMsg.text}
                    </span>
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={saveTargets}
                    disabled={savingTargets || !draftTargets}
                  >
                    {savingTargets ? "Saving…" : "Save targets"}
                  </button>
                </div>
              )}
            </div>

            {!targets ? (
              <p className="text-sm text-red-500 mt-2">
                No targets are configured — every KPI will read "no data" rather than green.
                Seed <code>platform_settings.ph_dialer_kpi_targets</code>.
              </p>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Metric</th><th>Better</th><th>Green at</th><th>Watch at</th><th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(draftTargets ?? targets).map(([key, t]) => (
                      <tr key={key}>
                        <td className="font-medium text-gray-900 dark:text-white">
                          {t.label} <span className="text-xs text-gray-400 font-mono">{key}</span>
                        </td>
                        <td className="text-sm text-gray-500">
                          {t.direction === "lower" ? "lower ↓" : "higher ↑"}
                        </td>
                        {(["green", "amber"] as const).map((band) => (
                          <td key={band}>
                            {isSuperAdmin ? (
                              <input
                                type="number"
                                className="input input-xs input-bordered w-24"
                                value={t[band]}
                                onChange={(e) => {
                                  const n = Number(e.target.value);
                                  setDraftTargets((d) => ({
                                    ...(d ?? targets),
                                    [key]: { ...t, [band]: Number.isFinite(n) ? n : t[band] },
                                  }));
                                }}
                              />
                            ) : (
                              <span className={band === "green" ? RAG_STYLE.green.text : RAG_STYLE.amber.text}>
                                {t.direction === "lower" ? "≤" : "≥"}{t[band]}
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="text-sm text-gray-500">{t.unit || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!isSuperAdmin && (
                  <p className="text-xs text-gray-500 mt-2">Only a super_admin can change these.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Scorecard ── */}
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-0">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Rep scorecard — {prettyDate(date)}
            </h2>
            <span className="text-xs text-gray-500">
              Sorted by {COLUMNS.find((c) => c.key === sort.key)?.label ?? "agent"} · click any header to re-sort
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-gray-500">Loading dialer metrics…</div>
          ) : agents.length === 0 ? (
            // Honest empty state: distinguish "never synced" from "synced, no activity".
            <div className="p-6 space-y-2">
              {!account ? (
                <>
                  <div className="font-medium text-gray-900 dark:text-white">
                    No sync has run for {prettyDate(date)}.
                  </div>
                  <div className="text-sm text-gray-500">
                    Hit <span className="font-medium">Refresh now</span> to pull this day from HotProspector.
                    This is not a zero — nothing has been fetched yet.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-medium text-gray-900 dark:text-white">
                    HotProspector reported no agent activity for {prettyDate(date)}.
                  </div>
                  <div className="text-sm text-gray-500">
                    Synced {sinceText(account.synced_at)}
                    {account.dashboard_message ? ` · HotProspector said: "${account.dashboard_message}"` : ""}.
                    {account.seats_active === 0 && (
                      <> Seat usage shows <span className="font-medium">0 of {account.seats_total ?? "?"} seats active</span>,
                        so there are no dialer users on the account yet — this table fills in once setters are
                        provisioned and start dialing.</>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("agent")}
                    >
                      Rep {sort.key === "agent" && (sort.desc ? "▼" : "▲")}
                    </th>
                    <th title="Worst tier across every KPI with data for this rep">Health</th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className="cursor-pointer select-none whitespace-nowrap"
                        title={c.hint}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label} {sort.key === c.key && (sort.desc ? "▼" : "▲")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAgents.map((r) => (
                    <tr
                      key={r.member_id}
                      className={r.member_id === leaderId ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}
                    >
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1 font-medium text-gray-900 dark:text-white">
                          {r.member_id === leaderId && (
                            <TrophyIcon
                              className="w-4 h-4 text-amber-500"
                              title={`Leader on ${COLUMNS.find((c) => c.key === sort.key)?.label}`}
                            />
                          )}
                          {r.agent_name ?? <span className="text-gray-400">Unnamed ({r.member_id})</span>}
                        </div>
                        <div className="text-xs text-gray-500">
                          {r.agent_email ?? "no email on file"}
                          {r.first_call && r.last_call ? ` · ${r.first_call}–${r.last_call}` : ""}
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const tier = healthByAgent.get(r.member_id) ?? "none";
                          return (
                            <span
                              className={`badge badge-sm gap-1 ${RAG_STYLE[tier].chip}`}
                              title={
                                tier === "none"
                                  ? "No KPI had both a value and a configured target"
                                  : `Worst KPI tier for this rep: ${RAG_STYLE[tier].label}`
                              }
                            >
                              <span aria-hidden>{RAG_STYLE[tier].glyph}</span>
                              {tier === "none" ? "No data" : RAG_STYLE[tier].label}
                            </span>
                          );
                        })()}
                      </td>
                      {COLUMNS.map((c) => {
                        // Colour + SHAPE, never colour alone.
                        const tier = c.kpi ? rag((c.kpiValue ?? c.value)(r), targets?.[c.kpi]) : "none";
                        return (
                          <td
                            key={c.key}
                            className={`whitespace-nowrap ${c.kpi ? RAG_STYLE[tier].text : ""}`}
                            title={c.kpi ? targetHint(targets?.[c.kpi]) : c.hint}
                          >
                            {tier !== "none" && (
                              <span aria-hidden className="mr-1 text-[10px]">{RAG_STYLE[tier].glyph}</span>
                            )}
                            {c.render(r)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Dispositions ── */}
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Dispositions — {prettyDate(date)}
              </h2>
              <p className="text-xs text-gray-500">
                How dials ended, per campaign and per rep. Positive outcomes are highlighted.
              </p>
            </div>
            <select
              className="select select-sm select-bordered"
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              disabled={campaignOptions.length === 0}
            >
              <option value="all">
                {campaignOptions.length === 0 ? "No campaigns" : "All campaigns"}
              </option>
              {campaignOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="text-gray-500 mt-3">Loading dispositions…</div>
          ) : dispositionGrandTotal === 0 ? (
            // Honest empty state — and say WHICH reason applies.
            <div className="mt-3 text-sm space-y-1">
              <div className="font-medium text-gray-900 dark:text-white">
                No dispositions recorded for {campaignFilter === "all" ? "any campaign" : "this campaign"} on{" "}
                {prettyDate(date)}.
              </div>
              <div className="text-gray-500">
                {!account
                  ? "No sync has run for this day yet — hit Refresh now."
                  : (account.campaign_count ?? 0) === 0
                    ? "HotProspector reports no dialer campaigns configured on the account, so there is nothing to break down yet. Dispositions appear once campaigns exist and reps start dialing them."
                    : "The campaigns were pulled but HotProspector returned no disposition counts for this day."}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-6">
              {/* Totals */}
              <div className="space-y-2">
                {dispositionTotals.map((d) => (
                  <div key={d.disposition} className="flex items-center gap-3">
                    <div className={`w-44 shrink-0 text-sm ${TONE_TEXT[d.tone]}`}>{d.disposition}</div>
                    <div className="flex-1 h-3 bg-base-200 rounded overflow-hidden">
                      <div
                        className={`h-full ${TONE_BAR[d.tone]}`}
                        style={{ width: `${Math.max(2, Math.round((d.total / dispositionGrandTotal) * 100))}%` }}
                      />
                    </div>
                    <div className="w-24 text-right text-sm tabular-nums">
                      <span className={TONE_TEXT[d.tone]}>{d.total}</span>
                      <span className="text-xs text-gray-400 ml-1">
                        {Math.round((d.total / dispositionGrandTotal) * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Rep × disposition */}
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Rep</th>
                      {dispositionTotals.map((d) => (
                        <th key={d.disposition} className={`whitespace-nowrap ${TONE_TEXT[d.tone]}`}>
                          {d.disposition}
                        </th>
                      ))}
                      <th className="whitespace-nowrap">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispositionByRep.map((rep) => (
                      <tr key={rep.id}>
                        <td className="font-medium text-gray-900 dark:text-white whitespace-nowrap">{rep.name}</td>
                        {dispositionTotals.map((d) => {
                          const v = rep.byDisposition.get(d.disposition);
                          return (
                            <td key={d.disposition} className="tabular-nums">
                              {v === undefined ? (
                                <span
                                  className="text-gray-300 dark:text-gray-600"
                                  title="Not reported by HotProspector for this rep"
                                >
                                  —
                                </span>
                              ) : (
                                <span className={d.tone === "good" ? TONE_TEXT.good : ""}>{v}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="tabular-nums font-medium">{rep.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 7-day trend ── */}
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              {TREND_DAYS}-day trend per rep
            </h2>
            <div className="join">
              {(Object.keys(TREND_META) as TrendKey[]).map((k) => (
                <button
                  key={k}
                  className={`btn btn-xs join-item ${trendKey === k ? "btn-active" : ""}`}
                  onClick={() => setTrendKey(k)}
                >
                  {TREND_META[k].label}
                </button>
              ))}
            </div>
          </div>

          {trendByRep.length === 0 ? (
            <p className="text-sm text-gray-500 mt-2">
              No snapshots in the {TREND_DAYS} days ending {prettyDate(date)} — nothing to trend yet.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {trendByRep.map((rep) => (
                <div key={rep.id}>
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">{rep.name}</div>
                  <div className="flex items-end gap-2">
                    {trendDays.map((d) => {
                      const v = rep.byDay.has(d) ? rep.byDay.get(d)! : undefined;
                      // undefined = no snapshot that day; null = snapshot exists but
                      // HotProspector didn't report the metric. Neither is a zero.
                      const pct = v === undefined || v === null || trendMax === 0
                        ? 0 : Math.max(4, Math.round((v / trendMax) * 100));
                      return (
                        <div key={d} className="flex-1 flex flex-col items-center gap-1">
                          <div className="h-16 w-full flex items-end">
                            {v === undefined || v === null ? (
                              <div
                                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded"
                                title={v === undefined ? "No snapshot for this day" : "Not reported by HotProspector"}
                              />
                            ) : (
                              <div
                                className="w-full bg-mint-green/70 rounded-t"
                                style={{ height: `${pct}%` }}
                                title={`${v} ${TREND_META[trendKey].label.toLowerCase()} on ${prettyDate(d)}`}
                              />
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500">{d.slice(5)}</div>
                          <div className="text-[10px] text-gray-700 dark:text-gray-300">
                            {v === undefined || v === null ? "—" : v}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        A dash means HotProspector did not report that metric for the day — it is never rendered as a zero.
        Snapshots refresh hourly during business hours plus a settling pass the next morning; use
        <span className="font-medium"> Refresh now</span> for an immediate pull, which also re-pulls dispositions.
        Number health and call-transcript intelligence are the next layer and are not on this page yet.
      </p>
    </div>
  );
}
