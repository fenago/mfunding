// Assignments — the setter's own worklist, and the manager's view of everyone's.
//
// WHAT THIS IS FOR. My Day answers "what should I touch in the next hour"; it is
// a queue and it deliberately hides most of the book. This tab answers the other
// question a setter asks all day — "what is MINE?" — and it hides nothing. Every
// merchant assigned to them, in one table they can sort, filter and act on
// without leaving the row.
//
// WHO SEES WHAT. A role='closer' session sees ONLY deals whose assigned_closer_id
// is their own profile id, so the "Assigned to" filter is inert for them (it is
// still rendered, disabled and showing their own name — the honest statement that
// this book is scoped, not that scope is a thing they were denied). An
// admin/super_admin gets the live version of that filter (Anyone / each closer /
// Unassigned), which re-runs the query. Both roles see the "Assigned to" COLUMN.
// This is a UI scope, NOT a security boundary — the
// boundary is RLS (closer_select_all_deals lets any staff READ deals; INSERT and
// UPDATE stay own-book). Notes are the tighter one: activity_log was deliberately
// NOT widened for closers, so a setter reads notes on their own book only, which
// is exactly the book this tab shows them.
//
// NOTHING HERE IS A NEW FLOW. Every action is the flow that already exists
// somewhere else, moved to the row so the setter never has to go find it:
//   • Open           → /admin/playbooks?deal=… (the Revenue Playbook itself)
//   • Book appointment → BookAppointmentControl (scheduleAppointment + GHL invite)
//   • Application    → MerchantApplicationModal (fill it in, send it to e-sign)
//   • Notes          → addDealNote() into activity_log, the same rows the
//                      playbook's Notes button reads and writes.
//
// HONESTY. A failed read leaves `rows` NULL and renders an error — never an empty
// table, which would read as "you have no merchants" and is the exact lie that
// makes a setter stop working their book. The row cap is reported when hit, and
// while it is hit the client-side sort is stated to be a sort of the loaded page,
// not of everything.
//
// Times are EASTERN everywhere (the floor's clock), relative on screen with the
// exact ET stamp on hover.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ChatBubbleLeftEllipsisIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import {
  addDealNote,
  getDealById,
  isHumanNoteSubject,
  listActiveCloserOptions,
} from "@/services/dealService";
import { DEAL_STAGES, DEAL_STATUS_CONFIG, type DealStatus, type DealWithCustomer } from "@/types/deals";
import { dateTimeET } from "@/utils/time";
import BookAppointmentControl from "./BookAppointmentControl";
import MerchantApplicationModal from "./MerchantApplicationModal";

// ── Contract ─────────────────────────────────────────────────────────────────
// One unbroken string literal on purpose: the client is untyped, so supabase-js
// infers the row shape by parsing this literal. Splitting it across a `+`
// concatenation defeats that parse and the result degrades to GenericStringError.
const ASSIGN_COLS =
  "id,deal_number,customer_id,lead_source,status,previous_status,assigned_closer_id,created_at,contacted_at,spoke_at,appointment_at,appointment_promised_at,appointment_synced_at,appointment_sync_error,ghl_contact_id,amount_requested,customer:customers!customer_id(id,business_name,first_name,last_name,phone,email)";

/** Bounded like every other read on this page. Hitting it is REPORTED. */
const ASSIGN_CAP = 1000;

interface AssignCustomer {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

interface AssignRow {
  id: string;
  deal_number: string | null;
  customer_id: string;
  lead_source: string | null;
  status: string | null;
  previous_status: string | null;
  assigned_closer_id: string | null;
  created_at: string | null;
  contacted_at: string | null;
  spoke_at: string | null;
  appointment_at: string | null;
  appointment_promised_at: string | null;
  appointment_synced_at: string | null;
  appointment_sync_error: string | null;
  ghl_contact_id: string | null;
  amount_requested: number | null;
  customer: AssignCustomer | null;
}

const UNASSIGNED = "__unassigned__";

type SortKey = "merchant" | "source" | "stage" | "assignee" | "assigned" | "last_contact";
type ApptFilter = "all" | "booked" | "promised" | "none";
type SourceFilter = "all" | "live_transfer" | "realtime_appt" | "other";

// ── Small local formatters ───────────────────────────────────────────────────
function merchantName(r: AssignRow): string {
  const c = r.customer;
  // `||`, not `??`: an empty business_name is falsy but not nullish, and a blank
  // heading on a worklist row is worse than falling through to the person's name.
  return (
    c?.business_name?.trim()
    || [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim()
    || "Unnamed merchant"
  );
}

/** Who owns the row, as text. Three honest states and no fourth: a real name, the
 *  explicit fact that nobody owns it, or — when staff_directory cannot name the id
 *  — the id fragment itself. A blank cell here reads as "data missing" and would
 *  be the one thing this column must never say. */
function assigneeLabel(r: AssignRow, names: Record<string, string>): string {
  if (!r.assigned_closer_id) return "Unassigned";
  return names[r.assigned_closer_id] ?? r.assigned_closer_id.slice(0, 8);
}

function contactLine(r: AssignRow): string {
  const bits = [prettyPhone(r.customer?.phone ?? null), r.customer?.email ?? null].filter(Boolean);
  return bits.join(" · ");
}

function prettyPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return p;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function sinceText(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** The last time a human actually touched the merchant. spoke_at is the stronger
 *  fact (a conversation happened) but contacted_at can be later, so take the max
 *  rather than preferring one — either one alone would under-report. */
function lastContactAt(r: AssignRow): string | null {
  const t = [r.contacted_at, r.spoke_at]
    .filter((v): v is string => !!v)
    .map((v) => Date.parse(v))
    .filter((n) => !Number.isNaN(n));
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

const LADDER_ORDER = new Map<string, number>(DEAL_STAGES.map((s, i) => [s.key as string, i]));

function stageLabel(status: string | null): string {
  if (!status) return "—";
  return DEAL_STATUS_CONFIG[status as DealStatus]?.label ?? status;
}

function sourceLabel(src: string | null): string {
  if (src === "live_transfer") return "Live transfer";
  if (src === "realtime_appt") return "Real-time";
  return src ?? "—";
}

function sourceChipCls(src: string | null): string {
  if (src === "live_transfer") return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300";
  if (src === "realtime_appt") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
}

/** The bucket the Source filter uses. Anything that is not one of the two Synergy
 *  products is "other" — including a null lead_source, which is a real state
 *  (hand-created deal) and must stay reachable rather than vanishing. */
function sourceBucket(src: string | null): SourceFilter {
  if (src === "live_transfer") return "live_transfer";
  if (src === "realtime_appt") return "realtime_appt";
  return "other";
}

// ═════════════════════════════════════════════════════════════════════════════

export default function AssignmentsPanel({
  viewerId,
  canSeeAll,
}: {
  /** The signed-in app user (profiles.id). A closer's whole scope. */
  viewerId: string | null;
  /** admin / super_admin — gets the closer picker and the Closer column. */
  canSeeAll: boolean;
}) {
  const [rows, setRows] = useState<AssignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  // Admin-only scope picker. A closer never reads this — their scope is forced
  // to their own id in the query below.
  const [closerFilter, setCloserFilter] = useState<string>("all");

  const [filterSource, setFilterSource] = useState<SourceFilter>("all");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterAppt, setFilterAppt] = useState<ApptFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "assigned", desc: true });

  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [appDeal, setAppDeal] = useState<DealWithCustomer | null>(null);
  const [appLoadingId, setAppLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 6000);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  // Deliberately NOT filtered by the page's date range. Every other tab on this
  // page is a time-window report; this one is a BOOK. A merchant assigned three
  // months ago and never worked is precisely the row a setter needs to see, and a
  // range filter would be the thing that hides it.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!canSeeAll && !viewerId) {
        throw new Error(
          "Your user id could not be read, so your assignments cannot be scoped to you. Reload the page or sign in again.",
        );
      }

      let q = supabase.from("deals").select(ASSIGN_COLS);
      if (!canSeeAll) {
        q = q.eq("assigned_closer_id", viewerId!);
      } else if (closerFilter === UNASSIGNED) {
        q = q.is("assigned_closer_id", null);
      } else if (closerFilter !== "all") {
        q = q.eq("assigned_closer_id", closerFilter);
      }

      const { data, error: qErr } = await q
        .order("created_at", { ascending: false })
        .limit(ASSIGN_CAP);
      if (qErr) throw new Error(qErr.message);

      const list = (data ?? []) as unknown as AssignRow[];
      setRows(list);
      setTruncated(list.length >= ASSIGN_CAP);

      // Names via staff_directory — NOT profiles, whose RLS hands a closer only
      // their own row. A user the directory cannot name keeps an id fragment
      // rather than an invented name.
      const ids = [...new Set(list.map((r) => r.assigned_closer_id).filter((v): v is string => !!v))];
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("staff_directory").select("id,name").in("id", ids);
        const map: Record<string, string> = {};
        for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
          if (p.name) map[p.id] = p.name;
        }
        // MERGED, not replaced: narrowing the scope to one closer must not make
        // the other names we already resolved disappear out of the picker.
        setNames((prev) => ({ ...prev, ...map }));
      }
    } catch (e) {
      // null, not [] — a failed read means the book is UNKNOWN, never empty.
      setRows(null);
      setError(e instanceof Error ? e.message : "Failed to read your assignments");
    }
    setLoading(false);
  }, [canSeeAll, viewerId, closerFilter]);

  useEffect(() => { void load(); }, [load]);

  // The picker offers the ACTIVE CLOSERS (the same roster the deal reassign
  // control uses), UNION anyone actually holding assignments in what we've
  // loaded. The union matters: a deal still assigned to a deactivated closer
  // would otherwise be unreachable through the picker even though the row exists.
  const [activeClosers, setActiveClosers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!canSeeAll) return;
    let cancelled = false;
    void (async () => {
      try {
        const opts = await listActiveCloserOptions();
        if (!cancelled) setActiveClosers(opts.map((o) => ({ id: o.profileId, name: o.name })));
      } catch {
        // A roster we can't read just means the picker falls back to whoever
        // appears in the loaded rows — never a reason to blank the tab.
        if (!cancelled) setActiveClosers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [canSeeAll]);

  const closerOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of activeClosers) byId.set(c.id, c.name);
    for (const [id, name] of Object.entries(names)) if (!byId.has(id)) byId.set(id, name);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeClosers, names]);

  // ── Filter options, built from what is actually loaded ─────────────────────
  const stageOptions = useMemo(() => {
    const present = [...new Set((rows ?? []).map((r) => r.status).filter((v): v is string => !!v))];
    return present.sort(
      (a, b) => (LADDER_ORDER.get(a) ?? 900) - (LADDER_ORDER.get(b) ?? 900) || a.localeCompare(b),
    );
  }, [rows]);

  // The assignee filter counts as a filter like any other — it is the one that
  // narrows the QUERY rather than the loaded page, so leaving it out of the count
  // would let "Clear (0)" sit next to a table that is still scoped to one closer.
  const filterCount =
    (canSeeAll && closerFilter !== "all" ? 1 : 0) +
    (filterSource !== "all" ? 1 : 0) +
    (filterStage !== "all" ? 1 : 0) +
    (filterAppt !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const clearFilters = () => {
    if (canSeeAll) setCloserFilter("all");
    setFilterSource("all");
    setFilterStage("all");
    setFilterAppt("all");
    setSearch("");
  };

  // ── Filter + sort (client-side, over the loaded page) ──────────────────────
  const visible = useMemo(() => {
    if (!rows) return [];
    const term = search.trim().toLowerCase();
    const termDigits = term.replace(/\D/g, "");

    const filtered = rows.filter((r) => {
      if (filterSource !== "all" && sourceBucket(r.lead_source) !== filterSource) return false;
      if (filterStage !== "all" && r.status !== filterStage) return false;
      if (filterAppt === "booked" && !r.appointment_at) return false;
      if (filterAppt === "promised" && (r.appointment_at || !r.appointment_promised_at)) return false;
      if (filterAppt === "none" && (r.appointment_at || r.appointment_promised_at)) return false;
      if (term) {
        const hay = [
          merchantName(r),
          r.customer?.business_name,
          r.customer?.first_name,
          r.customer?.last_name,
          r.customer?.email,
          r.deal_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const phoneDigits = (r.customer?.phone ?? "").replace(/\D/g, "");
        const phoneHit = termDigits.length >= 3 && phoneDigits.includes(termDigits);
        if (!hay.includes(term) && !phoneHit) return false;
      }
      return true;
    });

    const dir = sort.desc ? -1 : 1;
    const ts = (v: string | null) => (v ? Date.parse(v) || 0 : 0);
    const cmp = (a: AssignRow, b: AssignRow): number => {
      switch (sort.key) {
        case "merchant":
          return merchantName(a).localeCompare(merchantName(b));
        case "source":
          return sourceLabel(a.lead_source).localeCompare(sourceLabel(b.lead_source));
        case "stage":
          return (
            (LADDER_ORDER.get(a.status ?? "") ?? 900) - (LADDER_ORDER.get(b.status ?? "") ?? 900)
            || stageLabel(a.status).localeCompare(stageLabel(b.status))
          );
        case "assignee":
          return assigneeLabel(a, names).localeCompare(assigneeLabel(b, names));
        case "last_contact":
          return ts(lastContactAt(a)) - ts(lastContactAt(b));
        case "assigned":
        default:
          return ts(a.created_at) - ts(b.created_at);
      }
    };
    return [...filtered].sort((a, b) => cmp(a, b) * dir);
  }, [rows, filterSource, filterStage, filterAppt, search, sort, names]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === "assigned" }));

  const openApplication = async (dealId: string) => {
    setAppLoadingId(dealId);
    try {
      const res = await getDealById(dealId);
      if (!res) throw new Error("That deal could not be re-read — it may have been reassigned or removed.");
      setAppDeal(res.deal);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't open the application.", "error");
    } finally {
      setAppLoadingId(null);
    }
  };

  // Merchant · Source · Stage · Assigned to · Assigned · Last contact · Appointment · Actions
  const colCount = 8;

  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm">
      <div className="card-body p-4 space-y-3">
        {/* ── Header + scope ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <ClipboardDocumentListIcon className="w-5 h-5 text-mint-green" />
              Assignments
              {rows && (
                <span className="text-sm font-normal text-gray-400">
                  ({visible.length.toLocaleString()}
                  {visible.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ""})
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-3xl">
              {canSeeAll ? (
                <>
                  Every merchant on the book, by whoever it is assigned to. <b>Not filtered by the date
                  range above</b> — this is a book, not a window, so a merchant assigned months ago and never
                  worked still shows.
                </>
              ) : (
                <>
                  <b>Every merchant assigned to you</b>, in one place. <b>Not filtered by the date range
                  above</b> — nothing on your book is hidden by a window. Work a row without leaving it:
                  book the appointment, fill and send the application, leave a note.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-xs btn-ghost gap-1"
              onClick={() => void load()}
              disabled={loading}
            >
              <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {/* ── Filters (same shape as the Call log's bar) ───────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search merchant or phone"
            className="input input-xs input-bordered w-52"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            title="Matches business name, contact name, email, deal number, or phone digits"
          />
          {/* Assigned to. The ONE control that narrows by owner, and the only one
              on this bar that re-runs the QUERY rather than filtering the loaded
              page — which is the point: with a 1,000-row cap, picking a closer is
              how you actually reach the rest of their book. */}
          {canSeeAll ? (
            <select
              className="select select-xs select-bordered"
              value={closerFilter}
              onChange={(e) => setCloserFilter(e.target.value)}
              title="Narrow the book to one owner. This re-reads the deals for that person — it is a view scope, not a permission; RLS is what actually governs the rows."
            >
              <option value="all">Anyone assigned</option>
              <option value={UNASSIGNED}>Unassigned</option>
              {closerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <select
              className="select select-xs select-bordered"
              value="me"
              disabled
              title="This tab is already scoped to you, so there is no one else to filter to."
              onChange={() => {}}
            >
              <option value="me">
                {(viewerId && names[viewerId]) || "Assigned to you"}
              </option>
            </select>
          )}
          <select
            className="select select-xs select-bordered"
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as SourceFilter)}
          >
            <option value="all">Any source</option>
            <option value="live_transfer">Live transfer</option>
            <option value="realtime_appt">Real-time</option>
            <option value="other">Other / none</option>
          </select>
          <select
            className="select select-xs select-bordered"
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            title="The stages actually present on the loaded rows"
          >
            <option value="all">Any stage</option>
            {stageOptions.map((s) => (
              <option key={s} value={s}>{stageLabel(s)}</option>
            ))}
          </select>
          <select
            className="select select-xs select-bordered"
            value={filterAppt}
            onChange={(e) => setFilterAppt(e.target.value as ApptFilter)}
            title="Promised = the setter said an appointment was set but no time is on the calendar yet"
          >
            <option value="all">Any appointment</option>
            <option value="booked">Booked</option>
            <option value="promised">Promised — needs a time</option>
            <option value="none">No appointment</option>
          </select>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            disabled={filterCount === 0}
            onClick={clearFilters}
          >
            Clear{filterCount > 0 ? ` (${filterCount})` : ""}
          </button>
        </div>

        {truncated && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            ⚠ <b>Showing the {ASSIGN_CAP.toLocaleString()} most recent only</b> — the book is larger than
            that. Filters and sorting apply to what is loaded here, not to everything. Narrow the scope
            (pick a closer) to see the rest.
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        {error ? (
          <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
            <span>
              <b>Assignments could not be read</b> — this is not an empty book, it is an unknown one.
              <br />
              <span className="text-xs font-mono opacity-80">{error}</span>
            </span>
          </div>
        ) : loading && !rows ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-6">
            <span className="loading loading-spinner loading-sm" /> Loading assignments…
          </div>
        ) : rows && rows.length === 0 ? (
          <div className="py-10 text-center">
            <ClipboardDocumentListIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              {canSeeAll && closerFilter === UNASSIGNED
                ? "Nothing is sitting unassigned."
                : canSeeAll && closerFilter !== "all"
                  ? "Nothing is assigned to that closer yet."
                  : "No merchants are assigned to you yet."}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              {canSeeAll
                ? "This read succeeded — the book really is empty for this scope."
                : "This read succeeded, so this is a real empty book, not a loading problem. New live-transfer and real-time leads land here the moment they are assigned to you."}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              No merchant matches these filters.
            </p>
            <button type="button" className="btn btn-xs btn-ghost mt-2" onClick={clearFilters}>
              Clear the filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="text-xs">
                  <Th label="Merchant" active={sort.key === "merchant"} desc={sort.desc} onClick={() => toggleSort("merchant")} />
                  <Th label="Source" active={sort.key === "source"} desc={sort.desc} onClick={() => toggleSort("source")} />
                  <Th label="Stage" active={sort.key === "stage"} desc={sort.desc} onClick={() => toggleSort("stage")} />
                  <Th label="Assigned to" active={sort.key === "assignee"} desc={sort.desc} onClick={() => toggleSort("assignee")} />
                  <Th label="Assigned" active={sort.key === "assigned"} desc={sort.desc} onClick={() => toggleSort("assigned")} />
                  <Th label="Last contact" active={sort.key === "last_contact"} desc={sort.desc} onClick={() => toggleSort("last_contact")} />
                  <th className="text-xs font-semibold text-gray-500 dark:text-gray-400">Appointment</th>
                  <th className="text-xs font-semibold text-gray-500 dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const lc = lastContactAt(r);
                  const parked = !LADDER_ORDER.has(r.status ?? "") && !!r.previous_status;
                  const cfg = DEAL_STATUS_CONFIG[r.status as DealStatus];
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover">
                        {/* Merchant */}
                        <td className="align-top">
                          <div className="font-semibold text-gray-900 dark:text-white">{merchantName(r)}</div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400">
                            {contactLine(r) || <span className="opacity-60">no phone or email on file</span>}
                          </div>
                          {r.deal_number && (
                            <div className="text-[10px] font-mono text-gray-400">#{r.deal_number}</div>
                          )}
                        </td>

                        {/* Source */}
                        <td className="align-top">
                          <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${sourceChipCls(r.lead_source)}`}>
                            {sourceLabel(r.lead_source)}
                          </span>
                        </td>

                        {/* Stage */}
                        <td className="align-top">
                          <span
                            className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              cfg ? `${cfg.bgColor} ${cfg.color}` : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                            }`}
                          >
                            {stageLabel(r.status)}
                          </span>
                          {parked && (
                            <div
                              className="text-[10px] text-gray-400 mt-0.5"
                              title="Parked off the ladder — this is the last active stage it held"
                            >
                              was {stageLabel(r.previous_status)}
                            </div>
                          )}
                        </td>

                        {/* Assigned to — shown to everyone. A setter only ever sees
                            their own name here, which is not noise: it is the
                            visible proof the row is theirs. */}
                        <td className="align-top text-xs text-gray-600 dark:text-gray-300">
                          {r.assigned_closer_id ? (
                            names[r.assigned_closer_id] ?? (
                              <span
                                className="font-mono opacity-70"
                                title="staff_directory could not name this user id — shown as an id fragment rather than an invented name"
                              >
                                {r.assigned_closer_id.slice(0, 8)}
                              </span>
                            )
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">Unassigned</span>
                          )}
                        </td>

                        {/* Assigned / created */}
                        <td
                          className="align-top text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap"
                          title={r.created_at ? `${dateTimeET(r.created_at)} ET` : "No created_at on this deal"}
                        >
                          {sinceText(r.created_at)}
                        </td>

                        {/* Last contact */}
                        <td
                          className="align-top text-xs whitespace-nowrap"
                          title={lc ? `${dateTimeET(lc)} ET` : "No contact attempt has ever been stamped on this deal"}
                        >
                          {lc ? (
                            <span className="text-gray-600 dark:text-gray-300">{sinceText(lc)}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">never</span>
                          )}
                        </td>

                        {/* Appointment */}
                        <td className="align-top">
                          {r.appointment_at ? (
                            <span
                              className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 whitespace-nowrap"
                              title={`${dateTimeET(r.appointment_at)} ET`}
                            >
                              📅 {dateTimeET(r.appointment_at)}
                            </span>
                          ) : r.appointment_promised_at ? (
                            <span
                              className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 whitespace-nowrap"
                              title={`An appointment was promised ${dateTimeET(r.appointment_promised_at)} ET but no time is booked. Book it from this row.`}
                            >
                              ⚠ promised
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="align-top">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Link
                              to={`/admin/playbooks?deal=${r.id}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-ocean-blue/60 px-2 py-0.5 text-[11px] font-semibold text-ocean-blue hover:bg-ocean-blue/10"
                              title="Open this merchant's Revenue Playbook"
                            >
                              Open <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                            </Link>

                            <BookAppointmentControl
                              dealId={r.id}
                              appointmentAt={r.appointment_at}
                              appointmentSyncedAt={r.appointment_synced_at}
                              appointmentSyncError={r.appointment_sync_error}
                              // The appointment belongs to whoever owns the merchant —
                              // an admin booking on a setter's behalf must not steal it.
                              ownerUserId={r.assigned_closer_id ?? viewerId}
                              onRefresh={() => void load()}
                              onNotify={notify}
                            />

                            <button
                              type="button"
                              onClick={() => void openApplication(r.id)}
                              disabled={appLoadingId === r.id}
                              title="Fill the application in-app, then email it to the merchant to e-sign"
                              className="inline-flex items-center gap-1 rounded-lg border border-mint-green/60 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                            >
                              {appLoadingId === r.id ? "Opening…" : "📄 Application"}
                            </button>

                            <button
                              type="button"
                              onClick={() => setOpenNotes((cur) => (cur === r.id ? null : r.id))}
                              title="Add a note and read this merchant's note history"
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${
                                openNotes === r.id
                                  ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                                  : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
                              }`}
                            >
                              <ChatBubbleLeftEllipsisIcon className="w-3.5 h-3.5" /> Notes
                            </button>
                          </div>
                        </td>
                      </tr>

                      {openNotes === r.id && (
                        <tr>
                          <td colSpan={colCount} className="bg-base-200/60 dark:bg-gray-800/40">
                            <NotesDrawer
                              dealId={r.id}
                              customerId={r.customer_id}
                              merchant={merchantName(r)}
                              onNotify={notify}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fill the application in-app and send it to e-sign — the SAME modal the
          playbook's green card opens, not a second implementation of it. */}
      {appDeal && (
        <MerchantApplicationModal
          deal={appDeal}
          onClose={() => setAppDeal(null)}
          onSent={() => { setAppDeal(null); void load(); }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg px-4 py-3 text-sm text-white shadow-xl ${
            toast.tone === "error" ? "bg-red-600" : "bg-gray-900 dark:bg-gray-700"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

/** A sortable header cell. The arrow states the direction rather than leaving the
 *  user to infer it from the data. */
function Th({
  label,
  active,
  desc,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
}) {
  return (
    <th className="text-xs font-semibold text-gray-500 dark:text-gray-400">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-ocean-blue ${active ? "text-ocean-blue" : ""}`}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className={active ? "" : "opacity-25"}>{active && !desc ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// NOTES
// ═════════════════════════════════════════════════════════════════════════════
// The same rows the playbook's Notes button reads and writes: activity_log,
// entity_type='customer', entity_id = the DEAL's customer_id. Written through
// addDealNote(), which stamps logged_by and mirrors the note into GHL — so a note
// left here shows up on the contact in VibeReach like every other note.
//
// Author names come from staff_directory, NOT the profiles:logged_by embed the
// older surfaces use: profiles RLS hands a closer only their own row, so that
// embed renders every teammate's note as "Unknown".
//
// Machine rows (stage changes, funder correspondence markers) are filtered out by
// isHumanNoteSubject — this is a note history, not an audit trail.

interface NoteRow {
  id: string;
  subject: string | null;
  content: string | null;
  interaction_type: string | null;
  created_at: string;
  logged_by: string | null;
}

function NotesDrawer({
  dealId,
  customerId,
  merchant,
  onNotify,
}: {
  dealId: string;
  customerId: string;
  merchant: string;
  onNotify: (text: string, tone?: "ok" | "error") => void;
}) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id,subject,content,interaction_type,created_at,logged_by")
        .eq("entity_type", "customer")
        .eq("entity_id", customerId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);

      const human = ((data ?? []) as NoteRow[]).filter((r) => isHumanNoteSubject(r.subject));
      setNotes(human);

      const ids = [...new Set(human.map((n) => n.logged_by).filter((v): v is string => !!v))];
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("staff_directory").select("id,name").in("id", ids);
        const map: Record<string, string> = {};
        for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
          if (p.name) map[p.id] = p.name;
        }
        setAuthors(map);
      }
    } catch (e) {
      // null, not [] — "couldn't read the notes" must never render as "no notes".
      setNotes(null);
      setErr(e instanceof Error ? e.message : "Failed to read notes");
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await addDealNote({ dealId, customerId, content });
      setDraft("");
      await load();
      // The note is SAVED either way — a GHL mirror failure is a whisper about
      // where it did NOT land, never a claim that the note was lost.
      if (res.noContact) onNotify("Note saved. Not mirrored to GHL — this merchant has no GHL contact.");
      else if (!res.synced) onNotify(`Note saved. GHL mirror failed: ${res.syncError ?? "unknown error"}`, "error");
      else onNotify("Note saved and mirrored to the GHL contact.");
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Couldn't save the note.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
        Notes — {merchant}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <textarea
          className="textarea textarea-bordered textarea-sm flex-1 min-w-[16rem] text-sm"
          rows={2}
          placeholder="What happened on this call? (saved with your name and the time, and mirrored to GHL)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm bg-ocean-blue text-white hover:bg-ocean-blue/90 border-0 disabled:opacity-50"
          disabled={saving || !draft.trim()}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Add the note"}
        </button>
      </div>

      {err ? (
        <p className="text-xs text-red-600 dark:text-red-400">
          <b>Notes could not be read</b> — this is not "no notes". <span className="font-mono opacity-80">{err}</span>
        </p>
      ) : notes === null ? (
        <p className="text-xs text-gray-400">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No notes on this merchant yet. The read succeeded — this is a real empty history.
        </p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                  {n.logged_by
                    ? authors[n.logged_by] ?? (
                        <span className="font-mono opacity-70" title="staff_directory could not name this user id">
                          {n.logged_by.slice(0, 8)}
                        </span>
                      )
                    : <span className="opacity-70">no author recorded</span>}
                </span>
                <span className="text-[10px] text-gray-400" title={`${dateTimeET(n.created_at)} ET`}>
                  {dateTimeET(n.created_at)} ET · {sinceText(n.created_at)}
                </span>
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">{n.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
