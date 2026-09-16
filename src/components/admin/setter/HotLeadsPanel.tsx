import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  FireIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { QUEUE_CLOSED_STATUSES } from "@/services/dealService";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import { REALTIME_LEAD_SOURCES, sourceMeta, SOURCE_TONE_CLASS } from "@/lib/sourceLabel";
import { handoffState, leadHeat, HEAT_RANK, type Heat, type HeatTier } from "@/lib/realtimeLeads";

/**
 * HotLeadsPanel — the 🔥 HOT section pinned to the TOP of the Setter Operations
 * console.
 *
 * WHY IT EXISTS (owner, 2026-09-16): live transfers and real-time appointments are
 * the most expensive leads MFunding buys and the most perishable — speed-to-lead is
 * the entire product. They were landing in the general queue and getting buried
 * under hundreds of aged/UCC records. This panel makes them impossible to miss and
 * says, per lead, how long it has been sitting and how many times it has actually
 * been dialed, because the instruction is "call those immediately and repeatedly".
 *
 * SCOPE — real-time sources only (live_transfer + realtime_appt), created in the
 * last 7 days. The source list is NOT hand-written here: it comes from
 * REALTIME_LEAD_SOURCES in src/lib/sourceLabel.ts, the same map every other surface
 * uses to label a lead, so a new real-time vendor source lights up here for free.
 *
 * ACCESS — this is a plain `deals` select with NO closer filter, so RLS decides who
 * sees what, exactly as it already does elsewhere on this page: an admin or a
 * processor sees the whole board, a plain closer sees their own book plus unassigned
 * (the money wall, 20260827_setter_deal_money_wall.sql). No new data access, no RPC,
 * no bypass.
 *
 * HONESTY (readers-must-distinguish-unreadable): a failed read renders a RED "the
 * read failed" box and NEVER "0 hot leads". A genuine zero renders one calm line —
 * no alarming empty box, which would teach the team to ignore the flames.
 */

// The window the owner asked for. Anything older stops being a speed-to-lead
// problem and is just pipeline, which the rest of the console already handles.
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 3_600_000;
const ROW_CAP = 200;
/** How many live rows show before the "show all" expander. */
const PREVIEW_ROWS = 8;

const DEAL_COLS =
  "id,deal_number,status,lead_source,created_at,created_by,first_call_due_at,first_attempt_at,last_attempt_at,contact_attempts,contacted_at,spoke_at,callback_at,callback_source,amount_requested,assigned_closer_id,ghl_contact_id,lead_qual,customer:customers!customer_id(business_name,first_name,last_name,phone,do_not_contact)";

interface HotCustomer {
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  do_not_contact: boolean | null;
}

interface HotRow {
  id: string;
  deal_number: string | null;
  status: string | null;
  lead_source: string | null;
  created_at: string;
  created_by: string | null;
  first_call_due_at: string | null;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  contact_attempts: number | null;
  contacted_at: string | null;
  spoke_at: string | null;
  callback_at: string | null;
  callback_source: string | null;
  amount_requested: number | null;
  assigned_closer_id: string | null;
  ghl_contact_id: string | null;
  lead_qual: Record<string, unknown> | null;
  customer: HotCustomer | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: HotRow[] };

const PARKED = new Set<string>(QUEUE_CLOSED_STATUSES);
const isParked = (status: string | null) => !!status && PARKED.has(status);

function merchantName(r: HotRow): string {
  const c = r.customer;
  return (
    c?.business_name?.trim() ||
    [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() ||
    r.deal_number ||
    "Unnamed merchant"
  );
}

function prettyPhone(raw: string | null): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : raw;
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** mm:ss, for the real-time 5-minute clock. */
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The merchant's own answer to "best time to reach you" — free text from the
 *  vendor email, displayed and never parsed (same rule as My Day). */
function bestTimeToCall(r: HotRow): string | undefined {
  const raw = r.lead_qual && typeof r.lead_qual === "object" ? r.lead_qual["best_time"] : null;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || /^(n\/?a|none|any|anytime)$/i.test(s)) return undefined;
  return s;
}

// ── The visual ladder. Everything escalates together: flames, badge, row edge. ──
const TIER_UI: Record<
  HeatTier,
  { flames: string; label: string; badge: string; edge: string; row: string }
> = {
  blazing: {
    flames: "🔥🔥🔥",
    label: "UNTOUCHED — CALL NOW",
    badge: "bg-red-600 text-white animate-pulse",
    edge: "border-l-red-600",
    row: "bg-red-50 dark:bg-red-950/40 ring-1 ring-inset ring-red-400/60 dark:ring-red-700/60",
  },
  burning: {
    flames: "🔥🔥",
    label: "BADLY BEHIND",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200",
    edge: "border-l-red-500",
    row: "bg-red-50/50 dark:bg-red-950/20",
  },
  hot: {
    flames: "🔥",
    label: "NEEDS ANOTHER DIAL",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200",
    edge: "border-l-orange-500",
    row: "bg-orange-50/40 dark:bg-orange-950/15",
  },
  working: {
    flames: "",
    label: "Being worked",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    edge: "border-l-amber-400",
    row: "",
  },
  connected: {
    flames: "",
    label: "Spoke ✓",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    edge: "border-l-emerald-500",
    row: "",
  },
  parked: {
    flames: "",
    label: "Parked",
    badge: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
    edge: "border-l-gray-300 dark:border-l-gray-600",
    row: "",
  },
};

/** The one line that says, in words, WHY this lead is the colour it is. */
function heatWhy(r: HotRow, h: Heat, now: number): string {
  switch (h.tier) {
    case "blazing":
      return r.lead_source === "live_transfer"
        ? "The vendor handed this merchant over and nobody has dialed them. Call now."
        : `Arrived ${ago(r.created_at, now)} and never dialed — this is the speed-to-lead window we pay for.`;
    case "burning":
      return `${h.attempts} attempt${h.attempts === 1 ? "" : "s"} in ${ago(r.created_at, now)
        .replace(" ago", "")} — ${h.deficit} short of where it should be. This one is rotting.`;
    case "hot":
      return `${h.attempts} attempt${h.attempts === 1 ? "" : "s"} so far — due another dial today.`;
    case "working":
      return `${h.attempts} attempt${h.attempts === 1 ? "" : "s"} logged — on pace, keep going.`;
    case "connected":
      return "A real conversation happened — this is a pipeline deal now, not a chase.";
    case "parked":
      return "Closed out of the working pipeline — shown so it isn't silently dropped.";
  }
}

export default function HotLeadsPanel({
  onOpen,
}: {
  onOpen: (lookup: { dealId: string }) => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [showParked, setShowParked] = useState(false);
  // Foldable, remembered, and DEFAULT COLLAPSED (owner ruling 2026-09-16).
  // The header still carries the whole alarm — the flame, the count, and
  // "N need calling now" — so a folded panel is a one-line summons rather than a
  // hidden section. Only a viewer who has explicitly expanded it before (the
  // stored "0") reopens expanded, so the choice sticks per person.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hotLeadsCollapsed") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("hotLeadsCollapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setState({ kind: "loading" });
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("deals")
      .select(DEAL_COLS)
      .in("lead_source", REALTIME_LEAD_SOURCES)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP);
    if (error) {
      // UNREADABLE ≠ zero. Never let a failed read render as "no hot leads".
      setState({ kind: "error", message: error.message });
      return;
    }
    setState({ kind: "ready", rows: (data ?? []) as unknown as HotRow[] });
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load(true);
    // A real-time lead that lands while the console is open has to appear on its
    // own — a setter waiting to hit refresh is the bug. Quiet refetch, no spinner.
    const poll = setInterval(() => void load(false), 30_000);
    return () => clearInterval(poll);
  }, [load]);

  // Ticks the clocks (age, last-touch, the 5-minute countdown) every second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const { live, parked, liveCount } = useMemo(() => {
    const rows = state.kind === "ready" ? state.rows : [];
    const scored = rows.map((r) => ({ r, h: leadHeat(r, now, isParked) }));
    // Hottest first; inside a tier, the one that has been waiting longest.
    scored.sort(
      (a, b) =>
        HEAT_RANK[a.h.tier] - HEAT_RANK[b.h.tier] ||
        b.h.deficit - a.h.deficit ||
        b.h.ageMs - a.h.ageMs,
    );
    const liveRows = scored.filter((s) => s.h.tier !== "parked");
    return {
      live: liveRows,
      parked: scored.filter((s) => s.h.tier === "parked"),
      liveCount: liveRows.length,
    };
  }, [state, now]);

  // The number that earns the flame in the header: leads actually being neglected.
  const urgentCount = live.filter((s) => s.h.tier === "blazing" || s.h.tier === "burning").length;

  const alarmed = state.kind === "ready" && urgentCount > 0;

  const header = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="group flex items-center gap-2 text-left min-w-0"
        title={collapsed ? "Show the hot real-time leads" : "Fold the hot real-time leads away"}
      >
        {collapsed ? (
          <ChevronRightIcon className="w-4 h-4 text-gray-400 group-hover:text-orange-500 shrink-0" />
        ) : (
          <ChevronDownIcon className="w-4 h-4 text-gray-400 group-hover:text-orange-500 shrink-0" />
        )}
        <FireIcon
          className={`w-5 h-5 shrink-0 ${alarmed ? "text-red-600 dark:text-red-400 animate-pulse" : "text-orange-500 dark:text-orange-400"}`}
        />
        <span className="text-sm font-black tracking-tight text-gray-900 dark:text-white uppercase">
          Hot — real-time leads
        </span>
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 hidden sm:inline">
          last {WINDOW_DAYS} days
        </span>
        {state.kind === "ready" && (
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
              urgentCount > 0
                ? "bg-red-600 text-white"
                : liveCount > 0
                  ? "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
            }`}
          >
            {urgentCount > 0 ? `${urgentCount} need calling now` : `${liveCount} open`}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => void load(true)}
        disabled={state.kind === "loading"}
        className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-orange-600 disabled:opacity-50 shrink-0"
        title="Reload the real-time leads"
      >
        <ArrowPathIcon className={`w-3.5 h-3.5 ${state.kind === "loading" ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">Refresh</span>
      </button>
    </div>
  );

  const visible = showAll ? live : live.slice(0, PREVIEW_ROWS);

  return (
    <div
      className={`rounded-xl border-2 p-4 transition-colors ${
        alarmed
          ? "border-red-400 dark:border-red-600/70 bg-gradient-to-br from-red-50 via-orange-50 to-white dark:from-red-950/40 dark:via-orange-950/20 dark:to-gray-800"
          : "border-orange-300/70 dark:border-orange-700/50 bg-white dark:bg-gray-800"
      }`}
    >
      {header}

      {!collapsed && (
        <>
          {state.kind === "loading" && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-5">
              <span className="loading loading-spinner loading-xs" /> Checking for real-time leads…
            </div>
          )}

          {state.kind === "error" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
              <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Couldn't read the real-time leads.</div>
                <div className="mt-0.5">
                  This is <b>not</b> "no hot leads" — it's an unreadable list. There may be live
                  transfers waiting that this panel cannot see right now.
                </div>
                <div className="mt-0.5 font-mono opacity-80">{state.message}</div>
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="mt-1.5 font-semibold text-ocean-blue hover:underline"
                >
                  Try again →
                </button>
              </div>
            </div>
          )}

          {state.kind === "ready" && live.length === 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              No real-time leads in the last {WINDOW_DAYS} days.
              {parked.length > 0 && (
                <>
                  {" "}
                  {parked.length} {parked.length === 1 ? "was" : "were"} closed out — shown below.
                </>
              )}{" "}
              Nothing to chase here; work your book underneath.
            </p>
          )}

          {state.kind === "ready" && live.length > 0 && (
            <>
              <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-300">
                These are the leads we <b>pay the most for</b> and they go cold fastest. Call them{" "}
                <b>immediately and repeatedly</b> — the attempt count on each row is how many dials
                it has actually had.
              </p>
              <div className="mt-3 space-y-1.5">
                {visible.map(({ r, h }) => (
                  <HotLeadRow key={r.id} r={r} h={h} now={now} onOpen={onOpen} />
                ))}
              </div>
              {live.length > PREVIEW_ROWS && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 text-[11px] font-semibold text-ocean-blue hover:underline"
                >
                  {showAll
                    ? "Show fewer"
                    : `Show all ${live.length} real-time leads (${live.length - PREVIEW_ROWS} more) →`}
                </button>
              )}
              {live.length >= ROW_CAP && (
                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                  ⚠ Showing the first {ROW_CAP} — there may be more in the window.
                </div>
              )}
            </>
          )}

          {state.kind === "ready" && parked.length > 0 && (
            <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-2">
              <button
                type="button"
                onClick={() => setShowParked((v) => !v)}
                className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
              >
                {showParked ? "Hide" : "Show"} {parked.length} already closed out (nurture, declined,
                funded…) {showParked ? "↑" : "↓"}
              </button>
              {showParked && (
                <div className="mt-2 space-y-1.5">
                  {parked.map(({ r, h }) => (
                    <HotLeadRow key={r.id} r={r} h={h} now={now} onOpen={onOpen} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One lead. The whole row opens the merchant in the console above — the same
 *  onOpen({ dealId }) every other list on this page uses. */
function HotLeadRow({
  r,
  h,
  now,
  onOpen,
}: {
  r: HotRow;
  h: Heat;
  now: number;
  onOpen: (lookup: { dealId: string }) => void;
}) {
  const ui = TIER_UI[h.tier];
  const src = sourceMeta(r.lead_source);
  const handoff = handoffState(r, now);
  const stated = bestTimeToCall(r);
  // The real-time 5-minute clock. Only meaningful while the lead is untouched —
  // once someone has reached out, speed-to-lead is already banked in the attempt.
  const dueMs =
    r.first_call_due_at && !r.first_attempt_at ? Date.parse(r.first_call_due_at) - now : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen({ dealId: r.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen({ dealId: r.id });
      }}
      title={`Open ${merchantName(r)} in the console`}
      className={`rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${ui.edge} ${ui.row} px-3 py-2 cursor-pointer hover:border-ocean-blue hover:shadow-sm transition`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {ui.flames && <span className="text-sm leading-none shrink-0">{ui.flames}</span>}
          <span className={`text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${ui.badge}`}>
            {ui.label}
          </span>
          <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
            {merchantName(r)}
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${SOURCE_TONE_CLASS[src.tone]}`}>
            {src.label}
          </span>
          {r.customer?.do_not_contact && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white shrink-0"
              title="This merchant asked not to be contacted — do not call, text, or email."
            >
              🚫 DO NOT CONTACT
            </span>
          )}
          {h.tier === "parked" && r.status && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
              DEAL_STATUS_CONFIG[r.status as DealStatus]?.bgColor ?? "bg-gray-100 dark:bg-gray-700"
            } ${DEAL_STATUS_CONFIG[r.status as DealStatus]?.color ?? "text-gray-600 dark:text-gray-300"}`}>
              {DEAL_STATUS_CONFIG[r.status as DealStatus]?.label ?? r.status}
            </span>
          )}
        </div>
        {/* ARRIVED — the clock that matters most on an expensive perishable lead. */}
        <span
          className={`text-[11px] font-bold shrink-0 tabular-nums ${
            h.tier === "blazing" || h.tier === "burning"
              ? "text-red-600 dark:text-red-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
          title={`Lead created ${new Date(r.created_at).toLocaleString()}`}
        >
          arrived {ago(r.created_at, now)}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-gray-700 dark:text-gray-200">{heatWhy(r, h, now)}</p>

      {/* ATTEMPTS + LAST TOUCH — the two numbers the owner asked to be visible. */}
      <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]">
        <span
          className={`font-bold ${
            h.attempts === 0
              ? "text-red-600 dark:text-red-400"
              : "text-gray-700 dark:text-gray-200"
          }`}
          title="Dial attempts logged on this deal, including auto-audited GHL calls"
        >
          📞 {h.attempts === 0 ? "NEVER DIALED" : `${h.attempts} attempt${h.attempts === 1 ? "" : "s"}`}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {r.last_attempt_at ? `last tried ${ago(r.last_attempt_at, now)}` : "no touch yet"}
        </span>
        {r.spoke_at && (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            🗣 spoke {ago(r.spoke_at, now)}
          </span>
        )}
      </div>

      {/* The time-critical extras, only when they mean something. */}
      <div className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-[10px]">
        {dueMs !== null && (
          <span className="font-bold px-1.5 py-0.5 rounded-full bg-red-600 text-white tabular-nums">
            {dueMs > 0 ? `⏱ EMAIL NOW · ${countdown(dueMs)} left` : "⏱ 5-MIN WINDOW MISSED — send it anyway"}
          </span>
        )}
        {handoff === "missed" && (
          <span
            className="font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200"
            title="A live transfer with no sign anyone took the call — the merchant was on the line and nobody got them."
          >
            ⚡ Handoff looks missed
          </span>
        )}
        {handoff === "captured" && (
          <span className="font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            ⚡ Handoff taken
          </span>
        )}
        {stated && (
          <span
            className="font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="The merchant's own answer to “best time to reach you” — call at their time, don't just satisfy a stopwatch."
          >
            🕐 They said "{stated}"
          </span>
        )}
        {r.amount_requested != null && r.amount_requested > 0 && (
          <span className="font-semibold text-gray-600 dark:text-gray-300">
            asking ${Math.round(r.amount_requested).toLocaleString()}
          </span>
        )}
        {!r.assigned_closer_id && (
          <span
            className="font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="Nobody owns this lead — it shows on everyone's board and gets worked by no one."
          >
            🧑‍💼 Unassigned
          </span>
        )}
      </div>

      {/* Dial it without leaving the page. VibeReach first — its call button records
          and auto-logs, which is what keeps the attempt count above honest. */}
      {r.customer?.phone && (
        <div className="mt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {r.ghl_contact_id ? (
            <a
              href={`https://app.vibereach.io/v2/location/t7NmVR4WCy927j4Zon4b/contacts/detail/${r.ghl_contact_id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-ocean-blue hover:underline"
              title="Open in VibeReach — its call button dials, records, and auto-logs the attempt"
            >
              <PhoneIcon className="w-3 h-3" />
              {prettyPhone(r.customer.phone)}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
              <PhoneIcon className="w-3 h-3" />
              {prettyPhone(r.customer.phone)}
            </span>
          )}
          <button
            type="button"
            onClick={() => onOpen({ dealId: r.id })}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ocean-blue text-white hover:bg-deep-sea transition-colors"
          >
            Open in console
          </button>
        </div>
      )}
    </div>
  );
}
