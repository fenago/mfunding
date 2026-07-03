// FunderResponsesBoard — the "what did the funders say?" board on Revenue
// Playbook Step 7 (Offer Presented). Where Step 6 (FunderPicker) fans the deal
// OUT to funders, this board tracks what comes BACK: one card per funder the
// deal went to, each moving through a small state machine
//   ⏳ Awaiting → ✉ Replied → 💰 Offer → ✅ Accepted / 🙅 Merchant declined
//   (or ❌ Funder declined)
// with inline actions to log the reply without leaving the step. The stage move
// stays on the step's own button — logging an offer here never advances the deal.
//
// mode="accepted" renders a single compact "Accepted offer" summary for Step 8
// (Accept + e-sign) as context — funder, amount, factor, payback, est. payment.
import { useEffect, useMemo, useState } from "react";
import {
  ClockIcon,
  EnvelopeIcon,
  CurrencyDollarIcon,
  CheckCircleIcon,
  HandThumbDownIcon,
  ArrowPathIcon,
  XMarkIcon,
  InboxArrowDownIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { TrophyIcon } from "@heroicons/react/24/solid";
import supabase from "../../supabase";
import { updateSubmission } from "../../services/dealService";
import { useSession } from "../../context/SessionContext";
import { useUserProfile } from "../../context/UserProfileContext";
import type { DealWithCustomer } from "../../types/deals";

// No concrete "Bank Statements & Documents Upload" form URL is stored in the repo
// or DB yet, so stip-request prefills use this placeholder — the closer swaps in
// the real link (the body stays fully editable) before sending.
// GHL "Bank Statements & Documents Upload" form — the same secure upload
// link the doc-collection sequences send to merchants.
const UPLOAD_LINK_PLACEHOLDER = "https://api.leadconnectorhq.com/widget/form/vO16UFona1IkxuezRg0d";

// AI response-type → badge label + color (mirrors the classifier's enum).
const RESPONSE_TYPE_META: Record<string, { label: string; cls: string }> = {
  stip_request: { label: "Stip request", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  decline: { label: "Decline", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  offer: { label: "Offer", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  question: { label: "Question", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  acknowledgment: { label: "Acknowledgment", cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
  other: { label: "Reply", cls: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300" },
};
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

type Frequency = "daily" | "weekly";
const PAYMENTS_PER_MONTH: Record<Frequency, number> = { daily: 21, weekly: 4.33 };

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Compact "3h ago" / "2d ago".
function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

// Merchant-side monthly burden of an offer + its share of monthly revenue.
// amber when the pull eats >15% of revenue (a common affordability red line).
function burden(payment: number | null, freq: Frequency, monthlyRevenue: number | null | undefined) {
  if (!payment) return null;
  const monthly = payment * PAYMENTS_PER_MONTH[freq];
  const pct = monthlyRevenue ? (monthly / monthlyRevenue) * 100 : null;
  return { monthly, pct, hot: pct != null && pct > 15 };
}

interface SubRow {
  id: string;
  lenderId: string;
  lenderName: string;
  status: string;
  submittedAt: string | null;
  responseAt: string | null;
  offerAmount: number | null;
  factorRate: number | null;
  termMonths: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
  declineReason: string | null;
  courtesySentAt: string | null;
  // AI reply classification (from poll-funder-replies; may be null).
  responseType: string | null;
  responseSummary: string | null;
  declineCategory: string | null;
  requestedItems: string[];
}

type StateKey = "awaiting" | "replied" | "offer" | "accepted" | "merchant_declined" | "funder_declined";

// One place the card's badge + accents come from, derived from the row's status
// and which economics fields are populated.
function stateOf(s: SubRow): { key: StateKey; emoji: string; label: string; cls: string } {
  if (s.status === "offer_accepted")
    return { key: "accepted", emoji: "✅", label: "Accepted", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
  if (s.status === "offer_declined")
    return { key: "merchant_declined", emoji: "🙅", label: "Merchant declined", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" };
  if (s.status === "declined")
    return { key: "funder_declined", emoji: "❌", label: "Funder declined", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" };
  if (s.offerAmount != null || s.status === "offer_made" || s.status === "approved")
    return { key: "offer", emoji: "💰", label: "Offer", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" };
  if (s.responseAt)
    return { key: "replied", emoji: "✉", label: "Replied", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
  return { key: "awaiting", emoji: "⏳", label: "Awaiting", cls: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300" };
}

const freqOf = (s: SubRow): Frequency => (s.weeklyPayment != null ? "weekly" : "daily");
const paymentOf = (s: SubRow) => (s.weeklyPayment != null ? s.weeklyPayment : s.dailyPayment);
const paybackOf = (s: SubRow) => s.totalPayback ?? (s.offerAmount != null && s.factorRate != null ? Math.round(s.offerAmount * s.factorRate) : null);

// A submission counts as "on the board" once it actually went out (or came back).
// Failed/never-sent rows (pending with no timestamp/response) are hidden.
function isLive(s: SubRow): boolean {
  return (
    !!s.submittedAt ||
    !!s.responseAt ||
    s.offerAmount != null ||
    ["submitted", "under_review", "approved", "offer_made", "offer_accepted", "offer_declined", "declined"].includes(s.status)
  );
}

export default function FunderResponsesBoard({ deal, mode = "board" }: { deal: DealWithCustomer; mode?: "board" | "accepted" }) {
  const { session } = useSession();
  const { profile } = useUserProfile();
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // Inline form state (one open at a time, keyed by submission id).
  const [offerFormFor, setOfferFormFor] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState<{ amount: string; factor: string; term: string; payment: string; frequency: Frequency }>({ amount: "", factor: "", term: "", payment: "", frequency: "daily" });
  const [offerError, setOfferError] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [courtesyMsg, setCourtesyMsg] = useState<Record<string, string>>({});

  // Message-the-merchant modal (fires send-merchant-email on explicit click only).
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgCc, setMsgCc] = useState("");
  const [msgBcc, setMsgBcc] = useState("");
  const [sentLog, setSentLog] = useState<{ at: string; subject: string; snippet: string }[]>([]);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);
  const [msgToast, setMsgToast] = useState<string | null>(null);

  const monthlyRevenue = deal.customer?.monthly_revenue ?? null;
  const merchantFirst = deal.customer?.first_name?.trim() || "there";
  const merchantName = [deal.customer?.first_name, deal.customer?.last_name].filter(Boolean).join(" ").trim()
    || deal.customer?.business_name || "the merchant";
  const merchantEmail = deal.customer?.email ?? null;
  const closerName = (profile?.display_name?.trim())
    || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim()
    || "Momentum Funding";

  // Build a context-aware prefill for the merchant message. Broker best practice:
  // never name the funder to the merchant — phrase as "our funding partner".
  function prefillFor(s: SubRow | null): { subject: string; body: string } {
    // Stip request → ask the merchant for exactly what the funder needs.
    if (s && s.responseType === "stip_request") {
      const items = s.requestedItems.length ? s.requestedItems.join(", ") : "one more document";
      return {
        subject: "Quick item needed for your funding file",
        body:
          `Hi ${merchantFirst} — good news: one of our funding partners is actively reviewing your file. ` +
          `To finish their review they need: ${items}. ` +
          `Upload it here: ${UPLOAD_LINK_PLACEHOLDER} — or just reply to this email with the document attached.\n\n` +
          `— ${closerName}`,
      };
    }
    // Funder declined → reassure; do NOT mention the decline unless the closer edits it in.
    if (s && (s.status === "declined")) {
      return {
        subject: "An update on your funding file",
        body:
          `Hi ${merchantFirst} — just a quick update: we're still actively working your file and ` +
          `have more funding options in motion. I'll reach out the moment I have news. Thanks for your patience.\n\n` +
          `— ${closerName}`,
      };
    }
    // General / replied → a neutral update the closer completes.
    return {
      subject: "An update on your funding file",
      body:
        `Hi ${merchantFirst} — quick update on your funding file. ` +
        `[write your update here]\n\n` +
        `— ${closerName}`,
    };
  }

  function openMessage(s: SubRow | null) {
    const pre = prefillFor(s);
    setMsgSubject(pre.subject);
    setMsgBody(pre.body);
    setMsgError(null);
    setMsgOpen(true);
  }

  async function sendMerchantMessage() {
    if (!msgSubject.trim()) { setMsgError("Enter a subject."); return; }
    if (!msgBody.trim()) { setMsgError("Enter a message."); return; }
    setMsgBusy(true);
    setMsgError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("send-merchant-email", {
        body: {
          dealId: deal.id, subject: msgSubject.trim(), body: msgBody.trim(),
          cc: msgCc.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
          bcc: msgBcc.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
        },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setMsgOpen(false);
      setMsgToast("Message sent to the merchant.");
      void loadSentLog();
      setTimeout(() => setMsgToast(null), 4000);
    } catch (e) {
      setMsgError(e instanceof Error ? e.message : "Could not send the message.");
    } finally {
      setMsgBusy(false);
    }
  }

  async function loadSentLog() {
    const { data } = await supabase
      .from("activity_log")
      .select("created_at, subject, content")
      .eq("entity_type", "deal").eq("entity_id", deal.id)
      .like("subject", "merchant:email%")
      .order("created_at", { ascending: false }).limit(10);
    setSentLog((data ?? []).map((r) => ({
      at: r.created_at as string,
      subject: String(r.subject ?? "").replace(/^merchant:email — /, ""),
      snippet: String(r.content ?? ""),
    })));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("deal_submissions")
        .select("id, lender_id, status, submitted_at, response_at, offer_amount, factor_rate, term_months, daily_payment, weekly_payment, total_payback, decline_reason, courtesy_sent_at, response_type, response_summary, response_data, lender:lenders!lender_id ( company_name )")
        .eq("deal_id", deal.id);
      if (qErr) throw qErr;
      const mapped: SubRow[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
        const parsed = (r.response_data as { parsed?: { decline_reason_category?: string | null; requested_items?: unknown } } | null)?.parsed;
        const items = Array.isArray(parsed?.requested_items)
          ? (parsed!.requested_items as unknown[]).filter((x) => typeof x === "string") as string[]
          : [];
        return {
          id: r.id as string,
          lenderId: r.lender_id as string,
          lenderName: ((r.lender as { company_name?: string } | null)?.company_name) ?? "Funder",
          status: r.status as string,
          submittedAt: (r.submitted_at as string | null) ?? null,
          responseAt: (r.response_at as string | null) ?? null,
          offerAmount: (r.offer_amount as number | null) ?? null,
          factorRate: (r.factor_rate as number | null) ?? null,
          termMonths: (r.term_months as number | null) ?? null,
          dailyPayment: (r.daily_payment as number | null) ?? null,
          weeklyPayment: (r.weekly_payment as number | null) ?? null,
          totalPayback: (r.total_payback as number | null) ?? null,
          declineReason: (r.decline_reason as string | null) ?? null,
          courtesySentAt: (r.courtesy_sent_at as string | null) ?? null,
          responseType: (r.response_type as string | null) ?? null,
          responseSummary: (r.response_summary as string | null) ?? null,
          declineCategory: (parsed?.decline_reason_category as string | null) ?? null,
          requestedItems: items,
        };
      });
      setRows(mapped.filter(isLive));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load funder responses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); loadSentLog(); }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Best-effort activity-trail entry (mirrors FunderPicker's logActivity shape).
  async function logActivity(interaction_type: string, subject: string, content: string, newStatus?: string) {
    try {
      await supabase.from("activity_log").insert({
        entity_type: "deal", entity_id: deal.id,
        interaction_type, subject, content,
        new_status: newStatus ?? null,
        logged_by: session?.user?.id ?? null,
      });
    } catch { /* the trail is nice-to-have; never block the action on it */ }
  }

  function openOfferForm(s: SubRow) {
    setDeclineFor(null);
    setOfferError(null);
    setOfferFormFor(s.id);
    setOfferForm({
      amount: s.offerAmount != null ? String(s.offerAmount) : "",
      factor: s.factorRate != null ? String(s.factorRate) : "",
      term: s.termMonths != null ? String(s.termMonths) : "",
      payment: s.dailyPayment != null ? String(s.dailyPayment) : s.weeklyPayment != null ? String(s.weeklyPayment) : "",
      frequency: s.weeklyPayment != null ? "weekly" : "daily",
    });
  }

  async function saveOffer(s: SubRow) {
    const amount = parseFloat(offerForm.amount);
    const factor = parseFloat(offerForm.factor);
    if (!Number.isFinite(amount) || amount <= 0) { setOfferError("Enter the advance amount."); return; }
    if (!Number.isFinite(factor) || factor <= 0) { setOfferError("Enter the factor rate (e.g. 1.3)."); return; }
    const term = offerForm.term ? parseInt(offerForm.term, 10) : null;
    const payment = offerForm.payment ? parseFloat(offerForm.payment) : null;
    const totalPayback = Math.round(amount * factor);
    const daily = offerForm.frequency === "daily" ? payment : null;
    const weekly = offerForm.frequency === "weekly" ? payment : null;
    setRowBusy(s.id);
    setOfferError(null);
    try {
      await updateSubmission(s.id, {
        status: "offer_made",
        offer_amount: amount,
        factor_rate: factor,
        term_months: term,
        daily_payment: daily,
        weekly_payment: weekly,
        total_payback: totalPayback,
      });
      await logActivity(
        "offer_received",
        `Offer logged — ${s.lenderName}`,
        `${s.lenderName} offered ${money(amount)} at ${factor} factor (${money(totalPayback)} payback)${payment ? `, ${money(payment)} ${offerForm.frequency}` : ""}${term ? `, ${term} mo` : ""}.`,
        "offer_made",
      );
      setOfferFormFor(null);
      await load();
    } catch (e) {
      setOfferError(e instanceof Error ? e.message : "Could not save the offer.");
    } finally {
      setRowBusy(null);
    }
  }

  async function markFunderDeclined(s: SubRow) {
    setRowBusy(s.id);
    try {
      await updateSubmission(s.id, { status: "declined", decline_reason: declineReason.trim() || null });
      await logActivity("note", `Funder declined — ${s.lenderName}`, `${s.lenderName} declined the deal${declineReason.trim() ? `: ${declineReason.trim()}` : "."}`, "declined");
      setDeclineFor(null);
      setDeclineReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decline.");
    } finally {
      setRowBusy(null);
    }
  }

  async function setOfferOutcome(s: SubRow, outcome: "offer_accepted" | "offer_declined") {
    setRowBusy(s.id);
    try {
      await updateSubmission(s.id, { status: outcome });
      if (outcome === "offer_accepted") {
        await logActivity("note", `Offer accepted — ${s.lenderName}`, `Merchant accepted ${s.lenderName}'s offer of ${money(s.offerAmount)}.`, "offer_accepted");
      } else {
        await logActivity("note", `Offer declined by merchant — ${s.lenderName}`, `Merchant declined ${s.lenderName}'s offer.`, "offer_declined");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the offer.");
    } finally {
      setRowBusy(null);
    }
  }

  // Fire the courtesy thank-you engine (submit-to-funders action=courtesy_decline).
  // Idempotent server-side; we also flip the local row so the button disables.
  async function sendThankYou(s: SubRow) {
    setRowBusy(s.id);
    setCourtesyMsg((m) => ({ ...m, [s.id]: "" }));
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("submit-to-funders", {
        body: { action: "courtesy_decline", dealId: deal.id, lenderId: s.lenderId, lenderIds: [s.lenderId] },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      const stamp = (data?.courtesy_sent_at as string) ?? new Date().toISOString();
      setRows((prev) => prev.map((r) => (r.id === s.id ? { ...r, courtesySentAt: stamp } : r)));
      setCourtesyMsg((m) => ({ ...m, [s.id]: data?.alreadySent ? "Already thanked." : "Thank-you sent." }));
    } catch (e) {
      setCourtesyMsg((m) => ({ ...m, [s.id]: e instanceof Error ? e.message : "Could not send the thank-you." }));
    } finally {
      setRowBusy(null);
    }
  }

  // Ranked cheapest-payback-first so the best economics sit at the front, matching
  // the FunderPicker compare strip. Non-offer cards fall to the back.
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const pa = paybackOf(a), pb = paybackOf(b);
      if (pa != null && pb != null) return pa - pb;
      if (pa != null) return -1;
      if (pb != null) return 1;
      return a.lenderName.localeCompare(b.lenderName);
    });
  }, [rows]);
  const bestOfferId = sorted.find((s) => paybackOf(s) != null && s.status !== "declined")?.id;

  // ── Step 8 variant: single "Accepted offer" summary as context ──
  if (mode === "accepted") {
    const accepted = rows.find((s) => s.status === "offer_accepted");
    if (loading) return <p className="mt-3 text-sm text-gray-400">Loading accepted offer…</p>;
    if (!accepted) {
      return (
        <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-[12px] text-gray-500 dark:text-gray-400">
          No offer marked accepted yet — accept the winning offer on Step 7 (Present offers) first.
        </div>
      );
    }
    const freq = freqOf(accepted);
    const payment = paymentOf(accepted);
    const b = burden(payment, freq, monthlyRevenue);
    return (
      <div className="mt-3 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-900/15 p-3">
        <div className="flex items-center gap-2 mb-2">
          <TrophyIcon className="w-4 h-4 text-emerald-500" />
          <span className="text-[12px] font-semibold text-gray-900 dark:text-white">Accepted offer — {accepted.lenderName}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1 text-[12px]">
          <div><p className="text-gray-400">Amount</p><p className="font-semibold text-gray-900 dark:text-white">{money(accepted.offerAmount)}</p></div>
          <div><p className="text-gray-400">Factor</p><p className="text-gray-700 dark:text-gray-200">{accepted.factorRate != null ? `${accepted.factorRate}x` : "—"}</p></div>
          <div><p className="text-gray-400">Payback</p><p className="font-semibold text-gray-900 dark:text-white">{money(paybackOf(accepted))}</p></div>
          <div><p className="text-gray-400">Est. payment</p><p className="text-gray-700 dark:text-gray-200">{payment != null ? `${money(payment)}/${freq === "weekly" ? "wk" : "day"}` : "—"}</p></div>
          <div><p className="text-gray-400">Term</p><p className="text-gray-700 dark:text-gray-200">{accepted.termMonths != null ? `${accepted.termMonths} mo` : "—"}</p></div>
        </div>
        {b?.pct != null && (
          <span className={`mt-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium ${b.hot ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
            {b.pct.toFixed(0)}% of monthly revenue{b.hot ? " ⚠" : ""}
          </span>
        )}
      </div>
    );
  }

  // ── Step 7 variant: the responses board ──
  return (
    <div className="mt-4 rounded-lg border border-ocean-blue/40 bg-white dark:bg-gray-800 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <InboxArrowDownIcon className="w-4 h-4 text-ocean-blue" />
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Funder responses</span>
        <span className="text-[11px] text-gray-400">log each reply as it comes in — cheapest payback first</span>
        <button
          type="button"
          onClick={() => openMessage(null)}
          disabled={!merchantEmail}
          title={merchantEmail ? "Send an email to the merchant" : "No merchant email on file"}
          className="ml-auto text-[11px] font-semibold text-ocean-blue hover:bg-ocean-blue/5 border border-ocean-blue/40 rounded px-2 py-1 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <EnvelopeIcon className="w-3.5 h-3.5" /> Message merchant
        </button>
        <button type="button" onClick={load} className="text-[11px] text-ocean-blue hover:underline">↻ Refresh</button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading funder responses…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-500">
          No funders on this deal yet. Fan the deal out on Step 6 (Submit to funders) first.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {sorted.map((s) => {
            const st = stateOf(s);
            const isBest = s.id === bestOfferId;
            const hasOffer = s.offerAmount != null;
            const freq = freqOf(s);
            const payment = paymentOf(s);
            const b = burden(payment, freq, monthlyRevenue);
            const busy = rowBusy === s.id;
            const isFunderDeclined = st.key === "funder_declined";
            const isTerminal = ["accepted", "merchant_declined", "funder_declined"].includes(st.key);
            const typeMeta = s.responseType ? (RESPONSE_TYPE_META[s.responseType] ?? RESPONSE_TYPE_META.other) : null;
            // Message-the-merchant CTA belongs on replied / stip-request / declined cards.
            const showMsgButton = st.key === "replied" || s.responseType === "stip_request" || isFunderDeclined;
            return (
              <div key={s.id} className={`rounded-md border p-2.5 text-[11px] space-y-2 ${isBest ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/15" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"} ${st.key === "merchant_declined" ? "opacity-60" : ""}`}>
                {/* Header: funder + state badge */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isBest && <TrophyIcon className="w-3.5 h-3.5 text-emerald-500" />}
                  <span className="font-semibold text-gray-900 dark:text-white">{s.lenderName}</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium ${st.cls}`}>
                    <span>{st.emoji}</span> {st.label}
                  </span>
                  {isBest && <span className="text-[9px] uppercase tracking-wide text-emerald-600 font-semibold">best value</span>}
                  {st.key === "awaiting" && s.submittedAt && (
                    <span className="inline-flex items-center gap-0.5 text-gray-400"><ClockIcon className="w-3 h-3" /> sent {relTime(s.submittedAt)}</span>
                  )}
                  {st.key !== "awaiting" && s.responseAt && (
                    <span className="text-gray-400">· {relTime(s.responseAt)}</span>
                  )}
                </div>

                {/* AI reply classification — what the funder actually said */}
                {typeMeta && (
                  <div className="space-y-1 rounded bg-gray-50 dark:bg-gray-900/40 px-1.5 py-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${typeMeta.cls}`}>{typeMeta.label}</span>
                      {s.declineCategory && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                          {DECLINE_REASON_LABELS[s.declineCategory] ?? s.declineCategory.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    {s.requestedItems.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {s.requestedItems.map((it, i) => (
                          <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                            {it}
                          </span>
                        ))}
                      </div>
                    )}
                    {s.responseSummary && <p className="text-gray-600 dark:text-gray-300 italic">{s.responseSummary}</p>}
                  </div>
                )}

                {/* Offer economics */}
                {hasOffer && s.status !== "declined" && (
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-gray-600 dark:text-gray-300">
                    <span className="text-gray-400">Amount</span><span className="text-right font-medium">{money(s.offerAmount)}</span>
                    <span className="text-gray-400">Factor</span><span className="text-right">{s.factorRate}x</span>
                    <span className="text-gray-400">Payback</span><span className="text-right font-medium">{money(paybackOf(s))}</span>
                    {payment != null && <><span className="text-gray-400">Payment</span><span className="text-right">{money(payment)}/{freq === "weekly" ? "wk" : "day"}</span></>}
                    {s.termMonths != null && <><span className="text-gray-400">Term</span><span className="text-right">{s.termMonths} mo</span></>}
                  </div>
                )}
                {hasOffer && s.status !== "declined" && b?.pct != null && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${b.hot ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                    {b.pct.toFixed(0)}% of monthly revenue{b.hot ? " ⚠" : ""}
                  </span>
                )}
                {isFunderDeclined && (
                  <p className="text-rose-600 dark:text-rose-400">Funder declined{s.declineReason ? ` — ${s.declineReason}` : ""}.</p>
                )}

                {/* Inline offer form */}
                {offerFormFor === s.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="text-[10px] text-gray-500">Advance amount
                        <input type="number" inputMode="decimal" value={offerForm.amount} onChange={(e) => setOfferForm((f) => ({ ...f, amount: e.target.value }))} placeholder="50000" className="mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
                      </label>
                      <label className="text-[10px] text-gray-500">Factor rate
                        <input type="number" inputMode="decimal" step="0.01" value={offerForm.factor} onChange={(e) => setOfferForm((f) => ({ ...f, factor: e.target.value }))} placeholder="1.30" className="mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
                      </label>
                      <label className="text-[10px] text-gray-500">Term (months)
                        <input type="number" inputMode="numeric" value={offerForm.term} onChange={(e) => setOfferForm((f) => ({ ...f, term: e.target.value }))} placeholder="6" className="mt-0.5 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
                      </label>
                      <label className="text-[10px] text-gray-500">Payment
                        <div className="mt-0.5 flex gap-1">
                          <input type="number" inputMode="decimal" value={offerForm.payment} onChange={(e) => setOfferForm((f) => ({ ...f, payment: e.target.value }))} placeholder="450" className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
                          <select value={offerForm.frequency} onChange={(e) => setOfferForm((f) => ({ ...f, frequency: e.target.value as Frequency }))} className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 py-1 text-[12px] text-gray-900 dark:text-white">
                            <option value="daily">daily</option>
                            <option value="weekly">weekly</option>
                          </select>
                        </div>
                      </label>
                    </div>
                    {(() => {
                      const a = parseFloat(offerForm.amount), fac = parseFloat(offerForm.factor), pay = parseFloat(offerForm.payment);
                      if (!Number.isFinite(a) || !Number.isFinite(fac)) return null;
                      const pv = burden(Number.isFinite(pay) ? pay : null, offerForm.frequency, monthlyRevenue);
                      return (
                        <p className="text-[11px] text-gray-500">
                          Total payback {money(Math.round(a * fac))}
                          {pv?.pct != null && <span className={pv.hot ? "text-amber-600 font-medium" : ""}> · {pv.pct.toFixed(0)}% of monthly revenue{pv.hot ? " ⚠" : ""}</span>}
                        </p>
                      );
                    })()}
                    {offerError && <p className="text-[11px] text-red-600 dark:text-red-400">{offerError}</p>}
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => saveOffer(s)} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                        {busy ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <CheckCircleIcon className="w-3.5 h-3.5" />} Save offer
                      </button>
                      <button type="button" onClick={() => { setOfferFormFor(null); setOfferError(null); }} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                        <XMarkIcon className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : declineFor === s.id ? (
                  <div className="space-y-2">
                    <input type="text" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason (optional) — e.g. too many positions" className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-[12px] text-gray-900 dark:text-white" />
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => markFunderDeclined(s)} className="text-[11px] font-semibold px-2.5 py-1 rounded bg-rose-600 text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                        {busy ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <HandThumbDownIcon className="w-3.5 h-3.5" />} Record decline
                      </button>
                      <button type="button" onClick={() => { setDeclineFor(null); setDeclineReason(""); }} className="text-[11px] text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                        <XMarkIcon className="w-3.5 h-3.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Row actions */
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {/* Offer cards: accept / merchant-declined */}
                    {hasOffer && !isTerminal && (
                      <>
                        <button type="button" disabled={busy} onClick={() => setOfferOutcome(s, "offer_accepted")} className="text-[10px] font-semibold px-2 py-1 rounded bg-emerald-600 text-white hover:opacity-90 disabled:opacity-50">Mark accepted</button>
                        <button type="button" disabled={busy} onClick={() => setOfferOutcome(s, "offer_declined")} className="text-[10px] font-semibold px-2 py-1 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">Merchant declined</button>
                      </>
                    )}
                    {/* Awaiting / replied cards: log the reply */}
                    {!isTerminal && (
                      <button type="button" onClick={() => openOfferForm(s)} className="text-[10px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 inline-flex items-center gap-1">
                        <CurrencyDollarIcon className="w-3.5 h-3.5" /> {hasOffer ? "Edit offer" : "Log offer"}
                      </button>
                    )}
                    {!isTerminal && !hasOffer && (
                      <button type="button" onClick={() => { setDeclineFor(s.id); setDeclineReason(""); setOfferFormFor(null); }} className="text-[10px] font-semibold px-2 py-1 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 inline-flex items-center gap-1">
                        <HandThumbDownIcon className="w-3.5 h-3.5" /> Funder declined
                      </button>
                    )}
                    {/* Funder-declined cards: courtesy thank-you (idempotent) */}
                    {isFunderDeclined && (
                      s.courtesySentAt ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                          <CheckCircleIcon className="w-3.5 h-3.5" /> Thank-you sent
                        </span>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => sendThankYou(s)} className="text-[10px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 disabled:opacity-50 inline-flex items-center gap-1">
                          {busy ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <EnvelopeIcon className="w-3.5 h-3.5" />} Send thank-you
                        </button>
                      )
                    )}
                    {/* Message the merchant — prefilled from this card's context */}
                    {showMsgButton && (
                      <button type="button" onClick={() => openMessage(s)} className="text-[10px] font-semibold px-2 py-1 rounded border border-ocean-blue/50 text-ocean-blue hover:bg-ocean-blue/5 inline-flex items-center gap-1">
                        <EnvelopeIcon className="w-3.5 h-3.5" /> Message merchant
                      </button>
                    )}
                  </div>
                )}
                {courtesyMsg[s.id] && <p className="text-[10px] text-gray-500 dark:text-gray-400">{courtesyMsg[s.id]}</p>}
              </div>
            );
          })}
        </div>
      )}
      {sorted.some((s) => s.status === "offer_accepted") && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded px-2 py-1.5">
          An offer is accepted. Advance the deal with the step button below — accept/decline here don't move the stage on purpose.
        </p>
      )}

      {msgToast && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded px-2 py-1.5 inline-flex items-center gap-1">
          <CheckCircleIcon className="w-3.5 h-3.5" /> {msgToast}
        </p>
      )}

      {/* Merchant-message audit trail — every send-merchant-email for this deal */}
      {sentLog.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 p-2.5">
          <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1.5 inline-flex items-center gap-1">
            <EnvelopeIcon className="w-3.5 h-3.5" /> Messages sent to the merchant
          </p>
          <ul className="space-y-1.5">
            {sentLog.map((m, i) => (
              <li key={i} className="text-[11px] text-gray-600 dark:text-gray-300">
                <span className="text-gray-400">{new Date(m.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                {" · "}<span className="font-medium text-gray-800 dark:text-gray-100">{m.subject}</span>
                {m.snippet && <span className="text-gray-400"> — {m.snippet.slice(0, 90)}{m.snippet.length > 90 ? "…" : ""}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Message-the-merchant modal — sends via GHL (lands in the merchant's thread) */}
      {msgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !msgBusy && setMsgOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <span className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <EnvelopeIcon className="w-4 h-4 text-ocean-blue" /> Message the merchant
              </span>
              <button type="button" onClick={() => !msgBusy && setMsgOpen(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-[12px] text-gray-600 dark:text-gray-300">
                <span className="text-gray-400">To</span>{" "}
                <span className="font-medium text-gray-900 dark:text-white">{merchantName}</span>
                {merchantEmail ? <span className="text-gray-400"> · {merchantEmail}</span> : <span className="text-rose-500"> · no email on file</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[11px] font-medium text-gray-500">CC
                  <input type="text" value={msgCc} onChange={(e) => setMsgCc(e.target.value)} placeholder="email, email…" className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-[13px] text-gray-900 dark:text-white" />
                </label>
                <label className="block text-[11px] font-medium text-gray-500">BCC
                  <input type="text" value={msgBcc} onChange={(e) => setMsgBcc(e.target.value)} placeholder="email, email…" className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-[13px] text-gray-900 dark:text-white" />
                </label>
              </div>
              <label className="block text-[11px] font-medium text-gray-500">Subject
                <input type="text" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-[13px] text-gray-900 dark:text-white" />
              </label>
              <label className="block text-[11px] font-medium text-gray-500">Message
                <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={9} className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-[13px] text-gray-900 dark:text-white resize-y" />
              </label>
              <p className="text-[10px] text-gray-400">
                Fully editable before you send. We don't name the funder to the merchant — phrase it as "our funding partner". This sends through GHL and lands in the merchant's existing email thread.
              </p>
              {msgError && <p className="text-[12px] text-red-600 dark:text-red-400">{msgError}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={() => setMsgOpen(false)} disabled={msgBusy} className="text-[12px] px-3 py-1.5 rounded text-gray-600 hover:text-gray-800 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={sendMerchantMessage} disabled={msgBusy || !merchantEmail} className="text-[12px] font-semibold px-3 py-1.5 rounded bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1">
                {msgBusy ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <PaperAirplaneIcon className="w-4 h-4" />} Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
