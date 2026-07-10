import { useCallback, useEffect, useMemo, useState } from "react";
import { BoltIcon, ArrowPathIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { getOpenDealsForQueue, type QueueDeal } from "../../services/dealService";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Urgency {
  rank: number;
  badge: string;
  why: string;
  /** ISO timestamp that drives the card's age + the intra-rank sort. */
  since: string;
  tone: string;
  /** When set, the card corner shows a LIVE speed-to-lead countdown to this ISO
   * timestamp ("⏱ 4:32 left"), flipping to "SLA MISSED — call anyway" past it. */
  countdownDue?: string;
}

// mm:ss countdown from a millisecond delta.
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const WARM = new Set(["warm", "warmer"]);
const HOT = new Set(["hot", "hottest"]);

// Ranking rules — the order here IS the priority (0 = most urgent). A deal that
// matches none of these never enters the queue.
function classify(deal: QueueDeal, now: number): Urgency | null {
  const subs = deal.submissions ?? [];
  const responded = subs.filter((s) => s.response_at);
  const anyResponded = responded.length > 0;

  // 0 — a HOT lead (real-time / live transfer) with a live speed-to-lead clock.
  // The most time-critical thing on the board: the merchant expects a call NOW.
  if (deal.status === "new" && deal.first_call_due_at && HOT.has(deal.temperature ?? "")) {
    const dueMs = Date.parse(deal.first_call_due_at) - now;
    // Live transfers get their own loud label + a corner countdown (below); the
    // clock isn't jammed into the badge so both read cleanly at a glance.
    const isLiveTransfer = deal.lead_source === "live_transfer";
    return {
      rank: 0,
      badge: isLiveTransfer
        ? "🔴 LIVE TRANSFER — CALL NOW"
        : (dueMs > 0 ? `🔴 CALL NOW · ${countdown(dueMs)}` : "🔴 CALL NOW · OVERDUE"),
      why: dueMs > 0 ? "Real-time lead — call before the clock runs out." : "Real-time lead PAST its call window — call immediately.",
      since: deal.created_at,
      tone: "red",
      // Only live transfers surface the corner countdown; other real-time leads
      // keep their existing badge-embedded clock so nothing changes for them.
      countdownDue: isLiveTransfer ? deal.first_call_due_at : undefined,
    };
  }

  // 1 — a funder replied, but the deal is still parked in Submitted.
  if (deal.status === "submitted_to_funder" && anyResponded) {
    const since = responded.map((s) => s.response_at as string).sort()[0];
    return { rank: 1, badge: "💬 Funder replied", why: "A funder responded — pull the offer in.", since, tone: "emerald" };
  }
  // 2 — the merchant wrote back within the last 3 days: read + act.
  if (deal.merchant_reply_at && now - Date.parse(deal.merchant_reply_at) < 3 * DAY) {
    return { rank: 2, badge: "💬 Merchant replied", why: deal.merchant_reply_summary || "The merchant wrote back — read + act.", since: deal.merchant_reply_at, tone: "emerald" };
  }
  // 3 — offer received, sitting >24h without being presented.
  if (deal.status === "offer_received" && deal.offer_received_at && now - Date.parse(deal.offer_received_at) > DAY) {
    return { rank: 3, badge: "📄 Present offers", why: "Offer in hand 24h+ — get it in front of them.", since: deal.offer_received_at, tone: "amber" };
  }
  // 3 — a docs stage stalled 3+ days.
  const staleCol: Record<string, keyof QueueDeal> = {
    application_sent: "application_sent_at",
    docs_collected: "docs_collected_at",
    bank_statements: "bank_statements_at",
  };
  if (deal.status in staleCol) {
    const ts = deal[staleCol[deal.status]] as string | null;
    if (ts && now - Date.parse(ts) > 3 * DAY) {
      return { rank: 4, badge: "⏰ Docs stale", why: "No movement in 3+ days — chase the stips.", since: ts, tone: "red" };
    }
  }
  // 4 — submitted 48h+ ago and no funder has responded yet.
  if (deal.status === "submitted_to_funder" && deal.submitted_at && !anyResponded && now - Date.parse(deal.submitted_at) > 2 * DAY) {
    return { rank: 5, badge: "📤 Nudge funders", why: "Submitted 48h+ ago, still silent — nudge them.", since: deal.submitted_at, tone: "blue" };
  }
  // 5 — a new lead. It surfaces IMMEDIATELY: a just-created lead is the very
  // definition of "needs first contact", so it must never be invisible while it
  // ages (that hid brand-new leads from the closer AND admins for up to an hour).
  // Temperature only sets the badge/urgency. (Hot leads are caught by rank 0.)
  if (deal.status === "new" && deal.created_at) {
    const warm = WARM.has(deal.temperature ?? "");
    return warm
      ? { rank: 5.5, badge: "🌤️ Warm lead — call now", why: "Purchased/qualified lead — these decay fast, call now.", since: deal.created_at, tone: "amber" }
      : { rank: 6, badge: "🆕 New lead — make first contact", why: "Newly created lead — make first contact.", since: deal.created_at, tone: "gray" };
  }
  // 6 — CATCH-ALL: any OTHER open deal (terminal statuses are already filtered
  // out upstream in getOpenDealsForQueue) is still being actively worked, so it
  // must NEVER silently drop off My Day mid-funnel — that's the bug where a lead
  // moved to "contacted" (or qualifying, docs, etc.) disappeared from the queue.
  // Give each stage a nudge; anything unmapped still shows as low-priority
  // "in progress" so nothing open is ever invisible.
  const since = deal.updated_at ?? deal.created_at ?? null;
  switch (deal.status) {
    case "contacted":
      return { rank: 7, badge: "☎️ Qualify this lead", why: "You've made contact — run the 3 qualifiers and move them forward.", since, tone: "blue" };
    case "qualifying":
      return { rank: 7, badge: "📋 Send the application", why: "Qualified — get the app + upload link out while they're warm.", since, tone: "blue" };
    case "application_sent":
      return { rank: 7, badge: "✍️ Chase the signed app", why: "Application sent — nudge them to sign so you can package it.", since, tone: "blue" };
    case "docs_collected":
    case "bank_statements":
      return { rank: 7, badge: "📎 Collect the stips", why: "Docs started — get the rest (bank statements/ID) and submit.", since, tone: "blue" };
    case "offer_presented":
      return { rank: 7, badge: "🤝 Close the offer", why: "Offer's in front of them — close it.", since, tone: "amber" };
    case "offer_accepted":
      return { rank: 7, badge: "📝 Push to funding", why: "Accepted — drive it to funded.", since, tone: "amber" };
    default:
      return { rank: 8, badge: "🔧 In progress", why: "Open deal — keep it moving.", since, tone: "gray" };
  }
}

const toneChip: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function nameOf(d: QueueDeal): string {
  return (
    d.customer?.business_name ||
    [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
    d.deal_number ||
    "Lead"
  );
}

// Compact deal size for the card ("$25K ask"). Omitted entirely when there's no
// requested amount on the row.
function amountOf(d: QueueDeal): string | null {
  const a = d.amount_requested;
  if (!a || a <= 0) return null;
  return a >= 1000 ? `$${Math.round(a / 1000)}K ask` : `$${a} ask`;
}

// How long an item may sit at its `since` timestamp before it's "overdue". Keyed
// off the classification rank so we don't re-derive the situation: funder/merchant
// replies go stale fast (4h), a new/warm lead must be worked within the hour, and
// the active-stage nudges (rank 7) get a full business day. Ranks with their own
// clock (rank 0's countdown) or that are already time-gated in classify() (offers,
// stale docs, silent funders) return null — no separate overdue flag.
function slaMs(rank: number): number | null {
  if (rank === 1 || rank === 2) return 4 * HOUR;
  if (rank === 5.5 || rank === 6) return HOUR;
  if (rank === 7) return DAY;
  return null;
}

// Color-code each card by HOW the lead arrived, so the queue reads at a glance:
// live transfers pop red (they're the time-critical ones), web-form leads blue,
// etc. Left edge carries the color; a tiny chip names the source.
const SOURCE_STYLE: Record<string, { edge: string; chip: string; label: string }> = {
  live_transfer: { edge: "border-l-red-500", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", label: "Live transfer" },
  realtime_appt: { edge: "border-l-red-400", chip: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", label: "Real-time" },
  website: { edge: "border-l-blue-500", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", label: "Web form" },
  website_apply: { edge: "border-l-blue-500", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", label: "Web form" },
  web_purchased: { edge: "border-l-amber-500", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", label: "Web lead" },
  aged_transfer: { edge: "border-l-orange-500", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", label: "Aged" },
  cold_email: { edge: "border-l-purple-500", chip: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", label: "Cold email" },
  cold_email_landing: { edge: "border-l-purple-500", chip: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300", label: "Cold email" },
  renewal: { edge: "border-l-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", label: "Renewal" },
  referral: { edge: "border-l-teal-500", chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300", label: "Referral" },
};
const SOURCE_FALLBACK = { edge: "border-l-gray-300 dark:border-l-gray-600", chip: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300", label: "Other" };
const sourceStyle = (d: QueueDeal) => SOURCE_STYLE[d.lead_source ?? ""] ?? SOURCE_FALLBACK;

/**
 * "My Day" — the ranked work queue at the top of the Revenue Playbook. Clicking
 * a card loads that deal into the workspace (via onPick, which also switches to
 * the matching playbook tab). Auto-refreshes every 60s like the funnel board.
 */
export default function MyDayQueue({ onPick }: { onPick: (d: QueueDeal) => void }) {
  const { effectiveUserId, isAdmin, isSuperAdmin } = useUserProfile();
  // Admins/super-admins can flip Mine/All; a pure closer (no admin role) is
  // always scoped to their own book + unassigned. Default All for super_admin,
  // Mine for everyone else.
  const canToggle = isAdmin;
  const [scope, setScope] = useState<"mine" | "all">(isSuperAdmin ? "all" : "mine");
  const [deals, setDeals] = useState<QueueDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  // My Day is an accordion but DEFAULT EXPANDED.
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(() => {
    getOpenDealsForQueue()
      .then((d) => setDeals(d))
      .catch(() => setDeals([]))
      .finally(() => {
        setLoading(false);
        setNow(Date.now());
      });
  }, []);

  useEffect(() => {
    load();
    // Near-real-time: a fast poll, a refetch when the tab regains focus, and a
    // live subscription to deal changes — so a lead created by anyone (e.g. a
    // closer) pops into the queue without a manual refresh.
    const poll = setInterval(load, 15_000);
    const onFocus = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const channel = supabase
      .channel("myday-deals")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, () => load())
      .subscribe();
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      supabase.removeChannel(channel);
    };
  }, [load]);

  // Tick `now` every second so the hot-lead speed-to-lead countdown counts down
  // live (the 60s data reload is too coarse for a ticking clock).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const mineScope = (d: QueueDeal) => !d.assigned_closer_id || d.assigned_closer_id === effectiveUserId;

  const items = useMemo(() => {
    const scoped = deals.filter((d) => {
      if (!canToggle) return mineScope(d);
      return scope === "all" ? true : mineScope(d);
    });
    return scoped
      .map((d) => ({ deal: d, u: classify(d, now) }))
      .filter((x): x is { deal: QueueDeal; u: Urgency } => x.u !== null)
      .sort((a, b) => a.u.rank - b.u.rank || Date.parse(a.u.since) - Date.parse(b.u.since));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, scope, canToggle, effectiveUserId, now]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 text-left">
          <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
          <BoltIcon className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold text-gray-900 dark:text-white">My Day</h2>
          {!loading && items.length > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {items.length}
            </span>
          )}
          <span className="hidden sm:inline text-xs text-gray-400">— what needs you next, most urgent first</span>
        </button>
        <div className="flex items-center gap-2">
          {canToggle && (
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-2.5 py-1 ${scope === s ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                >
                  {s === "mine" ? "Mine" : "All"}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={load}
            title="Refresh the queue"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (loading ? (
        <p className="text-sm text-gray-400 py-2">Loading your queue…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Queue clear — work the funnel below 🎉</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {items.map(({ deal, u }) => {
            const src = sourceStyle(deal);
            const amount = amountOf(deal);
            const sla = slaMs(u.rank);
            const overdue = sla !== null && now - Date.parse(u.since) > sla;
            return (
              <button
                key={deal.id}
                onClick={() => onPick(deal)}
                title={`Load ${nameOf(deal)} into the playbook`}
                className={`group shrink-0 w-72 text-left rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${src.edge} bg-gray-50 dark:bg-gray-900 hover:border-ocean-blue hover:shadow-md hover:-translate-y-0.5 transition p-3`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${toneChip[u.tone]}`}>{u.badge}</span>
                  {u.countdownDue ? (
                    (Date.parse(u.countdownDue) - now) > 0 ? (
                      <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0 tabular-nums">
                        ⏱ {countdown(Date.parse(u.countdownDue) - now)} left
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0">SLA MISSED — call anyway</span>
                    )
                  ) : overdue ? (
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400 shrink-0">overdue</span>
                  ) : (
                    <span className="text-[11px] text-gray-400 shrink-0">{ago(u.since, now)}</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{nameOf(deal)}</p>
                  {amount && <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 shrink-0">{amount}</span>}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 mt-0.5">{u.why}</p>
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${src.chip}`}>{src.label}</span>
                  <span className="text-[11px] font-medium text-ocean-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Open →</span>
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
