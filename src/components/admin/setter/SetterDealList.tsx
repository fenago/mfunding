import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  BuildingStorefrontIcon,
  BoltIcon,
  MoonIcon,
  PencilSquareIcon,
  PhoneIcon,
  StarIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { useUserProfile } from "@/context/UserProfileContext";
import QuickAppModal from "@/components/admin/processor/QuickAppModal";
import SchedulePicker from "@/components/admin/processor/SchedulePicker";
import { addDealNote, updateDealStatus } from "@/services/dealService";
import { applicationCompleteness } from "@/lib/applicationCompleteness";
import type { DealWithCustomer } from "@/types/deals";
import type { PlaybookLookup } from "@/hooks/usePlaybookContact";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import { sourceLabel, sourceMeta, SOURCE_TONE_CLASS } from "@/lib/sourceLabel";
import { dateTimeET, etWallClockToUtcIso } from "@/utils/time";

/**
 * SetterDealList — the setter's own book, rendered under the search box as the
 * DEFAULT idle view of the Operations console. Before this, a setter opening
 * Operations saw only a blank search; now the deals assigned to them are right
 * there, one click from the console.
 *
 * SCOPE — this is MY book. The query filters deals to
 *   assigned_closer_id = <the signed-in user's profile id>
 * (effectiveUserId, so a super_admin "viewing as" a setter sees THAT setter's
 * book). This is an explicit filter, NOT a reliance on RLS: the closer_select_all
 * policy lets any staff READ every deal, so without this eq() a setter would see
 * the whole company's pipeline. It mirrors AssignmentsPanel's own-book query.
 *
 * A row → onOpen({ dealId }) → usePlaybookContact.openMerchant loads the console,
 * exactly like the search box and a deep link.
 *
 * HONESTY (readers-must-distinguish-unreadable): a failed read renders a RED
 * error, never an empty list — "couldn't load your deals" ≠ "you have no deals".
 * The three states are distinct: loading spinner, real empty (read succeeded), and
 * error. The cap is stated when hit so the list never silently claims to be whole.
 */

const DEAL_CAP = 50;

// One unbroken literal — supabase-js infers the row shape by parsing it, so a
// split string degrades the type to GenericStringError.
const DEAL_COLS =
  "id,deal_number,status,previous_status,lead_source,updated_at,created_at,contacted_at,spoke_at,last_attempt_at,callback_at,callback_source,appointment_at,appointment_promised_at,stips_promised_by,amount_requested,use_of_funds,customer_id,customer:customers!customer_id(business_name,first_name,last_name,phone,email,monthly_revenue,industry)";

interface DealCustomer {
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  monthly_revenue: number | null;
  industry: string | null;
}

interface DealRow {
  id: string;
  deal_number: string | null;
  status: string | null;
  previous_status: string | null;
  lead_source: string | null;
  updated_at: string | null;
  created_at: string | null;
  contacted_at: string | null;
  spoke_at: string | null;
  last_attempt_at: string | null;
  callback_at: string | null;
  callback_source: string | null;
  appointment_at: string | null;
  appointment_promised_at: string | null;
  stips_promised_by: string | null;
  amount_requested: number | null;
  use_of_funds: string | null;
  customer_id: string | null;
  customer: DealCustomer | null;
}

/** Days since the SETTER'S FIRST TOUCH (earliest contact stamp). null = never
 *  touched — the two-week clock hasn't started. */
function daysSinceFirstTouch(r: DealRow): number | null {
  const stamps = [r.contacted_at, r.spoke_at]
    .filter((v): v is string => !!v)
    .map((v) => Date.parse(v))
    .filter((n) => Number.isFinite(n));
  if (stamps.length === 0) return null;
  return Math.floor((Date.now() - Math.min(...stamps)) / 86_400_000);
}

const STALE_DAYS = 14;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: DealRow[]; total: number };

function merchantName(r: DealRow): string {
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
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
}

function stageLabel(status: string | null): string {
  if (!status) return "—";
  return DEAL_STATUS_CONFIG[status as DealStatus]?.label ?? status;
}

function stageChipCls(status: string | null): string {
  const cfg = DEAL_STATUS_CONFIG[status as DealStatus];
  return cfg
    ? `${cfg.bgColor} ${cfg.color}`
    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";
}

/** Relative "how long ago", with the exact ET stamp handed to the caller for a title. */
function sinceText(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** When was this deal last actually touched — the newest of update/contact/spoke. */
function lastActiveAt(r: DealRow): string | null {
  const t = [r.updated_at, r.contacted_at, r.spoke_at, r.last_attempt_at]
    .filter((v): v is string => !!v)
    .map((v) => Date.parse(v))
    .filter((n) => !Number.isNaN(n));
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

/** The one next-step worth surfacing on a row, if it's readily on the deal. Booked
 *  appointment wins, then a scheduled callback, then a promised-but-unbooked appt,
 *  then a statements commitment. Returns null when there's nothing concrete. */
function nextStep(
  r: DealRow,
): { label: string; tone: string; title: string } | null {
  if (r.appointment_at) {
    return {
      label: `📅 Appt ${dateTimeET(r.appointment_at)}`,
      tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
      title: `Appointment booked ${dateTimeET(r.appointment_at)} ET`,
    };
  }
  if (r.callback_at) {
    const stated = r.callback_source === "merchant_stated";
    return {
      label: `🕐 ${stated ? "Their window" : "Callback"} ${dateTimeET(r.callback_at)}`,
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
      title: stated
        ? `The merchant's stated best time — ${dateTimeET(r.callback_at)} ET`
        : `You promised to call at ${dateTimeET(r.callback_at)} ET`,
    };
  }
  if (r.appointment_promised_at) {
    return {
      label: "⚠ Appt promised — needs a time",
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
      title: "An appointment was promised but no time is booked yet — book it in the console.",
    };
  }
  if (r.stips_promised_by) {
    return {
      label: `📎 Statements ${r.stips_promised_by.slice(0, 10)}`,
      tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
      title: `The merchant committed to sending bank statements by ${r.stips_promised_by.slice(0, 10)}`,
    };
  }
  return null;
}

/**
 * QUEUE FILTERS — the setter narrows their own book without leaving Operations.
 * Every filter is applied IN the Supabase query (not client-side), so the
 * {count:'exact'} banner and the DEAL_CAP truncation stay truthful about the
 * whole matching set, not just what came back.
 */
type QueueFilter =
  | { kind: "all" }
  | { kind: "callbacks" } // callback_at within today, ET
  | { kind: "never" } // never contacted (no contacted_at / no spoke_at / 0 attempts)
  | { kind: "stage"; stage: DealStatus };

/** Today's ET midnight → tomorrow's ET midnight as UTC ISO bounds. Uses the app's
 *  Eastern wall-clock converter so a setter in ANY browser timezone sees the same
 *  "today" the callbacks were booked against. */
function etTodayBoundsUtc(): { start: string; end: string } {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())) {
    p[part.type] = part.value;
  }
  const y = +p.year,
    m = +p.month,
    d = +p.day;
  return { start: etWallClockToUtcIso(y, m, d, 0, 0), end: etWallClockToUtcIso(y, m, d + 1, 0, 0) };
}

/** Empty-state copy per filter. The second line always reasserts the read
 *  succeeded, so an empty queue is never mistaken for an unreadable book. */
function emptyCopy(f: QueueFilter): { title: string; body: string } {
  switch (f.kind) {
    case "callbacks":
      return {
        title: "No callbacks due today.",
        body: "This read succeeded — none of your deals have a callback scheduled for today (ET).",
      };
    case "never":
      return {
        title: "No never-contacted deals.",
        body: "This read succeeded — every deal in your book has at least one logged touch.",
      };
    case "stage":
      return {
        title: `No deals in "${stageLabel(f.stage)}" right now.`,
        body: "This read succeeded — nothing of yours sits in that stage. Try another filter.",
      };
    default:
      return {
        title: "No deals assigned to you yet — search above to pull one up.",
        body: "This read succeeded, so this is a real empty book. New leads land here the moment they're assigned to you.",
      };
  }
}

// The stages offered in the "By stage" dropdown, in pipeline order — the existing
// DEAL_STATUS_CONFIG is the single source of truth for labels.
const STAGE_OPTIONS = (Object.keys(DEAL_STATUS_CONFIG) as DealStatus[]).map((s) => ({
  value: s,
  label: DEAL_STATUS_CONFIG[s].label,
}));

export default function SetterDealList({
  onOpen,
}: {
  onOpen: (lookup: PlaybookLookup) => void;
}) {
  const { effectiveUserId } = useUserProfile();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState<QueueFilter>({ kind: "all" });
  const [quickAppDealId, setQuickAppDealId] = useState<string | null>(null);
  // Customer ids whose application has been signed (from ghl_doc_completions).
  const [signedCustomers, setSignedCustomers] = useState<Set<string>>(new Set());
  // Documents on file per customer: total + bank-statement count.
  const [docCounts, setDocCounts] = useState<Map<string, { total: number; statements: number }>>(new Map());
  // Per-deal application completeness (pct + fields left) — the exit rule: a deal
  // leaves the working list at 100% (or Nurture).
  const [appPct, setAppPct] = useState<Map<string, { pct: number; left: number }>>(new Map());
  // ★ the signed-in setter's working set (their own processor_working claims).
  const [workingSet, setWorkingSet] = useState<Set<string>>(new Set());
  const [workingOnly, setWorkingOnly] = useState(false);
  // Row-action state: star busy, armed nurture, notes editor, errors.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [nurtureArmed, setNurtureArmed] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    // No signed-in id → we can't scope the book to a person, and an unscoped read
    // would show the whole company. Say so, don't silently show everything.
    if (!effectiveUserId) {
      setState({
        kind: "error",
        message:
          "Your user id could not be read, so your book can't be scoped to you. Reload the page or sign in again.",
      });
      return;
    }
    try {
      let query = supabase
        .from("deals")
        .select(DEAL_COLS, { count: "exact" })
        .eq("assigned_closer_id", effectiveUserId);

      // Filters applied in-query so {count:'exact'} + the cap stay truthful.
      if (filter.kind === "callbacks") {
        const { start, end } = etTodayBoundsUtc();
        query = query.not("callback_at", "is", null).gte("callback_at", start).lt("callback_at", end);
      } else if (filter.kind === "never") {
        query = query
          .is("contacted_at", null)
          .is("spoke_at", null)
          .or("contact_attempts.is.null,contact_attempts.eq.0");
      } else if (filter.kind === "stage") {
        query = query.eq("status", filter.stage);
      }
      // Parked deals (nurture / declined / dead) are NOISE on the working board
      // (owner rule 9/1) — hidden from every view except an explicit stage pick,
      // which is still how you reach them when you want them.
      if (filter.kind !== "stage") {
        query = query.not("status", "in", "(nurture,declined,dead)");
      }

      // Callbacks are most useful soonest-first; every other view is newest-touch first.
      query =
        filter.kind === "callbacks"
          ? query.order("callback_at", { ascending: true, nullsFirst: false })
          : query.order("updated_at", { ascending: false, nullsFirst: false });

      const { data, error, count } = await query.limit(DEAL_CAP);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as DealRow[];
      setState({ kind: "ready", rows, total: count ?? rows.length });
      // Which of these merchants have a SIGNED application? One extra query against
      // the completion ledger (no GHL call) → a ✍️ Signed badge on the row.
      const custIds = Array.from(new Set(rows.map((r) => r.customer_id).filter(Boolean))) as string[];
      if (custIds.length > 0) {
        const [{ data: comps }, { data: docs }] = await Promise.all([
          supabase.from("ghl_doc_completions").select("customer_id, doc_name").in("customer_id", custIds),
          supabase.from("customer_documents").select("customer_id, document_type").in("customer_id", custIds),
        ]);
        const signed = new Set<string>();
        for (const c of (comps ?? []) as { customer_id: string; doc_name: string | null }[]) {
          if (c.customer_id && /application|prefill|partial/i.test(c.doc_name ?? "")) signed.add(c.customer_id);
        }
        setSignedCustomers(signed);
        const dc = new Map<string, { total: number; statements: number }>();
        for (const doc of (docs ?? []) as { customer_id: string; document_type: string | null }[]) {
          const cur = dc.get(doc.customer_id) ?? { total: 0, statements: 0 };
          cur.total += 1;
          if (doc.document_type === "bank_statement") cur.statements += 1;
          dc.set(doc.customer_id, cur);
        }
        setDocCounts(dc);
      } else {
        setSignedCustomers(new Set());
        setDocCounts(new Map());
      }
      // ── Application completeness per deal (the exit rule) + the setter's ★s ──
      const dealIds = rows.map((r) => r.id);
      if (dealIds.length > 0) {
        const [{ data: apps }, { data: stars }] = await Promise.all([
          supabase.from("mca_applications").select("*").in("deal_id", dealIds),
          supabase.from("processor_working").select("deal_id").eq("profile_id", effectiveUserId).in("deal_id", dealIds),
        ]);
        const appByDeal = new Map<string, Record<string, unknown>>();
        for (const a of (apps ?? []) as Record<string, unknown>[]) {
          appByDeal.set(String(a.deal_id), a);
        }
        const pct = new Map<string, { pct: number; left: number }>();
        for (const r of rows) {
          const res = applicationCompleteness(
            {
              customer: r.customer ?? undefined,
              lead_qual: null,
              amount_requested: r.amount_requested,
              use_of_funds: r.use_of_funds,
            } as unknown as DealWithCustomer,
            (appByDeal.get(r.id) as never) ?? null,
          );
          pct.set(r.id, { pct: res.pct, left: res.missing.length });
        }
        setAppPct(pct);
        setWorkingSet(new Set(((stars ?? []) as { deal_id: string }[]).map((s) => s.deal_id)));
      } else {
        setAppPct(new Map());
        setWorkingSet(new Set());
      }
    } catch (e) {
      // error, NEVER an empty list — an unreadable book is not an empty book.
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load your deals.",
      });
    }
  }, [effectiveUserId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadedRows = state.kind === "ready" ? state.rows : [];
  // WORKING-QUEUE RULE (owner 9/2): a deal stays on My Deals until its application
  // is COMPLETE (100%) or it leaves for Nurture. Complete deals drop off the
  // default view (still reachable by picking their stage). The ★ chip narrows to
  // the setter's own working set.
  const rows = loadedRows.filter((r) => {
    if (filter.kind === "all") {
      const p = appPct.get(r.id);
      if (p && p.pct >= 100) return false;
    }
    if (workingOnly && !workingSet.has(r.id)) return false;
    return true;
  });
  const total = state.kind === "ready" ? state.total : 0;
  const truncated = state.kind === "ready" && total > loadedRows.length;

  // ── Row actions: ★ toggle, callback/appointment, nurture, quick note ──
  const toggleStar = async (dealId: string) => {
    setRowBusy(dealId);
    setRowErr(null);
    try {
      const { data, error } = await supabase.rpc("processor_toggle_working", { p_deal_id: dealId });
      if (error) throw new Error(error.message);
      const on = (data as { working?: boolean } | null)?.working === true;
      setWorkingSet((prev) => {
        const next = new Set(prev);
        if (on) next.add(dealId); else next.delete(dealId);
        return next;
      });
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : "Couldn't update your working set.");
    } finally {
      setRowBusy(null);
    }
  };

  const saveSchedule = async (dealId: string, col: "callback_at" | "appointment_at", iso: string) => {
    const patch: Record<string, unknown> =
      col === "callback_at" ? { callback_at: iso, callback_source: "closer_promised" } : { appointment_at: iso };
    await mustWrite("save the follow-up", supabase.from("deals").update(patch).eq("id", dealId));
    void load();
  };

  const armOrFireNurture = (dealId: string) => {
    if (nurtureArmed === dealId) {
      setNurtureArmed(null);
      setRowBusy(dealId);
      setRowErr(null);
      void (async () => {
        try {
          await updateDealStatus(dealId, "nurture");
          void load();
        } catch (e) {
          setRowErr(e instanceof Error ? e.message : "Couldn't move to nurture.");
        } finally {
          setRowBusy(null);
        }
      })();
    } else {
      setNurtureArmed(dealId);
      window.setTimeout(() => setNurtureArmed((cur) => (cur === dealId ? null : cur)), 4000);
    }
  };

  const saveNote = async (r: DealRow) => {
    const content = noteText.trim();
    if (!content || !r.customer_id) return;
    setRowBusy(r.id);
    setRowErr(null);
    try {
      await addDealNote({ dealId: r.id, customerId: r.customer_id, content });
      setNoteText("");
      setNotesFor(null);
    } catch (e) {
      setRowErr(e instanceof Error ? e.message : "Couldn't save the note.");
    } finally {
      setRowBusy(null);
    }
  };

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
          <InboxStackIcon className="w-5 h-5 text-mint-green" />
          My deals
          {state.kind === "ready" && (
            <span className="text-xs font-normal text-gray-400">
              ({rows.length.toLocaleString()}
              {truncated ? ` of ${total.toLocaleString()}` : ""})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue disabled:opacity-50"
          title="Reload your book"
        >
          <ArrowPathIcon className={`w-3.5 h-3.5 ${state.kind === "loading" ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>
    ),
    [state.kind, rows.length, total, truncated, load],
  );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 max-w-xl">
      {header}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {filter.kind === "callbacks"
          ? "Your deals with a callback scheduled for today (ET), soonest first — click one to load it."
          : "The merchants assigned to you, most-recently-active first — click one to load it into the console."}
      </p>

      {/* Queue filters — narrow your own book. All are applied in-query. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "all", label: "All", active: filter.kind === "all", next: { kind: "all" } as QueueFilter },
            {
              key: "callbacks",
              label: "Callbacks today",
              active: filter.kind === "callbacks",
              next: { kind: "callbacks" } as QueueFilter,
            },
            {
              key: "never",
              label: "Never contacted",
              active: filter.kind === "never",
              next: { kind: "never" } as QueueFilter,
            },
          ] as const
        ).map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => setFilter(chip.next)}
            aria-pressed={chip.active}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              chip.active
                ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
            }`}
          >
            {chip.label}
          </button>
        ))}
        {/* ★ My working set — the setter's own starred deals (any other filter still applies). */}
        <button
          type="button"
          onClick={() => setWorkingOnly((v) => !v)}
          aria-pressed={workingOnly}
          title="Only the deals you starred as your working set"
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
            workingOnly
              ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
              : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
          }`}
        >
          <StarIcon className="w-3.5 h-3.5" /> My working set
        </button>
        {/* By stage — the dropdown IS its own filter; empty value returns to All. */}
        <select
          value={filter.kind === "stage" ? filter.stage : ""}
          onChange={(e) =>
            setFilter(e.target.value ? { kind: "stage", stage: e.target.value as DealStatus } : { kind: "all" })
          }
          aria-label="Filter by stage"
          className={`text-xs font-semibold px-2 py-1 rounded-full border bg-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ocean-blue ${
            filter.kind === "stage"
              ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
              : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
          }`}
        >
          <option value="" className="text-gray-900 dark:bg-gray-800 dark:text-white">
            By stage…
          </option>
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} className="text-gray-900 dark:bg-gray-800 dark:text-white">
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-6">
            <span className="loading loading-spinner loading-xs" /> Loading your deals…
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Couldn't load your deals.</div>
              <div className="mt-0.5">This is not an empty book — it's an unknown one.</div>
              <div className="mt-0.5 font-mono opacity-80">{state.message}</div>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-1.5 font-semibold text-ocean-blue hover:underline"
              >
                Try again →
              </button>
            </div>
          </div>
        )}

        {state.kind === "ready" && rows.length === 0 && (
          <div className="py-8 text-center">
            <BuildingStorefrontIcon className="w-9 h-9 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              {emptyCopy(filter).title}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{emptyCopy(filter).body}</p>
          </div>
        )}

        {rowErr && (
          <p className="mb-2 text-xs font-semibold text-red-600 dark:text-red-400">{rowErr}</p>
        )}
        {state.kind === "ready" && rows.length > 0 && (
          <>
            {truncated && (
              <div className="mb-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                ⚠ Showing your first {DEAL_CAP}
                {filter.kind === "callbacks" ? " by callback time" : " most-recently-active"} — narrow with a
                filter or search above to reach the rest.
              </div>
            )}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {rows.map((r) => {
                const src = sourceMeta(r.lead_source);
                const ns = nextStep(r);
                const active = lastActiveAt(r);
                const phone = prettyPhone(r.customer?.phone ?? null);
                const p = appPct.get(r.id) ?? null;
                const touchDays = daysSinceFirstTouch(r);
                const stale = touchDays !== null && touchDays >= STALE_DAYS;
                const starred = workingSet.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={`w-full px-3 py-2.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0 transition-colors ${
                      stale
                        ? "bg-red-50/70 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-gray-900"
                    }`}
                  >
                  <div className="flex items-start gap-2.5">
                    {/* ★ working set — the setter's own claim */}
                    <button
                      type="button"
                      disabled={rowBusy === r.id}
                      onClick={() => void toggleStar(r.id)}
                      title={starred ? "In your working set — click to remove" : "Star into your working set"}
                      className="shrink-0 mt-0.5 disabled:opacity-40"
                    >
                      {starred ? (
                        <StarSolid className="w-4 h-4 text-amber-400" />
                      ) : (
                        <StarIcon className="w-4 h-4 text-gray-300 hover:text-amber-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpen({ dealId: r.id })}
                      title={`Load ${merchantName(r)} into the console`}
                      className="min-w-0 flex-1 text-left flex items-start gap-2.5"
                    >
                    <BuildingStorefrontIcon className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                          {merchantName(r)}
                        </span>
                        <span
                          className="text-[10px] text-gray-400 shrink-0"
                          title={active ? `Last active ${dateTimeET(active)} ET` : "No activity stamped yet"}
                        >
                          {sinceText(active)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stageChipCls(r.status)}`}
                        >
                          {stageLabel(r.status)}
                        </span>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${SOURCE_TONE_CLASS[src.tone]}`}
                          title={`Lead source: ${sourceLabel(r.lead_source)}`}
                        >
                          {src.label}
                        </span>
                        {ns && (
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ns.tone}`}
                            title={ns.title}
                          >
                            {ns.label}
                          </span>
                        )}
                        {r.customer_id && signedCustomers.has(r.customer_id) && (
                          <span
                            title="Application signed"
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          >
                            ✍️ Signed
                          </span>
                        )}
                        {/* Documents on file — total + how many are bank statements. */}
                        {(() => {
                          const dcs = r.customer_id ? docCounts.get(r.customer_id) : null;
                          if (!dcs || dcs.total === 0) {
                            return (
                              <span
                                title="No documents on file yet"
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700/60"
                              >
                                📄 no docs
                              </span>
                            );
                          }
                          return (
                            <span
                              title={`${dcs.total} document${dcs.total === 1 ? "" : "s"} on file · ${dcs.statements} bank statement${dcs.statements === 1 ? "" : "s"} — open the deal to view them`}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                                dcs.statements > 0
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                  : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                              }`}
                            >
                              📄 {dcs.total} doc{dcs.total === 1 ? "" : "s"}
                              {dcs.statements > 0 ? ` · ${dcs.statements} stmt${dcs.statements === 1 ? "" : "s"}` : ""}
                            </span>
                          );
                        })()}
                        {/* App completeness — the exit rule: 100% leaves this list. */}
                        {p && (
                          <span
                            title={p.pct >= 100 ? "Application complete" : `${p.left} required field${p.left === 1 ? "" : "s"} left`}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                              p.pct >= 100
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                : p.pct >= 60
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                            }`}
                          >
                            app {p.pct}%
                          </span>
                        )}
                        {/* The two-week clock — from the setter's FIRST TOUCH. */}
                        {touchDays !== null ? (
                          <span
                            title={`${touchDays} day${touchDays === 1 ? "" : "s"} since your first touch${stale ? " — two weeks up: move to nurture" : ""}`}
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
                              stale
                                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                : "bg-gray-100 text-gray-500 dark:bg-gray-700/60 dark:text-gray-300"
                            }`}
                          >
                            {touchDays}d worked
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700/60">
                            not touched
                          </span>
                        )}
                      </div>
                      {phone && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                          <PhoneIcon className="w-3 h-3" />
                          {phone}
                        </div>
                      )}
                    </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickAppDealId(r.id)}
                      title="Quick App — fast mandatory-only application"
                      className="shrink-0 self-center inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-amber-500 text-white hover:bg-amber-600"
                    >
                      <BoltIcon className="w-3 h-3" /> Quick App
                    </button>
                  </div>

                  {/* Follow-up strip — schedule, note, and (when two weeks are up) nurture. */}
                  <div className="mt-1.5 pl-6 flex flex-wrap items-center gap-2">
                    <SchedulePicker
                      kind="callback"
                      value={r.callback_at}
                      compact
                      onSave={(iso) => saveSchedule(r.id, "callback_at", iso)}
                    />
                    <SchedulePicker
                      kind="appointment"
                      value={r.appointment_at}
                      compact
                      onSave={(iso) => saveSchedule(r.id, "appointment_at", iso)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setNotesFor((cur) => (cur === r.id ? null : r.id));
                        setNoteText("");
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
                    >
                      <PencilSquareIcon className="w-3 h-3" /> Note
                    </button>
                    <button
                      type="button"
                      disabled={rowBusy === r.id}
                      onClick={() => armOrFireNurture(r.id)}
                      title={stale ? "Two weeks up — move to long-term nurture" : "Move to long-term nurture"}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                        nurtureArmed === r.id
                          ? "border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200"
                          : stale
                            ? "border-violet-400 text-violet-600 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                            : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-500 hover:text-violet-600"
                      }`}
                    >
                      <MoonIcon className="w-3 h-3" />
                      {nurtureArmed === r.id ? "Confirm?" : "Nurture"}
                    </button>
                  </div>

                  {/* Inline quick-note editor */}
                  {notesFor === r.id && (
                    <div className="mt-1.5 pl-6 flex items-start gap-2">
                      <textarea
                        autoFocus
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="What happened / what's next…"
                        rows={2}
                        className="flex-1 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-900 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        disabled={!noteText.trim() || rowBusy === r.id}
                        onClick={() => void saveNote(r)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-40"
                      >
                        {rowBusy === r.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Quick App launched from a row — loads the deal via getDealById (own-deal
          for a setter), no console load required. Refresh the book on save. */}
      {quickAppDealId && (
        <QuickAppModal
          dealId={quickAppDealId}
          onClose={() => setQuickAppDealId(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
