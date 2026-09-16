import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  FireIcon,
  PhoneIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { QUEUE_CLOSED_STATUSES, getDealById } from "@/services/dealService";
import { DEAL_STATUS_CONFIG, type DealStatus, type DealWithCustomer } from "@/types/deals";
import { REALTIME_LEAD_SOURCES, sourceMeta, SOURCE_TONE_CLASS } from "@/lib/sourceLabel";
import { handoffState, leadHeat, HEAT_RANK, type Heat, type HeatTier } from "@/lib/realtimeLeads";
import { dateTimeET } from "@/utils/time";
import { useUserProfile } from "@/context/UserProfileContext";
import SetterActionRail from "@/components/admin/setter/SetterActionRail";
import SetterCommsPanel from "@/components/admin/setter/SetterCommsPanel";
import SetterCallOutcome from "@/components/admin/setter/SetterCallOutcome";
import SetterNotes from "@/components/admin/setter/SetterNotes";
import BookAppointmentControl from "@/components/admin/BookAppointmentControl";

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
 * ACCESS — the lead list is a plain `deals` select with NO closer filter, so RLS
 * decides who sees what, exactly as it already does elsewhere on this page: an admin
 * or a processor sees the whole board, a plain closer sees their own book plus
 * unassigned (the money wall, 20260827_setter_deal_money_wall.sql). The call history
 * comes from realtime_lead_call_history(), which re-derives that same visibility
 * itself rather than trusting the ids it is handed. No new data access, no bypass.
 *
 * WHERE THE CALL COUNT COMES FROM (20260916a) — NOT deals.contact_attempts.
 * That column is fed by the GHL telemetry path and the processor's log buttons and
 * misses every WAVV dial, and WAVV is the primary dialer. On 2026-09-16 this panel
 * told the team that The Goldberg Group (MF-2026-0337) had NEVER BEEN DIALED when
 * Kristine Gidoc had called them the previous afternoon; it undercounted Lmt of San
 * Diego 1-against-3 and showed Garden View a last-attempt stamp six hours stale. A
 * false accusation is worse than no alarm, because it teaches the team that the
 * flames are noise — and then the genuinely untouched live transfer gets ignored
 * with the rest. The RPC unions WAVV, GHL/LeadConnector, activity_log call rows and
 * manual touches, dedupes across sources, and returns the individual calls.
 *
 * HONESTY (readers-must-distinguish-unreadable): a failed lead read renders a RED
 * "the read failed" box and NEVER "0 hot leads". A failed CALL-HISTORY read renders
 * an amber "call history unreadable" chip on the row and NEVER "NEVER DIALED" —
 * "nobody called this merchant" is an accusation about a named person and may only
 * be made from a count we can prove. A genuine zero renders one calm line — no
 * alarming empty box, which would teach the team to ignore the flames.
 */

// The window the owner asked for. Anything older stops being a speed-to-lead
// problem and is just pipeline, which the rest of the console already handles.
const WINDOW_DAYS = 7;
const WINDOW_MS = WINDOW_DAYS * 24 * 3_600_000;
const ROW_CAP = 200;
/** How many live rows show before the "show all" expander. */
const PREVIEW_ROWS = 8;

const DEAL_COLS =
  "id,deal_number,status,lead_source,created_at,created_by,first_call_due_at,first_attempt_at,last_attempt_at,contact_attempts,contacted_at,spoke_at,callback_at,callback_source,amount_requested,assigned_closer_id,ghl_contact_id,lead_qual,customer:customers!customer_id(business_name,first_name,last_name,phone,additional_phones,do_not_contact)";

interface HotCustomer {
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  /** Second/third numbers — the ones that matter when the main line goes nowhere. */
  additional_phones: string[] | null;
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

// ── TRUE call history, from realtime_lead_call_history(uuid[]) ────────────────
/** One real dial, from whichever source recorded it. */
interface CallEvent {
  at: string;
  /** wavv | ghl | activity | manual — which system recorded the dial. */
  source: string;
  disposition: string | null;
  seconds: number | null;
  /** The person who dialed, where the source could name them. */
  who: string | null;
}

interface CallHistory {
  /** The TRUE total, LIFETIME. Always the full count, even when `calls` is
   *  capped. This is what the row displays and the only count NEVER DIALED may
   *  be judged on — if we have ever called them, they are not un-dialed. */
  attempts: number;
  /** Dials at or after this lead arrived (deals.created_at). Everything that
   *  asks "is this being worked NOW" — pace, blazing, the 5-minute badge —
   *  reads this instead, so a prior campaign's dials cannot make a fresh
   *  transfer look attended to. */
  attempts_since_arrival: number;
  last_at: string | null;
  last_disposition: string | null;
  last_by: string | null;
  last_source: string | null;
  calls: CallEvent[];
}

/** Keyed by deal id. A deal ABSENT from the map is unreadable, not zero. */
type HistoryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; byDeal: Record<string, CallHistory> };

/** How many days of the chase the row's tracker shows. Matches TouchTracker in
 *  ProcessorDetailDrawer — same window, same "day 1 = arrival" rule. */
const TRACKER_DAYS = 14;
const DAY_MS = 24 * 3_600_000;

/** Human label for where a dial was recorded, so "who called" is never a mystery. */
const SOURCE_WORD: Record<string, string> = {
  wavv: "WAVV",
  ghl: "VibeReach",
  activity: "logged",
  manual: "logged by hand",
};

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

/**
 * A field the LEAD VENDOR supplied in the intake email, parked on deals.lead_qual
 * by the live-transfer/real-time intake function. Free text — displayed verbatim,
 * never parsed into a decision (same rule as My Day).
 *
 * Every one of these is the vendor's claim, not ours and not the merchant's file,
 * so everything rendered from here is labelled "Vendor says". The owner asked
 * where "10am PST" came from; the answer is this object, and now the row says so.
 */
function vendorField(r: HotRow, key: string): string | undefined {
  const raw = r.lead_qual && typeof r.lead_qual === "object" ? r.lead_qual[key] : null;
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!s || /^(n\/?a|none|any|anytime|no|unknown|-)$/i.test(s)) return undefined;
  return s;
}

/**
 * The vendor's qualification answers worth showing, in the order a setter reads
 * them on a call. Deliberately an ALLOW-LIST: lead_qual also carries the raw
 * email plumbing (_email_from, _email_subject, _email_to) and the vendor's own
 * agent label, none of which help anyone dial. Measured 2026-09-16: all 25 keys
 * are present on every one of the 20 live real-time leads, so this is a choice
 * about noise, not availability.
 */
const VENDOR_DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: "contact_name", label: "Ask for" },
  { key: "best_time", label: "Best time" },
  { key: "phone", label: "Phone (vendor)" },
  { key: "email", label: "Email (vendor)" },
  { key: "state", label: "State" },
  { key: "industry", label: "Industry" },
  { key: "monthly_deposits", label: "Monthly deposits" },
  { key: "requested_amount", label: "Wants" },
  { key: "use_of_funds", label: "Use of funds" },
  { key: "fico", label: "FICO (stated)" },
  { key: "time_as_owner", label: "Time as owner" },
  { key: "is_owner", label: "Is the owner" },
  { key: "need_money_now", label: "Needs it now" },
  { key: "open_positions", label: "Open positions" },
  { key: "positions_balance", label: "Positions balance" },
  { key: "processes_cc", label: "Processes cards" },
  { key: "has_equity", label: "Has equity" },
  { key: "property_paid_down", label: "Property paid down" },
  { key: "difficulty_approved", label: "Had trouble getting approved" },
];

const hasVendorDetail = (r: HotRow) => VENDOR_DETAIL_FIELDS.some((f) => vendorField(r, f.key));

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
  // With the true call history unreadable, every sentence below that quotes an
  // attempt count would be quoting a number we know is short (contact_attempts
  // misses WAVV). Say that instead of guessing out loud.
  if (!h.attemptsKnown) {
    return `Arrived ${ago(r.created_at, now)}. The real call history couldn't be read, so the dial count below is a floor, not a fact — check VibeReach before assuming nobody has called.`;
  }
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
  const [history, setHistory] = useState<HistoryState>({ kind: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [showParked, setShowParked] = useState(false);
  // Accordion: the id of the ONE row whose action drawer is open. One at a time,
  // because each drawer loads a full deal and mounts the console's whole action
  // set — a panel with eight of those open stops being a triage list.
  const [openActions, setOpenActions] = useState<string | null>(null);
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
      setHistory({ kind: "error", message: "the lead list itself could not be read" });
      return;
    }
    const rows = (data ?? []) as unknown as HotRow[];
    setState({ kind: "ready", rows });
    setNow(Date.now());

    // ── The TRUE dial counts, in one round trip for the whole panel. ──
    // Second read on purpose: the lead list is RLS-filtered `deals`, while the
    // call history has to union four tables (one of them phone-keyed, so it needs
    // SECURITY DEFINER) and cannot be expressed as a PostgREST join.
    if (rows.length === 0) {
      setHistory({ kind: "ready", byDeal: {} });
      return;
    }
    const hist = await supabase.rpc("realtime_lead_call_history", {
      p_deal_ids: rows.map((x) => x.id),
    });
    if (hist.error) {
      setHistory({ kind: "error", message: hist.error.message });
      return;
    }
    setHistory({
      kind: "ready",
      byDeal: (hist.data ?? {}) as Record<string, CallHistory>,
    });
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
    const byDeal = history.kind === "ready" ? history.byDeal : null;
    const scored = rows.map((r) => {
      // null = unreadable (the RPC failed, or this deal is outside what the
      // caller may see). leadHeat treats that as "unknown", never as zero, so a
      // row can never scream UNTOUCHED on the strength of a missing read.
      const hist = byDeal ? (byDeal[r.id] ?? null) : null;
      return {
        r,
        hist,
        h: leadHeat(
          {
            ...r,
            true_attempts: hist ? hist.attempts : null,
            // Pace is measured over the lead's age, so it must be judged on the
            // dials made since it arrived — not on the merchant's lifetime count.
            attempts_since_arrival: hist ? hist.attempts_since_arrival : null,
          },
          now,
          isParked,
        ),
      };
    });
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
  }, [state, history, now]);

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
                <b>immediately and repeatedly</b> — the attempt count on each row is every real dial
                from every source (WAVV, VibeReach, and anything logged by hand).
              </p>
              {history.kind === "error" && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                  <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">Couldn't read the call history.</div>
                    <div className="mt-0.5">
                      The dial counts below fall back to the deal's own counter, which{" "}
                      <b>misses every WAVV call</b> — treat them as a floor, not a fact, and don't
                      conclude anyone failed to call.
                    </div>
                    <div className="mt-0.5 font-mono opacity-80">{history.message}</div>
                  </div>
                </div>
              )}
              <div className="mt-3 space-y-1.5">
                {visible.map(({ r, h, hist }) => (
                  <HotLeadRow
                    key={r.id}
                    r={r}
                    h={h}
                    hist={hist}
                    now={now}
                    onOpen={onOpen}
                    actionsOpen={openActions === r.id}
                    onToggleActions={() =>
                      setOpenActions((v) => (v === r.id ? null : r.id))
                    }
                    onDealChanged={() => void load(false)}
                  />
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
                  {parked.map(({ r, h, hist }) => (
                    <HotLeadRow
                      key={r.id}
                      r={r}
                      h={h}
                      hist={hist}
                      now={now}
                      onOpen={onOpen}
                      actionsOpen={openActions === r.id}
                      onToggleActions={() =>
                        setOpenActions((v) => (v === r.id ? null : r.id))
                      }
                      onDealChanged={() => void load(false)}
                    />
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

/**
 * A 14-day chase tracker sized to live inside a hot-lead row.
 *
 * Same idea and the same arithmetic as TouchTracker in ProcessorDetailDrawer —
 * one cell per day since the lead arrived, green with a count where it was
 * called, light red for an elapsed day with none, grey for days not yet reached —
 * shrunk from that drawer's 24px cells to 12px so fourteen of them fit on a row
 * the setter is scanning, not studying. The day label moves into the tooltip,
 * which also carries the real dates and dispositions.
 *
 * The day -1 fold is deliberate and matches the drawer: a WAVV call that ends in
 * "Appointment Set" MINTS the deal, so the call that created the lead is stamped
 * minutes before the deal row exists. Without the fold, day 1 shows red over the
 * very call that produced the merchant.
 */
function MiniTracker({ createdAt, calls }: { createdAt: string; calls: CallEvent[] }) {
  const created = Date.parse(createdAt);
  const now = Date.now();
  const elapsed = Math.floor((now - created) / DAY_MS);
  const counts = new Array(TRACKER_DAYS).fill(0) as number[];
  for (const c of calls) {
    let idx = Math.floor((Date.parse(c.at) - created) / DAY_MS);
    if (idx === -1) idx = 0;
    if (idx >= 0 && idx < TRACKER_DAYS) counts[idx] += 1;
  }
  const missed = counts.filter((c, i) => i <= Math.min(elapsed, TRACKER_DAYS - 1) && c === 0).length;

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className="flex gap-[2px]">
        {counts.map((c, i) => {
          const future = i > elapsed;
          const today = i === elapsed && elapsed < TRACKER_DAYS;
          const cls = future
            ? "bg-gray-100 dark:bg-gray-800"
            : c > 0
              ? "bg-emerald-500 text-white"
              : "bg-red-100 text-red-400 dark:bg-red-900/30 dark:text-red-400";
          return (
            <div
              key={i}
              title={`Day ${i + 1}${today ? " (today)" : ""} — ${
                future ? "not reached yet" : c > 0 ? `${c} call${c === 1 ? "" : "s"}` : "no calls"
              }`}
              className={`w-3 h-3.5 rounded-[2px] flex items-center justify-center text-[8px] font-bold leading-none ${cls} ${
                today ? "ring-1 ring-ocean-blue" : ""
              }`}
            >
              {future ? "" : c > 0 ? c : ""}
            </div>
          );
        })}
      </div>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
        {TRACKER_DAYS}-day chase
        {missed > 0 && elapsed < TRACKER_DAYS
          ? ` · ${missed} silent day${missed === 1 ? "" : "s"}`
          : ""}
      </span>
    </div>
  );
}

/**
 * HotLeadActions — everything a setter or processor needs to work a hot lead,
 * inline on the row, so nobody bounces between screens on the most perishable
 * leads we buy.
 *
 * NOTHING HERE IS NEW. Every control is the SAME component the Operations console
 * mounts (SetterOpsTab), bound to the same deal and firing the same RPCs and edge
 * functions:
 *   · SetterActionRail   → Quick App, full application (both with the
 *                          ensureDealStageAtLeast wiring), Send docs
 *                          (AdHocSendMenu), and Do Not Contact (SetterDndButton).
 *   · SetterCommsPanel   → Text (TextMerchantPanel, the JMP/sms-send path — NOT
 *                          GHL) and Email (EmailMerchantPanel).
 *   · SetterCallOutcome  → log the disposition (connected / no answer / voicemail
 *                          / callback / not interested → nurture) through
 *                          logContactAttempt + updateDealStatus, with the ET
 *                          callback picker and an optional note.
 *   · BookAppointmentControl → book a real appointment (emails the invite).
 *   · SetterNotes        → free-text notes on the deal.
 * A duplicate send path here would be a second thing to keep correct, and the
 * first one to drift.
 *
 * LAZY, AND ONE AT A TIME. The panel renders up to 200 rows; loading a full
 * DealWithCustomer for each would be 200 reads to render a list nobody has asked
 * to act on yet. The deal loads on expand, and the panel keeps a single row open
 * (accordion), so the dense scan-list stays a scan-list.
 *
 * getDealById is the same loader the console uses, including its get_deal_lite
 * fallback — so a processor opening a lead assigned to another setter still gets
 * the row (money-masked) instead of an empty drawer.
 */
function HotLeadActions({
  dealId,
  onDealChanged,
}: {
  dealId: string;
  /** Re-read the panel so counts, heat and the tracker reflect what just happened. */
  onDealChanged: () => void;
}) {
  const { effectiveUserId } = useUserProfile();
  const [deal, setDeal] = useState<DealWithCustomer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // BookAppointmentControl requires an onNotify; a local line keeps this drawer
  // self-contained, exactly as SetterChecklist does for the same control.
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const loadDeal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await getDealById(dealId);
      // UNREADABLE ≠ "no such deal": say the read failed and offer a retry rather
      // than rendering an empty action set that looks like there's nothing to do.
      if (!res) {
        setError("Couldn't load this merchant's record — the actions can't be shown.");
        return;
      }
      setDeal(res.deal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this merchant's record.");
    } finally {
      setBusy(false);
    }
  }, [dealId]);

  useEffect(() => {
    void loadDeal();
  }, [loadDeal]);

  // Any action inside re-reads the deal AND tells the panel, so the attempt count
  // and heat on the row behind the drawer move the moment a call is logged.
  const refresh = useCallback(() => {
    void loadDeal();
    onDealChanged();
  }, [loadDeal, onDealChanged]);

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 4000);
  }, []);

  return (
    // Stops the row's own onClick from firing — a tap on a button in here must not
    // also yank the merchant into the console above.
    <div
      className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 p-3 space-y-3 cursor-default"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      {busy && !deal && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="loading loading-spinner loading-xs" /> Loading the merchant's record…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">{error}</div>
            <button
              type="button"
              onClick={() => void loadDeal()}
              className="mt-1 font-semibold text-ocean-blue hover:underline"
            >
              Try again →
            </button>
          </div>
        </div>
      )}

      {deal && (
        <>
          {/* APPLY + SEND + take them off the list. autoOpen is deliberately OFF:
              in the console the application modal pops on load because a merchant
              is on the line, but a list row popping a full-screen modal on expand
              would fight the setter scanning the panel. */}
          <SetterActionRail deal={deal} onRefresh={refresh} />

          {/* TEXT + EMAIL — the 5-minute speed-to-lead touch. */}
          <SetterCommsPanel deal={deal} onRefresh={refresh} />

          {/* BOOK IT. Sits next to the vendor's stated best time on the row above,
              which is the whole reason it belongs here: a setter reads "10am PST"
              and books against it without changing screens. */}
          <div className="flex flex-wrap items-center gap-3">
            <BookAppointmentControl
              dealId={deal.id}
              appointmentAt={deal.appointment_at}
              appointmentSyncedAt={deal.appointment_synced_at}
              appointmentSyncError={deal.appointment_sync_error}
              ownerUserId={effectiveUserId}
              onRefresh={refresh}
              onNotify={notify}
            />
          </div>

          {/* LOG THE CALL (also the callback + not-interested/nurture park) beside
              the notes, the same pairing the console uses at the bottom. */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SetterCallOutcome deal={deal} onRefresh={refresh} />
            <SetterNotes deal={deal} onRefresh={refresh} />
          </div>
        </>
      )}

      {toast && (
        <p
          className={`text-xs font-medium ${
            toast.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {toast.text}
        </p>
      )}
    </div>
  );
}

/** One lead. The whole row opens the merchant in the console above — the same
 *  onOpen({ dealId }) every other list on this page uses. */
function HotLeadRow({
  r,
  h,
  hist,
  now,
  onOpen,
  actionsOpen,
  onToggleActions,
  onDealChanged,
}: {
  r: HotRow;
  h: Heat;
  /** TRUE call history for this deal. `null` = unreadable, NEVER "zero calls". */
  hist: CallHistory | null;
  now: number;
  onOpen: (lookup: { dealId: string }) => void;
  /** Accordion — the panel keeps at most one action drawer open. */
  actionsOpen: boolean;
  onToggleActions: () => void;
  onDealChanged: () => void;
}) {
  // The vendor's own qualification answers, folded away by default so the rows
  // stay scannable. Everything in here is the VENDOR's claim, never our file.
  const [showVendor, setShowVendor] = useState(false);
  const ui = TIER_UI[h.tier];
  const src = sourceMeta(r.lead_source);
  const handoff = handoffState(r, now);
  // Vendor-supplied facts. Labelled as the vendor's claim wherever they render,
  // because that is exactly what the owner asked: where did "10am PST" come from?
  const bestTime = vendorField(r, "best_time");
  const vendorContact = vendorField(r, "contact_name");
  const vendorFico = vendorField(r, "fico");
  const vendorDeposits = vendorField(r, "monthly_deposits");
  // The real-time 5-minute clock. Only meaningful while the lead is UNTOUCHED —
  // once someone has reached out, speed-to-lead is banked and the badge is just
  // noise on a lead that is being worked (owner, 2026-09-16: "once we've called,
  // I don't think we need that badge there").
  //
  // Gated on the TRUE call count, never on deals.first_attempt_at: that column is
  // written by our own app paths and by the GHL telemetry mirror, and NOT by WAVV
  // — the same blind spot that had this panel calling twelve dialed leads "NEVER
  // DIALED". The Goldberg Group had a real WAVV dial and a null first_attempt_at,
  // so it kept flashing "5-MIN WINDOW MISSED" at a setter who had already called.
  //
  // Unreadable history suppresses the badge too. "You missed the window" is an
  // accusation, and this panel does not make accusations off a count it cannot
  // prove — the same rule that governs the NEVER DIALED chip.
  //
  // Judged on dials SINCE THIS LEAD ARRIVED, not the merchant's lifetime count.
  // The badge is a speed-to-lead statement about THIS arrival: having dialed the
  // same merchant on a purchased list last month says nothing about whether this
  // transfer was answered inside its five minutes, and letting that suppress the
  // badge would hide a genuinely missed window.
  const dueMs =
    r.first_call_due_at && hist && hist.attempts_since_arrival === 0
      ? Date.parse(r.first_call_due_at) - now
      : null;
  // The last REAL dial, from the RPC — not deals.last_attempt_at, which is stale
  // whenever the newest call came through WAVV (Garden View was six hours behind).
  const lastAt = hist?.last_at ?? null;

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

      {/* HOW MANY TIMES, AND EXACTLY WHEN. Both owner complaints answered on one
          line: a count from the real union of every dialer, and the ABSOLUTE date
          and time in ET (the business runs on ET) with the relative age kept
          alongside it, because "1d ago" alone never told anyone when to call back. */}
      <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]">
        {!h.attemptsKnown ? (
          <span
            className="font-bold text-amber-700 dark:text-amber-300"
            title="The call-history read failed, so this row cannot say how many times this merchant was dialed. It is NOT a claim that nobody called."
          >
            📞 CALL HISTORY UNREADABLE
          </span>
        ) : (
          <span
            className={`font-bold ${
              h.attempts === 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-700 dark:text-gray-200"
            }`}
            title="Every real dial on this merchant — WAVV, VibeReach/LeadConnector, and anything logged by hand — deduped so one call is never counted twice."
          >
            📞{" "}
            {h.attempts === 0
              ? "NEVER DIALED"
              : `${h.attempts} call${h.attempts === 1 ? "" : "s"}`}
          </span>
        )}

        {lastAt ? (
          <span className="text-gray-600 dark:text-gray-300">
            last called <b className="font-semibold">{dateTimeET(lastAt)}</b>{" "}
            <span className="text-gray-400 dark:text-gray-500">({ago(lastAt, now)})</span>
            {hist?.last_disposition ? ` — ${hist.last_disposition}` : ""}
            {hist?.last_by ? ` · ${hist.last_by}` : ""}
            {hist?.last_source && SOURCE_WORD[hist.last_source]
              ? ` · ${SOURCE_WORD[hist.last_source]}`
              : ""}
          </span>
        ) : h.attemptsKnown ? (
          <span className="text-gray-500 dark:text-gray-400">no call on record yet</span>
        ) : // The floor from deals.contact_attempts. Shown only to say "at least
        // this much happened" — never as the count.
        (r.contact_attempts ?? 0) > 0 && r.last_attempt_at ? (
          <span className="text-gray-500 dark:text-gray-400">
            deal counter says at least {r.contact_attempts}, last {dateTimeET(r.last_attempt_at)}
          </span>
        ) : null}

        {r.spoke_at && (
          <span
            className="font-semibold text-emerald-600 dark:text-emerald-400"
            title={`Confirmed conversation ${dateTimeET(r.spoke_at)}`}
          >
            🗣 spoke {dateTimeET(r.spoke_at)}
          </span>
        )}
      </div>

      {/* The 14-day chase at a glance. Only where we can read the real calls — a
          tracker drawn from an unreadable history would paint fourteen red days
          over a merchant somebody called every morning. */}
      {hist && <MiniTracker createdAt={r.created_at} calls={hist.calls} />}

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
        {/* PROVENANCE, spelled out. The owner asked "they said 10am PST — was that
            given to us in the real-time lead?" It was: the vendor collected it on
            the qualification call and put it in the intake email, and the intake
            function parked it on deals.lead_qual. Saying "Vendor says" on the chip
            means nobody has to wonder again whose claim this is. */}
        {bestTime && (
          <span
            className="font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="Supplied by the lead vendor in the intake email, from their qualification call with the merchant. Call at their time — don't just satisfy a stopwatch."
          >
            🕐 Vendor says best time: {bestTime}
          </span>
        )}
        {vendorContact && (
          <span
            className="font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            title="The person the vendor spoke to — ask for them by name."
          >
            👤 Ask for {vendorContact}
          </span>
        )}
        {vendorDeposits && (
          <span
            className="font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            title="Monthly deposits as stated to the lead vendor — unverified until the bank statements land."
          >
            🏦 Vendor says {vendorDeposits}/mo
          </span>
        )}
        {vendorFico && (
          <span
            className="font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            title="FICO as stated to the lead vendor — self-reported, not a pull."
          >
            📊 Vendor says FICO {vendorFico}
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

      {/* ── THE ACTION BAR ────────────────────────────────────────────────────
          A compact primary set inline — dial, VibeReach, work it, open it — with
          everything else behind "Work this lead". The owner's rule for this panel
          is that the heat and the attempt count are the reason it exists, so the
          buttons sit UNDER them and stay one line. */}
      <div
        className="mt-1.5 flex items-center gap-1.5 flex-wrap"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        {/* CLICK TO DIAL. Hands the number to whatever the machine uses for tel:
            (softphone/WAVV), for the setter who is not already sitting in
            VibeReach. The dial is not itself a logged attempt — that is what
            "Work this lead → Log the call" is for, and the count above only ever
            moves on a real recorded call. */}
        {r.customer?.phone && (
          <a
            href={`tel:${r.customer.phone.replace(/[^0-9+]/g, "")}`}
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            title={`Dial ${prettyPhone(r.customer.phone)} — then log the outcome under "Work this lead"`}
          >
            <PhoneIcon className="w-3 h-3" />
            {prettyPhone(r.customer.phone)}
          </a>
        )}

        {/* The second number matters most on a hot lead nobody can reach. */}
        {(r.customer?.additional_phones ?? []).map((p) => (
          <a
            key={p}
            href={`tel:${p.replace(/[^0-9+]/g, "")}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-emerald-500/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
            title={`Second number on file — dial ${prettyPhone(p)}`}
          >
            <PhoneIcon className="w-3 h-3" />
            {prettyPhone(p)}
          </a>
        ))}

        {/* WORK IT — the whole action set, lazily loaded (see HotLeadActions). */}
        <button
          type="button"
          onClick={onToggleActions}
          aria-expanded={actionsOpen}
          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full transition-colors ${
            actionsOpen
              ? "bg-ocean-blue text-white"
              : "bg-ocean-blue/10 text-ocean-blue hover:bg-ocean-blue/20 dark:bg-ocean-blue/20"
          }`}
          title="Application, text, email, send docs, log the call, set a callback or appointment, nurture, DND — without leaving this panel"
        >
          <WrenchScrewdriverIcon className="w-3 h-3" />
          {actionsOpen ? "Hide actions" : "Work this lead"}
          {actionsOpen ? (
            <ChevronDownIcon className="w-3 h-3" />
          ) : (
            <ChevronRightIcon className="w-3 h-3" />
          )}
        </button>

        {r.ghl_contact_id && (
          <a
            href={`https://app.vibereach.io/v2/location/t7NmVR4WCy927j4Zon4b/contacts/detail/${r.ghl_contact_id}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue transition-colors"
            title="Open in VibeReach — its call button dials, records, and auto-logs the attempt"
          >
            VibeReach ↗
          </a>
        )}

        <button
          type="button"
          onClick={() => onOpen({ dealId: r.id })}
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue transition-colors"
          title="Load this merchant into the full console below"
        >
          Open in console
        </button>

        {hasVendorDetail(r) && (
          <button
            type="button"
            onClick={() => setShowVendor((v) => !v)}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-gray-500 dark:text-gray-400 hover:text-ocean-blue transition-colors"
            title="Everything the lead vendor collected on their qualification call"
          >
            {showVendor ? "Hide vendor detail" : "Vendor detail"} {showVendor ? "↑" : "↓"}
          </button>
        )}
      </div>

      {/* The rest of the vendor's qualification answers. Folded by default — these
          rows are scanned, not studied — and labelled as the vendor's claim, not
          our verified file. */}
      {showVendor && (
        <div
          className="mt-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 px-2.5 py-2"
          onClick={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">
            What the vendor collected
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {VENDOR_DETAIL_FIELDS.map(({ key, label }) => {
              const v = vendorField(r, key);
              if (!v) return null;
              return (
                <div key={key} className="min-w-0">
                  <dt className="text-[10px] text-gray-400">{label}</dt>
                  <dd className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 truncate" title={v}>
                    {v}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {actionsOpen && <HotLeadActions dealId={r.id} onDealChanged={onDealChanged} />}
    </div>
  );
}
