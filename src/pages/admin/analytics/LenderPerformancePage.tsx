import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  BuildingLibraryIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "@heroicons/react/24/outline";
import AnalyticsTabNav from "../../../components/analytics/AnalyticsTabNav";
import {
  getFunderAnalytics,
  type FunderAnalytics,
  type FunderAnalyticsRow,
  type FunderFeedEvent,
  type FunderFeedKind,
} from "../../../services/dealService";

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

// AI decline-reason category → short human label.
const DECLINE_REASON_LABELS: Record<string, string> = {
  low_revenue: "Low revenue",
  industry: "Industry",
  time_in_business: "Time in business",
  credit: "Credit",
  existing_positions: "Too many positions",
  missing_docs: "Missing docs",
  state: "State",
  other: "Other",
};
const declineReasonLabel = (cat: string | null): string =>
  cat ? DECLINE_REASON_LABELS[cat] ?? cat.replace(/_/g, " ") : "—";

const PAPER_LABELS: Record<string, string> = {
  a_paper: "A paper",
  b_paper: "B paper",
  c_paper: "C paper",
  d_paper: "D paper",
};
const paperLabel = (p: string | null): string => (p ? PAPER_LABELS[p] ?? p.replace(/_/g, " ") : "—");

function fmtHrs(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function fmtMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ─────────────────────────── Event feed styling ───────────────────────────

const FEED_KIND_META: Record<FunderFeedKind, { verb: string; dot: string; chip: string }> = {
  decline: { verb: "declined", dot: "bg-rose-500", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  stip_request: { verb: "requested a stip on", dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  offer: { verb: "made an offer on", dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  question: { verb: "asked about", dot: "bg-sky-500", chip: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  acknowledgment: { verb: "acknowledged", dot: "bg-gray-400", chip: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  reply: { verb: "replied on", dot: "bg-gray-400", chip: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  open: { verb: "opened", dot: "bg-violet-500", chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
};

const CHART_COLORS = ["#EF4444", "#F59E0B", "#007EA7", "#8B5CF6", "#22C55E", "#EC4899", "#64748B"];

// ─────────────────────────────── Hero strip ───────────────────────────────

function HeroStrip({ data }: { data: FunderAnalytics }) {
  const t = data.totals;
  const cards: Array<{ label: string; value: string; tone?: string; hint?: string }> = [
    { label: "Submissions", value: String(t.submissions) },
    { label: "Replies", value: String(t.replies), hint: t.submissions > 0 ? `${((t.replies / t.submissions) * 100).toFixed(0)}% reply rate` : undefined },
    { label: "Offers", value: String(t.offers), tone: "text-emerald-600" },
    { label: "Declines", value: String(t.declines), tone: "text-rose-600" },
    { label: "Accepted", value: String(t.accepted), tone: "text-emerald-600" },
    { label: "Avg first response", value: fmtHrs(t.avgFirstResponseHrs) },
    {
      label: "Open rate",
      value: t.openRate != null ? `${t.openRate.toFixed(0)}%` : "—",
      hint: t.trackedEmails > 0 ? `${t.openedEmails}/${t.trackedEmails} emails` : "no tracked opens",
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <p className={`text-2xl font-bold ${c.tone ?? "text-gray-900 dark:text-white"}`}>{c.value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.label}</p>
          {c.hint && <p className="text-[11px] text-gray-400 mt-0.5">{c.hint}</p>}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Live event feed ─────────────────────────────

function FeedRow({ ev }: { ev: FunderFeedEvent }) {
  const meta = FEED_KIND_META[ev.kind];
  const funder =
    ev.kind === "open" && ev.opener === "merchant"
      ? <span className="font-medium text-gray-700 dark:text-gray-200">Merchant</span>
      : ev.lenderId
      ? <Link to={`/admin/lenders/${ev.lenderId}`} className="font-medium text-ocean-blue hover:underline">{ev.funderName ?? "Funder"}</Link>
      : <span className="font-medium text-gray-700 dark:text-gray-200">{ev.funderName ?? "Funder"}</span>;

  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {funder} <span className="text-gray-500 dark:text-gray-400">{meta.verb}</span>{" "}
          {ev.dealNumber ? (
            ev.dealId ? (
              <Link to={`/admin/deals/${ev.dealId}`} className="font-medium text-ocean-blue hover:underline">{ev.dealNumber}</Link>
            ) : (
              <span className="font-medium">{ev.dealNumber}</span>
            )
          ) : (
            <span className="text-gray-400">a deal</span>
          )}
          {ev.detail && ev.kind !== "open" && (
            <span className="text-gray-500 dark:text-gray-400"> — {ev.detail}</span>
          )}
        </p>
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap shrink-0" title={new Date(ev.at).toLocaleString()}>
        {clockTime(ev.at)}
      </span>
    </li>
  );
}

function LiveEventFeed({ feed }: { feed: FunderFeedEvent[] }) {
  const [limit, setLimit] = useState(25);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Live funder activity</h3>
        <span className="text-xs text-gray-400">{feed.length} events</span>
      </div>
      {feed.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          No funder replies yet — events will stream in here as funders respond to submissions.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {feed.slice(0, limit).map((ev) => (
              <FeedRow key={ev.id} ev={ev} />
            ))}
          </ul>
          {feed.length > limit && (
            <button
              onClick={() => setLimit((l) => l + 25)}
              className="mt-3 text-sm text-ocean-blue hover:underline"
            >
              Show more
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Per-funder detail panel ─────────────────────────

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700/50 rounded overflow-hidden">
        <div className="h-full rounded flex items-center justify-end pr-1.5" style={{ width: `${Math.max(pct, value > 0 ? 8 : 0)}%`, backgroundColor: color }}>
          {value > 0 && <span className="text-[10px] font-semibold text-white">{value}</span>}
        </div>
      </div>
    </div>
  );
}

function FunderDetail({ f }: { f: FunderAnalyticsRow }) {
  const declineData = useMemo(
    () =>
      Object.entries(f.declineReasonCounts)
        .map(([cat, n]) => ({ name: declineReasonLabel(cat), value: n }))
        .sort((a, b) => b.value - a.value),
    [f.declineReasonCounts],
  );

  return (
    <div className="grid md:grid-cols-2 gap-6 p-4 bg-gray-50 dark:bg-gray-900/30 rounded-lg">
      {/* Mini funnel */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Submission funnel</h4>
        <div className="space-y-2">
          <FunnelBar label="Submitted" value={f.sent} max={f.sent} color="#007EA7" />
          <FunnelBar label="Replied" value={f.replied} max={f.sent} color="#0EA5E9" />
          <FunnelBar label="Offer" value={f.offers} max={f.sent} color="#F59E0B" />
          <FunnelBar label="Accepted" value={f.accepted} max={f.sent} color="#22C55E" />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span>Avg offer-to-ask: <span className="font-medium text-gray-700 dark:text-gray-200">{f.avgOfferToAsk != null ? `${(f.avgOfferToAsk * 100).toFixed(0)}%` : "—"}</span></span>
          <span>Avg factor: <span className="font-medium text-gray-700 dark:text-gray-200">{f.avgFactor != null ? `${f.avgFactor.toFixed(2)}x` : "—"}</span></span>
          <span>Median response: <span className="font-medium text-gray-700 dark:text-gray-200">{fmtHrs(f.medianResponseHrs)}</span></span>
        </div>
        {f.requestedItems.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Items they've requested</p>
            <div className="flex flex-wrap gap-1.5">
              {f.requestedItems.map((item) => (
                <span key={item} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Decline breakdown + deals */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Why they pass</h4>
        {declineData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(90, declineData.length * 34)}>
            <BarChart data={declineData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.15} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#9CA3AF" }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | undefined) => [v ?? 0, "Declines"]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {declineData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-gray-400 py-4">No classified declines from this funder yet.</p>
        )}

        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mt-4 mb-2">Deals with this funder</h4>
        <ul className="space-y-1.5">
          {f.deals.map((d, i) => (
            <li key={`${d.dealId}-${i}`} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 min-w-0">
                {d.dealId ? (
                  <Link to={`/admin/deals/${d.dealId}`} className="text-ocean-blue hover:underline font-medium shrink-0">{d.dealNumber ?? "Deal"}</Link>
                ) : (
                  <span className="font-medium">{d.dealNumber ?? "Deal"}</span>
                )}
                <span className="truncate text-gray-500 dark:text-gray-400">{d.businessName ?? "—"}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {d.amountRequested != null && <span className="text-gray-500 dark:text-gray-400">{fmtMoney(d.amountRequested)}</span>}
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{d.status.replace(/_/g, " ")}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────── Leaderboard ───────────────────────────────

type SortKey = "lenderName" | "sent" | "replied" | "replyRate" | "medianResponseHrs" | "offers" | "offerRate" | "accepted" | "declines" | "avgFactor" | "estCommission" | "lastInteraction";

function Leaderboard({ funders }: { funders: FunderAnalyticsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("sent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...funders];
    arr.sort((a, b) => {
      let av: number | string | null;
      let bv: number | string | null;
      if (sortKey === "lenderName") { av = a.lenderName.toLowerCase(); bv = b.lenderName.toLowerCase(); }
      else if (sortKey === "lastInteraction") { av = a.lastInteraction ? Date.parse(a.lastInteraction) : 0; bv = b.lastInteraction ? Date.parse(b.lastInteraction) : 0; }
      else { av = a[sortKey] as number | null; bv = b[sortKey] as number | null; }
      if (av == null) av = -1;
      if (bv == null) bv = -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [funders, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "lenderName" ? "asc" : "desc"); }
  };

  const cols: Array<{ key: SortKey; label: string; align?: string; title?: string }> = [
    { key: "lenderName", label: "Funder", align: "text-left" },
    { key: "sent", label: "Sent", align: "text-right" },
    { key: "replied", label: "Replied", align: "text-right" },
    { key: "replyRate", label: "Reply %", align: "text-right" },
    { key: "medianResponseHrs", label: "Med. resp", align: "text-right", title: "Median time from submission to first reply" },
    { key: "offers", label: "Offers", align: "text-right" },
    { key: "offerRate", label: "Offer %", align: "text-right" },
    { key: "accepted", label: "Accepted", align: "text-right" },
    { key: "declines", label: "Declines", align: "text-right" },
    { key: "avgFactor", label: "Avg factor", align: "text-right" },
    { key: "estCommission", label: "Commission", align: "text-right", title: "Estimated: accepted deal amounts × 8 points" },
    { key: "lastInteraction", label: "Last seen", align: "text-right" },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Funder leaderboard</h3>
        <span className="text-xs text-gray-400">Click a row for detail · commission is <span className="italic">est.</span></span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 w-6" />
              {cols.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  onClick={() => toggleSort(c.key)}
                  className={`py-2 px-2 font-semibold cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-200 ${c.align ?? "text-right"}`}
                >
                  <span className={`inline-flex items-center gap-1 ${c.align === "text-left" ? "" : "justify-end"}`}>
                    {c.label}
                    {sortKey === c.key && (sortDir === "asc" ? <ArrowUpIcon className="w-3 h-3" /> : <ArrowDownIcon className="w-3 h-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => {
              const isOpen = expanded === f.lenderId;
              return (
                <Fragment key={f.lenderId}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : f.lenderId)}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                  >
                    <td className="py-2.5 pl-1 text-gray-400">
                      {isOpen ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                    </td>
                    <td className="py-2.5 px-2 text-left">
                      <Link to={`/admin/lenders/${f.lenderId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ocean-blue hover:underline">
                        {f.lenderName}
                      </Link>
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{paperLabel(f.paperType)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-700 dark:text-gray-200">{f.sent}</td>
                    <td className="py-2.5 px-2 text-right text-gray-700 dark:text-gray-200">{f.replied}</td>
                    <td className="py-2.5 px-2 text-right text-gray-500 dark:text-gray-400">{f.replyRate != null ? `${f.replyRate.toFixed(0)}%` : "—"}</td>
                    <td className="py-2.5 px-2 text-right text-gray-500 dark:text-gray-400">{fmtHrs(f.medianResponseHrs)}</td>
                    <td className="py-2.5 px-2 text-right text-gray-700 dark:text-gray-200">{f.offers}</td>
                    <td className="py-2.5 px-2 text-right text-gray-500 dark:text-gray-400">{f.offerRate != null ? `${f.offerRate.toFixed(0)}%` : "—"}</td>
                    <td className="py-2.5 px-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{f.accepted}</td>
                    <td className="py-2.5 px-2 text-right">
                      <span className="text-gray-500 dark:text-gray-400">{f.declines}</span>
                      {f.topDeclineReason && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">{declineReasonLabel(f.topDeclineReason)}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right text-gray-700 dark:text-gray-200">{f.avgFactor != null ? `${f.avgFactor.toFixed(2)}x` : "—"}</td>
                    <td className="py-2.5 px-2 text-right text-gray-700 dark:text-gray-200">{f.estCommission > 0 ? `${fmtMoney(f.estCommission)} est.` : "—"}</td>
                    <td className="py-2.5 px-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{timeAgo(f.lastInteraction)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={cols.length + 1} className="px-2 pb-4">
                        <FunderDetail f={f} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── Decline intelligence ─────────────────────────

function revenueRange(nums: number[]): string {
  if (nums.length === 0) return "—";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `${fmtMoney(min)}/mo` : `${fmtMoney(min)}–${fmtMoney(max)}/mo`;
}

function DeclineIntelligence({ data }: { data: FunderAnalytics }) {
  const totalData = useMemo(
    () =>
      Object.entries(data.declineReasonTotals)
        .map(([cat, n]) => ({ name: declineReasonLabel(cat), value: n }))
        .sort((a, b) => b.value - a.value),
    [data.declineReasonTotals],
  );

  // Funders that have at least one decline or offer with an observed revenue.
  const observed = data.funders.filter((f) => f.declinedRevenues.length > 0 || f.offeredRevenues.length > 0);

  if (totalData.length === 0 && observed.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">Decline intelligence</h3>
        <p className="text-sm text-gray-400 py-4">No classified declines yet — this panel fills in as funders pass on files and their reasons are captured.</p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Decline reasons — all funders</h3>
        <p className="text-xs text-gray-400 mb-4">AI-classified from funder replies</p>
        {totalData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(140, totalData.length * 40)}>
            <BarChart data={totalData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.15} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | undefined) => [v ?? 0, "Declines"]} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {totalData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400 py-4">No classified declines yet.</p>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Observed revenue thresholds</h3>
        <p className="text-xs text-gray-400 mb-4">Monthly revenue of declined vs. offered merchants — observed from data, not a stated policy</p>
        {observed.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-2 text-left font-semibold">Funder</th>
                  <th className="py-2 px-2 text-left font-semibold">Declined revenue</th>
                  <th className="py-2 px-2 text-left font-semibold">Offered revenue</th>
                  <th className="py-2 pl-2 text-left font-semibold">Observation</th>
                </tr>
              </thead>
              <tbody>
                {observed.map((f) => {
                  const dMax = f.declinedRevenues.length ? Math.max(...f.declinedRevenues) : null;
                  const oMin = f.offeredRevenues.length ? Math.min(...f.offeredRevenues) : null;
                  let note = "—";
                  if (dMax != null && oMin != null) note = `Offers above ~${fmtMoney(oMin)}/mo`;
                  else if (dMax != null) note = `Declines at/under ${fmtMoney(dMax)}/mo`;
                  else if (oMin != null) note = `Offers from ${fmtMoney(oMin)}/mo`;
                  return (
                    <tr key={f.lenderId} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="py-2 pr-2">
                        <Link to={`/admin/lenders/${f.lenderId}`} className="font-medium text-ocean-blue hover:underline">{f.lenderName}</Link>
                      </td>
                      <td className="py-2 px-2 text-gray-600 dark:text-gray-300">
                        {f.declinedRevenues.length ? <>{revenueRange(f.declinedRevenues)} <span className="text-gray-400">(n={f.declinedRevenues.length})</span></> : "—"}
                      </td>
                      <td className="py-2 px-2 text-gray-600 dark:text-gray-300">
                        {f.offeredRevenues.length ? <>{revenueRange(f.offeredRevenues)} <span className="text-gray-400">(n={f.offeredRevenues.length})</span></> : "—"}
                      </td>
                      <td className="py-2 pl-2 text-gray-500 dark:text-gray-400">{note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 py-4">Not enough decline/offer revenue data to observe thresholds yet.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────── Page ───────────────────────────────

export default function LenderPerformancePage() {
  const [data, setData] = useState<FunderAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getFunderAnalytics();
      setData(d);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load funder analytics");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // auto-refresh every 60s
    return () => clearInterval(t);
  }, [load]);

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  const hasData = !!data && data.totals.submissions > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funder Performance</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Live funder replies, offer/decline rates, and decline intelligence across every submission
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" title="Refresh now">
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AnalyticsTabNav />

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl p-4 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {!hasData ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <BuildingLibraryIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Collecting funder data…</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Funder performance appears here once deals are submitted to funders and replies come back. This view refreshes automatically.
          </p>
        </div>
      ) : (
        data && (
          <>
            <HeroStrip data={data} />
            <LiveEventFeed feed={data.feed} />
            <Leaderboard funders={data.funders} />
            <DeclineIntelligence data={data} />
            <p className="text-[11px] text-gray-400">
              Reply % = replied ÷ sent. Offer % = offers ÷ sent. Commission is estimated (accepted deal amount × 8 points) until booked in the commissions ledger. Revenue thresholds are observed from submitted deals, not funder-stated policy.
            </p>
          </>
        )
      )}
    </div>
  );
}
