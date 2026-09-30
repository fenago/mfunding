// DeclineCloseOut — "every funder passed": tell the merchant, then park.
//
// One component, two mounts (the Funder chase tab and the Playbook's
// FunderWorkspace), because the words a merchant receives when we close them
// out must not depend on which screen the operator happened to be on.
//
// Order is load-bearing: SEND FIRST, PARK SECOND. A merchant who never got the
// email stays on the board. closeOutDeclined enforces that; this component
// just has to report the failure honestly instead of claiming a park.
//
// Inline, never a browser popup — arm then confirm, 5s auto-disarm (house rule).
import { useCallback, useEffect, useState } from "react";
import supabase from "@/supabase";
import { useSession } from "@/context/SessionContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { LOST_REASON_OPTIONS, type DealWithCustomer, type LostReason } from "@/types/deals";
import {
  CLOSE_OUT_OUTCOMES,
  closeOutBlockReason,
  closeOutDeclined,
  declineCloseoutPrefill,
  isLive,
  type CloseOutOutcome,
  type SubmissionLike,
} from "@/lib/funderSubmissions";

interface GuardRow extends SubmissionLike {
  lenderName: string;
}

type Guard =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; rows: GuardRow[] };

export default function DeclineCloseOut({
  deal,
  /** Already-loaded submissions, when the caller has them — skips the fetch.
   *  Omit and the component loads its own. */
  rows,
  onDone,
}: {
  deal: DealWithCustomer;
  rows?: GuardRow[];
  onDone?: () => void;
}) {
  const { session } = useSession();
  const { profile } = useUserProfile();

  const [guard, setGuard] = useState<Guard>(rows ? { kind: "ready", rows } : { kind: "loading" });
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<CloseOutOutcome>("nurture");
  const [reason, setReason] = useState<LostReason>("funders_declined_all");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const provided = rows !== undefined;

  const loadGuard = useCallback(async () => {
    if (provided) return;
    setGuard({ kind: "loading" });
    const { data, error } = await supabase
      .from("deal_submissions")
      .select("status, submitted_at, response_at, offer_amount, factor_rate, daily_payment, weekly_payment, total_payback, lender:lenders!lender_id ( company_name )")
      .eq("deal_id", deal.id);
    if (error) {
      setGuard({ kind: "error", message: error.message });
      return;
    }
    if (data == null) {
      setGuard({ kind: "error", message: "The submissions read came back empty." });
      return;
    }
    const mapped: GuardRow[] = (data as unknown as Record<string, unknown>[]).map((r) => ({
      lenderName: ((r.lender as { company_name?: string } | null)?.company_name) ?? "Funder",
      status: r.status as string,
      submittedAt: (r.submitted_at as string | null) ?? null,
      responseAt: (r.response_at as string | null) ?? null,
      offerAmount: (r.offer_amount as number | null) ?? null,
      factorRate: (r.factor_rate as number | null) ?? null,
      dailyPayment: (r.daily_payment as number | null) ?? null,
      weeklyPayment: (r.weekly_payment as number | null) ?? null,
      totalPayback: (r.total_payback as number | null) ?? null,
    }));
    setGuard({ kind: "ready", rows: mapped.filter(isLive) });
  }, [deal.id, provided]);

  useEffect(() => {
    if (provided) setGuard({ kind: "ready", rows: rows! });
    else void loadGuard();
  }, [provided, rows, loadGuard]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const cust = deal.customer as { business_name?: string | null; first_name?: string | null; do_not_contact?: boolean | null } | undefined;
  const businessName = cust?.business_name?.trim() || "this merchant";
  const dnd = !!cust?.do_not_contact;
  const senderName =
    profile?.display_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    "Momentum Funding";

  // A guard we could not READ is not a guard that passed. Refuse the close-out
  // rather than risk declining a merchant who has a live offer.
  if (guard.kind === "error") {
    return (
      <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
        <span className="font-bold">Close-out unavailable — couldn&apos;t check for live offers.</span> This is an
        unread check, not a clear one, so the button stays off.
        <span className="ml-1 font-mono opacity-80">{guard.message}</span>
        <button type="button" onClick={() => void loadGuard()} className="ml-1 font-semibold text-ocean-blue hover:underline">
          Try again →
        </button>
      </div>
    );
  }
  if (guard.kind === "loading") {
    return <p className="text-[11px] text-gray-400">Checking for live offers…</p>;
  }

  const blocked = closeOutBlockReason(guard.rows, guard.rows.map((r) => r.lenderName));

  function start() {
    const pre = declineCloseoutPrefill({ businessName: cust?.business_name, firstName: cust?.first_name, senderName });
    setSubject(pre.subject);
    setBody(pre.body);
    setOutcome("nurture");
    setReason("funders_declined_all");
    setArmed(false);
    setErr(null);
    setOpen(true);
  }

  async function run() {
    if (guard.kind !== "ready") return;
    setBusy(true);
    setErr(null);
    try {
      await closeOutDeclined({
        dealId: deal.id,
        outcome,
        reason,
        subject,
        body,
        skipEmail: dnd,
        lenderNames: guard.rows.map((r) => r.lenderName),
        userId: session?.user?.id,
        byName: senderName,
      });
      setOpen(false);
      onDone?.();
    } catch (e) {
      setErr(
        `${e instanceof Error ? e.message : "The close-out failed."} — the deal was NOT moved and is still on the board.`,
      );
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!!blocked}
          title={blocked ?? "Email the merchant that every funder passed, then park the deal"}
          onClick={start}
          className="text-[11px] font-semibold px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Declined — close out
        </button>
        {blocked && <span className="text-[10px] text-amber-600 dark:text-amber-400">{blocked}</span>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-900/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold text-gray-900 dark:text-white">Close out {businessName}</span>
        <button
          type="button"
          onClick={() => { setOpen(false); setArmed(false); setErr(null); }}
          className="ml-auto text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          Cancel ×
        </button>
      </div>

      {dnd ? (
        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          This merchant is marked <span className="font-bold">do-not-contact</span> — no email will be sent. The
          deal will be parked and the reason logged.
        </p>
      ) : (
        <>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">
            This is the merchant&apos;s last contact from us — read it before it goes.
          </p>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
        </>
      )}

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Move to</div>
          <div className="flex gap-1.5">
            {CLOSE_OUT_OUTCOMES.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setOutcome(o.key)}
                aria-pressed={outcome === o.key}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                  outcome === o.key
                    ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                    : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 max-w-xs">
            {CLOSE_OUT_OUTCOMES.find((o) => o.key === outcome)?.hint}
          </p>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Reason</div>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as LostReason)}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
            {LOST_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => { if (armed) void run(); else setArmed(true); }}
        className={`text-[11px] font-semibold px-3 py-1.5 rounded text-white disabled:opacity-50 ${
          armed ? "bg-amber-600" : "bg-rose-600"
        }`}
      >
        {busy
          ? "Working…"
          : armed
            ? dnd
              ? `⚠️ Tap again to park as ${outcome} →`
              : `⚠️ Tap again to email the merchant and park as ${outcome} →`
            : dnd
              ? "Park without emailing"
              : "Send the decline and close out"}
      </button>

      {err && <p className="text-[11px] font-semibold text-red-700 dark:text-red-300">{err}</p>}
    </div>
  );
}
