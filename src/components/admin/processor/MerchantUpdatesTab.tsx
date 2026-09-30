import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowPathIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InboxIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { dateTimeET } from "@/utils/time";
import { relativeTime } from "@/utils/portalNotifications";
import { MERCHANT_UPDATE_EVENT } from "@/hooks/useMerchantUpdateAlert";
import { metaFor, headlineFor, subtitleFor } from "./updateKindMeta";

// MerchantUpdatesTab — the DURABLE half of "something changed on a merchant's
// file". The corner toast is for the processor who is looking; this is for the
// one who is not.
//
// WHY (owner, 2026-09-30): "Bankers LLC sent in a change, and our processor just
// completely missed it." At 16:54 that merchant wrote in to correct his
// corporate name, his email and his phone, after we had already emailed him an
// application addressed to a mistyped version of the name he was correcting.
// The deal is still called "Bankers LLC".
//
// ⚠️ THE WRITE PATH WAS NEVER BROKEN. `deals.merchant_reply_at` was stamped at
// 17:07 with the correct summary. Every extraction worked. The change simply had
// nowhere to appear. That is why this tab exists and why it reads a table rather
// than re-deriving anything.
//
// ── WHY A TABLE AND NOT A LIVE QUERY ────────────────────────────────────────
// The failure mode is nobody being on the page at 16:54. So the events are
// captured by DB triggers as they happen, deduplicated there, and sit unread
// until a human clears them. A page that only shows what is on screen right now
// would have missed Bankers exactly as hard as the old one did.
//
// ── READ STATE IS PER USER ──────────────────────────────────────────────────
// Marking read writes to processor_notification_reads keyed on
// (notification, profile). Two processors working the same board must not clear
// each other's badge.
//
// ── UNREADABLE IS NEVER EMPTY ───────────────────────────────────────────────
// A failed read renders a red "could not be read" panel, NOT the empty state.
// "You're all caught up" against a broken query is the same lie as a silent
// zero on the badge, and it is the lie that caused this feature.

interface FeedRow {
  id: string;
  kind: string;
  deal_id: string;
  deal_number: string | null;
  deal_status: string | null;
  business_name: string;
  title: string;
  detail: string | null;
  event_count: number;
  event_at: string;
  is_read: boolean;
  read_at: string | null;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: FeedRow[] };

export default function MerchantUpdatesTab() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showRead, setShowRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("processor_notification_feed", {
      p_limit: 120,
      p_include_read: true,
      p_days: 30,
    });
    if (error) {
      setState({ kind: "error", message: error.message });
      return;
    }
    setState({ kind: "ready", rows: (data as FeedRow[] | null) ?? [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A live card firing, or coming back to the tab, re-syncs the list.
  useEffect(() => {
    const onUpdate = () => void load();
    const onFocus = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener(MERCHANT_UPDATE_EVENT, onUpdate);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener(MERCHANT_UPDATE_EVENT, onUpdate);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setBusy(true);
      // Optimistic, then reconciled by the reload below. A mark-read that fails
      // must not leave the row looking handled.
      const { error } = await supabase.rpc("processor_notifications_mark_read", { p_ids: ids });
      setBusy(false);
      if (error) {
        setState({ kind: "error", message: `Could not mark that read: ${error.message}` });
        return;
      }
      // Tells the sidebar pill and the tab badge to recount. They read the same
      // table through their own RPC rather than being handed a number here —
      // one source, three surfaces, no chance of them drifting apart.
      window.dispatchEvent(new CustomEvent(MERCHANT_UPDATE_EVENT));
      await load();
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    setBusy(true);
    const { error } = await supabase.rpc("processor_notifications_mark_all_read");
    setBusy(false);
    if (error) {
      setState({ kind: "error", message: `Could not clear the list: ${error.message}` });
      return;
    }
    window.dispatchEvent(new CustomEvent(MERCHANT_UPDATE_EVENT));
    await load();
  }, [load]);

  // Memoised so the empty-array fallback isn't a fresh identity every render
  // (which would re-run the filter below forever).
  const rows = useMemo(() => (state.kind === "ready" ? state.rows : []), [state]);
  const unread = useMemo(() => rows.filter((r) => !r.is_read), [rows]);
  const visible = showRead ? rows : unread;

  // ── UNREADABLE. Red, and it says what failed. Never the empty state. ──
  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-red-800 dark:text-red-200">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          Merchant updates could not be read
        </p>
        <p className="mt-1.5 text-[13px] text-red-700 dark:text-red-300">{state.message}</p>
        <p className="mt-1.5 text-[12px] text-red-700/80 dark:text-red-300/80">
          <b>This is NOT "nothing changed."</b> Until this loads, check the merchant&apos;s deal
          directly before assuming their file is quiet.
        </p>
        <button
          type="button"
          onClick={() => {
            setState({ kind: "loading" });
            void load();
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Try again
        </button>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">Reading merchant updates…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Header — what this list IS, said once, because a notification list that
          does not state its own scope gets misread as "everything". */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            What changed on merchant files
            {unread.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                {unread.length} unread
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            Merchant replies, signatures, documents and funder answers — last 30 days, whole board,
            open stages only. Not stage moves, not our own calls or emails.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showRead}
              onChange={(e) => setShowRead(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            Show read
          </label>
          <button
            type="button"
            onClick={() => void load()}
            title="Refresh"
            className="rounded-lg border border-gray-300 dark:border-gray-600 p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={busy || unread.length === 0}
            onClick={() => void markAllRead()}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            Mark all read
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <InboxIcon className="mx-auto w-8 h-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
            {showRead ? "Nothing in the last 30 days." : "Nothing unread."}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
            {/* Say WHICH read succeeded. An empty list is only trustworthy when
                the reader knows it came from a query that worked. */}
            The list loaded fine — there is genuinely nothing here.
            {!showRead && rows.length > 0 && (
              <> Tick &ldquo;Show read&rdquo; to see the {rows.length} you have already handled.</>
            )}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {visible.map((r) => {
            const meta = metaFor(r.kind);
            const { Icon } = meta;
            const headline = headlineFor(r.kind, r.title, r.event_count);
            const subtitle = subtitleFor(r.kind, r.detail, r.event_count);
            return (
              <li
                key={r.id}
                className={`flex items-start gap-3 px-4 py-3 border-l-4 ${meta.edge} ${
                  r.is_read ? "opacity-55" : "bg-violet-50/30 dark:bg-violet-500/5"
                }`}
              >
                <Icon className={`mt-0.5 w-5 h-5 shrink-0 ${meta.head}`} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/playbooks?deal=${encodeURIComponent(r.deal_id)}`)}
                      className="truncate text-sm font-bold text-gray-900 dark:text-white hover:text-ocean-blue hover:underline"
                      title={`Open ${r.business_name} in the playbook`}
                    >
                      {r.business_name}
                    </button>
                    {r.deal_number && (
                      <span className="text-[11px] tabular-nums text-gray-400">{r.deal_number}</span>
                    )}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.chip}`}>
                      {meta.label}
                    </span>
                  </div>

                  <p className="mt-0.5 text-[12px] font-semibold text-gray-800 dark:text-gray-100">{headline}</p>
                  {subtitle && (
                    <p className="mt-0.5 text-[12px] leading-snug text-gray-600 dark:text-gray-300">{subtitle}</p>
                  )}

                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400" title={dateTimeET(r.event_at)}>
                    {/* The EVENT time. A document sweep can be an hour behind, so
                        "just now" would be a claim we cannot support. */}
                    {relativeTime(r.event_at)} ago · {dateTimeET(r.event_at)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/playbooks?deal=${encodeURIComponent(r.deal_id)}`)}
                    className="rounded-lg bg-ocean-blue px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 whitespace-nowrap"
                  >
                    Open the deal
                  </button>
                  {!r.is_read && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void markRead([r.id])}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap"
                    >
                      <CheckIcon className="w-3.5 h-3.5" />
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
