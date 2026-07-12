import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  SparklesIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/solid";
import { useSession } from "../../context/SessionContext";
import {
  getMyPortalDeals,
  getMyDealSubmissions,
  respondToOffer,
  OfferActionError,
  SUBMITTED_OR_PAST_STATUSES,
  type DealSubmissionView,
} from "../../services/portalService";
import Countdown from "../../components/portal/Countdown";
import { isDeadlinePast } from "../../utils/deadline";

function money(n: number | null): string | null {
  return n == null ? null : `$${Math.round(n).toLocaleString()}`;
}

/** Local decision state per offer, keyed by submission_id (or partner label as
 *  a fallback when the backend hasn't added submission_id yet). */
type Decision = "accepted" | "declined";

function offerKey(sub: DealSubmissionView, i: number): string {
  return sub.submission_id ?? `${sub.partner_label}-${i}`;
}

// ── Plain-language "what do these numbers mean?" — compliance-safe, no APR ─────
function NumbersExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <InformationCircleIcon className="w-5 h-5 text-ocean-blue" />
          What do these numbers mean?
        </span>
        <ChevronDownIcon
          className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Funding amount</p>
            <p>The working capital deposited into your business account.</p>
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Total payback</p>
            <p>
              The full amount you'll send back over the life of the advance — funding amount plus
              the funding partner's fixed cost. It never changes based on time.
            </p>
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Payment</p>
            <p>
              The set amount remitted from your business receipts each business day or week until the
              total payback is met. It's a purchase of a portion of your future sales — not a loan,
              so there's no interest rate.
            </p>
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Term</p>
            <p>The typical time it takes to complete the payments at the expected pace.</p>
          </div>
          <p className="text-xs text-gray-400">
            Your funding specialist will walk through every number with you before anything is
            finalized. You're never charged a fee by us — funding partners compensate us.
          </p>
        </div>
      )}
    </div>
  );
}

// ── One offer card ────────────────────────────────────────────────────────────
function OfferCard({
  sub,
  index,
  total,
  decision,
  deEmphasized,
  busy,
  onAccept,
  onDecline,
}: {
  sub: DealSubmissionView;
  index: number;
  total: number;
  decision: Decision | undefined;
  /** Another offer was accepted — dim this one but keep it actionable. */
  deEmphasized: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const expired = isDeadlinePast(sub.offer_expires_at);
  const amt = money(sub.offer_amount);
  const payback = money(sub.offer_payback);
  const payment = money(sub.offer_payment);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={`rounded-2xl border p-5 flex flex-col transition-opacity ${
        deEmphasized ? "opacity-60" : ""
      } ${
        decision === "accepted"
          ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20"
          : decision === "declined" || expired
            ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60"
            : "border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-800"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          <SparklesIcon className="w-4 h-4" />
          Offer {index + 1}
          {total > 1 ? ` of ${total}` : ""}
        </span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">from {sub.partner_label}</p>

      {/* Headline: funding amount */}
      <div className="mt-4">
        <span className="block text-xs text-gray-500 dark:text-gray-400">Funding amount</span>
        <span className="block text-4xl font-extrabold text-gray-900 dark:text-white">
          {amt ?? "—"}
        </span>
      </div>

      {/* The numbers, in dollars and plain words */}
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {payback && (
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Total payback</dt>
            <dd className="text-lg font-bold text-gray-900 dark:text-white">{payback}</dd>
          </div>
        )}
        {sub.offer_term && (
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Term</dt>
            <dd className="text-lg font-bold text-gray-900 dark:text-white">
              {sub.offer_term} months
            </dd>
          </div>
        )}
        {payment && (
          <div>
            <dt className="text-xs text-gray-500 dark:text-gray-400">Payment</dt>
            <dd className="text-lg font-bold text-gray-900 dark:text-white">
              {payment}
              {sub.offer_frequency ? ` ${sub.offer_frequency}` : ""}
            </dd>
          </div>
        )}
      </dl>

      {/* Expiry */}
      {sub.offer_expires_at && !expired && decision === undefined && (
        <div className="mt-4">
          <Countdown target={sub.offer_expires_at} label="Good through" variant="soft" />
        </div>
      )}

      {/* Actions / states */}
      <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
        {decision === "accepted" ? (
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CheckCircleIcon className="w-5 h-5" />
            <span className="text-sm font-semibold">You chose this offer</span>
          </div>
        ) : decision === "declined" ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">You passed on this offer.</p>
        ) : expired ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This offer has expired — we're checking on updated options.
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-mint-green text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition"
            >
              {busy ? "Working…" : "Accept this offer"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition"
            >
              No thanks
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function ConfirmModal({
  sub,
  mode,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  sub: DealSubmissionView;
  mode: "accept" | "decline";
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const amt = money(sub.offer_amount);
  const payback = money(sub.offer_payback);
  const payment = money(sub.offer_payment);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onCancel}
    >
      <motion.div
        className="w-full sm:max-w-md bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "accept" ? (
          <>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Move forward with this offer?
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              from {sub.partner_label}
            </p>
            <dl className="mt-4 space-y-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-4">
              {amt && (
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-600 dark:text-gray-300">Funding amount</dt>
                  <dd className="text-sm font-bold text-gray-900 dark:text-white">{amt}</dd>
                </div>
              )}
              {payback && (
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-600 dark:text-gray-300">Total payback</dt>
                  <dd className="text-sm font-bold text-gray-900 dark:text-white">{payback}</dd>
                </div>
              )}
              {payment && (
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-600 dark:text-gray-300">Payment</dt>
                  <dd className="text-sm font-bold text-gray-900 dark:text-white">
                    {payment}
                    {sub.offer_frequency ? ` ${sub.offer_frequency}` : ""}
                  </dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              Choosing this doesn't finalize anything — your funding specialist will call to confirm
              the details and next steps with you.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Pass on this offer?
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              You can always change your mind while the offer is still good. If any other options
              come in, we'll show them here.
            </p>
          </>
        )}

        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${
              mode === "accept" ? "bg-mint-green hover:brightness-95" : "bg-gray-700 hover:bg-gray-800"
            }`}
          >
            {busy ? "Working…" : mode === "accept" ? "Yes, move forward" : "Yes, pass on it"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function PortalOffersPage() {
  const { session } = useSession();
  const [offers, setOffers] = useState<DealSubmissionView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [modal, setModal] = useState<{ sub: DealSubmissionView; key: string; mode: "accept" | "decline" } | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;

    const load = async () => {
      setIsLoading(true);
      try {
        const deals = await getMyPortalDeals();
        // Only MCA-family deals that have reached funder submission can have offers.
        const eligible = deals.filter(
          (d) => d.deal_type !== "vcf" && SUBMITTED_OR_PAST_STATUSES.has(d.status),
        );
        const all = await Promise.all(
          eligible.map((d) => getMyDealSubmissions(d.id).catch(() => [])),
        );
        const offerSubs = all.flat().filter((s) => s.status_bucket === "offer");
        setOffers(offerSubs);
      } catch (err) {
        console.error("Failed to load offers:", err);
        setOffers([]);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [session]);

  const confirm = async () => {
    if (!modal) return;
    setModalBusy(true);
    setModalError(null);
    const { sub, key, mode } = modal;
    try {
      if (!sub.submission_id) {
        // No handle to act on yet — the specialist path handles it.
        throw new OfferActionError(
          "Your specialist will finalize this with you — we've noted your choice.",
        );
      }
      await respondToOffer(sub.submission_id, mode === "accept" ? "accept" : "decline");
      setDecisions((d) => ({ ...d, [key]: mode === "accept" ? "accepted" : "declined" }));
      if (mode === "accept") setAccepted(true);
      setModal(null);
    } catch (e) {
      setModalError(
        e instanceof Error ? e.message : "Something went wrong. Please try again.",
      );
    } finally {
      setModalBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green" />
      </div>
    );
  }

  const anyOpen = offers.some((s, i) => decisions[offerKey(s, i)] === undefined && !isDeadlinePast(s.offer_expires_at));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your offers</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {offers.length > 1
            ? "Compare your options side by side. Your funding specialist can walk you through any of them."
            : "Here's your offer. Your funding specialist can walk you through every detail."}
        </p>
      </div>

      {accepted && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-gradient-to-r from-mint-green to-teal-500 p-6 text-white"
        >
          <p className="text-lg font-bold">You're moving forward! 🎉</p>
          <p className="text-sm text-white/90 mt-1">
            Your funding specialist will call you shortly to finalize the details.
          </p>
        </motion.div>
      )}

      {offers.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-gray-600 dark:text-gray-300 font-medium">
            No offers to review right now.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The moment a funding partner comes back with an offer, it'll appear here and we'll let
            you know.
          </p>
          <Link to="/portal" className="btn-primary mt-4 inline-flex">
            Back to your dashboard
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {offers.map((sub, i) => {
              const key = offerKey(sub, i);
              return (
                <OfferCard
                  key={key}
                  sub={sub}
                  index={i}
                  total={offers.length}
                  decision={decisions[key]}
                  deEmphasized={accepted && decisions[key] === undefined}
                  busy={modalBusy && modal?.key === key}
                  onAccept={() => {
                    setModalError(null);
                    setModal({ sub, key, mode: "accept" });
                  }}
                  onDecline={() => {
                    setModalError(null);
                    setModal({ sub, key, mode: "decline" });
                  }}
                />
              );
            })}
          </div>

          {anyOpen && <NumbersExplainer />}
        </>
      )}

      {modal && (
        <ConfirmModal
          sub={modal.sub}
          mode={modal.mode}
          busy={modalBusy}
          error={modalError}
          onConfirm={confirm}
          onCancel={() => {
            if (!modalBusy) setModal(null);
          }}
        />
      )}
    </div>
  );
}
