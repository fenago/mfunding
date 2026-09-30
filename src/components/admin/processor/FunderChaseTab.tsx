// FunderChaseTab — the processor's funder work queue.
//
// ONE ROW PER SUBMISSION, not per deal. EZ Lawn→Cashable, Volcy→Highland Hill,
// Volcy→Uplyft is three rows, because the unit of chasing is a funder who owes
// us an answer, not a merchant.
//
// Sorted oldest-awaiting first: the top of the list is whoever has been silent
// longest. Where a funder publishes its own turnaround (lenders.funding_speed —
// Cashable says "~60-minute decisions"), a row past that promise is flagged
// BREACHED, which outranks the generic clock. That row is the whole point of
// the screen.
//
// Every status derivation and every write here comes from @/lib/funderSubmissions,
// the same module the per-deal FunderResponsesBoard runs on. The card and the
// table row are different chrome over identical meaning.
//
// HONESTY: a failed read renders RED with a retry. "No funders outstanding" when
// the query actually failed would stop her chasing altogether.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useSession } from "@/context/SessionContext";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  CHASE_TONE_CLS,
  chaseTone,
  funderMessagePrefill,
  hoursSince,
  isLive,
  logOffer,
  markFunderDeclined,
  messageFunder,
  money,
  quotedDecisionHours,
  relTime,
  stateOf,
  validateOffer,
  type Frequency,
  type StateKey,
} from "@/lib/funderSubmissions";

/** One submission, joined up to its merchant and its funder. */
interface ChaseRow {
  id: string;
  dealId: string;
  dealNumber: string | null;
  businessName: string;
  amountRequested: number | null;
  lenderId: string;
  lenderName: string;
  fundingSpeed: string | null;
  status: string;
  submittedAt: string | null;
  responseAt: string | null;
  openedAt: string | null;
  openCount: number;
  offerAmount: number | null;
  factorRate: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
  declineReason: string | null;
  responseType: string | null;
  responseSummary: string | null;
  requestedItems: string[];
}

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: ChaseRow[] };

type Filter = "outstanding" | "offers" | "declined" | "all";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "outstanding", label: "Awaiting", hint: "they owe us an answer" },
  { key: "offers", label: "Offers", hint: "came back with terms" },
  { key: "declined", label: "Declined", hint: "passed" },
  { key: "all", label: "All", hint: "everything submitted" },
];

/** Which filter bucket a row falls in. Offers/declines are reference, not work. */
function bucketOf(key: StateKey): Filter {
  if (key === "awaiting" || key === "replied") return "outstanding";
  if (key === "offer" || key === "accepted") return "offers";
  return "declined"; // funder_declined, merchant_declined, withdrawn
}

export default function FunderChaseTab() {
  const { session } = useSession();
  const { profile } = useUserProfile();
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("outstanding");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  // Which row has an inline form open, and which kind. One at a time — this is a
  // table, and two open editors in a table is unreadable.
  const [openForm, setOpenForm] = useState<{ id: string; kind: "message" | "offer" | "decline" } | null>(null);
  const [msg, setMsg] = useState({ subject: "", body: "" });
  const [offer, setOffer] = useState<{ amount: string; factor: string; term: string; payment: string; frequency: Frequency }>(
    { amount: "", factor: "", term: "", payment: "", frequency: "daily" },
  );
  const [declineReason, setDeclineReason] = useState("");
  // House rule: no browser popups. Sending an email to a funder is a two-step
  // arm/confirm, auto-disarming after 5s so a stray arm never lingers.
  const [armedSend, setArmedSend] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const senderName =
    profile?.display_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    "Momentum Funding";

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const { data, error } = await supabase
      .from("deal_submissions")
      .select(
        "id, deal_id, lender_id, status, submitted_at, response_at, opened_at, open_count, offer_amount, " +
          "factor_rate, term_months, daily_payment, weekly_payment, total_payback, decline_reason, " +
          "response_type, response_summary, response_data, withdrawn_at, " +
          "lender:lenders!lender_id ( company_name, funding_speed ), " +
          "deal:deals!deal_id ( deal_number, amount_requested, customer:customers!customer_id ( business_name, first_name, last_name ) )",
      )
      .order("submitted_at", { ascending: true, nullsFirst: false });

    if (error) {
      setState({ kind: "error", message: error.message });
      return;
    }
    if (data == null) {
      setState({ kind: "error", message: "The submissions read came back empty." });
      return;
    }

    const rows: ChaseRow[] = (data as unknown as Record<string, unknown>[]).map((r) => {
      const lender = r.lender as { company_name?: string; funding_speed?: string | null } | null;
      const deal = r.deal as
        | { deal_number?: string | null; amount_requested?: number | null; customer?: { business_name?: string | null; first_name?: string | null; last_name?: string | null } | null }
        | null;
      const cust = deal?.customer ?? null;
      const parsed = (r.response_data as { parsed?: { requested_items?: unknown } } | null)?.parsed;
      const items = Array.isArray(parsed?.requested_items)
        ? ((parsed!.requested_items as unknown[]).filter((x) => typeof x === "string") as string[])
        : [];
      return {
        id: r.id as string,
        dealId: r.deal_id as string,
        dealNumber: deal?.deal_number ?? null,
        businessName:
          cust?.business_name?.trim() ||
          [cust?.first_name, cust?.last_name].filter(Boolean).join(" ").trim() ||
          deal?.deal_number ||
          "Unnamed merchant",
        amountRequested: deal?.amount_requested ?? null,
        lenderId: r.lender_id as string,
        lenderName: lender?.company_name ?? "Funder",
        fundingSpeed: lender?.funding_speed ?? null,
        status: r.status as string,
        submittedAt: (r.submitted_at as string | null) ?? null,
        responseAt: (r.response_at as string | null) ?? null,
        openedAt: (r.opened_at as string | null) ?? null,
        openCount: (r.open_count as number | null) ?? 0,
        offerAmount: (r.offer_amount as number | null) ?? null,
        factorRate: (r.factor_rate as number | null) ?? null,
        dailyPayment: (r.daily_payment as number | null) ?? null,
        weeklyPayment: (r.weekly_payment as number | null) ?? null,
        totalPayback: (r.total_payback as number | null) ?? null,
        declineReason: (r.decline_reason as string | null) ?? null,
        responseType: (r.response_type as string | null) ?? null,
        responseSummary: (r.response_summary as string | null) ?? null,
        requestedItems: items,
      };
    });
    setState({ kind: "ready", rows: rows.filter(isLive) });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!armedSend) return;
    const t = setTimeout(() => setArmedSend(false), 5000);
    return () => clearTimeout(t);
  }, [armedSend]);

  // Memoised so the derived useMemos below don't recompute every render (a new
  // [] literal each pass would invalidate them).
  const all = useMemo(() => (state.kind === "ready" ? state.rows : []), [state]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { outstanding: 0, offers: 0, declined: 0, all: all.length };
    for (const r of all) c[bucketOf(stateOf(r).key)] += 1;
    return c;
  }, [all]);

  // Oldest-awaiting first — the top of the list is whoever has been silent
  // longest. A breached row (past the funder's own quoted turnaround) sorts
  // above everything regardless of raw age.
  const visible = useMemo(() => {
    const rows = all.filter((r) => filter === "all" || bucketOf(stateOf(r).key) === filter);
    return [...rows].sort((a, b) => {
      const ha = hoursSince(a.submittedAt);
      const hb = hoursSince(b.submittedAt);
      const ta = chaseTone(ha, quotedDecisionHours(a.fundingSpeed));
      const tb = chaseTone(hb, quotedDecisionHours(b.fundingSpeed));
      if (ta === "breached" && tb !== "breached") return -1;
      if (tb === "breached" && ta !== "breached") return 1;
      return (hb ?? -1) - (ha ?? -1); // oldest (most hours) first
    });
  }, [all, filter]);

  function closeForms() {
    setOpenForm(null);
    setArmedSend(false);
    setDeclineReason("");
    setOffer({ amount: "", factor: "", term: "", payment: "", frequency: "daily" });
  }

  function openMessage(r: ChaseRow) {
    const pre = funderMessagePrefill({
      businessName: r.businessName,
      dealNumber: r.dealNumber,
      senderName,
      responseType: r.responseType,
      requestedItems: r.requestedItems,
    });
    setMsg({ subject: pre.subject, body: pre.body });
    setArmedSend(false);
    setRowErr((m) => ({ ...m, [r.id]: "" }));
    setOpenForm({ id: r.id, kind: "message" });
  }

  async function doSend(r: ChaseRow) {
    if (!msg.subject.trim()) { setRowErr((m) => ({ ...m, [r.id]: "Enter a subject." })); return; }
    if (!msg.body.trim()) { setRowErr((m) => ({ ...m, [r.id]: "Enter a message." })); return; }
    setRowBusy(r.id);
    setRowErr((m) => ({ ...m, [r.id]: "" }));
    try {
      await messageFunder({ dealId: r.dealId, lenderId: r.lenderId, subject: msg.subject, body: msg.body });
      closeForms();
      setToast(`Message sent to ${r.lenderName}.`);
      setTimeout(() => setToast(null), 4000);
    } catch (e) {
      setRowErr((m) => ({ ...m, [r.id]: e instanceof Error ? e.message : "Could not send the message." }));
    } finally {
      setRowBusy(null);
    }
  }

  async function doLogOffer(r: ChaseRow) {
    const invalid = validateOffer(offer);
    if (invalid) { setRowErr((m) => ({ ...m, [r.id]: invalid })); return; }
    setRowBusy(r.id);
    setRowErr((m) => ({ ...m, [r.id]: "" }));
    try {
      await logOffer({
        submissionId: r.id,
        dealId: r.dealId,
        lenderName: r.lenderName,
        userId: session?.user?.id,
        offer: {
          amount: parseFloat(offer.amount),
          factor: parseFloat(offer.factor),
          term: offer.term ? parseInt(offer.term, 10) : null,
          payment: offer.payment ? parseFloat(offer.payment) : null,
          frequency: offer.frequency,
        },
      });
      closeForms();
      await load();
    } catch (e) {
      setRowErr((m) => ({ ...m, [r.id]: e instanceof Error ? e.message : "Could not save the offer." }));
    } finally {
      setRowBusy(null);
    }
  }

  async function doDecline(r: ChaseRow) {
    setRowBusy(r.id);
    setRowErr((m) => ({ ...m, [r.id]: "" }));
    try {
      await markFunderDeclined({
        submissionId: r.id,
        dealId: r.dealId,
        lenderName: r.lenderName,
        userId: session?.user?.id,
        reason: declineReason,
      });
      closeForms();
      await load();
    } catch (e) {
      setRowErr((m) => ({ ...m, [r.id]: e instanceof Error ? e.message : "Could not record the decline." }));
    } finally {
      setRowBusy(null);
    }
  }

  // ── Unreadable is its own state, never an empty list ──
  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5">
        <div className="flex items-start gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-red-700 dark:text-red-300">
              Couldn&apos;t load the funder queue.
            </div>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
              This is <span className="font-bold">not</span> &ldquo;no funders outstanding&rdquo; — it is an unread
              query. Do not stop chasing on the strength of this screen until it loads.
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-red-700/80 dark:text-red-300/80">{state.message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1.5 text-xs font-semibold text-ocean-blue hover:underline"
            >
              Try again →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <PaperAirplaneIcon className="w-4 h-4 text-ocean-blue" />
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Funder chase</h2>
        <span className="text-[11px] text-gray-400">
          one row per submission · oldest silence first · chase whoever owes us an answer
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto text-[11px] text-ocean-blue hover:underline inline-flex items-center gap-1"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Status filter — Awaiting is the default; offers/declines are reference. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => { setFilter(f.key); closeForms(); }}
            aria-pressed={filter === f.key}
            title={f.hint}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              filter === f.key
                ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
            }`}
          >
            {f.label}
            <span className="ml-1 tabular-nums opacity-70">
              {state.kind === "ready" ? counts[f.key] : "—"}
            </span>
          </button>
        ))}
      </div>

      {toast && (
        <div className="mb-3 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          {toast}
        </div>
      )}

      {state.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-8">
          <span className="loading loading-spinner loading-sm" /> Loading the funder queue…
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6">
          {filter === "outstanding"
            ? "Nothing outstanding — every funder that has the file has answered."
            : "No submissions in this view."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left font-semibold py-1.5 pr-3">Merchant</th>
                <th className="text-left font-semibold py-1.5 pr-3">Funder</th>
                <th className="text-right font-semibold py-1.5 pr-3">Amount</th>
                <th className="text-left font-semibold py-1.5 pr-3">Sent</th>
                <th className="text-left font-semibold py-1.5 pr-3">Opened</th>
                <th className="text-left font-semibold py-1.5 pr-3">Status</th>
                <th className="text-right font-semibold py-1.5">Chase</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const st = stateOf(r);
                const hrs = hoursSince(r.submittedAt);
                const quoted = quotedDecisionHours(r.fundingSpeed);
                const tone = chaseTone(hrs, quoted);
                const busy = rowBusy === r.id;
                const form = openForm?.id === r.id ? openForm.kind : null;
                const err = rowErr[r.id];
                return (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/60 align-top">
                    <td className="py-2 pr-3" colSpan={form ? 7 : 1}>
                      {form ? (
                        // ── Inline editor, full width. No drawer, no popup. ──
                        <div className="rounded-lg border border-ocean-blue/40 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-3 space-y-2">
                          <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-900 dark:text-white">
                            {r.businessName} → {r.lenderName}
                            <button
                              type="button"
                              onClick={closeForms}
                              className="ml-auto text-[11px] font-normal text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              Cancel ×
                            </button>
                          </div>

                          {form === "message" && (
                            <>
                              <input
                                type="text"
                                value={msg.subject}
                                onChange={(e) => setMsg((m) => ({ ...m, subject: e.target.value }))}
                                placeholder="Subject"
                                className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                              />
                              <textarea
                                value={msg.body}
                                onChange={(e) => setMsg((m) => ({ ...m, body: e.target.value }))}
                                rows={5}
                                className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                              />
                              <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                Goes to this funder&apos;s submission contact. To attach documents or CC an ISO rep,
                                open the deal&apos;s full funder board.
                              </p>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { if (armedSend) void doSend(r); else setArmedSend(true); }}
                                className={`text-[11px] font-semibold px-3 py-1.5 rounded text-white disabled:opacity-50 inline-flex items-center gap-1 ${
                                  armedSend ? "bg-amber-600" : "bg-ocean-blue"
                                }`}
                              >
                                <EnvelopeIcon className="w-3.5 h-3.5" />
                                {busy ? "Sending…" : armedSend ? "⚠️ Tap again to email the funder →" : "Send to funder"}
                              </button>
                            </>
                          )}

                          {form === "offer" && (
                            <>
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                <input type="text" inputMode="decimal" value={offer.amount} onChange={(e) => setOffer((o) => ({ ...o, amount: e.target.value }))} placeholder="Amount" className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                <input type="text" inputMode="decimal" value={offer.factor} onChange={(e) => setOffer((o) => ({ ...o, factor: e.target.value }))} placeholder="Factor (1.3)" className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                <input type="text" inputMode="numeric" value={offer.term} onChange={(e) => setOffer((o) => ({ ...o, term: e.target.value }))} placeholder="Term (mo)" className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                <input type="text" inputMode="decimal" value={offer.payment} onChange={(e) => setOffer((o) => ({ ...o, payment: e.target.value }))} placeholder="Payment" className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                                <select value={offer.frequency} onChange={(e) => setOffer((o) => ({ ...o, frequency: e.target.value as Frequency }))} className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
                                  <option value="daily">daily</option>
                                  <option value="weekly">weekly</option>
                                </select>
                              </div>
                              <button type="button" disabled={busy} onClick={() => void doLogOffer(r)} className="text-[11px] font-semibold px-3 py-1.5 rounded bg-ocean-blue text-white disabled:opacity-50">
                                {busy ? "Saving…" : "Save the offer"}
                              </button>
                            </>
                          )}

                          {form === "decline" && (
                            <>
                              <input
                                type="text"
                                value={declineReason}
                                onChange={(e) => setDeclineReason(e.target.value)}
                                placeholder="Reason (optional) — e.g. too many positions"
                                className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                              />
                              <button type="button" disabled={busy} onClick={() => void doDecline(r)} className="text-[11px] font-semibold px-3 py-1.5 rounded bg-rose-600 text-white disabled:opacity-50">
                                {busy ? "Recording…" : `Record ${r.lenderName}'s decline`}
                              </button>
                            </>
                          )}

                          {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
                        </div>
                      ) : (
                        <Link
                          to={`/admin/deals/${r.dealId}`}
                          className="font-semibold text-gray-900 dark:text-white hover:text-ocean-blue inline-flex items-center gap-1"
                        >
                          {r.businessName}
                          <ArrowTopRightOnSquareIcon className="w-3 h-3 opacity-50" />
                        </Link>
                      )}
                      {!form && r.dealNumber && (
                        <div className="text-[10px] text-gray-400">{r.dealNumber}</div>
                      )}
                    </td>

                    {!form && (
                      <>
                        <td className="py-2 pr-3">
                          <div className="text-gray-900 dark:text-gray-100">{r.lenderName}</div>
                          {r.fundingSpeed && (
                            <div className="text-[10px] text-gray-400" title={r.fundingSpeed}>
                              quotes {r.fundingSpeed.length > 34 ? `${r.fundingSpeed.slice(0, 34)}…` : r.fundingSpeed}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">
                          {money(r.offerAmount ?? r.amountRequested)}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={CHASE_TONE_CLS[tone]}>
                            {r.submittedAt ? relTime(r.submittedAt) : "never stamped"}
                          </span>
                          {tone === "breached" && quoted != null && (
                            <div className="text-[10px] font-bold text-red-700 dark:text-red-300">
                              ⚠ past their own {quoted < 1 ? `${Math.round(quoted * 60)}-min` : `${quoted}h`} promise
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {r.openedAt ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-px text-[10px] font-semibold">
                              <EyeIcon className="w-3 h-3" /> {r.openCount > 1 ? `${r.openCount}×` : "yes"}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400">not opened</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}>
                            {st.emoji} {st.label}
                          </span>
                          {r.responseSummary && (
                            <div className="text-[10px] text-gray-500 dark:text-gray-400 max-w-[22rem] truncate" title={r.responseSummary}>
                              {r.responseSummary}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => openMessage(r)} className="text-[10px] font-semibold text-ocean-blue hover:underline">
                            Message funder
                          </button>
                          <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                          <button type="button" onClick={() => { setRowErr((m) => ({ ...m, [r.id]: "" })); setOpenForm({ id: r.id, kind: "offer" }); }} className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
                            Log offer
                          </button>
                          <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
                          <button type="button" onClick={() => { setRowErr((m) => ({ ...m, [r.id]: "" })); setDeclineReason(""); setOpenForm({ id: r.id, kind: "decline" }); }} className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 hover:underline">
                            Declined
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
