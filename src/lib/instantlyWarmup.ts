// ── Shared Instantly warmup model ────────────────────────────────────────────
// Single source of truth for the cold-email warmup clock + domain grouping,
// reused by both the Email page (EmailPage) and the Cold Email Planner so the
// two views always agree on what "warmed" means. Do not fork this logic.

export interface InstantlyAccount {
  email?: string;
  status?: number | string;
  warmup_status?: number | string;
  warmup_score?: number;
  stat_warmup_score?: number;
  daily_limit?: number;
  setup_pending?: boolean;
  timestamp_warmup_start?: string | null;
  timestamp_created?: string | null;
  [k: string]: unknown;
}

export interface InstantlyCampaign {
  id?: string;
  name?: string;
  status?: number | string;
  [k: string]: unknown;
}

export interface Overview {
  key_present?: boolean;
  accounts: InstantlyAccount[];
  campaigns: InstantlyCampaign[];
  forwarding?: Record<string, { target: string | null; ok: boolean }>;
  real_site?: string;
  errors?: { accounts: string | null; campaigns: string | null };
}

// RED before 3 weeks (do NOT send) · YELLOW 3–6 weeks (warming, can start light
// after ~3.5wk) · GREEN after 6 weeks (safe full send).
export const WARM_YELLOW_DAYS = 21; // 3 weeks
export const WARM_GREEN_DAYS = 42; // 6 weeks
export const WARM_MIN_SEND_DAYS = 25; // ~3.5 weeks — earliest you'd cautiously start
const DAY_MS = 86_400_000;

export type WarmTone = "red" | "yellow" | "green";
export interface WarmState {
  started: boolean;
  days: number; // days warming so far
  toGreen: number; // days remaining until green (0 if green)
  pct: number; // progress toward 6 weeks (0–100)
  tone: WarmTone;
  label: string;
  canStart: boolean; // past the ~3.5-week minimum
}

export function warmupStart(a: InstantlyAccount): string | null {
  return a.timestamp_warmup_start || a.timestamp_created || null;
}

export function warmState(startIso: string | null, now: number): WarmState {
  if (!startIso) return { started: false, days: 0, toGreen: WARM_GREEN_DAYS, pct: 0, tone: "red", label: "Warmup not started", canStart: false };
  const days = Math.max(0, Math.floor((now - Date.parse(startIso)) / DAY_MS));
  const toGreen = Math.max(0, WARM_GREEN_DAYS - days);
  const pct = Math.min(100, Math.round((days / WARM_GREEN_DAYS) * 100));
  const canStart = days >= WARM_MIN_SEND_DAYS;
  if (days >= WARM_GREEN_DAYS) return { started: true, days, toGreen, pct, tone: "green", label: "Ready — safe to send", canStart: true };
  if (days >= WARM_YELLOW_DAYS) return { started: true, days, toGreen, pct, tone: "yellow", label: canStart ? "Warming — can start light" : "Warming — not yet at 3.5-week minimum", canStart };
  return { started: true, days, toGreen, pct, tone: "red", label: "Too early — do NOT send", canStart: false };
}

export const WARM_TONE: Record<WarmTone, { chip: string; bar: string; ring: string; dot: string; text: string }> = {
  red:    { chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",       bar: "bg-red-500",    ring: "border-red-300 dark:border-red-800",       dot: "bg-red-500",    text: "text-red-600 dark:text-red-400" },
  yellow: { chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", bar: "bg-amber-500",  ring: "border-amber-300 dark:border-amber-800",   dot: "bg-amber-500",  text: "text-amber-600 dark:text-amber-400" },
  green:  { chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", bar: "bg-emerald-500", ring: "border-emerald-300 dark:border-emerald-800", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
};

export interface DomainGroup {
  domain: string;
  accts: InstantlyAccount[];
  start: string | null;
  ws: WarmState;
  avgHealth: number;
  fwd?: { target: string | null; ok: boolean };
}

export function groupDomains(accounts: InstantlyAccount[], forwarding: Record<string, { target: string | null; ok: boolean }>, now: number): DomainGroup[] {
  const map = new Map<string, InstantlyAccount[]>();
  for (const a of accounts) {
    const d = a.email?.split("@")[1]?.toLowerCase() ?? "unknown";
    const arr = map.get(d) ?? [];
    arr.push(a);
    map.set(d, arr);
  }
  return [...map.entries()]
    .map(([domain, accts]) => {
      const starts = accts.map(warmupStart).filter((s): s is string => !!s).sort();
      const start = starts[0] ?? null; // domain warmup began when its first mailbox started
      const avgHealth = accts.length
        ? Math.round(accts.reduce((s, a) => s + (Number(a.stat_warmup_score ?? a.warmup_score) || 0), 0) / accts.length)
        : 0;
      return { domain, accts, start, ws: warmState(start, now), avgHealth, fwd: forwarding[domain] };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
