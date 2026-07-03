import { useCallback, useEffect, useMemo, useState } from "react";
import { BoltIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { getOpenDealsForQueue, type QueueDeal } from "../../services/dealService";
import { useUserProfile } from "../../context/UserProfileContext";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Urgency {
  rank: number;
  badge: string;
  why: string;
  /** ISO timestamp that drives the card's age + the intra-rank sort. */
  since: string;
  tone: string;
}

// Ranking rules — the order here IS the priority (1 = most urgent). A deal that
// matches none of these never enters the queue.
function classify(deal: QueueDeal, now: number): Urgency | null {
  const subs = deal.submissions ?? [];
  const responded = subs.filter((s) => s.response_at);
  const anyResponded = responded.length > 0;

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
  // 5 — a new lead untouched for over an hour.
  if (deal.status === "new" && deal.created_at && now - Date.parse(deal.created_at) > HOUR) {
    return { rank: 6, badge: "🆕 Untouched lead", why: "New lead sitting 1h+ — make first contact.", since: deal.created_at, tone: "gray" };
  }
  return null;
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
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

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
        <div className="flex items-center gap-2">
          <BoltIcon className="w-5 h-5 text-amber-500" />
          <h2 className="text-base font-bold text-gray-900 dark:text-white">My Day</h2>
          {!loading && items.length > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {items.length}
            </span>
          )}
          <span className="hidden sm:inline text-xs text-gray-400">— what needs you next, most urgent first</span>
        </div>
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

      {loading ? (
        <p className="text-sm text-gray-400 py-2">Loading your queue…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">Queue clear — work the funnel below 🎉</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {items.map(({ deal, u }) => (
            <button
              key={deal.id}
              onClick={() => onPick(deal)}
              title={`Load ${nameOf(deal)} into the playbook`}
              className="shrink-0 w-60 text-left rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 hover:border-ocean-blue hover:shadow-md transition p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${toneChip[u.tone]}`}>{u.badge}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{ago(u.since, now)}</span>
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{nameOf(deal)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{u.why}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
