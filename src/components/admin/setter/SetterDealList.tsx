import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InboxStackIcon,
  BuildingStorefrontIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import type { PlaybookLookup } from "@/hooks/usePlaybookContact";
import { DEAL_STATUS_CONFIG, type DealStatus } from "@/types/deals";
import { sourceLabel, sourceMeta, SOURCE_TONE_CLASS } from "@/lib/sourceLabel";
import { dateTimeET } from "@/utils/time";

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
  "id,deal_number,status,previous_status,lead_source,updated_at,created_at,contacted_at,spoke_at,last_attempt_at,callback_at,callback_source,appointment_at,appointment_promised_at,stips_promised_by,customer:customers!customer_id(business_name,first_name,last_name,phone)";

interface DealCustomer {
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
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
  customer: DealCustomer | null;
}

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

export default function SetterDealList({
  onOpen,
}: {
  onOpen: (lookup: PlaybookLookup) => void;
}) {
  const { effectiveUserId } = useUserProfile();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

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
      const { data, error, count } = await supabase
        .from("deals")
        .select(DEAL_COLS, { count: "exact" })
        .eq("assigned_closer_id", effectiveUserId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(DEAL_CAP);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as DealRow[];
      setState({ kind: "ready", rows, total: count ?? rows.length });
    } catch (e) {
      // error, NEVER an empty list — an unreadable book is not an empty book.
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load your deals.",
      });
    }
  }, [effectiveUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = state.kind === "ready" ? state.rows : [];
  const total = state.kind === "ready" ? state.total : 0;
  const truncated = state.kind === "ready" && total > rows.length;

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
        The merchants assigned to you, most-recently-active first — click one to load it into the console.
      </p>

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
              No deals assigned to you yet — search above to pull one up.
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This read succeeded, so this is a real empty book. New leads land here the moment they're
              assigned to you.
            </p>
          </div>
        )}

        {state.kind === "ready" && rows.length > 0 && (
          <>
            {truncated && (
              <div className="mb-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                ⚠ Showing your {DEAL_CAP} most-recently-active — search above to reach the rest.
              </div>
            )}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {rows.map((r) => {
                const src = sourceMeta(r.lead_source);
                const ns = nextStep(r);
                const active = lastActiveAt(r);
                const phone = prettyPhone(r.customer?.phone ?? null);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpen({ dealId: r.id })}
                    title={`Load ${merchantName(r)} into the console`}
                    className="w-full text-left px-3 py-2.5 flex items-start gap-2.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
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
                      </div>
                      {phone && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                          <PhoneIcon className="w-3 h-3" />
                          {phone}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
