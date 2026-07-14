import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import {
  getCalendarDeals,
  STIPS_PENDING_STATUSES,
  type CalendarDeal,
} from "../../services/dealService";
import { useUserProfile } from "../../context/UserProfileContext";
import { dateKeyET, timeET } from "../../utils/time";

/**
 * /admin/calendar — the in-app calendar, for EVERY staff level.
 *
 * READ-ONLY by design (P1): the playbook / My Day stays the single place where
 * callbacks get rescheduled or cleared. This page answers one question — "what
 * did we promise, and when?" — from OUR database. The GHL calendar is a
 * projection of these same rows; this page reads the truth.
 *
 * Three item types, all off `deals`:
 *   🕐 callback  — deals.callback_at (timed; red + banner once it's past due)
 *   📎 stips due — deals.stips_promised_by (an all-day DATE promise, shown only
 *                  while the deal is still in a stage where the promise matters)
 *   ⏱ SLA       — deals.first_call_due_at, FUTURE only (5-minute windows; rare)
 *
 * Scope mirrors My Day exactly: closers are already fenced to their own book +
 * unassigned by RLS; admins get a Mine/All toggle (default All for super_admin,
 * Mine otherwise). Every time on screen is Eastern.
 */

type ItemType = "callback" | "stips" | "sla";

interface CalItem {
  key: string;
  type: ItemType;
  deal: CalendarDeal;
  /** ET calendar day this item belongs to, "YYYY-MM-DD". */
  dateKey: string;
  /** ISO instant for timed items; null = all-day (stips promises). */
  at: string | null;
  pastDue: boolean;
}

const TYPE_META: Record<ItemType, { icon: string; label: string; chip: string; dot: string }> = {
  callback: {
    icon: "🕐",
    label: "Callback",
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  stips: {
    icon: "📎",
    label: "Stips due",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  sla: {
    icon: "⏱",
    label: "SLA — first call",
    chip: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
    dot: "bg-fuchsia-500",
  },
};

const RED_CHIP = "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
const RED_DOT = "bg-red-500";

// Stable closer color: hash the profile id into a small palette, so the same
// closer is always the same color in the All view — across days, across visits.
const CLOSER_PALETTE = [
  { chip: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  { chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  { chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  { chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  { chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  { chip: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300" },
];

function closerChipClass(closerId: string): string {
  let h = 0;
  for (let i = 0; i < closerId.length; i++) h = (h * 31 + closerId.charCodeAt(i)) >>> 0;
  return CLOSER_PALETTE[h % CLOSER_PALETTE.length].chip;
}

function nameOf(d: CalendarDeal): string {
  return (
    d.customer?.business_name ||
    [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
    d.deal_number ||
    "Deal"
  );
}

function closerNameOf(d: CalendarDeal): string {
  return [d.closer?.first_name, d.closer?.last_name].filter(Boolean).join(" ") || "Unassigned";
}

// ── Calendar-day math, done on date KEYS ("YYYY-MM-DD"), never on Date renders ──
// The app's render patch defaults every Date format to Eastern, which is exactly
// right for instants and exactly wrong for pure calendar days (UTC-midnight of a
// key would render as the previous evening ET). So day labels are assembled from
// the key's own numbers, and only day-of-week uses Date — via UTC accessors,
// which no timezone can bend.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const firstDow = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
const dowOfKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** "Tue, July 14" from a date key — no Date formatting, no timezone to get wrong. */
function labelOfKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return `${DOW[dowOfKey(key)]}, ${MONTHS[m - 1]} ${d}`;
}

/** "2h late" / "3d late" for a missed callback. */
function lateLabel(iso: string, now: number): string {
  const h = Math.floor((now - Date.parse(iso)) / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor((now - Date.parse(iso)) / 60_000))}m late`;
  if (h < 24) return `${h}h late`;
  return `${Math.floor(h / 24)}d late`;
}

/** Every dated commitment on a deal → 0–3 calendar items. */
function itemsOf(deal: CalendarDeal, now: number, todayKey: string): CalItem[] {
  const out: CalItem[] = [];
  if (deal.callback_at) {
    out.push({
      key: `${deal.id}-cb`,
      type: "callback",
      deal,
      dateKey: dateKeyET(deal.callback_at),
      at: deal.callback_at,
      pastDue: Date.parse(deal.callback_at) < now, // deal is open by construction — a past callback is a missed promise
    });
  }
  if (deal.stips_promised_by && STIPS_PENDING_STATUSES.has(deal.status)) {
    const dateKey = deal.stips_promised_by.slice(0, 10); // DATE column — no timezone, use as-is
    out.push({
      key: `${deal.id}-stips`,
      type: "stips",
      deal,
      dateKey,
      at: null,
      pastDue: dateKey < todayKey,
    });
  }
  // Speed-to-lead deadlines are 5-minute windows: only a FUTURE one is actionable
  // on a calendar. Once it's past, My Day's SLA handling owns it — repeating
  // "missed" here would just train people to ignore red.
  if (deal.first_call_due_at && Date.parse(deal.first_call_due_at) > now) {
    out.push({
      key: `${deal.id}-sla`,
      type: "sla",
      deal,
      dateKey: dateKeyET(deal.first_call_due_at),
      at: deal.first_call_due_at,
      pastDue: false,
    });
  }
  return out;
}

// All-day promises first, then timed items in time order.
function byDayOrder(a: CalItem, b: CalItem): number {
  if (!a.at && b.at) return -1;
  if (a.at && !b.at) return 1;
  if (a.at && b.at) return Date.parse(a.at) - Date.parse(b.at);
  return nameOf(a.deal).localeCompare(nameOf(b.deal));
}

/** One calendar line: time · type chip · merchant · deal # · sync tick · closer. */
function ItemRow({ item, now, showCloser }: { item: CalItem; now: number; showCloser: boolean }) {
  const { deal, type, at, pastDue } = item;
  const meta = TYPE_META[type];
  const missedCallback = type === "callback" && pastDue;
  const lateStips = type === "stips" && pastDue;
  const chip = missedCallback || lateStips ? RED_CHIP : meta.chip;

  // "📅 synced to GHL" only when the GHL appointment reflects THIS exact instant
  // (same value-equality rule as My Day — a stale tick after a reschedule is a lie).
  const onCalendar =
    type === "callback" &&
    !!deal.callback_ghl_event_id &&
    !!deal.callback_synced_at &&
    !!deal.callback_at &&
    Date.parse(deal.callback_synced_at) === Date.parse(deal.callback_at);
  const syncError = type === "callback" && !onCalendar && deal.callback_sync_error;

  return (
    <Link
      to={`/admin/deals/${deal.id}`}
      title={`Open ${nameOf(deal)} — reschedule/clear from the Revenue Playbook`}
      className={`group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition hover:shadow-sm hover:border-ocean-blue ${
        missedCallback
          ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
          : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
      }`}
    >
      <span
        className={`w-[4.5rem] shrink-0 text-xs font-bold tabular-nums ${
          missedCallback ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-200"
        }`}
      >
        {at ? timeET(at) : "All day"}
      </span>
      <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${chip}`}>
        {meta.icon} {meta.label}
        {missedCallback && at && <> · MISSED — {lateLabel(at, now)}</>}
        {lateStips && <> · promise passed</>}
      </span>
      <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{nameOf(deal)}</span>
        {deal.deal_number && (
          <span className="text-[11px] font-mono text-gray-400 shrink-0">{deal.deal_number}</span>
        )}
      </span>
      {onCalendar && (
        <span className="hidden sm:inline text-[11px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0" title="The GHL calendar shows this exact time">
          📅 synced
        </span>
      )}
      {syncError && (
        <span className="hidden sm:inline text-[11px] font-medium text-amber-600 dark:text-amber-400 shrink-0" title={`GHL sync failed: ${syncError}`}>
          ⚠ not on GHL
        </span>
      )}
      {showCloser && (
        <span
          className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            deal.assigned_closer_id ? closerChipClass(deal.assigned_closer_id) : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"
          }`}
        >
          {closerNameOf(deal)}
        </span>
      )}
      <span className="text-[11px] font-medium text-ocean-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        Open →
      </span>
    </Link>
  );
}

export default function CalendarPage() {
  const { effectiveUserId, isAdmin, isSuperAdmin } = useUserProfile();
  // Same scope pattern as My Day: closers are RLS-fenced already; admins toggle.
  const canToggle = isAdmin;
  const [scope, setScope] = useState<"mine" | "all">(isSuperAdmin ? "all" : "mine");
  const [deals, setDeals] = useState<CalendarDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const todayKey = dateKeyET(new Date(now));
  const [ty, tm] = todayKey.split("-").map(Number);
  const [view, setView] = useState<{ y: number; m: number }>({ y: ty, m: tm });
  const [selectedKey, setSelectedKey] = useState<string>(todayKey);

  const load = useCallback(() => {
    getCalendarDeals()
      .then(setDeals)
      .catch(() => setDeals([]))
      .finally(() => {
        setLoading(false);
        setNow(Date.now());
      });
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 60_000);
    const onFocus = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // A half-minute tick keeps "MISSED / Xm late" honest between polls.
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  const mineScope = useCallback(
    (d: CalendarDeal) => !d.assigned_closer_id || d.assigned_closer_id === effectiveUserId,
    [effectiveUserId],
  );

  const items = useMemo(() => {
    const scoped = deals.filter((d) => (!canToggle ? mineScope(d) : scope === "all" ? true : mineScope(d)));
    return scoped.flatMap((d) => itemsOf(d, now, todayKey));
  }, [deals, canToggle, scope, mineScope, now, todayKey]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const it of items) {
      const arr = map.get(it.dateKey) ?? [];
      arr.push(it);
      map.set(it.dateKey, arr);
    }
    for (const arr of map.values()) arr.sort(byDayOrder);
    return map;
  }, [items]);

  // Missed promises: every past-due callback on a still-open deal, oldest first.
  const missedCallbacks = useMemo(
    () =>
      items
        .filter((i) => i.type === "callback" && i.pastDue)
        .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!)),
    [items],
  );

  const todayItems = byDay.get(todayKey) ?? [];
  const selectedItems = byDay.get(selectedKey) ?? [];
  const showCloser = canToggle && scope === "all";

  // Month grid cells: leading blanks to the first weekday, then the days.
  const cells = useMemo(() => {
    const blanks = Array.from({ length: firstDow(view.y, view.m) }, () => null as string | null);
    const days = Array.from({ length: daysInMonth(view.y, view.m) }, (_, i) => keyOf(view.y, view.m, i + 1));
    return [...blanks, ...days];
  }, [view]);

  const monthDelta = (delta: number) => {
    setView(({ y, m }) => {
      const n = m + delta;
      if (n < 1) return { y: y - 1, m: 12 };
      if (n > 12) return { y: y + 1, m: 1 };
      return { y, m: n };
    });
  };
  const jumpToday = () => {
    setView({ y: ty, m: tm });
    setSelectedKey(todayKey);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CalendarDaysIcon className="w-7 h-7 text-mint-green" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Calendar</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Every callback, stips promise, and SLA window — straight from the pipeline. All times <b>ET</b>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canToggle && (
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
              {(["mine", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 font-medium ${
                    scope === s ? "bg-ocean-blue text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  {s === "mine" ? "Mine" : "All"}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={load}
            title="Refresh"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Read-only notice: the playbook is where callbacks actually get worked. */}
      <Link
        to="/admin/playbooks"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
      >
        <MapIcon className="w-3.5 h-3.5" />
        Read-only view — reschedule or clear callbacks in the <b>Revenue Playbook</b> →
      </Link>

      {/* MISSED PROMISES — past-due callbacks on open deals, loud on purpose. */}
      {!loading && missedCallbacks.length > 0 && (
        <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
          <h2 className="text-sm font-bold text-red-700 dark:text-red-300 mb-2">
            🔴 Missed callbacks — {missedCallbacks.length} promise{missedCallbacks.length === 1 ? "" : "s"} past due
          </h2>
          <div className="space-y-1.5">
            {missedCallbacks.map((it) => (
              <ItemRow key={it.key} item={it} now={now} showCloser={showCloser} />
            ))}
          </div>
        </div>
      )}

      {/* TODAY — the most-used surface. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Today — {labelOfKey(todayKey)}</h2>
          {todayItems.length > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-mint-green/15 text-mint-green">
              {todayItems.length}
            </span>
          )}
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 py-1">Loading the calendar…</p>
        ) : todayItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <b>Nothing due today</b> — no callbacks, no promised stips, no SLA windows.{" "}
            <Link to="/admin/playbooks" className="text-ocean-blue hover:underline">Work My Day in the Revenue Playbook →</Link>
          </p>
        ) : (
          <div className="space-y-1.5">
            {todayItems.map((it) => (
              <ItemRow key={it.key} item={it} now={now} showCloser={showCloser} />
            ))}
          </div>
        )}
      </div>

      {/* Month grid + day agenda */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {MONTHS[view.m - 1]} {view.y}
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => monthDelta(-1)}
                title="Previous month"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <button
                onClick={jumpToday}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600"
              >
                Today
              </button>
              <button
                onClick={() => monthDelta(1)}
                title="Next month"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {DOW.map((d) => (
              <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-gray-400 py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((key, i) =>
              key === null ? (
                <div key={`blank-${i}`} />
              ) : (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`min-h-[3.5rem] rounded-lg border p-1.5 text-left transition flex flex-col ${
                    selectedKey === key
                      ? "border-ocean-blue bg-ocean-blue/10"
                      : "border-gray-100 dark:border-gray-700 hover:border-ocean-blue/50 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  } ${key === todayKey ? "ring-2 ring-mint-green" : ""}`}
                >
                  <span
                    className={`text-xs font-semibold ${
                      key === todayKey ? "text-mint-green" : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {Number(key.slice(8))}
                  </span>
                  {(byDay.get(key)?.length ?? 0) > 0 && (
                    <span className="mt-auto flex items-center gap-0.5 flex-wrap">
                      {(byDay.get(key) ?? []).slice(0, 4).map((it) => (
                        <span
                          key={it.key}
                          title={`${TYPE_META[it.type].icon} ${nameOf(it.deal)}`}
                          className={`w-1.5 h-1.5 rounded-full ${
                            it.pastDue && it.type === "callback" ? RED_DOT : TYPE_META[it.type].dot
                          }`}
                        />
                      ))}
                      {(byDay.get(key)?.length ?? 0) > 4 && (
                        <span className="text-[9px] font-semibold text-gray-400">+{(byDay.get(key)?.length ?? 0) - 4}</span>
                      )}
                    </span>
                  )}
                </button>
              ),
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${TYPE_META.callback.dot}`} /> 🕐 callback</span>
            <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${TYPE_META.stips.dot}`} /> 📎 stips due</span>
            <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${TYPE_META.sla.dot}`} /> ⏱ SLA</span>
            <span className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${RED_DOT}`} /> missed callback</span>
          </div>
        </div>

        {/* Day agenda */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">
            {selectedKey === todayKey ? "Today" : labelOfKey(selectedKey)}
          </h2>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : selectedItems.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              Nothing scheduled — no callbacks, promises, or deadlines land on this day
              {scope === "mine" && canToggle ? " in your book. Try All." : "."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {selectedItems.map((it) => (
                <ItemRow key={it.key} item={it} now={now} showCloser={showCloser} />
              ))}
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="mt-3 text-xs text-gray-400">
              The whole {scope === "mine" && canToggle ? "book" : "pipeline"} is promise-free right now — callbacks
              set in the playbook will appear here the moment they're saved.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
