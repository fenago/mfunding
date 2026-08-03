import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HeartIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  BoltIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";

// ── Types (mirror the live DB contract) ──────────────────────────────────────
type Status = "up" | "degraded" | "down";

interface HealthState {
  service: string;
  status: string | null;
  http_status: number | null;
  latency_ms: number | null;
  detail: string | null;
  last_transition_at: string | null;
  alerted: boolean | null;
  updated_at: string | null;
}
interface HealthCheck {
  id: string;
  service: string;
  status: string | null;
  http_status: number | null;
  latency_ms: number | null;
  detail: string | null;
  checked_at: string;
}
interface HealthIncident {
  id: string;
  service: string;
  status: string | null;
  detail: string | null;
  opened_at: string;
  closed_at: string | null;
}

// ── Service lookup: raw service string → friendly label + "what to do" hint ───
// Any service NOT in this map falls back to the raw string + a generic hint, so
// new services the backend starts writing still render honestly.
const SERVICE_META: Record<string, { label: string; hint: string }> = {
  instantly: {
    label: "Instantly (email verify / warmup)",
    hint: "Renew the plan at instantly.ai → Billing. Email verification + warmup are paused until then.",
  },
  ghl: {
    label: "GoHighLevel / VibeReach",
    hint: "Check the GHL Private Integration Token and the sub-account status.",
  },
  llm: {
    label: "AI provider (underwriting / recommendations)",
    hint: "Check the AI provider's credits/billing in Admin → Integrations → AI Provider.",
  },
  plaid: {
    label: "Plaid (bank connection)",
    hint: "Check PLAID_CLIENT_ID / PLAID_SECRET_* in the vault and the environment toggle in platform_settings.plaid.",
  },
  "site:mfunding.net": {
    label: "Website (mfunding.net)",
    hint: "Check the Netlify deploy + DNS.",
  },
  "site:my.mfunding.net": {
    label: "Merchant portal (my.mfunding.net)",
    hint: "Check Netlify alias + GoDaddy DNS for the portal subdomain.",
  },
  "edge-runtime": {
    label: "Supabase edge runtime",
    hint: "If this is down, health checks aren't running — check Supabase status / project pause.",
  },
  cron: {
    label: "Scheduled jobs (pg_cron)",
    hint: "A cron job failed or stalled — see the detail line; check pg_cron / pg_net.",
  },
  "supabase-egress": {
    label: "Supabase egress / usage cap",
    hint: "Egress or disk is near/over the Pro quota, or the project is 402-restricted. Check Supabase dashboard → Billing / Usage; raise or lift the spend cap before it restricts REST + edge functions.",
  },
};

function metaFor(service: string) {
  return SERVICE_META[service] ?? { label: service, hint: "" };
}

// Integrations we know about but do NOT actively test. Rendered as neutral grey
// chips — never a green check for something we don't probe (honesty rule).
// Plaid graduated to a real UP/DOWN probe (checkPlaid in system-health-check).
const NOT_INSTRUMENTED: { name: string; note: string }[] = [];

function normStatus(s: string | null): Status | null {
  if (s === "up" || s === "degraded" || s === "down") return s;
  return null;
}

// down first, then degraded, then up, then unknown; tiebreak alphabetical by label.
const STATUS_RANK: Record<string, number> = { down: 0, degraded: 1, up: 2 };
function statusRank(s: string | null): number {
  return s && s in STATUS_RANK ? STATUS_RANK[s] : 3;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

// ── Status colors ─────────────────────────────────────────────────────────────
const PILL: Record<Status, string> = {
  up: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  degraded: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  down: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};
const SEG: Record<Status, string> = {
  up: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-red-500",
};
const NO_DATA_SEG = "bg-gray-200 dark:bg-gray-700";

// ── Uptime strip: bucket checks in the window; worst status per bucket wins ────
type Window = "24h" | "7d";
const WINDOW_MS: Record<Window, number> = { "24h": 24 * 3600_000, "7d": 7 * 24 * 3600_000 };
const WINDOW_BUCKETS: Record<Window, number> = { "24h": 48, "7d": 84 };

interface Bucket {
  status: Status | null;
  startMs: number;
}
function buildBuckets(checks: HealthCheck[], window: Window): Bucket[] {
  const now = Date.now();
  const span = WINDOW_MS[window];
  const count = WINDOW_BUCKETS[window];
  const size = span / count;
  const start = now - span;
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    status: null,
    startMs: start + i * size,
  }));
  for (const c of checks) {
    const t = Date.parse(c.checked_at);
    if (!Number.isFinite(t) || t < start || t > now) continue;
    const idx = Math.min(count - 1, Math.floor((t - start) / size));
    const st = normStatus(c.status);
    if (!st) continue;
    const cur = buckets[idx].status;
    // worst wins: down > degraded > up
    if (cur === null || statusRank(st) < statusRank(cur)) buckets[idx].status = st;
  }
  return buckets;
}

export default function SystemHealthPage() {
  const [states, setStates] = useState<HealthState[]>([]);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [incidents, setIncidents] = useState<HealthIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState<Window>("24h");
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - WINDOW_MS["7d"]).toISOString();
    const [stateRes, checkRes, incidentRes] = await Promise.all([
      supabase
        .from("system_health_state")
        .select("service, status, http_status, latency_ms, detail, last_transition_at, alerted, updated_at"),
      supabase
        .from("system_health_checks")
        .select("id, service, status, http_status, latency_ms, detail, checked_at")
        .gte("checked_at", sevenDaysAgo)
        .order("checked_at", { ascending: false })
        .limit(5000),
      supabase
        .from("system_health_incidents")
        .select("id, service, status, detail, opened_at, closed_at")
        .order("opened_at", { ascending: false })
        .limit(20),
    ]);
    setStates((stateRes.data || []) as HealthState[]);
    setChecks((checkRes.data || []) as HealthCheck[]);
    setIncidents((incidentRes.data || []) as HealthIncident[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runChecks() {
    setRunning(true);
    setRunMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("system-health-check", { body: { source: "ui" } });
      if (error) {
        setRunMsg({ ok: false, text: error.message || "Health check failed to run." });
        setRunning(false);
        return;
      }
      // Refetch, then summarize from the fresh state rows (source of truth).
      const sevenDaysAgo = new Date(Date.now() - WINDOW_MS["7d"]).toISOString();
      const [stateRes, checkRes, incidentRes] = await Promise.all([
        supabase
          .from("system_health_state")
          .select("service, status, http_status, latency_ms, detail, last_transition_at, alerted, updated_at"),
        supabase
          .from("system_health_checks")
          .select("id, service, status, http_status, latency_ms, detail, checked_at")
          .gte("checked_at", sevenDaysAgo)
          .order("checked_at", { ascending: false })
          .limit(5000),
        supabase
          .from("system_health_incidents")
          .select("id, service, status, detail, opened_at, closed_at")
          .order("opened_at", { ascending: false })
          .limit(20),
      ]);
      const fresh = (stateRes.data || []) as HealthState[];
      setStates(fresh);
      setChecks((checkRes.data || []) as HealthCheck[]);
      setIncidents((incidentRes.data || []) as HealthIncident[]);

      const total = fresh.length;
      const down = fresh.filter((s) => normStatus(s.status) === "down").length;
      const degraded = fresh.filter((s) => normStatus(s.status) === "degraded").length;
      const parts: string[] = [];
      if (down) parts.push(`${down} down`);
      if (degraded) parts.push(`${degraded} degraded`);
      // Honesty: reflect what the response actually returned, if present.
      const checkedFromFn =
        data && typeof data === "object" && typeof (data as { checked?: unknown }).checked === "number"
          ? (data as { checked: number }).checked
          : total;
      setRunMsg({
        ok: down === 0,
        text:
          parts.length === 0
            ? `Checked ${checkedFromFn} services — all up`
            : `Checked ${checkedFromFn} services — ${parts.join(", ")}`,
      });
    } catch (e) {
      setRunMsg({ ok: false, text: e instanceof Error ? e.message : "Health check failed to run." });
    }
    setRunning(false);
  }

  const sortedStates = useMemo(() => {
    return [...states].sort((a, b) => {
      const r = statusRank(a.status) - statusRank(b.status);
      if (r !== 0) return r;
      return metaFor(a.service).label.localeCompare(metaFor(b.service).label);
    });
  }, [states]);

  // group checks by service once for the uptime section
  const checksByService = useMemo(() => {
    const map = new Map<string, HealthCheck[]>();
    for (const c of checks) {
      const arr = map.get(c.service);
      if (arr) arr.push(c);
      else map.set(c.service, [c]);
    }
    return map;
  }, [checks]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <HeartIcon className="w-6 h-6 text-mint-green" /> System Health
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Live status of the external APIs and systems MFunding depends on.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {runMsg && (
            <span className={`text-sm ${runMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {runMsg.text}
            </span>
          )}
          <button
            onClick={runChecks}
            disabled={running}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-mint-green text-white hover:opacity-90 disabled:opacity-50"
          >
            <BoltIcon className={`w-4 h-4 ${running ? "animate-pulse" : ""}`} />
            {running ? "Running checks…" : "Run checks now"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Status tiles ─────────────────────────────────────────────────────── */}
      {loading && states.length === 0 ? (
        <p className="text-sm text-gray-400">Loading service status…</p>
      ) : sortedStates.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400">No checks have run yet — click Run checks now</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedStates.map((s) => {
            const meta = metaFor(s.service);
            const st = normStatus(s.status);
            const bad = st === "down" || st === "degraded";
            return (
              <div
                key={s.service}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white truncate">{meta.label}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">{s.service}</p>
                  </div>
                  {st ? (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${PILL[st]}`}>
                      {st}
                    </span>
                  ) : (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                      No data yet
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  {typeof s.latency_ms === "number" && (
                    <span>
                      <span className="text-gray-400">Latency</span>{" "}
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{s.latency_ms}ms</span>
                    </span>
                  )}
                  {typeof s.http_status === "number" && (
                    <span>
                      <span className="text-gray-400">HTTP</span>{" "}
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{s.http_status}</span>
                    </span>
                  )}
                  <span>
                    <span className="text-gray-400">Checked</span> {relTime(s.updated_at)}
                  </span>
                </div>

                {s.detail && <p className="text-xs text-gray-600 dark:text-gray-300">{s.detail}</p>}

                {bad && meta.hint && (
                  <div className="mt-auto text-xs rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-900/40 flex gap-2">
                    <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{meta.hint}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Uptime history ───────────────────────────────────────────────────── */}
      {sortedStates.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-gray-900 dark:text-white">Uptime history</h2>
            <div className="flex items-center gap-4">
              {/* Legend */}
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-sm ${SEG.up}`} /> up
                </span>
                <span className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-sm ${SEG.degraded}`} /> degraded
                </span>
                <span className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-sm ${SEG.down}`} /> down
                </span>
                <span className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-sm ${NO_DATA_SEG}`} /> no data
                </span>
              </div>
              {/* Window toggle */}
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-semibold">
                {(["24h", "7d"] as Window[]).map((w) => (
                  <button
                    key={w}
                    onClick={() => setWindow(w)}
                    className={`px-3 py-1.5 ${
                      window === w
                        ? "bg-mint-green/10 text-mint-green"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {sortedStates.map((s) => {
              const meta = metaFor(s.service);
              const svcChecks = checksByService.get(s.service) || [];
              const buckets = buildBuckets(svcChecks, window);
              return (
                <div key={s.service} className="flex items-center gap-3">
                  <div className="w-48 flex-shrink-0 min-w-0">
                    <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{meta.label}</p>
                  </div>
                  <div className="flex-1 flex gap-px h-6 rounded overflow-hidden">
                    {buckets.map((b, i) => {
                      const when = new Date(b.startMs).toLocaleString();
                      const stTxt = b.status ?? "no data";
                      return (
                        <div
                          key={i}
                          title={`${when} — ${stTxt}`}
                          className={`flex-1 ${b.status ? SEG[b.status] : NO_DATA_SEG}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recent incidents ─────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-gray-100 dark:border-gray-700">
          <ExclamationTriangleIcon className={`w-5 h-5 ${incidents.length ? "text-amber-500" : "text-emerald-500"}`} />
          <h2 className="font-bold text-gray-900 dark:text-white">Recent incidents</h2>
          {incidents.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {incidents.length}
            </span>
          )}
        </div>
        {incidents.length === 0 ? (
          <div className="p-6 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="w-5 h-5" /> No incidents recorded
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Severity</th>
                  <th className="py-3 px-4">Opened</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Detail</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => {
                  const meta = metaFor(inc.service);
                  const st = normStatus(inc.status);
                  const closed = inc.closed_at ? Date.parse(inc.closed_at) : null;
                  const opened = Date.parse(inc.opened_at);
                  const duration =
                    closed !== null && Number.isFinite(closed) && Number.isFinite(opened)
                      ? fmtDuration(closed - opened)
                      : null;
                  return (
                    <tr key={inc.id} className="border-b border-gray-50 dark:border-gray-800">
                      <td className="py-2.5 px-4 text-gray-900 dark:text-white">{meta.label}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${
                            st ? PILL[st] : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {st ?? inc.status ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-gray-500 whitespace-nowrap">
                        {new Date(inc.opened_at).toLocaleString()}
                        <span className="block text-xs text-gray-400">{relTime(inc.opened_at)}</span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {duration ? (
                          <span className="text-gray-600 dark:text-gray-300">{duration}</span>
                        ) : (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            ongoing
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500 max-w-xs truncate">{inc.detail || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Not instrumented ─────────────────────────────────────────────────── */}
      {NOT_INSTRUMENTED.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <SignalSlashIcon className="w-5 h-5 text-gray-400" />
            <h2 className="font-bold text-gray-900 dark:text-white">Not instrumented</h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Integrations we know about but do <span className="font-semibold">not</span> actively test yet. We never show a
            green check for something we don't probe.
          </p>
          <div className="flex flex-wrap gap-2">
            {NOT_INSTRUMENTED.map((n) => (
              <span
                key={n.name}
                title={n.note}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="font-semibold">{n.name}</span>
                <span className="text-gray-400 dark:text-gray-400">· {n.note}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
